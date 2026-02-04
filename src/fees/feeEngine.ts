/**
 * Fee estimation engine for cross-venue arbitrage.
 *
 * Conservative worst-case fee assumptions for v0.1.
 * These are intentionally pessimistic until empirical fills confirm actual costs.
 *
 * Fee sources:
 * - Polymarket: ~2% taker fee on fill value
 * - Kalshi: ~1% per side + contract fees (~$0.01-0.03 per contract)
 */

/**
 * Fee estimate breakdown for a box trade (2 legs).
 */
export interface FeeEstimate {
  /** Estimated fee for the Polymarket leg */
  polymarketFee: number;
  /** Estimated fee for the Kalshi leg */
  kalshiFee: number;
  /** Total combined fee buffer for the 2-leg box */
  totalFeeBuffer: number;
}

/**
 * Polymarket fee parameters (conservative estimates).
 *
 * Polymarket charges a taker fee on matched trades.
 * Using 2% as worst-case estimate.
 */
const POLYMARKET_TAKER_FEE_RATE = 0.02;

/**
 * Kalshi fee parameters (conservative estimates).
 *
 * Kalshi has:
 * - A percentage-based fee (around 1% per side)
 * - A per-contract fee (~$0.01-0.03)
 *
 * Using conservative estimates that combine both.
 */
const KALSHI_FEE_RATE = 0.01;
const KALSHI_PER_CONTRACT_FEE = 0.03;

/**
 * Estimate fees for a single leg on Polymarket.
 *
 * @param price - Fill price (0-1)
 * @param qty - Number of contracts
 * @returns Estimated fee in dollars
 */
export function estimatePolymarketFee(price: number, qty: number): number {
  const notional = price * qty;
  return notional * POLYMARKET_TAKER_FEE_RATE;
}

/**
 * Estimate fees for a single leg on Kalshi.
 *
 * @param price - Fill price (0-1)
 * @param qty - Number of contracts
 * @returns Estimated fee in dollars
 */
export function estimateKalshiFee(price: number, qty: number): number {
  const notional = price * qty;
  const percentageFee = notional * KALSHI_FEE_RATE;
  const contractFee = qty * KALSHI_PER_CONTRACT_FEE;
  return percentageFee + contractFee;
}

/**
 * Estimate total fees for a 2-leg box trade.
 *
 * Assumes one leg on Polymarket, one leg on Kalshi.
 * Uses average price of 0.50 as a conservative middle estimate.
 *
 * @param polyPrice - Price of Polymarket leg (0-1)
 * @param kalshiPrice - Price of Kalshi leg (0-1)
 * @param qty - Number of contracts per leg
 * @returns Fee estimate breakdown
 */
export function estimateFees(
  polyPrice: number,
  kalshiPrice: number,
  qty: number = 1
): FeeEstimate {
  const polymarketFee = estimatePolymarketFee(polyPrice, qty);
  const kalshiFee = estimateKalshiFee(kalshiPrice, qty);

  return {
    polymarketFee,
    kalshiFee,
    totalFeeBuffer: polymarketFee + kalshiFee,
  };
}

/**
 * Get a conservative total fee buffer for a box trade.
 *
 * Uses worst-case assumptions:
 * - 2 legs at ~0.50 price each
 * - 1 contract per leg
 *
 * This is the default fee buffer used when specific prices aren't known.
 *
 * @returns Total fee buffer in dollars
 */
export function getFeeBuffer(): number {
  // Conservative estimate: assume both legs around $0.50
  const avgPrice = 0.5;
  const estimate = estimateFees(avgPrice, avgPrice, 1);
  return estimate.totalFeeBuffer;
}

/**
 * Get fee buffer based on actual leg prices.
 *
 * @param polyPrice - Price of Polymarket leg (0-1)
 * @param kalshiPrice - Price of Kalshi leg (0-1)
 * @param qty - Number of contracts per leg
 * @returns Total fee buffer in dollars
 */
export function getFeeBufferForPrices(
  polyPrice: number,
  kalshiPrice: number,
  qty: number = 1
): number {
  return estimateFees(polyPrice, kalshiPrice, qty).totalFeeBuffer;
}
