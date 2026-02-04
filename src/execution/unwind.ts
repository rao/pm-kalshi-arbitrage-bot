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
import { buildUnwindOrderParams, getCurrentBid } from "./orderPlanner";

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
 * Unwind a filled leg by selling the position.
 *
 * This is called when Leg A fills but Leg B fails.
 * We attempt to sell at the current bid minus slippage.
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

  // Get current bid for the side we bought
  const currentBid = getCurrentBid(filledLeg.leg.side, currentQuote);

  // Build unwind order (SELL at bid minus slippage)
  const unwindParams = buildUnwindOrderParams(
    filledLeg.leg,
    mapping,
    filledLeg.result?.fillQty ?? RISK_PARAMS.qtyPerTrade,
    currentBid,
    RISK_PARAMS.slippageBufferPerLeg
  );

  // Attempt the unwind
  let result: OrderResult | null = null;
  let realizedLoss: number;

  try {
    result = await venueClients.placeOrder(unwindParams);

    if (result.success) {
      // Calculate actual loss
      const buyPrice = filledLeg.result?.fillPrice ?? filledLeg.leg.price;
      realizedLoss = calculateUnwindLoss(
        buyPrice,
        result.fillPrice,
        result.fillQty
      );
    } else {
      // Unwind failed - assume total loss of position
      const buyPrice = filledLeg.result?.fillPrice ?? filledLeg.leg.price;
      const qty = filledLeg.result?.fillQty ?? RISK_PARAMS.qtyPerTrade;
      realizedLoss = estimateMaxUnwindLoss(buyPrice, qty);
    }
  } catch (error) {
    // Exception during unwind - assume total loss
    const buyPrice = filledLeg.result?.fillPrice ?? filledLeg.leg.price;
    const qty = filledLeg.result?.fillQty ?? RISK_PARAMS.qtyPerTrade;
    realizedLoss = estimateMaxUnwindLoss(buyPrice, qty);

    result = {
      success: false,
      orderId: null,
      fillQty: 0,
      fillPrice: 0,
      venue: filledLeg.leg.venue,
      status: "rejected",
      submittedAt: startTs,
      filledAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const endTs = Date.now();

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

  // Estimate loss assuming we'd sell at bid minus slippage
  const estimatedSellPrice = Math.max(
    0.01,
    currentBid - RISK_PARAMS.slippageBufferPerLeg
  );
  const buyPrice = filledLeg.leg.price;
  const qty = RISK_PARAMS.qtyPerTrade;
  const estimatedLoss = calculateUnwindLoss(buyPrice, estimatedSellPrice, qty);

  return {
    legToUnwind: filledLeg,
    unwindParams: {
      venue: filledLeg.leg.venue,
      side: filledLeg.leg.side,
      action: "sell",
      price: estimatedSellPrice,
      qty,
      timeInForce: "FOK",
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
