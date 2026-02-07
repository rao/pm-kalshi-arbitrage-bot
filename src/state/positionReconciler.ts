/**
 * Background position reconciler.
 *
 * Periodically queries actual positions from both venue APIs (source of truth),
 * overrides the local tracker if it disagrees, and takes corrective action
 * on unhedged exposure — either completing the arb or unwinding the excess.
 */

import type { Logger } from "../logging/logger";
import type { InitializedClients } from "../execution/venueClientFactory";
import type { IntervalMapping } from "../markets/mappingStore";
import type { NormalizedQuote } from "../normalization/types";
import type { VenueClients } from "../execution/types";
import type { Venue, Side } from "../strategy/types";
import type { VenuePosition } from "./positionTracker";
import { getPositions, setVenuePositions } from "./positionTracker";
import {
  acquireBusyLock,
  releaseBusyLock,
  markExecutionEnd,
  isExecutionBusy,
  isKillSwitchTriggered,
  isLiquidationInProgress,
  enterCooldown,
  addPendingSettlement,
  recordPnl,
  getLastExecutionEndTs,
} from "../execution/executionState";
import { getPortfolioPositions } from "../venues/kalshi/orders";
import { getCurrentAsk, getCurrentBid } from "../execution/orderPlanner";
import { generateClientOrderId } from "../execution/types";
import { estimateKalshiFee, estimatePolymarketFee } from "../fees/feeEngine";
import { RISK_PARAMS } from "../config/riskParams";
import { isVolatilityExitActive } from "../execution/volatilityExitManager";

/**
 * Venue-reported positions (from API).
 */
export interface VenuePositionReport {
  venue: Venue;
  yes: number;
  no: number;
}

export interface PositionReconcilerOptions {
  /** Initialized venue clients (for API calls) */
  venueClients: InitializedClients;
  /** Logger instance */
  logger: Logger;
  /** How often to reconcile in ms (default: 60000) */
  intervalMs?: number;
  /** Get the current interval mapping */
  getCurrentMapping: () => IntervalMapping | null;
  /** Get the latest quote for a venue */
  getQuote: (venue: Venue) => NormalizedQuote | null;
  /** Get VenueClients interface for order placement */
  getVenueClients: () => VenueClients | null;
  /**
   * Override venue position fetching (for testing).
   * If provided, called instead of the default API-based fetchers.
   */
  fetchPositions?: (mapping: IntervalMapping) => Promise<VenuePositionReport[]>;
}

/** Module-level timer handle */
let reconcilerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic position reconciler.
 */
export function startPositionReconciler(options: PositionReconcilerOptions): void {
  const { logger, intervalMs = 60000 } = options;

  if (reconcilerInterval) {
    logger.warn("[RECONCILER] Already running, stopping old one");
    stopPositionReconciler();
  }

  logger.info(`[RECONCILER] Starting position reconciler (interval=${intervalMs}ms)`);

  // Run first check after a short delay
  setTimeout(() => reconcileTick(options), 10000);

  reconcilerInterval = setInterval(() => reconcileTick(options), intervalMs);
}

/**
 * Stop the position reconciler.
 */
export function stopPositionReconciler(): void {
  if (reconcilerInterval) {
    clearInterval(reconcilerInterval);
    reconcilerInterval = null;
  }
}

/**
 * Fetch actual positions from Kalshi API.
 */
async function fetchKalshiPositions(
  options: PositionReconcilerOptions,
  mapping: IntervalMapping
): Promise<VenuePositionReport | null> {
  const { venueClients, logger } = options;
  if (!venueClients.kalshi || !mapping.kalshi) return null;

  try {
    const response = await getPortfolioPositions(venueClients.kalshi.auth, {
      ticker: mapping.kalshi.marketTicker,
    });

    let yes = 0;
    let no = 0;

    for (const pos of response.market_positions) {
      if (pos.ticker === mapping.kalshi.marketTicker) {
        if (pos.position > 0) {
          yes = pos.position;
        } else if (pos.position < 0) {
          no = Math.abs(pos.position);
        }
      }
    }

    return { venue: "kalshi", yes, no };
  } catch (error) {
    logger.warn(
      `[RECONCILER] Failed to fetch Kalshi positions: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Fetch actual positions from Polymarket API.
 */
async function fetchPolymarketPositions(
  options: PositionReconcilerOptions,
  mapping: IntervalMapping
): Promise<VenuePositionReport | null> {
  const { venueClients, logger } = options;
  if (!venueClients.polymarket || !mapping.polymarket) return null;

  try {
    const [yesBalance, noBalance] = await Promise.all([
      venueClients.polymarket.getConditionalTokenBalance(mapping.polymarket.upToken),
      venueClients.polymarket.getConditionalTokenBalance(mapping.polymarket.downToken),
    ]);

    return {
      venue: "polymarket",
      yes: yesBalance,
      no: noBalance,
    };
  } catch (error) {
    logger.warn(
      `[RECONCILER] Failed to fetch Polymarket positions: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Compare local tracker against venue-reported positions and override if different.
 *
 * @returns true if any mismatch was detected and overridden
 */
function compareAndOverride(
  reports: VenuePositionReport[],
  logger: Logger
): boolean {
  const local = getPositions();
  let mismatchFound = false;

  for (const report of reports) {
    const localPos = local[report.venue];
    const localYes = localPos.yes;
    const localNo = localPos.no;

    // Use tolerance for Polymarket (fractional tokens)
    const tolerance = report.venue === "polymarket" ? 0.01 : 0;
    const yesMismatch = Math.abs(localYes - report.yes) > tolerance;
    const noMismatch = Math.abs(localNo - report.no) > tolerance;

    if (yesMismatch || noMismatch) {
      const maxDiff = Math.max(
        Math.abs(localYes - report.yes),
        Math.abs(localNo - report.no)
      );
      const logFn = maxDiff >= 1.0 ? logger.warn.bind(logger) : logger.info.bind(logger);
      logFn(
        `[RECONCILER] ${maxDiff >= 1.0 ? "MISMATCH" : "Adjusting"} on ${report.venue}: ` +
          `local(yes=${localYes}, no=${localNo}) vs ` +
          `venue(yes=${report.yes}, no=${report.no}) — overriding local`
      );
      setVenuePositions(report.venue, { yes: report.yes, no: report.no });
      mismatchFound = true;
    }
  }

  return mismatchFound;
}

/**
 * Determine the corrective action for unhedged exposure.
 */
interface CorrectiveAction {
  type: "complete" | "unwind";
  /** Venue to place the corrective order on */
  venue: Venue;
  /** Side to buy (complete) or sell (unwind) */
  side: Side;
  /** Number of contracts */
  qty: number;
  /** Price limit for the order */
  price: number;
  /** Market ID for the order */
  marketId: string;
  /** Estimated cost or recovery */
  estimatedPnlImpact: number;
}

/**
 * Decide whether to complete the arb or unwind, and build the corrective action.
 */
function planCorrectiveAction(
  options: PositionReconcilerOptions,
  mapping: IntervalMapping
): CorrectiveAction | null {
  const { logger, getQuote } = options;
  const positions = getPositions();

  const totalYes = positions.polymarket.yes + positions.kalshi.yes;
  const totalNo = positions.polymarket.no + positions.kalshi.no;

  if (Math.abs(totalYes - totalNo) < 1.0) {
    // Balanced (within fee-related tolerance), nothing to do
    return null;
  }

  const excessSide: Side = totalYes > totalNo ? "yes" : "no";
  const missingSide: Side = totalYes > totalNo ? "no" : "yes";
  const imbalanceQty = Math.abs(totalYes - totalNo);

  // Find which venue has the excess (to potentially unwind)
  const excessOnPoly = excessSide === "yes" ? positions.polymarket.yes : positions.polymarket.no;
  const excessOnKalshi = excessSide === "yes" ? positions.kalshi.yes : positions.kalshi.no;
  const excessVenue: Venue = excessOnPoly >= excessOnKalshi ? "polymarket" : "kalshi";

  // For completing: pick the venue with better ask for the missing side
  // For simplicity, prefer Kalshi for completing (better fill rate for FOK)
  const completeVenue: Venue = mapping.kalshi ? "kalshi" : "polymarket";

  const completeQuote = getQuote(completeVenue);
  const excessQuote = getQuote(excessVenue);

  if (!completeQuote || !excessQuote) {
    logger.warn("[RECONCILER] Missing quotes for corrective action, skipping");
    return null;
  }

  // Estimate cost to complete the arb
  const completeAsk = getCurrentAsk(missingSide, completeQuote);
  const completeFee = completeVenue === "kalshi"
    ? estimateKalshiFee(completeAsk, imbalanceQty)
    : estimatePolymarketFee(completeAsk, imbalanceQty);
  // Revenue from completing: $1.00 per contract at settlement minus cost of missing side
  const completeNetPnl = (1.0 * imbalanceQty) - (completeAsk * imbalanceQty) - completeFee;

  // Estimate recovery from unwinding the excess
  const unwindBid = getCurrentBid(excessSide, excessQuote);
  const unwindFee = excessVenue === "kalshi"
    ? estimateKalshiFee(unwindBid, imbalanceQty)
    : estimatePolymarketFee(unwindBid, imbalanceQty);
  const unwindRecovery = (unwindBid * imbalanceQty) - unwindFee;

  // Get the market ID
  let completeMarketId: string | null = null;
  let unwindMarketId: string | null = null;

  if (completeVenue === "kalshi" && mapping.kalshi) {
    completeMarketId = mapping.kalshi.marketTicker;
  } else if (completeVenue === "polymarket" && mapping.polymarket) {
    completeMarketId = missingSide === "yes"
      ? mapping.polymarket.upToken
      : mapping.polymarket.downToken;
  }

  if (excessVenue === "kalshi" && mapping.kalshi) {
    unwindMarketId = mapping.kalshi.marketTicker;
  } else if (excessVenue === "polymarket" && mapping.polymarket) {
    unwindMarketId = excessSide === "yes"
      ? mapping.polymarket.upToken
      : mapping.polymarket.downToken;
  }

  logger.info(
    `[RECONCILER] Unhedged: totalYes=${totalYes}, totalNo=${totalNo}, ` +
      `excess=${excessSide} on ${excessVenue}, missing=${missingSide}. ` +
      `Complete PnL=$${completeNetPnl.toFixed(4)}, Unwind recovery=$${unwindRecovery.toFixed(4)}`
  );

  // Pick whichever loses less money (or makes more)
  if (completeNetPnl >= unwindRecovery && completeMarketId) {
    return {
      type: "complete",
      venue: completeVenue,
      side: missingSide,
      qty: Math.round(imbalanceQty), // contracts are integers
      price: completeAsk,
      marketId: completeMarketId,
      estimatedPnlImpact: completeNetPnl,
    };
  } else if (unwindMarketId) {
    return {
      type: "unwind",
      venue: excessVenue,
      side: excessSide,
      qty: Math.round(imbalanceQty),
      price: unwindBid,
      marketId: unwindMarketId,
      estimatedPnlImpact: -((excessSide === "yes" ? completeAsk : completeAsk) * imbalanceQty - unwindRecovery),
    };
  }

  logger.warn("[RECONCILER] Cannot determine corrective action (no market ID available)");
  return null;
}

/**
 * Execute a corrective action (complete arb or unwind excess).
 */
async function executeCorrectiveAction(
  action: CorrectiveAction,
  options: PositionReconcilerOptions,
  mapping: IntervalMapping
): Promise<void> {
  const { logger, getVenueClients } = options;
  const venueClients = getVenueClients();
  if (!venueClients) {
    logger.warn("[RECONCILER] No venue clients available for corrective action");
    return;
  }

  // Acquire busy lock
  if (!acquireBusyLock()) {
    logger.info("[RECONCILER] Busy lock held, deferring corrective action to next tick");
    return;
  }

  try {
    if (action.type === "complete") {
      logger.info(
        `[RECONCILER] Completing arb: BUY ${action.qty} ${action.side} on ${action.venue} @ $${action.price.toFixed(4)}`
      );

      const result = await venueClients.placeOrder({
        venue: action.venue,
        side: action.side,
        action: "buy",
        price: action.price,
        qty: action.qty,
        timeInForce: "IOC",
        marketId: action.marketId,
        clientOrderId: generateClientOrderId(action.venue, "U"),
      });

      if (result.success && result.fillQty > 0) {
        logger.info(
          `[RECONCILER] Complete arb FILLED: ${result.fillQty} contracts @ $${result.fillPrice.toFixed(4)}`
        );

        // Add pending settlement for the completed box
        if (mapping.intervalKey) {
          addPendingSettlement({
            executionId: `reconciler_${Date.now()}`,
            intervalKey: mapping.intervalKey,
            settlesAt: mapping.intervalKey.endTs * 1000,
            expectedPnl: action.estimatedPnlImpact,
            actualCost: result.fillPrice * result.fillQty,
            qty: result.fillQty,
            completedAt: Date.now(),
          });
        }
      } else {
        logger.warn(
          `[RECONCILER] Complete arb FAILED: ${result.error ?? "no fill"}`
        );
      }
    } else {
      // Unwind
      logger.info(
        `[RECONCILER] Unwinding excess: SELL ${action.qty} ${action.side} on ${action.venue} @ $${action.price.toFixed(4)}`
      );

      const result = await venueClients.placeOrder({
        venue: action.venue,
        side: action.side,
        action: "sell",
        price: action.venue === "kalshi" ? 0.01 : action.price,
        qty: action.qty,
        timeInForce: "IOC",
        orderType: action.venue === "kalshi" ? "market" : "limit",
        marketId: action.marketId,
        clientOrderId: generateClientOrderId(action.venue, "U"),
        reduceOnly: true,
      });

      if (result.success && result.fillQty > 0) {
        const loss = (action.price - result.fillPrice) * result.fillQty;
        logger.info(
          `[RECONCILER] Unwind FILLED: ${result.fillQty} contracts @ $${result.fillPrice.toFixed(4)}, ` +
            `estimated loss: $${loss.toFixed(4)}`
        );
        recordPnl(-Math.abs(loss));
      } else {
        logger.warn(
          `[RECONCILER] Unwind FAILED: ${result.error ?? "no fill"}`
        );
      }
    }

    // Enter cooldown after corrective action
    enterCooldown();
  } finally {
    markExecutionEnd();
    releaseBusyLock();
  }
}

/**
 * Single reconciliation tick.
 */
export async function reconcileTick(options: PositionReconcilerOptions): Promise<void> {
  const { logger, getCurrentMapping } = options;

  try {
    // 1. Get current mapping
    const mapping = getCurrentMapping();
    if (!mapping) {
      logger.debug("[RECONCILER] No current mapping, skipping");
      return;
    }

    // 1b. Skip if volatility exit is in progress
    if (isVolatilityExitActive()) return;

    // 1c. Skip if within grace period after last execution.
    // Venue APIs (especially Polymarket on-chain) may not reflect recent fills yet.
    // The local tracker is authoritative immediately after execution.
    const msSinceLastExec = Date.now() - getLastExecutionEndTs();
    if (msSinceLastExec < RISK_PARAMS.reconcilerPostExecGracePeriodMs) {
      logger.debug(
        `[RECONCILER] Within post-execution grace period (${Math.round(msSinceLastExec / 1000)}s / ` +
        `${RISK_PARAMS.reconcilerPostExecGracePeriodMs / 1000}s), skipping tick`
      );
      return;
    }

    // 2. Fetch actual positions from both venues (read-only, no lock needed)
    let reports: VenuePositionReport[];
    if (options.fetchPositions) {
      reports = await options.fetchPositions(mapping);
    } else {
      const [kalshiReport, polyReport] = await Promise.all([
        fetchKalshiPositions(options, mapping),
        fetchPolymarketPositions(options, mapping),
      ]);
      reports = [];
      if (kalshiReport) reports.push(kalshiReport);
      if (polyReport) reports.push(polyReport);
    }

    if (reports.length === 0) {
      logger.debug("[RECONCILER] Could not fetch positions from any venue, skipping");
      return;
    }

    // 3. Compare and override local tracker
    const hadMismatch = compareAndOverride(reports, logger);

    if (!hadMismatch) {
      logger.debug("[RECONCILER] Positions match, no action needed");
    }

    // 4. Check for unhedged exposure (after potential override)
    const positions = getPositions();
    const totalYes = positions.polymarket.yes + positions.kalshi.yes;
    const totalNo = positions.polymarket.no + positions.kalshi.no;

    if (Math.abs(totalYes - totalNo) < 1.0) {
      // Balanced (within fee-related tolerance)
      return;
    }

    logger.warn(
      `[RECONCILER] Unhedged exposure detected: totalYes=${totalYes}, totalNo=${totalNo}`
    );

    // 5. Guard checks before corrective action
    if (isExecutionBusy()) {
      logger.info("[RECONCILER] Execution busy, deferring corrective action to next tick");
      return;
    }

    if (isLiquidationInProgress()) {
      logger.info("[RECONCILER] Liquidation in progress, skipping corrective action");
      return;
    }

    // 6. Plan corrective action
    const action = planCorrectiveAction(options, mapping);
    if (!action) {
      return;
    }

    // Kill switch blocks corrective BUYS but allows unwind SELLS
    if (isKillSwitchTriggered() && action.type === "complete") {
      logger.info("[RECONCILER] Kill switch active, blocking corrective BUY (but would allow unwind sells)");
      return;
    }

    // 7. Execute corrective action
    await executeCorrectiveAction(action, options, mapping);
  } catch (error) {
    logger.error(
      `[RECONCILER] Tick error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
