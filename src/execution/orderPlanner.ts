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
 * Always assigns Polymarket as Leg A (IOC/FAK, partial fills OK) and
 * Kalshi as Leg B (FOK). This ensures that if Leg A doesn't fill,
 * we exit cleanly with zero risk. Kalshi (which almost always fills)
 * only submits after Polymarket confirms a fill.
 *
 * @param opportunity - The arbitrage opportunity
 * @param polyQuote - Current Polymarket quote (unused, kept for API compat)
 * @param kalshiQuote - Current Kalshi quote (unused, kept for API compat)
 * @returns LegPlan with ordered legs
 */
export function planLegOrder(
  opportunity: Opportunity,
  polyQuote: NormalizedQuote,
  kalshiQuote: NormalizedQuote
): LegPlan {
  const [leg0, leg1] = opportunity.legs;

  // Always: Polymarket = Leg A (IOC first), Kalshi = Leg B (FOK second)
  const polyLeg = leg0.venue === "polymarket" ? leg0 : leg1;
  const kalshiLeg = leg0.venue === "kalshi" ? leg0 : leg1;

  return {
    legA: polyLeg,
    legB: kalshiLeg,
    reason: "Polymarket first (IOC), Kalshi second (FOK) — sequential execution",
  };
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

  // Leg A (Polymarket) uses IOC/FAK for partial fills; Leg B (Kalshi) uses FOK
  const timeInForce: "FOK" | "IOC" =
    legLabel === "A" && leg.venue === "polymarket" ? "IOC" : "FOK";

  return {
    venue: leg.venue,
    side: leg.side,
    action: "buy", // v0.1 always buys (buy-both box arb)
    price: leg.price,
    qty,
    timeInForce,
    marketId,
    clientOrderId: generateClientOrderId(leg.venue, legLabel),
  };
}

/**
 * Build unwind order parameters (SELL instead of BUY).
 *
 * Uses MARKET orders for emergency unwinds to guarantee exit:
 * - Kalshi: type="market" executes at best available price (no price needed)
 * - Polymarket: aggressive limit at $0.01 (minimum price) to ensure fill
 *
 * @param leg - The leg to unwind
 * @param mapping - Market mapping
 * @param qty - Quantity to unwind
 * @param currentBidPrice - Current bid price (used for Polymarket fallback)
 * @param slippageBuffer - Slippage buffer (unused for market orders)
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

  // For unwinds, use market orders to guarantee exit
  // Kalshi: type="market" needs no price (set to 0, ignored)
  // Polymarket: use minimum price ($0.01) to ensure aggressive fill
  const unwindPrice = leg.venue === "kalshi" ? 0 : 0.01;

  return {
    venue: leg.venue,
    side: leg.side,
    action: "sell", // Unwind means selling what we bought
    price: unwindPrice,
    qty,
    timeInForce: "MARKET",
    orderType: "market",
    marketId,
    clientOrderId: generateClientOrderId(leg.venue, "U"), // "U" for unwind
    reduceOnly: true,
  };
}

/**
 * Build IOC/FOK limit sell params for a price ladder unwind step.
 *
 * - Kalshi: IOC (partial fills OK, fill what's available immediately)
 * - Polymarket: FOK (all-or-nothing at the limit price)
 *
 * @param leg - The leg to unwind
 * @param mapping - Market mapping
 * @param qty - Quantity to sell
 * @param sellPrice - Limit price for this ladder step (0-1 decimal)
 * @returns OrderParams for a limit sell at the given price
 */
export function buildLadderUnwindParams(
  leg: ArbLeg,
  mapping: IntervalMapping,
  qty: number,
  sellPrice: number
): OrderParams {
  const marketId = getMarketId(leg, mapping);
  const clampedPrice = Math.max(0.01, Math.min(0.99, sellPrice));

  return {
    venue: leg.venue,
    side: leg.side,
    action: "sell",
    price: clampedPrice,
    qty,
    // Kalshi IOC allows partial fills; Polymarket FOK is all-or-nothing
    timeInForce: leg.venue === "kalshi" ? "IOC" : "FOK",
    marketId,
    clientOrderId: generateClientOrderId(leg.venue, "U"),
    reduceOnly: true,
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
