/**
 * Arbitrage scanner - pure function for detecting opportunities.
 *
 * Scans normalized quotes from both venues to find profitable box arbitrage.
 * Pure function: no side effects, no I/O.
 */

import type { NormalizedQuote } from "../normalization/types";
import { isValidQuote } from "../normalization/types";
import { computeEdge } from "../fees/edge";
import { getFeeBufferForPrices } from "../fees/feeEngine";
import { isValidVenuePrice } from "./guards";
import { calculateMinQuantityForPolymarket, RISK_PARAMS } from "../config/riskParams";
import type {
  ScanContext,
  ScanResult,
  Opportunity,
  ArbLeg,
  Venue,
} from "./types";

/**
 * Find the best cross-venue box arbitrage.
 *
 * For a box arb, we need to buy YES at one venue and NO at another.
 * We want the cheapest combination:
 * - min(poly_yes_ask, kalshi_yes_ask) for YES leg
 * - min(poly_no_ask, kalshi_no_ask) for NO leg
 *
 * But each leg must come from a different venue.
 *
 * Actually, for a proper box arb across venues:
 * - We buy YES equivalent on one venue
 * - We buy NO equivalent on the other venue
 * - This guarantees a $1 payout regardless of outcome
 *
 * The key is: we're looking at the best prices across venues.
 *
 * Two configurations:
 * 1. Buy Poly YES + Buy Kalshi NO
 * 2. Buy Kalshi YES + Buy Poly NO
 *
 * We pick whichever is cheaper.
 */
interface BoxConfig {
  yesVenue: Venue;
  yesAsk: number;
  yesSize: number;
  noVenue: Venue;
  noAsk: number;
  noSize: number;
  cost: number;
}

function findBestBox(
  polyQuote: NormalizedQuote,
  kalshiQuote: NormalizedQuote
): BoxConfig {
  // Config 1: Poly YES + Kalshi NO
  const config1Cost = polyQuote.yes_ask + kalshiQuote.no_ask;
  const config1: BoxConfig = {
    yesVenue: "polymarket",
    yesAsk: polyQuote.yes_ask,
    yesSize: polyQuote.yes_ask_size,
    noVenue: "kalshi",
    noAsk: kalshiQuote.no_ask,
    noSize: kalshiQuote.no_ask_size,
    cost: config1Cost,
  };

  // Config 2: Kalshi YES + Poly NO
  const config2Cost = kalshiQuote.yes_ask + polyQuote.no_ask;
  const config2: BoxConfig = {
    yesVenue: "kalshi",
    yesAsk: kalshiQuote.yes_ask,
    yesSize: kalshiQuote.yes_ask_size,
    noVenue: "polymarket",
    noAsk: polyQuote.no_ask,
    noSize: polyQuote.no_ask_size,
    cost: config2Cost,
  };

  // Prefer Config 1 (Poly YES + Kalshi NO) to mitigate oracle divergence.
  // When Kalshi ref > Poly ref, BTC landing in the dead zone means Poly says UP, Kalshi says DOWN.
  // Config 1 wins in that scenario; Config 2 loses on both legs.
  // Config 2 must be cheaper by preferredConfigBonus to override.
  return config1Cost <= (config2Cost + RISK_PARAMS.preferredConfigBonus)
    ? config1
    : config2;
}

/**
 * Scan for arbitrage opportunities.
 *
 * This is a pure function - no side effects.
 *
 * @param context - Scan context with quotes and parameters
 * @returns Scan result with opportunity (if found) and diagnostics
 */
export function scanForArbitrage(context: ScanContext): ScanResult {
  const { polyQuote, kalshiQuote, intervalKey, feeBuffer, slippageBuffer, minEdgeNet } =
    context;

  // Check if both quotes are available
  if (!polyQuote) {
    return {
      opportunity: null,
      reason: "No Polymarket quote available",
      polyQuote: null,
      kalshiQuote,
      computedEdge: null,
    };
  }

  if (!kalshiQuote) {
    return {
      opportunity: null,
      reason: "No Kalshi quote available",
      polyQuote,
      kalshiQuote: null,
      computedEdge: null,
    };
  }

  // Validate quotes
  if (!isValidQuote(polyQuote)) {
    return {
      opportunity: null,
      reason: "Polymarket quote invalid (no bids/asks)",
      polyQuote,
      kalshiQuote,
      computedEdge: null,
    };
  }

  if (!isValidQuote(kalshiQuote)) {
    return {
      opportunity: null,
      reason: "Kalshi quote invalid (no bids/asks)",
      polyQuote,
      kalshiQuote,
      computedEdge: null,
    };
  }

  // Find best box configuration
  const box = findBestBox(polyQuote, kalshiQuote);

  // Validate prices are within venue bounds
  if (!isValidVenuePrice(box.yesAsk, box.yesVenue)) {
    return {
      opportunity: null,
      reason: `Invalid ${box.yesVenue} YES price: ${box.yesAsk.toFixed(4)} (must be 0.01-0.99)`,
      polyQuote,
      kalshiQuote,
      computedEdge: null,
    };
  }

  if (!isValidVenuePrice(box.noAsk, box.noVenue)) {
    return {
      opportunity: null,
      reason: `Invalid ${box.noVenue} NO price: ${box.noAsk.toFixed(4)} (must be 0.01-0.99)`,
      polyQuote,
      kalshiQuote,
      computedEdge: null,
    };
  }

  // Compute edge with dynamic price-specific fees
  const polyPrice = box.yesVenue === "polymarket" ? box.yesAsk : box.noAsk;
  const kalshiPrice = box.yesVenue === "kalshi" ? box.yesAsk : box.noAsk;
  const dynamicFeeBuffer = getFeeBufferForPrices(polyPrice, kalshiPrice, 1);
  const edgeResult = computeEdge(box.yesAsk, box.noAsk, dynamicFeeBuffer, slippageBuffer);

  // Check if profitable
  if (!edgeResult.profitable) {
    return {
      opportunity: null,
      reason: `No edge: cost=${box.cost.toFixed(3)}, net=${edgeResult.edgeNet.toFixed(3)}`,
      polyQuote,
      kalshiQuote,
      computedEdge: edgeResult,
    };
  }

  // Check minimum edge threshold
  if (edgeResult.edgeNet < minEdgeNet) {
    return {
      opportunity: null,
      reason: `Edge ${edgeResult.edgeNet.toFixed(4)} < min ${minEdgeNet.toFixed(4)}`,
      polyQuote,
      kalshiQuote,
      computedEdge: edgeResult,
    };
  }

  // Dynamic qty: maximize contracts based on orderbook depth
  // Take bookDepthFraction (80%) of available book depth to guarantee fill (headroom for book movement)
  const safeSize = Math.floor(Math.min(box.yesSize, box.noSize) * RISK_PARAMS.bookDepthFraction);
  // Cap by hard maximum per trade
  const qty = Math.min(safeSize, RISK_PARAMS.maxQtyPerTrade);

  // Validate that qty meets Polymarket minimum order constraints
  const polyMinQty = calculateMinQuantityForPolymarket(polyPrice);

  if (qty < polyMinQty) {
    return {
      opportunity: null,
      reason: `Insufficient liquidity for Polymarket minimum: available=${qty}, required=${polyMinQty} (book: yes=${box.yesSize}, no=${box.noSize})`,
      polyQuote,
      kalshiQuote,
      computedEdge: edgeResult,
    };
  }

  // Build opportunity
  const yesLeg: ArbLeg = {
    venue: box.yesVenue,
    side: "yes",
    price: box.yesAsk,
    size: box.yesSize,
  };

  const noLeg: ArbLeg = {
    venue: box.noVenue,
    side: "no",
    price: box.noAsk,
    size: box.noSize,
  };

  const opportunity: Opportunity = {
    intervalKey,
    timestamp: Date.now(),
    legs: [yesLeg, noLeg],
    cost: edgeResult.cost,
    edgeGross: edgeResult.edgeGross,
    edgeNet: edgeResult.edgeNet,
    reason: `Buy ${box.yesVenue.toUpperCase()} YES @ ${box.yesAsk.toFixed(3)}, ` +
      `Buy ${box.noVenue.toUpperCase()} NO @ ${box.noAsk.toFixed(3)} (qty=${qty})`,
    qty,
  };

  return {
    opportunity,
    reason: opportunity.reason,
    polyQuote,
    kalshiQuote,
    computedEdge: edgeResult,
  };
}

