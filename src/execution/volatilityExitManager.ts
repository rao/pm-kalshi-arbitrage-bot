/**
 * Volatility Exit Manager.
 *
 * State machine that monitors BTC price oscillation around the reference price
 * during the active window (last 7.5 min of interval) and proactively exits
 * positions when dangerous oscillation patterns are detected.
 *
 * Also provides a trading halt function for the last 1 minute of volatile intervals.
 *
 * States: IDLE → MONITORING → SELLING_FIRST → SELLING_SECOND → DONE → IDLE
 */

import type { Logger } from "../logging/logger";
import type { InitializedClients } from "./venueClientFactory";
import type { IntervalMapping } from "../markets/mappingStore";
import type { NormalizedQuote } from "../normalization/types";
import type { Venue, Side } from "../strategy/types";
import type { BtcPriceUpdate } from "../venues/polymarket/rtds";
import { Side as PolySide } from "../venues/polymarket/client";
import { createOrder as kalshiCreateOrder, getPortfolioPositions as kalshiGetPositions } from "../venues/kalshi/orders";
import type { KalshiOrderRequest } from "../venues/kalshi/types";
import { RISK_PARAMS } from "../config/riskParams";
import { msUntilRollover, getIntervalKey } from "../time/interval";
import {
  recordPrice,
  setReferencePrice,
  getReferencePrice,
  getAnalytics,
  resetForInterval as resetPriceStore,
  resetCrossingCount,
} from "../data/btcPriceStore";
import {
  getPositions,
  hasAnyPosition,
  getMarketIdForPosition,
  recordFill,
  getEntryVwap,
} from "../state";
import {
  isExecutionBusy,
  isKillSwitchTriggered,
  isLiquidationInProgress,
} from "./executionState";

export type VolatilityExitState =
  | "IDLE"
  | "MONITORING"
  | "SELLING_FIRST"
  | "SELLING_SECOND"
  | "DONE";

export interface VolatilityExitDeps {
  logger: Logger;
  venueClients: InitializedClients;
  getCurrentMapping: () => IntervalMapping | null;
  getQuote: (venue: Venue) => NormalizedQuote | null;
  dryRun: boolean;
  /** Override msUntilRollover for testing. */
  getMsUntilRollover?: () => number;
  /** Override API position fetching for testing. */
  fetchApiPositions?: () => Promise<{
    polymarket: { yes: number; no: number };
    kalshi: { yes: number; no: number };
  }>;
}

interface SellTarget {
  venue: Venue;
  side: Side;
  qty: number;
  marketId: string;
  entryVwap: number;
  currentBid: number;
  profitability: number;
}

/**
 * Volatility Exit Manager.
 *
 * Class-based for dependency injection and testability.
 */
export class VolatilityExitManager {
  private deps: VolatilityExitDeps;
  private state: VolatilityExitState = "IDLE";
  private _processing = false;
  private referenceSet = false;
  private secondSellStartTs: number | null = null;
  private pendingSecondTarget: SellTarget | null = null;
  private firstSoldQty = 0;
  private lastFailedTriggerTs: number | null = null;
  private failedSides: Set<string> = new Set();

  constructor(deps: VolatilityExitDeps) {
    this.deps = deps;
  }

  /** Get current state machine state. */
  getState(): VolatilityExitState {
    return this.state;
  }

  /**
   * Returns true when a volatility exit is actively selling.
   * Blocks arb scanning and pre-close unwind.
   */
  isActive(): boolean {
    return (
      this.state === "SELLING_FIRST" ||
      this.state === "SELLING_SECOND" ||
      this.state === "DONE"
    );
  }

  /**
   * Should new arb trading be halted due to volatility in the final minute?
   *
   * Returns true when:
   * - In last 1 minute of interval
   * - crossingCount >= threshold
   * - rangeUsd >= threshold
   */
  shouldHaltTrading(): boolean {
    if (!RISK_PARAMS.volatilityExitEnabled) return false;

    const msLeft = this.getMsUntilRollover();
    if (msLeft > RISK_PARAMS.volatilityHaltWindowMs) return false;

    const analytics = getAnalytics();
    return (
      analytics.crossingCount >= RISK_PARAMS.volatilityExitCrossingThreshold &&
      analytics.rangeUsd >= RISK_PARAMS.volatilityExitRangeThresholdUsd
    );
  }

  /**
   * Called on every Binance BTC price tick.
   * Feeds price to btcPriceStore and drives the state machine.
   */
  async onBtcPriceUpdate(update: BtcPriceUpdate): Promise<void> {
    if (this._processing) return;
    this._processing = true;
    try {
      // 1. Set reference price from first tick of interval
      if (!this.referenceSet) {
        setReferencePrice(update.price);
        this.referenceSet = true;
        this.deps.logger.debug(
          `[VOL-EXIT] Reference price set: $${update.price.toFixed(2)}`
        );
      }

      // 2. Feed to btcPriceStore
      recordPrice(update.price, update.ts_local);

      // 3. State machine
      if (!RISK_PARAMS.volatilityExitEnabled) return;

      switch (this.state) {
        case "IDLE":
          this.checkTransitionToMonitoring();
          break;

        case "MONITORING":
          await this.checkTrigger();
          break;

        case "SELLING_SECOND":
          await this.checkSecondSell();
          break;

        // SELLING_FIRST and DONE: no per-tick action needed
      }
    } finally {
      this._processing = false;
    }
  }

  /**
   * Reset for a new interval.
   */
  resetForInterval(): void {
    this.state = "IDLE";
    this._processing = false;
    this.referenceSet = false;
    this.secondSellStartTs = null;
    this.pendingSecondTarget = null;
    this.firstSoldQty = 0;
    this.lastFailedTriggerTs = null;
    this.failedSides.clear();
    resetPriceStore();
  }

  /**
   * Stop the manager (cleanup on shutdown).
   */
  stop(): void {
    this.state = "IDLE";
    this._processing = false;
    this.secondSellStartTs = null;
    this.pendingSecondTarget = null;
    this.lastFailedTriggerTs = null;
    this.failedSides.clear();
  }

  // --- Private state machine methods ---

  private checkTransitionToMonitoring(): void {
    if (!hasAnyPosition()) return;

    const msLeft = this.getMsUntilRollover();
    if (msLeft > RISK_PARAMS.volatilityExitWindowMs) return;

    this.state = "MONITORING";
    resetCrossingCount();
    this.deps.logger.info(
      `[VOL-EXIT] Entered MONITORING (${Math.round(msLeft / 1000)}s until rollover, positions held, crossings reset)`
    );
  }

  private async checkTrigger(): Promise<void> {
    const analytics = getAnalytics();

    // Check trigger conditions
    if (analytics.crossingCount < RISK_PARAMS.volatilityExitCrossingThreshold) return;
    if (analytics.rangeUsd < RISK_PARAMS.volatilityExitRangeThresholdUsd) return;

    // Fix 2: Cooldown after all-targets-failed cycle
    if (this.lastFailedTriggerTs !== null) {
      const sinceLastFail = Date.now() - this.lastFailedTriggerTs;
      if (sinceLastFail < RISK_PARAMS.volatilityExitFailedTriggerCooldownMs) return;
    }

    // Guard checks
    if (isExecutionBusy()) {
      this.deps.logger.debug("[VOL-EXIT] Execution busy, deferring trigger");
      return;
    }
    if (isLiquidationInProgress()) return;

    // Check for stale price data
    const analytics2 = getAnalytics();
    if (analytics2.sampleCount === 0) return;

    this.deps.logger.info(
      `[VOL-EXIT] TRIGGERED: crossings=${analytics.crossingCount}, ` +
        `range=$${analytics.rangeUsd.toFixed(0)}, ref=$${analytics.referencePrice?.toFixed(2)}`
    );

    // Determine sell order
    const targets = await this.buildSellTargets();
    if (targets.length === 0) {
      this.deps.logger.info("[VOL-EXIT] No sellable positions found, returning to IDLE");
      this.state = "IDLE";
      return;
    }

    // Sort by profitability descending — sell most profitable first
    targets.sort((a, b) => b.profitability - a.profitability);

    this.deps.logger.info(
      `[VOL-EXIT] Sell order: ${targets.map(
        (t) => `${t.venue} ${t.side} profit=${t.profitability.toFixed(4)}`
      ).join(" → ")}`
    );

    // Loop through ALL targets with zone-based profitability gate
    this.state = "SELLING_FIRST";
    let firstSoldTarget: SellTarget | null = null;
    let soldQty = 0;
    let anyAttempted = false;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];

      // Apply zone-based profitability threshold to first sell
      const { zone, threshold } = this.getZoneProfitThreshold();
      if (target.profitability < threshold) {
        this.deps.logger.info(
          `[VOL-EXIT] Skipping ${target.venue} ${target.side}: profit=${target.profitability.toFixed(4)} ` +
            `below ${zone} threshold (${threshold === -Infinity ? "-Inf" : threshold.toFixed(2)})`
        );
        continue;
      }

      anyAttempted = true;
      this.deps.logger.info(
        `[VOL-EXIT] Attempting sell ${i + 1}/${targets.length}: ` +
          `${target.venue} ${target.side} qty=${target.qty}`
      );

      soldQty = await this.executeSellWithRetries(target);
      if (soldQty > 0) {
        firstSoldTarget = target;
        this.firstSoldQty = soldQty;
        this.deps.logger.info(
          `[VOL-EXIT] First sell complete: ${soldQty} ${target.venue} ${target.side}`
        );

        // Set up remaining targets (excluding sold + failed sides) for second sell
        const remaining = targets.filter(
          (t, idx) =>
            idx > i && !this.failedSides.has(`${t.venue}_${t.side}`)
        );

        if (remaining.length > 0) {
          this.pendingSecondTarget = remaining[0];
          this.pendingSecondTarget.qty = Math.min(
            this.pendingSecondTarget.qty,
            soldQty
          );
          this.secondSellStartTs = Date.now();
          this.state = "SELLING_SECOND";
          this.deps.logger.info(
            `[VOL-EXIT] Waiting for second sell: ${this.pendingSecondTarget.venue} ${this.pendingSecondTarget.side}`
          );
          await this.checkSecondSell();
        } else {
          this.state = "DONE";
          this.deps.logger.info("[VOL-EXIT] Exit complete (single position)");
        }
        return;
      } else {
        this.deps.logger.warn(
          `[VOL-EXIT] Sell ${i + 1}/${targets.length} got no fill: ` +
            `${target.venue} ${target.side}`
        );
      }
    }

    if (!anyAttempted) {
      // All targets skipped (none met profitability threshold) — return to MONITORING without cooldown
      this.deps.logger.info(
        "[VOL-EXIT] All targets below profitability threshold, returning to MONITORING"
      );
      this.state = "MONITORING";
    } else {
      // All attempted targets failed — cooldown and return to monitoring
      this.deps.logger.warn(
        "[VOL-EXIT] All sell targets failed, entering cooldown and returning to MONITORING"
      );
      this.lastFailedTriggerTs = Date.now();
      this.state = "MONITORING";
    }
  }

  private async checkSecondSell(): Promise<void> {
    if (!this.pendingSecondTarget || !this.secondSellStartTs) return;

    const target = this.pendingSecondTarget;
    const elapsed = Date.now() - this.secondSellStartTs;

    // Refresh current bid
    const quote = this.deps.getQuote(target.venue);
    if (quote) {
      target.currentBid = this.getBidFromQuote(target.side, quote);
      target.profitability = target.currentBid - target.entryVwap;
    }

    // Dynamic zone based on time-to-rollover
    const { zone, threshold } = this.getZoneProfitThreshold();
    const msLeft = this.getMsUntilRollover();
    const shouldSell = target.profitability >= threshold;

    if (shouldSell) {
      if (zone === "emergency") {
        this.deps.logger.warn(
          `[VOL-EXIT] EMERGENCY sell (${Math.round(msLeft / 1000)}s left, ${Math.round(elapsed / 1000)}s elapsed), ` +
            `profit=${target.profitability.toFixed(4)}`
        );
      } else if (zone === "breakeven") {
        this.deps.logger.info(
          `[VOL-EXIT] Breakeven zone sell (${Math.round(msLeft / 1000)}s left): ${target.venue} ${target.side} ` +
            `profit=${target.profitability.toFixed(4)}`
        );
      } else {
        this.deps.logger.info(
          `[VOL-EXIT] Patient zone sell: ${target.venue} ${target.side} ` +
            `profit=${target.profitability.toFixed(4)}`
        );
      }

      const soldQty = await this.executeSellWithRetries(target);
      if (soldQty > 0) {
        this.deps.logger.info(
          `[VOL-EXIT] Second sell complete: ${soldQty} ${target.venue} ${target.side}`
        );
      } else {
        this.deps.logger.warn("[VOL-EXIT] Second sell got no fill");
      }

      this.state = "DONE";
      this.pendingSecondTarget = null;
      this.secondSellStartTs = null;
      this.deps.logger.info("[VOL-EXIT] Exit complete");
    } else {
      // Log zone status periodically (every ~5s based on BTC tick frequency)
      if (Math.round(elapsed / 1000) % 5 === 0 && elapsed > 0) {
        this.deps.logger.debug(
          `[VOL-EXIT] Waiting in ${zone} zone (${Math.round(msLeft / 1000)}s left, ${Math.round(elapsed / 1000)}s elapsed): ` +
            `${target.venue} ${target.side} profit=${target.profitability.toFixed(4)}`
        );
      }
    }
  }

  private getZoneProfitThreshold(): { zone: "patient" | "breakeven" | "emergency"; threshold: number } {
    const msLeft = this.getMsUntilRollover();
    if (msLeft < RISK_PARAMS.volatilityExitBreakevenThresholdMs) {
      return { zone: "emergency", threshold: -Infinity };
    } else if (msLeft < RISK_PARAMS.volatilityExitPatientThresholdMs) {
      return { zone: "breakeven", threshold: 0 };
    } else {
      return { zone: "patient", threshold: RISK_PARAMS.volatilityExitMinProfitPerShare };
    }
  }

  /**
   * Fetch actual positions from venue APIs, falling back to local tracker per-venue on failure.
   */
  private async fetchApiPositionsFromVenues(): Promise<{
    polymarket: { yes: number; no: number };
    kalshi: { yes: number; no: number };
  }> {
    // Use dep override if provided (for testing)
    if (this.deps.fetchApiPositions) {
      return this.deps.fetchApiPositions();
    }

    const mapping = this.deps.getCurrentMapping();
    const localPositions = getPositions();
    let polymarket = { yes: localPositions.polymarket.yes, no: localPositions.polymarket.no };
    let kalshi = { yes: localPositions.kalshi.yes, no: localPositions.kalshi.no };

    // Fetch Polymarket positions from API
    if (this.deps.venueClients.polymarket && mapping?.polymarket) {
      try {
        const [yesBalance, noBalance] = await Promise.all([
          this.deps.venueClients.polymarket.getConditionalTokenBalance(mapping.polymarket.upToken),
          this.deps.venueClients.polymarket.getConditionalTokenBalance(mapping.polymarket.downToken),
        ]);
        polymarket = { yes: yesBalance, no: noBalance };
        this.deps.logger.info(
          `[VOL-EXIT] API positions Polymarket: yes=${yesBalance.toFixed(2)}, no=${noBalance.toFixed(2)}`
        );
      } catch (error) {
        this.deps.logger.warn(
          `[VOL-EXIT] Failed to fetch Polymarket positions, using local: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Fetch Kalshi positions from API
    if (this.deps.venueClients.kalshi && mapping?.kalshi) {
      try {
        const response = await kalshiGetPositions(this.deps.venueClients.kalshi.auth, {
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
        kalshi = { yes, no };
        this.deps.logger.info(
          `[VOL-EXIT] API positions Kalshi: yes=${yes}, no=${no}`
        );
      } catch (error) {
        this.deps.logger.warn(
          `[VOL-EXIT] Failed to fetch Kalshi positions, using local: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return { polymarket, kalshi };
  }

  private async buildSellTargets(): Promise<SellTarget[]> {
    const positions = await this.fetchApiPositionsFromVenues();
    const mapping = this.deps.getCurrentMapping();
    const intervalKey = getIntervalKey();
    const targets: SellTarget[] = [];

    const sides: Array<{ venue: Venue; side: Side; position: number }> = [
      { venue: "polymarket", side: "yes", position: positions.polymarket.yes },
      { venue: "polymarket", side: "no", position: positions.polymarket.no },
      { venue: "kalshi", side: "yes", position: positions.kalshi.yes },
      { venue: "kalshi", side: "no", position: positions.kalshi.no },
    ];

    for (const { venue, side, position } of sides) {
      if (position <= 0) continue;
      if (this.failedSides.has(`${venue}_${side}`)) continue;

      // Get market ID
      let marketId: string | null = null;
      if (mapping) {
        if (venue === "polymarket" && mapping.polymarket) {
          marketId =
            side === "yes"
              ? mapping.polymarket.upToken
              : mapping.polymarket.downToken;
        } else if (venue === "kalshi" && mapping.kalshi) {
          marketId = mapping.kalshi.marketTicker;
        }
      }
      if (!marketId) {
        marketId = getMarketIdForPosition(venue, side);
      }
      if (!marketId) continue;

      // Get entry VWAP
      const entryVwap = getEntryVwap(venue, side, intervalKey);
      if (entryVwap === null) continue;

      // Get current bid
      const quote = this.deps.getQuote(venue);
      if (!quote) continue;

      const currentBid = this.getBidFromQuote(side, quote);
      const profitability = currentBid - entryVwap;

      targets.push({
        venue,
        side,
        qty: Math.floor(position),
        marketId,
        entryVwap,
        currentBid,
        profitability,
      });
    }

    return targets;
  }

  private getBidFromQuote(side: Side, quote: NormalizedQuote): number {
    return side === "yes" ? quote.yes_bid : quote.no_bid;
  }

  private getMsUntilRollover(): number {
    return this.deps.getMsUntilRollover
      ? this.deps.getMsUntilRollover()
      : msUntilRollover();
  }

  /**
   * Execute a sell with retries for partial fills.
   * If the first attempt partially fills, retry remaining qty at progressively lower prices.
   */
  private async executeSellWithRetries(target: SellTarget, maxRetries = 2): Promise<number> {
    let totalSold = await this.executeSell(target);
    if (totalSold > 0 && totalSold < target.qty) {
      this.deps.logger.info(
        `[VOL-EXIT] Partial fill: ${totalSold}/${target.qty}, retrying remaining`
      );
      const retryTarget = { ...target, qty: Math.floor(target.qty - totalSold) };
      for (let i = 0; i < maxRetries && retryTarget.qty > 0; i++) {
        retryTarget.currentBid -= RISK_PARAMS.volatilityExitSellPriceOffset;
        await new Promise((r) => setTimeout(r, 300));
        const retrySold = await this.executeSell(retryTarget);
        if (retrySold > 0) {
          totalSold += retrySold;
          retryTarget.qty = Math.floor(retryTarget.qty - retrySold);
          this.deps.logger.info(
            `[VOL-EXIT] Retry ${i + 1} filled ${retrySold}, total=${totalSold}/${target.qty}`
          );
        } else {
          this.deps.logger.warn(`[VOL-EXIT] Retry ${i + 1} got no fill, stopping retries`);
          break;
        }
      }
    }
    return totalSold;
  }

  private async executeSell(target: SellTarget): Promise<number> {
    if (this.deps.dryRun) {
      this.deps.logger.info(
        `[VOL-EXIT] DRY RUN: would sell ${target.qty} ${target.venue} ${target.side} ` +
          `@ ~$${(target.currentBid - RISK_PARAMS.volatilityExitSellPriceOffset).toFixed(4)}`
      );
      // Simulate fill in dry run for state machine progression
      return target.qty;
    }

    try {
      if (target.venue === "polymarket") {
        return await this.sellPolymarket(target);
      } else {
        return await this.sellKalshi(target);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.deps.logger.error(
        `[VOL-EXIT] Sell error for ${target.venue} ${target.side}: ${errMsg}`
      );

      // Fix 3a: Don't retry permanent failures
      if (this.isPermanentSellFailure(errMsg)) {
        this.markSideFailed(target.venue, target.side, errMsg);
        return 0;
      }

      // Retry once after 500ms at a lower price
      try {
        await new Promise((r) => setTimeout(r, 500));
        target.currentBid -= RISK_PARAMS.volatilityExitSellPriceOffset;
        if (target.venue === "polymarket") {
          return await this.sellPolymarket(target);
        } else {
          return await this.sellKalshi(target);
        }
      } catch (retryError) {
        const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
        this.deps.logger.error(
          `[VOL-EXIT] Retry sell also failed: ${retryMsg}`
        );

        if (this.isPermanentSellFailure(retryMsg)) {
          this.markSideFailed(target.venue, target.side, retryMsg);
        }
        return 0;
      }
    }
  }

  private isPermanentSellFailure(errMsg: string): boolean {
    const lower = errMsg.toLowerCase();
    return (
      lower.includes("insufficient_balance") ||
      lower.includes("market_closed") ||
      lower.includes("trading_closed") ||
      lower.includes("event_expired")
    );
  }

  private markSideFailed(venue: Venue, side: Side, reason: string): void {
    const key = `${venue}_${side}`;
    this.failedSides.add(key);
    this.deps.logger.warn(
      `[VOL-EXIT] Permanently marking ${key} as failed: ${reason}`
    );
  }

  private async sellPolymarket(target: SellTarget): Promise<number> {
    const client = this.deps.venueClients.polymarket;
    if (!client) throw new Error("Polymarket client not initialized");

    // Check on-chain balance first
    let adjustedQty = target.qty;
    try {
      const balance = await client.getConditionalTokenBalance(target.marketId);
      if (balance <= 0) {
        throw new Error(`insufficient_balance: on-chain balance is 0 for ${target.marketId}`);
      }
      adjustedQty = Math.min(adjustedQty, Math.floor(balance * 0.95));
      if (adjustedQty <= 0) {
        throw new Error(`insufficient_balance: adjusted qty is 0 (balance=${balance.toFixed(4)}) for ${target.marketId}`);
      }
    } catch (balanceErr) {
      // Re-throw insufficient_balance errors so executeSell can detect them
      if (balanceErr instanceof Error && balanceErr.message.includes("insufficient_balance")) {
        throw balanceErr;
      }
      // Use tracker qty if balance check fails for other reasons
    }

    // Check that recent fills have settled (>2.5s)
    // (on-chain tokens take time to appear)

    const sellPrice = Math.max(
      0.01,
      target.currentBid - RISK_PARAMS.volatilityExitSellPriceOffset
    );

    const result = await client.placeFakOrder({
      tokenId: target.marketId,
      price: sellPrice,
      amount: adjustedQty,
      side: PolySide.SELL,
    });

    if (result.success && result.takingAmount) {
      const tokensSold = parseFloat(result.makingAmount ?? "0");
      const soldQty = tokensSold > 0 ? tokensSold : adjustedQty;

      recordFill(
        target.venue,
        target.side,
        "sell",
        soldQty,
        sellPrice,
        getIntervalKey(),
        `volexit_${Date.now()}`,
        target.marketId
      );
      return soldQty;
    }

    if (!result.success && result.errorMsg) {
      throw new Error(result.errorMsg);
    }

    return 0;
  }

  private async sellKalshi(target: SellTarget): Promise<number> {
    const kalshi = this.deps.venueClients.kalshi;
    if (!kalshi) throw new Error("Kalshi client not initialized");

    const request: KalshiOrderRequest = {
      ticker: target.marketId,
      side: target.side,
      action: "sell",
      count: Math.floor(target.qty),
      type: "limit",
      time_in_force: "immediate_or_cancel",
      reduce_only: true,
    };

    // Price 1 tick below bid for fill certainty
    const priceCents = Math.max(
      1,
      Math.round(
        (target.currentBid - RISK_PARAMS.volatilityExitSellPriceOffset) * 100
      )
    );

    if (target.side === "yes") {
      request.yes_price = priceCents;
    } else {
      request.no_price = priceCents;
    }

    const response = await kalshiCreateOrder(kalshi.auth, request);
    const order = response.order;
    const fillQty = (order.count ?? 0) - (order.remaining_count ?? 0);

    if (fillQty > 0) {
      const fillPrice = priceCents / 100;
      recordFill(
        target.venue,
        target.side,
        "sell",
        fillQty,
        fillPrice,
        getIntervalKey(),
        `volexit_${Date.now()}`,
        target.marketId
      );
    }

    return fillQty;
  }
}

// --- Module-level flag for external guard checks ---

let activeManager: VolatilityExitManager | null = null;

/**
 * Register the active manager instance (called during wiring in index.ts).
 */
export function setActiveVolatilityExitManager(
  manager: VolatilityExitManager | null
): void {
  activeManager = manager;
}

/**
 * Check if a volatility exit is currently active.
 * Used as a guard by preCloseUnwind and positionReconciler.
 */
export function isVolatilityExitActive(): boolean {
  return activeManager?.isActive() ?? false;
}
