/**
 * Order planning for two-phase commit execution.
 *
 * Determines which leg executes first (A) vs second (B)
 * and builds order parameters for each venue.
 */

import type { ArbLeg, Venue, Side, Opportunity } from "../strategy/types";
import type { NormalizedQuote } from "../normalization/types";
import type { OrderParams } from "./types";
import type { IntervalMapping } from "../markets/mappingStore";
import { generateClientOrderId } from "./types";

/**
 * Result of leg planning.
 */
export interface LegPlan {
  /** Leg to execute first */
  legA: ArbLeg;
  /** Leg to execute second */
  legB: ArbLeg;
  /** Reason for this ordering */
  reason: string;
}

/**
 * Determine which leg should execute first (A) vs second (B).
 *
 * v0.1 heuristic: Execute the leg with larger available size first.
 * This maximizes the probability of Leg A filling, reducing the chance
 * we need to unwind if Leg B fails.
 *
 * @param opportunity - The arbitrage opportunity
 * @param polyQuote - Current Polymarket quote
 * @param kalshiQuote - Current Kalshi quote
 * @returns LegPlan with ordered legs
 */
export function planLegOrder(
  opportunity: Opportunity,
  polyQuote: NormalizedQuote,
  kalshiQuote: NormalizedQuote
): LegPlan {
  const [leg0, leg1] = opportunity.legs;

  // Get sizes for each leg based on venue
  const size0 = getLegSize(leg0, polyQuote, kalshiQuote);
  const size1 = getLegSize(leg1, polyQuote, kalshiQuote);

  // Leg with larger size goes first (more likely to fill)
  if (size0 >= size1) {
    return {
      legA: leg0,
      legB: leg1,
      reason: `${leg0.venue} has larger size (${size0} >= ${size1})`,
    };
  } else {
    return {
      legA: leg1,
      legB: leg0,
      reason: `${leg1.venue} has larger size (${size1} > ${size0})`,
    };
  }
}

/**
 * Get the available size for a leg from the appropriate quote.
 */
function getLegSize(
  leg: ArbLeg,
  polyQuote: NormalizedQuote,
  kalshiQuote: NormalizedQuote
): number {
  const quote = leg.venue === "polymarket" ? polyQuote : kalshiQuote;

  // We're buying, so we need the ask size
  if (leg.side === "yes") {
    return quote.yes_ask_size;
  } else {
    return quote.no_ask_size;
  }
}

/**
 * Get the market ID for a leg from the mapping.
 */
function getMarketId(leg: ArbLeg, mapping: IntervalMapping): string {
  if (leg.venue === "polymarket") {
    if (!mapping.polymarket) {
      throw new Error("No Polymarket mapping available");
    }
    // For Polymarket, we need the token ID based on side
    // YES = Up, NO = Down (normalized mapping)
    return leg.side === "yes"
      ? mapping.polymarket.upToken
      : mapping.polymarket.downToken;
  } else {
    if (!mapping.kalshi) {
      throw new Error("No Kalshi mapping available");
    }
    // For Kalshi, we use the market ticker
    return mapping.kalshi.marketTicker;
  }
}

/**
 * Build order parameters for a leg.
 *
 * @param leg - The arbitrage leg
 * @param mapping - Market mapping for the interval
 * @param qty - Quantity to trade
 * @param legLabel - "A" or "B" for client order ID
 * @returns OrderParams ready for submission
 */
export function buildOrderParams(
  leg: ArbLeg,
  mapping: IntervalMapping,
  qty: number,
  legLabel: "A" | "B"
): OrderParams {
  const marketId = getMarketId(leg, mapping);

  return {
    venue: leg.venue,
    side: leg.side,
    action: "buy", // v0.1 always buys (buy-both box arb)
    price: leg.price,
    qty,
    timeInForce: "FOK",
    marketId,
    clientOrderId: generateClientOrderId(leg.venue, legLabel),
  };
}

/**
 * Build unwind order parameters (SELL instead of BUY).
 *
 * @param leg - The leg to unwind
 * @param mapping - Market mapping
 * @param qty - Quantity to unwind
 * @param currentBidPrice - Current bid price for slippage adjustment
 * @param slippageBuffer - Slippage buffer to apply
 * @returns OrderParams for unwind order
 */
export function buildUnwindOrderParams(
  leg: ArbLeg,
  mapping: IntervalMapping,
  qty: number,
  currentBidPrice: number,
  slippageBuffer: number
): OrderParams {
  const marketId = getMarketId(leg, mapping);

  // Price at which we try to unwind: bid minus slippage to ensure fill
  const unwindPrice = Math.max(0.01, currentBidPrice - slippageBuffer);

  return {
    venue: leg.venue,
    side: leg.side,
    action: "sell", // Unwind means selling what we bought
    price: unwindPrice,
    qty,
    timeInForce: "FOK",
    marketId,
    clientOrderId: generateClientOrderId(leg.venue, "A"), // Reuse "A" for unwind
  };
}

/**
 * Get current bid price for a side from a quote.
 */
export function getCurrentBid(
  side: Side,
  quote: NormalizedQuote
): number {
  return side === "yes" ? quote.yes_bid : quote.no_bid;
}

/**
 * Get current ask price for a side from a quote.
 */
export function getCurrentAsk(
  side: Side,
  quote: NormalizedQuote
): number {
  return side === "yes" ? quote.yes_ask : quote.no_ask;
}

/**
 * Validate that an opportunity can be executed with the current mapping.
 */
export function validateOpportunityMapping(
  opportunity: Opportunity,
  mapping: IntervalMapping
): { valid: boolean; error?: string } {
  // Check Polymarket mapping
  const hasPolyLeg = opportunity.legs.some((l) => l.venue === "polymarket");
  if (hasPolyLeg && !mapping.polymarket) {
    return {
      valid: false,
      error: "Opportunity requires Polymarket but no mapping available",
    };
  }

  // Check Kalshi mapping
  const hasKalshiLeg = opportunity.legs.some((l) => l.venue === "kalshi");
  if (hasKalshiLeg && !mapping.kalshi) {
    return {
      valid: false,
      error: "Opportunity requires Kalshi but no mapping available",
    };
  }

  // Verify interval matches
  if (
    opportunity.intervalKey.startTs !== mapping.intervalKey.startTs ||
    opportunity.intervalKey.endTs !== mapping.intervalKey.endTs
  ) {
    return {
      valid: false,
      error: `Interval mismatch: opportunity=${opportunity.intervalKey.startTs}, mapping=${mapping.intervalKey.startTs}`,
    };
  }

  return { valid: true };
}
