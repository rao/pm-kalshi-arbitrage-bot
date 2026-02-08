/**
 * Kalshi orderbook normalization.
 *
 * Converts Kalshi orderbook data to NormalizedQuote format.
 *
 * CRITICAL: Kalshi only sends BIDS. Asks are implied:
 * - YES ask = (100 - best NO bid) / 100
 * - NO ask = (100 - best YES bid) / 100
 *
 * This is because in binary markets:
 * - Buying YES at price X is equivalent to selling NO at price (100 - X)
 * - A bid to buy NO is an implied ask to sell YES
 */

import type { NormalizedQuote } from "./types";
import {
  type KalshiOrderbookSnapshot,
  type KalshiOrderbookDelta,
  type KalshiPriceLevel,
  kalshiCentsToDecimal,
  getBestBid,
} from "../venues/kalshi/wsTypes";

/**
 * Convert Kalshi cents to decimal (0-1 range).
 */
export function centsToDecimal(cents: number): number {
  return kalshiCentsToDecimal(cents);
}

/**
 * Normalize a Kalshi orderbook snapshot to NormalizedQuote.
 *
 * @param snapshot - Kalshi orderbook snapshot message
 * @param tsLocal - Local timestamp (defaults to Date.now())
 * @returns NormalizedQuote
 */
export function normalizeKalshiSnapshot(
  snapshot: KalshiOrderbookSnapshot,
  tsLocal: number = Date.now()
): NormalizedQuote {
  const { yes, no } = snapshot.msg;

  // Get best YES bid (last in array since sorted ascending)
  const bestYesBid = getBestBid(yes);
  const yes_bid = bestYesBid ? centsToDecimal(bestYesBid[0]) : 0;
  const yes_bid_size = bestYesBid ? bestYesBid[1] : 0;

  // Get best NO bid
  const bestNoBid = getBestBid(no);
  const no_bid = bestNoBid ? centsToDecimal(bestNoBid[0]) : 0;
  const no_bid_size = bestNoBid ? bestNoBid[1] : 0;

  // CRITICAL: Calculate implied asks
  // YES ask = 100 - best NO bid (in cents), converted to decimal
  // If NO bid is 56 cents, YES ask is 44 cents (0.44)
  const yes_ask = bestNoBid ? centsToDecimal(100 - bestNoBid[0]) : 1;
  // YES ask size is the size of the NO bid (since that's who would fill your YES buy)
  const yes_ask_size = bestNoBid ? bestNoBid[1] : 0;

  // NO ask = 100 - best YES bid
  // If YES bid is 42 cents, NO ask is 58 cents (0.58)
  const no_ask = bestYesBid ? centsToDecimal(100 - bestYesBid[0]) : 1;
  // NO ask size is the size of the YES bid
  const no_ask_size = bestYesBid ? bestYesBid[1] : 0;

  return {
    yes_bid,
    yes_ask,
    yes_bid_size,
    yes_ask_size,
    no_bid,
    no_ask,
    no_bid_size,
    no_ask_size,
    ts_exchange: 0, // Snapshot doesn't include timestamp
    ts_local: tsLocal,
  };
}

/**
 * Apply a Kalshi orderbook delta to the current bid arrays.
 *
 * Returns the updated bid arrays and the new NormalizedQuote.
 *
 * @param currentYesBids - Current YES bids (sorted ascending by price)
 * @param currentNoBids - Current NO bids (sorted ascending by price)
 * @param delta - Delta message from Kalshi
 * @param tsLocal - Local timestamp
 * @returns Updated bid arrays and quote
 */
export function applyKalshiDelta(
  currentYesBids: KalshiPriceLevel[],
  currentNoBids: KalshiPriceLevel[],
  delta: KalshiOrderbookDelta,
  tsLocal: number = Date.now()
): {
  yesBids: KalshiPriceLevel[];
  noBids: KalshiPriceLevel[];
  quote: NormalizedQuote;
} {
  const { price, delta: deltaQty, side, ts } = delta.msg;

  // Clone arrays to avoid mutation
  let yesBids = [...currentYesBids];
  let noBids = [...currentNoBids];

  // Apply delta to the appropriate side
  if (side === "yes") {
    yesBids = applyDeltaToLevels(yesBids, price, deltaQty);
  } else {
    noBids = applyDeltaToLevels(noBids, price, deltaQty);
  }

  // Calculate quote from updated bids
  const bestYesBid = getBestBid(yesBids);
  const bestNoBid = getBestBid(noBids);

  const yes_bid = bestYesBid ? centsToDecimal(bestYesBid[0]) : 0;
  const yes_bid_size = bestYesBid ? bestYesBid[1] : 0;
  const no_bid = bestNoBid ? centsToDecimal(bestNoBid[0]) : 0;
  const no_bid_size = bestNoBid ? bestNoBid[1] : 0;

  // Implied asks
  const yes_ask = bestNoBid ? centsToDecimal(100 - bestNoBid[0]) : 1;
  const yes_ask_size = bestNoBid ? bestNoBid[1] : 0;
  const no_ask = bestYesBid ? centsToDecimal(100 - bestYesBid[0]) : 1;
  const no_ask_size = bestYesBid ? bestYesBid[1] : 0;

  // Parse timestamp from ISO 8601
  const ts_exchange = ts ? new Date(ts).getTime() : 0;

  return {
    yesBids,
    noBids,
    quote: {
      yes_bid,
      yes_ask,
      yes_bid_size,
      yes_ask_size,
      no_bid,
      no_ask,
      no_bid_size,
      no_ask_size,
      ts_exchange,
      ts_local: tsLocal,
    },
  };
}

/**
 * Apply a delta to a sorted price level array.
 *
 * The array is sorted ascending by price (best bid is last).
 *
 * @param levels - Current price levels
 * @param priceCents - Price in cents
 * @param deltaQty - Quantity delta (positive = add, negative = remove)
 * @returns Updated price levels
 */
function applyDeltaToLevels(
  levels: KalshiPriceLevel[],
  priceCents: number,
  deltaQty: number
): KalshiPriceLevel[] {
  // Find existing level at this price
  const existingIndex = levels.findIndex(([price]) => price === priceCents);

  if (existingIndex >= 0) {
    // Update existing level
    const [price, qty] = levels[existingIndex];
    const newQty = qty + deltaQty;

    if (newQty <= 0) {
      // Remove the level
      return [...levels.slice(0, existingIndex), ...levels.slice(existingIndex + 1)];
    } else {
      // Update the quantity
      const result = [...levels];
      result[existingIndex] = [price, newQty];
      return result;
    }
  } else if (deltaQty > 0) {
    // Add new level (need to insert in sorted order)
    const newLevels = [...levels, [priceCents, deltaQty] as KalshiPriceLevel];
    // Sort ascending by price
    newLevels.sort((a, b) => a[0] - b[0]);
    return newLevels;
  }

  // Delta is negative but no existing level - no change
  return levels;
}

/**
 * Initialize bid arrays from a snapshot.
 *
 * Returns cloned arrays that can be modified.
 */
export function initializeBidsFromSnapshot(
  snapshot: KalshiOrderbookSnapshot
): {
  yesBids: KalshiPriceLevel[];
  noBids: KalshiPriceLevel[];
} {
  return {
    yesBids: [...snapshot.msg.yes],
    noBids: [...snapshot.msg.no],
  };
}

/**
 * Compute a NormalizedQuote from bid arrays.
 *
 * Useful after applying multiple deltas.
 */
export function computeQuoteFromBids(
  yesBids: KalshiPriceLevel[],
  noBids: KalshiPriceLevel[],
  tsExchange: number = 0,
  tsLocal: number = Date.now()
): NormalizedQuote {
  const bestYesBid = getBestBid(yesBids);
  const bestNoBid = getBestBid(noBids);

  const yes_bid = bestYesBid ? centsToDecimal(bestYesBid[0]) : 0;
  const yes_bid_size = bestYesBid ? bestYesBid[1] : 0;
  const no_bid = bestNoBid ? centsToDecimal(bestNoBid[0]) : 0;
  const no_bid_size = bestNoBid ? bestNoBid[1] : 0;

  // Implied asks
  const yes_ask = bestNoBid ? centsToDecimal(100 - bestNoBid[0]) : 1;
  const yes_ask_size = bestNoBid ? bestNoBid[1] : 0;
  const no_ask = bestYesBid ? centsToDecimal(100 - bestYesBid[0]) : 1;
  const no_ask_size = bestYesBid ? bestYesBid[1] : 0;

  return {
    yes_bid,
    yes_ask,
    yes_bid_size,
    yes_ask_size,
    no_bid,
    no_ask,
    no_bid_size,
    no_ask_size,
    ts_exchange: tsExchange,
    ts_local: tsLocal,
  };
}

/**
 * Validate that YES ask + NO ask is close to 1.0.
 *
 * In efficient markets, this should hold (plus spread).
 * Large deviations may indicate stale data or an opportunity.
 *
 * @param quote - NormalizedQuote to validate
 * @param tolerance - Maximum deviation from 1.0 (default: 0.05)
 * @returns true if valid
 */
export function validateKalshiQuote(
  quote: NormalizedQuote,
  tolerance: number = 0.05
): boolean {
  const askSum = quote.yes_ask + quote.no_ask;
  return Math.abs(askSum - 1.0) <= tolerance;
}
