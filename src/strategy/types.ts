/**
 * Strategy types for arbitrage scanning.
 */

import type { IntervalKey } from "../time/interval";
import type { NormalizedQuote } from "../normalization/types";

/**
 * Venue identifier.
 */
export type Venue = "polymarket" | "kalshi";

/**
 * Side of a trade (YES or NO outcome).
 */
export type Side = "yes" | "no";

/**
 * A single leg of an arbitrage trade.
 */
export interface ArbLeg {
  /** Venue where this leg executes */
  venue: Venue;
  /** Which side (YES or NO) to buy */
  side: Side;
  /** Price to pay for this leg (0-1) */
  price: number;
  /** Size available at this price */
  size: number;
}

/**
 * A detected arbitrage opportunity.
 */
export interface Opportunity {
  /** Interval this opportunity is for */
  intervalKey: IntervalKey;
  /** Timestamp when opportunity was detected (ms) */
  timestamp: number;
  /** The two legs of the box trade [yesLeg, noLeg] */
  legs: [ArbLeg, ArbLeg];
  /** Total cost to acquire the box (per contract) */
  cost: number;
  /** Gross edge before fees/slippage (per contract) */
  edgeGross: number;
  /** Net edge after fees/slippage (per contract) */
  edgeNet: number;
  /** Human-readable description of the opportunity */
  reason: string;
  /** Quantity to trade (calculated based on Polymarket min order constraints) */
  qty: number;
}

/**
 * Result of a guard check.
 */
export type GuardResult =
  | { pass: true }
  | { pass: false; reason: string };

/**
 * Context for running guard checks.
 */
export interface GuardContext {
  /** Current net edge */
  edgeNet: number;
  /** Minimum required edge */
  minEdge: number;
  /** Size available for YES leg */
  yesSizeAvailable: number;
  /** Size available for NO leg */
  noSizeAvailable: number;
  /** Minimum size required per leg */
  minSizePerLeg: number;
  /** Timestamp of last failed trade (null if none) */
  lastFailureTs: number | null;
  /** Cooldown duration after failure (ms) */
  cooldownMs: number;
  /** Current daily realized loss */
  dailyLoss: number;
  /** Maximum allowed daily loss */
  maxDailyLoss: number;
  /** Current total notional deployed */
  currentNotional: number;
  /** Maximum total notional allowed */
  maxNotional: number;
  /** Estimated cost of this trade */
  estimatedCost: number;
  /** Open order count for Polymarket (optional) */
  polymarketOpenOrders?: number;
  /** Open order count for Kalshi (optional) */
  kalshiOpenOrders?: number;
  /** Maximum open orders per venue (optional) */
  maxOpenOrdersPerVenue?: number;
}

/**
 * Context for scanning for arbitrage.
 */
export interface ScanContext {
  /** Latest normalized quote from Polymarket (null if unavailable) */
  polyQuote: NormalizedQuote | null;
  /** Latest normalized quote from Kalshi (null if unavailable) */
  kalshiQuote: NormalizedQuote | null;
  /** Current interval key */
  intervalKey: IntervalKey;
  /** Fee buffer for the trade */
  feeBuffer: number;
  /** Slippage buffer for the trade */
  slippageBuffer: number;
  /** Minimum required net edge */
  minEdgeNet: number;
}

/**
 * Result of scanning for arbitrage.
 */
export interface ScanResult {
  /** Detected opportunity (null if none) */
  opportunity: Opportunity | null;
  /** Reason for result (description of opportunity or why none found) */
  reason: string;
  /** The Polymarket quote used */
  polyQuote: NormalizedQuote | null;
  /** The Kalshi quote used */
  kalshiQuote: NormalizedQuote | null;
  /** Computed edge (null if quotes unavailable) */
  computedEdge: {
    cost: number;
    edgeGross: number;
    edgeNet: number;
    profitable: boolean;
  } | null;
}
