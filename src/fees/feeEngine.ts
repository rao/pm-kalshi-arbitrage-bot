/**
 * Fee estimation engine for cross-venue arbitrage.
 *
 * Exact venue fee formulas:
 *
 * Kalshi: fee = ceil_cents(0.07 * contracts * price * (1 - price))
 *   - Parabolic: max fee at price=0.50, zero at extremes (0 or 1)
 *   - Rounded up to nearest cent ($0.01)
 *
 * Polymarket: fee = ceil_4dp(shares * price * 0.25 * (price * (1 - price))^2)
 *   - Quartic: max fee is 1.56% of notional at price=0.50
 *   - Rounded up to 4 decimal places ($0.0001)
 *   - Very small trades near extremes may incur no fee
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
 * Round up to nearest cent ($0.01).
 */
function ceilCents(dollars: number): number {
  return Math.ceil(dollars * 100) / 100;
}

/**
 * Round up to 4 decimal places ($0.0001).
 */
function ceil4dp(dollars: number): number {
  return Math.ceil(dollars * 10000) / 10000;
}

/**
 * Estimate fees for a single leg on Polymarket.
 *
 * Exact formula: ceil_4dp(shares * price * 0.25 * (price * (1 - price))^2)
 * Max fee is 1.56% of notional at price = 0.50.
 *
 * @param price - Fill price (0-1)
 * @param qty - Number of shares
 * @returns Estimated fee in dollars
 */
export function estimatePolymarketFee(price: number, qty: number): number {
  const pq = price * (1 - price);
  const raw = qty * price * 0.25 * pq * pq;
  return ceil4dp(raw);
}

/**
 * Estimate fees for a single leg on Kalshi.
 *
 * Exact formula: ceil_cents(0.07 * contracts * price * (1 - price))
 * Max fee at price = 0.50: ceil_cents(0.07 * 1 * 0.25) = $0.02
 *
 * @param price - Fill price (0-1)
 * @param qty - Number of contracts
 * @returns Estimated fee in dollars
 */
export function estimateKalshiFee(price: number, qty: number): number {
  const raw = 0.07 * qty * price * (1 - price);
  return ceilCents(raw);
}

/**
 * Estimate total fees for a 2-leg box trade.
 *
 * Assumes one leg on Polymarket, one leg on Kalshi.
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
 * Uses worst-case assumptions (price=0.50 for both legs).
 * This is used as a fallback; the scanner computes dynamic fees from actual prices.
 *
 * @returns Total fee buffer in dollars
 */
export function getFeeBuffer(): number {
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
