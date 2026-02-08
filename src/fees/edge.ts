/**
 * Edge calculation for arbitrage opportunities.
 *
 * Computes gross and net edge for buy-both "box" arbitrage.
 * Box arb: buy YES at one venue + buy NO at other venue = guaranteed $1 payout.
 */

/**
 * Result of edge calculation.
 */
export interface EdgeResult {
  /** Total cost to acquire the box (yesAsk + noAsk) */
  cost: number;
  /** Gross edge before fees/slippage: 1.0 - cost */
  edgeGross: number;
  /** Net edge after fees and slippage */
  edgeNet: number;
  /** Whether the opportunity is profitable */
  profitable: boolean;
}

/**
 * Compute the edge for a buy-both box arbitrage.
 *
 * Box arbitrage: buy YES at one venue + buy NO at another venue.
 * Settlement payout is always $1.00 (one of YES or NO will pay out).
 *
 * @param yesAsk - Best ask price to buy YES (0-1)
 * @param noAsk - Best ask price to buy NO (0-1)
 * @param feeBuffer - Total fee buffer for both legs
 * @param slippageBuffer - Total slippage buffer for both legs
 * @returns Edge calculation result
 *
 * @example
 * // Buy YES at 0.48, NO at 0.47, $0.03 fees, $0.01 slippage
 * computeEdge(0.48, 0.47, 0.03, 0.01)
 * // => { cost: 0.95, edgeGross: 0.05, edgeNet: 0.01, profitable: false }
 */
export function computeEdge(
  yesAsk: number,
  noAsk: number,
  feeBuffer: number,
  slippageBuffer: number
): EdgeResult {
  // Total cost to buy the box
  const cost = yesAsk + noAsk;

  // Gross edge: what we'd make without fees/slippage
  // Settlement pays $1.00, so edge = 1.00 - cost
  const edgeGross = 1.0 - cost;

  // Net edge: after accounting for fees and slippage
  const edgeNet = edgeGross - feeBuffer - slippageBuffer;

  return {
    cost,
    edgeGross,
    edgeNet,
    profitable: edgeNet > 0,
  };
}

