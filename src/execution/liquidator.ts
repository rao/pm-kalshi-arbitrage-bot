/**
 * Forced liquidation module.
 *
 * When the kill switch fires after a failed unwind, this module
 * actively sells remaining positions to close directional exposure.
 *
 * Key design decisions:
 * - Runs independently of normal execution (no busy lock needed)
 * - Uses FAK (partial fills OK) for maximum fill probability
 * - No price protection — goal is to close exposure at any cost
 * - Settlement-aware: handles "not enough balance" by waiting and retrying
 * - Uses stored market IDs so liquidation works even after interval rollover
 */

import type { Venue, Side } from "../strategy/types";
import type { Logger } from "../logging/logger";
import type { InitializedClients } from "./venueClientFactory";
import { Side as PolySide } from "../venues/polymarket/client";
import { createOrder as kalshiCreateOrder } from "../venues/kalshi/orders";
import type { KalshiOrderRequest } from "../venues/kalshi/types";
import {
  getPositions,
  getMarketIdForPosition,
  recordFill,
} from "../state";
import {
  startLiquidation,
  stopLiquidation,
  isLiquidationInProgress,
} from "./executionState";
import { getIntervalKey } from "../time/interval";

interface LiquidationResult {
  venue: Venue;
  side: Side;
  targetQty: number;
  soldQty: number;
  success: boolean;
  attempts: number;
  error?: string;
}

export interface ForceLiquidateResult {
  results: LiquidationResult[];
  allClosed: boolean;
}

/**
 * Forcefully liquidate all open positions across both venues.
 *
 * Called when kill switch triggers to close unhedged directional exposure.
 * Retries with exponential backoff to handle settlement timing issues.
 *
 * @param clients - Initialized venue clients
 * @param logger - Logger instance
 * @returns Summary of liquidation attempts
 */
export async function forceLiquidateAll(
  clients: InitializedClients,
  logger: Logger
): Promise<ForceLiquidateResult> {
  if (isLiquidationInProgress()) {
    logger.warn("[LIQUIDATOR] Liquidation already in progress, skipping");
    return { results: [], allClosed: true };
  }

  startLiquidation();
  logger.warn("[LIQUIDATOR] === FORCED LIQUIDATION STARTED ===");

  const results: LiquidationResult[] = [];

  try {
    const positions = getPositions();

    // Build list of positions to liquidate
    const toSell: Array<{ venue: Venue; side: Side; qty: number }> = [];

    if (positions.polymarket.yes > 0) {
      toSell.push({ venue: "polymarket", side: "yes", qty: positions.polymarket.yes });
    }
    if (positions.polymarket.no > 0) {
      toSell.push({ venue: "polymarket", side: "no", qty: positions.polymarket.no });
    }
    if (positions.kalshi.yes > 0) {
      toSell.push({ venue: "kalshi", side: "yes", qty: positions.kalshi.yes });
    }
    if (positions.kalshi.no > 0) {
      toSell.push({ venue: "kalshi", side: "no", qty: positions.kalshi.no });
    }

    if (toSell.length === 0) {
      logger.info("[LIQUIDATOR] No positions to liquidate");
      return { results: [], allClosed: true };
    }

    logger.warn(
      `[LIQUIDATOR] Positions to liquidate: ${toSell.map(
        (p) => `${p.venue} ${p.side}=${p.qty}`
      ).join(", ")}`
    );

    // Liquidate each position
    for (const pos of toSell) {
      const result = await liquidatePosition(
        pos.venue,
        pos.side,
        pos.qty,
        clients,
        logger
      );
      results.push(result);
    }

    const allClosed = results.every((r) => r.success);

    // Log final summary
    const finalPositions = getPositions();
    logger.warn(
      `[LIQUIDATOR] === LIQUIDATION ${allClosed ? "COMPLETE" : "INCOMPLETE"} ===\n` +
      `  Results: ${results.map((r) =>
        `${r.venue} ${r.side}: sold ${r.soldQty}/${r.targetQty} (${r.success ? "OK" : "FAILED"}, ${r.attempts} attempts)`
      ).join("; ")}\n` +
      `  Final positions: poly(yes=${finalPositions.polymarket.yes}, no=${finalPositions.polymarket.no}) ` +
      `kalshi(yes=${finalPositions.kalshi.yes}, no=${finalPositions.kalshi.no})`
    );

    return { results, allClosed };
  } finally {
    stopLiquidation();
  }
}

/**
 * Liquidate a single position with retries and exponential backoff.
 */
async function liquidatePosition(
  venue: Venue,
  side: Side,
  qty: number,
  clients: InitializedClients,
  logger: Logger
): Promise<LiquidationResult> {
  const marketId = getMarketIdForPosition(venue, side);
  if (!marketId) {
    logger.error(`[LIQUIDATOR] No market ID found for ${venue} ${side} — cannot liquidate`);
    return {
      venue, side, targetQty: qty, soldQty: 0, success: false, attempts: 0,
      error: "No market ID stored for this position",
    };
  }

  const maxRetries = 10;
  let soldQty = 0;
  let lastError = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const remaining = qty - soldQty;
    if (remaining <= 0) break;

    // Exponential backoff: 5s, 10s, 15s, 20s, 25s, 30s, 30s, 30s, 30s, 30s
    const delayMs = Math.min(5000 * attempt, 30000);

    logger.info(
      `[LIQUIDATOR] Attempt ${attempt}/${maxRetries}: SELL ${remaining} ${venue} ${side} (marketId=${marketId.substring(0, 20)}...) after ${delayMs}ms delay`
    );

    // Wait before attempt (gives on-chain settlement time to propagate)
    await new Promise((r) => setTimeout(r, delayMs));

    try {
      let fillQty = 0;

      if (venue === "polymarket") {
        fillQty = await sellOnPolymarket(clients, marketId, side, remaining, logger);
      } else {
        fillQty = await sellOnKalshi(clients, marketId, side, remaining, logger);
      }

      if (fillQty > 0) {
        soldQty += fillQty;
        // Record the sell in position tracker
        recordFill(venue, side, "sell", fillQty, 0.01, getIntervalKey(), `liq_${Date.now()}`, marketId);
        logger.info(`[LIQUIDATOR] Sold ${fillQty} ${venue} ${side}. Total sold: ${soldQty}/${qty}`);
      } else {
        logger.warn(`[LIQUIDATOR] No fill on attempt ${attempt} for ${venue} ${side}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      const isSettlementError =
        lastError.includes("not enough balance") ||
        lastError.includes("allowance") ||
        lastError.includes("insufficient");

      if (isSettlementError) {
        logger.warn(`[LIQUIDATOR] Settlement timing issue on attempt ${attempt}: ${lastError}. Will retry with longer delay.`);
      } else {
        logger.error(`[LIQUIDATOR] Error on attempt ${attempt}: ${lastError}`);
      }
    }
  }

  const success = soldQty >= qty;
  return {
    venue, side, targetQty: qty, soldQty, success, attempts: maxRetries,
    error: success ? undefined : lastError || "Max retries exhausted",
  };
}

/**
 * Sell position on Polymarket using FAK at $0.01 (worst-case price).
 */
async function sellOnPolymarket(
  clients: InitializedClients,
  tokenId: string,
  side: Side,
  qty: number,
  logger: Logger
): Promise<number> {
  if (!clients.polymarket) {
    throw new Error("Polymarket client not initialized");
  }

  // Use FAK (partial fills OK) at minimum price to ensure aggressive fill
  const result = await clients.polymarket.placeFakOrder({
    tokenId,
    price: 0.01,
    amount: qty, // SELL: amount = shares to sell
    side: PolySide.SELL,
  });

  if (result.success && result.takingAmount) {
    // takingAmount = USDC received, makingAmount = tokens sold
    const tokensSold = parseFloat(result.makingAmount ?? "0");
    return tokensSold > 0 ? tokensSold : qty;
  }

  if (!result.success && result.errorMsg) {
    throw new Error(result.errorMsg);
  }

  return 0;
}

/**
 * Sell position on Kalshi using IOC at 1 cent.
 */
async function sellOnKalshi(
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

  // Sell at 1 cent (worst case price)
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
