/**
 * Unwind/abort logic for failed executions.
 *
 * When Leg A fills but Leg B fails, we need to unwind Leg A
 * by selling what we bought. This module handles that process.
 */

import type { LegExecution, UnwindRecord, OrderResult, VenueClients } from "./types";
import type { NormalizedQuote } from "../normalization/types";
import type { IntervalMapping } from "../markets/mappingStore";
import { RISK_PARAMS } from "../config/riskParams";
import { buildUnwindOrderParams, buildLadderUnwindParams, getCurrentBid } from "./orderPlanner";

/**
 * Calculate the realized loss from an unwind.
 *
 * Loss = (buy price - sell price) * quantity
 *
 * @param buyPrice - Price at which we bought
 * @param sellPrice - Price at which we sold (or attempted)
 * @param qty - Quantity
 * @returns Realized loss (positive number)
 */
export function calculateUnwindLoss(
  buyPrice: number,
  sellPrice: number,
  qty: number
): number {
  const priceDiff = buyPrice - sellPrice;
  return Math.max(0, priceDiff * qty);
}

/**
 * Estimate worst-case loss if unwind fails completely.
 *
 * Assumes total loss of the position cost.
 *
 * @param buyPrice - Price at which we bought
 * @param qty - Quantity
 * @returns Maximum possible loss
 */
export function estimateMaxUnwindLoss(buyPrice: number, qty: number): number {
  return buyPrice * qty;
}

/**
 * Unwind a filled leg by selling the position using an incremental price ladder.
 *
 * This is called when Leg A fills but Leg B fails.
 *
 * Phase 1 — Price ladder: Try limit sells starting near buy price, walking
 * down incrementally (1 cent per step). This avoids the 5+ cent slippage
 * of market orders on thin books.
 *   - Kalshi: IOC (partial fills OK — fill what's available, reduce remaining qty)
 *   - Polymarket: FOK (all-or-nothing per step)
 *
 * Phase 2 — Market fallback: If any quantity remains after the ladder, fall
 * back to market orders with 2 retries.
 *
 * @param filledLeg - The leg execution that needs unwinding
 * @param currentQuote - Current quote for the venue
 * @param mapping - Market mapping
 * @param venueClients - Venue client interface for placing orders
 * @param reason - Reason for unwinding
 * @returns UnwindRecord with result
 */
export async function unwindLeg(
  filledLeg: LegExecution,
  currentQuote: NormalizedQuote,
  mapping: IntervalMapping,
  venueClients: VenueClients,
  reason: string
): Promise<UnwindRecord> {
  const startTs = Date.now();
  const buyPrice = filledLeg.result?.fillPrice ?? filledLeg.leg.price;
  const totalQty = filledLeg.result?.fillQty ?? RISK_PARAMS.qtyPerTrade;
  let remainingQty = totalQty;

  // Track all fills for VWAP calculation
  const fills: Array<{ qty: number; price: number }> = [];

  const currentBid = getCurrentBid(filledLeg.leg.side, currentQuote);
  console.log(`[UNWIND] Starting ladder unwind: ${filledLeg.leg.venue} ${filledLeg.leg.side} qty=${totalQty} buyPrice=$${buyPrice.toFixed(2)} currentBid=$${currentBid.toFixed(2)}. Reason: ${reason}`);

  // ── Phase 1: Price ladder ──
  const { unwindLadderSteps, unwindLadderStepSize, unwindLadderStepTimeoutMs, unwindMaxTotalTimeMs } = RISK_PARAMS;
  const deadline = startTs + unwindMaxTotalTimeMs;

  for (let step = 1; step <= unwindLadderSteps && remainingQty > 0; step++) {
    if (Date.now() >= deadline) {
      console.warn(`[UNWIND] Ladder hit time cap (${unwindMaxTotalTimeMs}ms), skipping to market fallback`);
      break;
    }

    const sellPrice = Math.max(0.01, buyPrice - step * unwindLadderStepSize);
    const ladderParams = buildLadderUnwindParams(filledLeg.leg, mapping, remainingQty, sellPrice);

    console.log(`[UNWIND] Ladder step ${step}/${unwindLadderSteps}: SELL ${remainingQty} @ $${sellPrice.toFixed(2)}`);

    try {
      const stepResult = await venueClients.placeOrder(ladderParams);

      if (stepResult.success && stepResult.fillQty > 0) {
        fills.push({ qty: stepResult.fillQty, price: stepResult.fillPrice });
        remainingQty -= stepResult.fillQty;
        console.log(`[UNWIND] Ladder step ${step} filled: ${stepResult.fillQty} @ $${stepResult.fillPrice.toFixed(4)}, remaining=${remainingQty}`);

        if (remainingQty <= 0) break;
      } else {
        console.log(`[UNWIND] Ladder step ${step} no fill: ${stepResult.error ?? stepResult.status}`);
      }
    } catch (error) {
      console.warn(`[UNWIND] Ladder step ${step} threw: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Wait before next step (unless we're done or out of time)
    if (remainingQty > 0 && step < unwindLadderSteps && Date.now() < deadline) {
      const waitMs = Math.min(unwindLadderStepTimeoutMs, deadline - Date.now());
      if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    }
  }

  // ── Phase 2: Market fallback ──
  const MARKET_RETRIES = 2;
  let lastResult: OrderResult | null = null;
  let lastError: string | null = null;

  if (remainingQty > 0) {
    console.warn(`[UNWIND] Ladder incomplete, ${remainingQty} remaining — falling back to market order`);

    const marketParams = buildUnwindOrderParams(
      filledLeg.leg,
      mapping,
      remainingQty,
      currentBid,
      RISK_PARAMS.slippageBufferPerLeg
    );

    for (let attempt = 1; attempt <= MARKET_RETRIES; attempt++) {
      try {
        lastResult = await venueClients.placeOrder(marketParams);

        if (lastResult.success && lastResult.fillQty > 0) {
          fills.push({ qty: lastResult.fillQty, price: lastResult.fillPrice });
          remainingQty -= lastResult.fillQty;
          console.log(`[UNWIND] Market fallback attempt ${attempt} filled: ${lastResult.fillQty} @ $${lastResult.fillPrice.toFixed(4)}, remaining=${remainingQty}`);
          if (remainingQty <= 0) break;
        } else {
          lastError = lastResult.error ?? "Unknown error";
          console.warn(`[UNWIND] Market fallback attempt ${attempt}/${MARKET_RETRIES} failed: ${lastError}`);
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.warn(`[UNWIND] Market fallback attempt ${attempt}/${MARKET_RETRIES} threw: ${lastError}`);
      }

      if (attempt < MARKET_RETRIES && remainingQty > 0) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
  }

  // ── Build result ──
  const totalFilled = fills.reduce((sum, f) => sum + f.qty, 0);
  const endTs = Date.now();

  let realizedLoss: number;
  let result: OrderResult;

  if (totalFilled > 0) {
    // Volume-weighted average sell price
    const vwap = fills.reduce((sum, f) => sum + f.qty * f.price, 0) / totalFilled;
    realizedLoss = calculateUnwindLoss(buyPrice, vwap, totalFilled);

    // If some qty remains unfilled, add total loss for that portion
    if (remainingQty > 0) {
      realizedLoss += estimateMaxUnwindLoss(buyPrice, remainingQty);
      console.error(`[UNWIND] ${remainingQty} contracts could not be unwound. Assuming total loss for those.`);
    }

    console.log(`[UNWIND] Complete: sold ${totalFilled}/${totalQty} @ VWAP $${vwap.toFixed(4)}, loss=$${realizedLoss.toFixed(4)}`);

    result = {
      success: remainingQty <= 0,
      orderId: lastResult?.orderId ?? null,
      fillQty: totalFilled,
      fillPrice: vwap,
      venue: filledLeg.leg.venue,
      status: remainingQty <= 0 ? "filled" : "timeout",
      submittedAt: startTs,
      filledAt: endTs,
      error: remainingQty > 0 ? `${remainingQty} contracts unfilled` : null,
    };
  } else {
    // Nothing filled at all
    realizedLoss = estimateMaxUnwindLoss(buyPrice, totalQty);
    console.error(`[UNWIND] All attempts failed. Assuming total loss: $${realizedLoss.toFixed(4)}`);

    result = {
      success: false,
      orderId: null,
      fillQty: 0,
      fillPrice: 0,
      venue: filledLeg.leg.venue,
      status: "rejected",
      submittedAt: startTs,
      filledAt: null,
      error: lastError ?? "All unwind attempts failed",
    };
  }

  // Use the market fallback params as the "canonical" unwind params for the record
  const unwindParams = buildUnwindOrderParams(
    filledLeg.leg,
    mapping,
    totalQty,
    currentBid,
    RISK_PARAMS.slippageBufferPerLeg
  );

  return {
    legToUnwind: filledLeg,
    unwindParams,
    result,
    startTs,
    endTs,
    realizedLoss,
    reason,
  };
}

/**
 * Simulate an unwind for dry run mode.
 *
 * Calculates what the expected loss would be without placing orders.
 * Uses market order pricing (minimum price for sells).
 *
 * @param filledLeg - The leg that would need unwinding
 * @param currentQuote - Current quote for the venue
 * @param reason - Reason for unwinding
 * @returns Simulated UnwindRecord
 */
export function simulateUnwind(
  filledLeg: LegExecution,
  currentQuote: NormalizedQuote,
  reason: string
): UnwindRecord {
  const now = Date.now();

  // Get current bid
  const currentBid = getCurrentBid(filledLeg.leg.side, currentQuote);

  // For market orders, we expect to sell near the current bid
  // Use conservative estimate (bid minus some slippage)
  const estimatedSellPrice = Math.max(
    0.01,
    currentBid - RISK_PARAMS.slippageBufferPerLeg
  );
  const buyPrice = filledLeg.leg.price;
  const qty = RISK_PARAMS.qtyPerTrade;
  const estimatedLoss = calculateUnwindLoss(buyPrice, estimatedSellPrice, qty);

  // Unwind price for market orders: 0 for Kalshi (ignored), 0.01 for Polymarket
  const unwindPrice = filledLeg.leg.venue === "kalshi" ? 0 : 0.01;

  return {
    legToUnwind: filledLeg,
    unwindParams: {
      venue: filledLeg.leg.venue,
      side: filledLeg.leg.side,
      action: "sell",
      price: unwindPrice,
      qty,
      timeInForce: "MARKET",
      orderType: "market",
      marketId: "simulated",
      clientOrderId: "simulated",
    },
    result: {
      success: true,
      orderId: "simulated",
      fillQty: qty,
      fillPrice: estimatedSellPrice,
      venue: filledLeg.leg.venue,
      status: "filled",
      submittedAt: now,
      filledAt: now,
      error: null,
    },
    startTs: now,
    endTs: now,
    realizedLoss: estimatedLoss,
    reason: `${reason} (simulated)`,
  };
}

/**
 * Determine if we should attempt unwind based on market conditions.
 *
 * @param filledLeg - The leg to potentially unwind
 * @param currentQuote - Current quote
 * @returns Whether to proceed with unwind
 */
export function shouldAttemptUnwind(
  filledLeg: LegExecution,
  currentQuote: NormalizedQuote
): { should: boolean; reason: string } {
  const currentBid = getCurrentBid(filledLeg.leg.side, currentQuote);

  // Don't unwind if bid is 0 (no liquidity)
  if (currentBid <= 0) {
    return {
      should: false,
      reason: "No bid available - will need manual intervention",
    };
  }

  // Calculate potential loss
  const buyPrice = filledLeg.result?.fillPrice ?? filledLeg.leg.price;
  const potentialLoss = calculateUnwindLoss(
    buyPrice,
    currentBid - RISK_PARAMS.slippageBufferPerLeg,
    filledLeg.result?.fillQty ?? RISK_PARAMS.qtyPerTrade
  );

  // Always attempt unwind in v0.1 (small positions)
  // In production, might skip if loss would be too large
  return {
    should: true,
    reason: `Estimated loss: $${potentialLoss.toFixed(4)}`,
  };
}
