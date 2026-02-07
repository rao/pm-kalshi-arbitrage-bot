/**
 * Pre-close safety unwind module.
 *
 * Starting ~70s before market close, automatically sells up to 95% of ALL
 * positions on BOTH venues to avoid dead zone risk near interval boundaries.
 *
 * Trade-off: sacrifices box profit (which would settle at $1) for safety
 * against oracle divergence and settlement issues in the final seconds.
 */

import type { Venue, Side } from "../strategy/types";
import type { Logger } from "../logging/logger";
import type { InitializedClients } from "./venueClientFactory";
import type { IntervalMapping } from "../markets/mappingStore";
import { Side as PolySide } from "../venues/polymarket/client";
import { createOrder as kalshiCreateOrder } from "../venues/kalshi/orders";
import type { KalshiOrderRequest } from "../venues/kalshi/types";
import { RISK_PARAMS } from "../config/riskParams";
import { msUntilRollover, getIntervalKey } from "../time/interval";
import {
  getPositions,
  getMarketIdForPosition,
  recordFill,
  hasAnyPosition,
} from "../state";
import {
  isExecutionBusy,
  isLiquidationInProgress,
} from "./executionState";

// --- Options ---

export interface PreCloseOptions {
  venueClients: InitializedClients;
  logger: Logger;
  getCurrentMapping: () => IntervalMapping | null;
  dryRun: boolean;
}

// --- Module state ---

let preCloseTimer: ReturnType<typeof setTimeout> | null = null;
let preCloseActive = false;

// --- Public API ---

/**
 * Check if pre-close unwind is currently active (blocks new arb scanning).
 */
export function isPreCloseUnwindActive(): boolean {
  return preCloseActive;
}

/**
 * Schedule the pre-close timer for the current interval.
 */
export function startPreCloseTimer(options: PreCloseOptions): void {
  // Clear any existing timer
  if (preCloseTimer !== null) {
    clearTimeout(preCloseTimer);
    preCloseTimer = null;
  }

  const msUntil = msUntilRollover();
  const triggerIn = msUntil - RISK_PARAMS.preCloseUnwindMs;

  if (msUntil <= 0) {
    // At boundary, rollover will reschedule
    options.logger.debug("[PRE-CLOSE] At interval boundary, skipping timer (rollover will reschedule)");
    return;
  }

  if (triggerIn > 0) {
    // Schedule for future
    preCloseTimer = setTimeout(() => {
      executePreCloseUnwind(options).catch((err) => {
        options.logger.error(
          `[PRE-CLOSE] Unwind error: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }, triggerIn);
    options.logger.info(`[PRE-CLOSE] Timer scheduled to fire in ${Math.round(triggerIn / 1000)}s (${Math.round(msUntil / 1000)}s until rollover)`);
  } else {
    // Already past trigger point — fire immediately
    options.logger.info(`[PRE-CLOSE] Already within pre-close window (${Math.round(msUntil / 1000)}s until rollover), firing immediately`);
    executePreCloseUnwind(options).catch((err) => {
      options.logger.error(
        `[PRE-CLOSE] Unwind error: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }
}

/**
 * Stop the pre-close timer and reset the active flag.
 * Called on rollover and shutdown.
 */
export function stopPreCloseTimer(): void {
  if (preCloseTimer !== null) {
    clearTimeout(preCloseTimer);
    preCloseTimer = null;
  }
  preCloseActive = false;
}

/**
 * Stop current timer + start a new one for the new interval.
 * Called on ROLLOVER_COMPLETED.
 */
export function reschedulePreCloseTimer(options: PreCloseOptions): void {
  stopPreCloseTimer();
  startPreCloseTimer(options);
}

/**
 * Reset all module state (for testing only).
 */
export function resetPreCloseState(): void {
  stopPreCloseTimer();
  preCloseActive = false;
}

// --- Sell execution ---

interface SellTarget {
  venue: Venue;
  side: Side;
  qty: number;
  marketId: string;
}

interface SellResult {
  venue: Venue;
  side: Side;
  targetQty: number;
  soldQty: number;
  success: boolean;
  error?: string;
}

/**
 * Execute the pre-close unwind: sell ~95% of all positions on both venues.
 */
export async function executePreCloseUnwind(options: PreCloseOptions): Promise<void> {
  const { venueClients, logger, getCurrentMapping, dryRun } = options;

  // 1. Set flag immediately — blocks new arb scanning
  preCloseActive = true;
  logger.info("[PRE-CLOSE] === PRE-CLOSE SAFETY UNWIND STARTED ===");

  // 2. Check positions
  if (!hasAnyPosition()) {
    logger.info("[PRE-CLOSE] No positions held, keeping flag active until rollover");
    return;
  }

  // 3. Wait for busy execution to finish (up to 5s)
  if (isExecutionBusy()) {
    logger.info("[PRE-CLOSE] Execution in progress, waiting up to 5s...");
    const waitStart = Date.now();
    while (isExecutionBusy() && Date.now() - waitStart < 5000) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (isExecutionBusy()) {
      logger.warn("[PRE-CLOSE] Execution still busy after 5s, proceeding anyway");
    }
  }

  // 4. Skip if liquidation in progress
  if (isLiquidationInProgress()) {
    logger.warn("[PRE-CLOSE] Liquidation in progress, deferring to liquidator");
    return;
  }

  // 5. Build sell list
  const positions = getPositions();
  const mapping = getCurrentMapping();
  const retainPct = RISK_PARAMS.preCloseRetainPct;
  const sellTargets: SellTarget[] = [];

  const venuesSides: Array<{ venue: Venue; side: Side; position: number }> = [
    { venue: "polymarket", side: "yes", position: positions.polymarket.yes },
    { venue: "polymarket", side: "no", position: positions.polymarket.no },
    { venue: "kalshi", side: "yes", position: positions.kalshi.yes },
    { venue: "kalshi", side: "no", position: positions.kalshi.no },
  ];

  for (const { venue, side, position } of venuesSides) {
    if (position <= 0) continue;

    const sellQty = Math.floor(position * (1 - retainPct));
    if (sellQty <= 0) continue;

    // Get market ID from mapping or fallback to position tracker
    let marketId: string | null = null;
    if (mapping) {
      if (venue === "polymarket" && mapping.polymarket) {
        marketId = side === "yes" ? mapping.polymarket.upToken : mapping.polymarket.downToken;
      } else if (venue === "kalshi" && mapping.kalshi) {
        marketId = mapping.kalshi.marketTicker;
      }
    }
    if (!marketId) {
      marketId = getMarketIdForPosition(venue, side);
    }
    if (!marketId) {
      logger.error(`[PRE-CLOSE] No market ID for ${venue} ${side}, skipping`);
      continue;
    }

    sellTargets.push({ venue, side, qty: sellQty, marketId });
  }

  if (sellTargets.length === 0) {
    logger.info("[PRE-CLOSE] No sell targets (positions too small to sell)");
    return;
  }

  logger.info(
    `[PRE-CLOSE] Sell targets: ${sellTargets.map(
      (t) => `${t.venue} ${t.side}=${t.qty}`
    ).join(", ")}`
  );

  if (dryRun) {
    logger.info("[PRE-CLOSE] DRY RUN — skipping actual sells");
    return;
  }

  // 6. Execute sells in parallel
  const results = await executeSells(sellTargets, venueClients, logger);

  // 7. Single retry for failed sells after 2s
  const failedTargets = results
    .filter((r) => !r.success)
    .map((r) => sellTargets.find((t) => t.venue === r.venue && t.side === r.side)!)
    .filter(Boolean);

  if (failedTargets.length > 0) {
    logger.info(`[PRE-CLOSE] Retrying ${failedTargets.length} failed sells after 2s...`);
    await new Promise((r) => setTimeout(r, 2000));
    const retryResults = await executeSells(failedTargets, venueClients, logger);

    // Merge retry results
    for (const retry of retryResults) {
      const idx = results.findIndex((r) => r.venue === retry.venue && r.side === retry.side);
      if (idx >= 0) {
        results[idx].soldQty += retry.soldQty;
        results[idx].success = results[idx].soldQty >= results[idx].targetQty * 0.5;
      }
    }
  }

  // 8. Log summary
  const finalPositions = getPositions();
  logger.info(
    `[PRE-CLOSE] === UNWIND COMPLETE ===\n` +
    `  Results: ${results.map(
      (r) => `${r.venue} ${r.side}: sold ${r.soldQty}/${r.targetQty} (${r.success ? "OK" : "PARTIAL"})`
    ).join("; ")}\n` +
    `  Final positions: poly(yes=${finalPositions.polymarket.yes}, no=${finalPositions.polymarket.no}) ` +
    `kalshi(yes=${finalPositions.kalshi.yes}, no=${finalPositions.kalshi.no})`
  );
}

/**
 * Execute sells for a list of targets in parallel.
 */
async function executeSells(
  targets: SellTarget[],
  clients: InitializedClients,
  logger: Logger
): Promise<SellResult[]> {
  const promises = targets.map(async (target): Promise<SellResult> => {
    try {
      let adjustedQty = target.qty;

      // For Polymarket, cap sell qty to actual on-chain balance
      if (target.venue === "polymarket" && clients.polymarket) {
        try {
          const actualBalance = await clients.polymarket.getConditionalTokenBalance(target.marketId);
          if (actualBalance <= 0) {
            logger.info(`[PRE-CLOSE] ${target.venue} ${target.side} balance=0, skipping`);
            return { venue: target.venue, side: target.side, targetQty: target.qty, soldQty: 0, success: true };
          }
          const maxSell = Math.floor(actualBalance * 0.95);
          if (maxSell < adjustedQty) {
            logger.info(`[PRE-CLOSE] Capping ${target.venue} ${target.side} sell from ${adjustedQty} to ${maxSell} (on-chain balance=${actualBalance.toFixed(2)})`);
            adjustedQty = maxSell;
          }
        } catch {
          logger.warn(`[PRE-CLOSE] Could not query balance for ${target.venue} ${target.side}, using tracker qty`);
        }
      }

      if (adjustedQty <= 0) {
        return { venue: target.venue, side: target.side, targetQty: target.qty, soldQty: 0, success: true };
      }

      let fillQty = 0;

      if (target.venue === "polymarket") {
        fillQty = await sellPolymarket(clients, target.marketId, target.side, adjustedQty, logger);
      } else {
        fillQty = await sellKalshi(clients, target.marketId, target.side, adjustedQty, logger);
      }

      if (fillQty > 0) {
        recordFill(target.venue, target.side, "sell", fillQty, 0.01, getIntervalKey(), `preclose_${Date.now()}`, target.marketId);
        logger.info(`[PRE-CLOSE] Sold ${fillQty} ${target.venue} ${target.side}`);
      }

      return {
        venue: target.venue,
        side: target.side,
        targetQty: target.qty,
        soldQty: fillQty,
        success: fillQty > 0,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[PRE-CLOSE] Sell failed for ${target.venue} ${target.side}: ${errMsg}`);
      return {
        venue: target.venue,
        side: target.side,
        targetQty: target.qty,
        soldQty: 0,
        success: false,
        error: errMsg,
      };
    }
  });

  return Promise.all(promises);
}

// --- Venue sell helpers ---

/**
 * Sell on Polymarket using FAK at $0.01 (worst-case price).
 */
async function sellPolymarket(
  clients: InitializedClients,
  tokenId: string,
  side: Side,
  qty: number,
  logger: Logger
): Promise<number> {
  if (!clients.polymarket) {
    throw new Error("Polymarket client not initialized");
  }

  const result = await clients.polymarket.placeFakOrder({
    tokenId,
    price: 0.01,
    amount: qty,
    side: PolySide.SELL,
  });

  if (result.success && result.takingAmount) {
    const tokensSold = parseFloat(result.makingAmount ?? "0");
    return tokensSold > 0 ? tokensSold : qty;
  }

  if (!result.success && result.errorMsg) {
    throw new Error(result.errorMsg);
  }

  return 0;
}

/**
 * Sell on Kalshi using IOC at 1 cent with reduce_only.
 */
async function sellKalshi(
  clients: InitializedClients,
  ticker: string,
  side: Side,
  qty: number,
  logger: Logger
): Promise<number> {
  if (!clients.kalshi) {
    throw new Error("Kalshi client not initialized");
  }

  const request: KalshiOrderRequest = {
    ticker,
    side,
    action: "sell",
    count: Math.floor(qty),
    type: "limit",
    time_in_force: "immediate_or_cancel",
    reduce_only: true,
  };

  if (side === "yes") {
    request.yes_price = 1;
  } else {
    request.no_price = 1;
  }

  const response = await kalshiCreateOrder(clients.kalshi.auth, request);
  const order = response.order;
  const fillQty = (order.count ?? 0) - (order.remaining_count ?? 0);
  return fillQty;
}
