/**
 * Risk parameters for v0.1 conservative trading.
 *
 * Per CLAUDE.md spec, these are intentionally conservative:
 * - $10 max total, $5 per venue
 * - 1 contract per leg (correctness over profit)
 * - 4 cent minimum net edge
 */

export const RISK_PARAMS = {
  /** Maximum total notional across both venues ($10) */
  maxNotional: 10.0,
  /** Maximum notional per venue ($5) */
  maxNotionalPerVenue: 5.0,
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
  /** Maximum daily loss before kill switch triggers ($0.50) */
  maxDailyLoss: 0.5,
  /** Maximum open orders per venue */
  maxOpenOrdersPerVenue: 2,
} as const;

export type RiskParams = typeof RISK_PARAMS;
