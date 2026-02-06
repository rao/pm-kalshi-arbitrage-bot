/**
 * Risk parameters for v0.1 conservative trading.
 *
 * Per CLAUDE.md spec, these are intentionally conservative:
 * - $10 max total, $5 per venue
 * - 1 contract per leg (correctness over profit)
 * - 4 cent minimum net edge
 */

export const RISK_PARAMS = {
  /** Maximum total notional across both venues */
  maxNotional: 200.0,
  /** Maximum notional per venue */
  maxNotionalPerVenue: 100.0,
  /** Number of contracts per trade leg */
  qtyPerTrade: 1,
  /** Minimum net edge after fees/slippage required to trade ($0.04) */
  minEdgeNet: 0.04,
  /** Slippage buffer per leg ($0.005) */
  slippageBufferPerLeg: 0.005,
  /** Maximum delay between leg A and leg B fills (ms) */
  maxLegDelayMs: 500,
  /** Maximum time to hold unhedged position (ms) */
  maxUnhedgedTimeMs: 1500,
  /** Cooldown period after a failed trade (ms) */
  cooldownMsAfterFailure: 3000,
  /** Maximum daily loss before kill switch triggers ($20.00) */
  maxDailyLoss: 20.00,
  /** Maximum open orders per venue */
  maxOpenOrdersPerVenue: 2,
  /** Timeout for individual leg orders (ms) - prevents getting stuck */
  legOrderTimeoutMs: 10000,
  /** Maximum contracts per trade (hard cap for dynamic sizing) */
  maxQtyPerTrade: 25,
  /** Fraction of available book depth to use (safety buffer for book movement) */
  bookDepthFraction: 0.80,
  /** Number of price ladder steps before market fallback during unwind */
  unwindLadderSteps: 3,
  /** Price decrement per ladder step (in decimal, $0.01 = 1 cent) */
  unwindLadderStepSize: 0.01,
  /** Timeout per ladder step in ms (wait for fill before stepping down) */
  unwindLadderStepTimeoutMs: 500,
  /** Hard cap for entire unwind process in ms */
  unwindMaxTotalTimeMs: 3000,
  /** Delay before Polymarket unwind sells to allow on-chain settlement (ms) */
  polymarketSettlementDelayMs: 2500,
  /** Number of retries when checking on-chain balance before unwind sell */
  unwindBalanceCheckRetries: 3,
  /** Delay between balance check retries (ms) */
  unwindBalanceCheckIntervalMs: 2000,
  /** Minimum Polymarket IOC fill qty worth hedging on Kalshi (must be >= 1) */
  minPartialFillQty: 1,
  /** Minimum cash balance per venue before kill switch triggers ($) */
  minVenueBalance: 10.0,
  /** Grace period after execution before reconciler acts (ms). Polymarket on-chain settlement can take 5-15s. */
  reconcilerPostExecGracePeriodMs: 30000,
} as const;

export type RiskParams = typeof RISK_PARAMS;

/**
 * Price bounds for each venue.
 *
 * Both Polymarket and Kalshi use 1-99 cent prices (0.01-0.99 in decimal).
 * Prices outside these bounds will be rejected by the venue.
 */
export const PRICE_BOUNDS = {
  polymarket: { min: 0.01, max: 0.99, tickSize: 0.01 },
  kalshi: { min: 0.01, max: 0.99, tickSize: 0.01 },
} as const;

export type PriceBounds = typeof PRICE_BOUNDS;

/**
 * Polymarket minimum order value for marketable orders (including FOK).
 * Orders below $1 will be rejected with "invalid amount for a marketable BUY order".
 */
export const POLYMARKET_MIN_ORDER_VALUE = 1.0;

/**
 * Polymarket minimum shares for limit orders.
 */
export const POLYMARKET_MIN_SHARES = 5;

/**
 * Calculate minimum quantity to satisfy Polymarket order constraints.
 *
 * Polymarket requires:
 * 1. $1 minimum order value for marketable orders
 * 2. 5 share minimum for limit orders
 *
 * @param polymarketPrice - The price per share (0.01-0.99)
 * @returns Minimum quantity that satisfies both constraints
 *
 * @example
 * // price = $0.30 -> max(5, ceil(3.33)) = max(5, 4) = 5 shares ($1.50)
 * calculateMinQuantityForPolymarket(0.30) // returns 5
 *
 * // price = $0.10 -> max(5, ceil(10)) = max(5, 10) = 10 shares ($1.00)
 * calculateMinQuantityForPolymarket(0.10) // returns 10
 *
 * // price = $0.50 -> max(5, ceil(2)) = max(5, 2) = 5 shares ($2.50)
 * calculateMinQuantityForPolymarket(0.50) // returns 5
 */
export function calculateMinQuantityForPolymarket(polymarketPrice: number): number {
  // Must satisfy BOTH:
  // 1. qty >= ceil($1 / price) -- for $1 minimum order value
  // 2. qty >= 5 -- for 5 share minimum
  const qtyForMinValue = Math.ceil(POLYMARKET_MIN_ORDER_VALUE / polymarketPrice);
  return Math.max(POLYMARKET_MIN_SHARES, qtyForMinValue);
}
