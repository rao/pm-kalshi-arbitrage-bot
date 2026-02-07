/**
 * Execution types for two-phase commit arbitrage execution.
 */

import type { IntervalKey } from "../time/interval";
import type { NormalizedQuote } from "../normalization/types";
import type { Opportunity, ArbLeg, Venue, Side } from "../strategy/types";
import type { IntervalMapping } from "../markets/mappingStore";

/**
 * Status of a single leg order.
 */
export type LegStatus =
  | "pending"
  | "submitting"
  | "filled"
  | "rejected"
  | "timeout";

/**
 * Overall execution status.
 */
export type ExecutionStatus =
  | "pending"
  | "leg_a_submitting"
  | "leg_a_filled"
  | "leg_b_submitting"
  | "leg_b_filled"
  | "legs_submitting"
  | "both_legs_failed"
  | "success"
  | "leg_a_failed"
  | "leg_b_failed"
  | "unwinding"
  | "unwound"
  | "aborted";

/**
 * Parameters for placing an order.
 */
export interface OrderParams {
  /** Venue to place order on */
  venue: Venue;
  /** Side of the order (yes or no) */
  side: Side;
  /** Action: buy or sell */
  action: "buy" | "sell";
  /** Price (0-1 decimal) */
  price: number;
  /** Quantity (number of contracts) */
  qty: number;
  /** Time in force - FOK for normal orders, MARKET for emergency unwinds */
  timeInForce: "FOK" | "MARKET" | "IOC";
  /** Order type - "limit" (default) or "market" (for emergency unwinds) */
  orderType?: "limit" | "market";
  /** Market identifier (ticker for Kalshi, token ID for Polymarket) */
  marketId: string;
  /** Client-generated order ID for tracking */
  clientOrderId: string;
  /** If true, order can only reduce an existing position (prevents creating short positions) */
  reduceOnly?: boolean;
}

/**
 * Result of an order placement attempt.
 */
export interface OrderResult {
  /** Whether the order was filled successfully */
  success: boolean;
  /** Exchange-assigned order ID (null if order rejected before submission) */
  orderId: string | null;
  /** Quantity filled */
  fillQty: number;
  /** Price at which filled (0-1 decimal) */
  fillPrice: number;
  /** Venue where order was placed */
  venue: Venue;
  /** Final status of the order */
  status: LegStatus;
  /** Timestamp when order was submitted (ms) */
  submittedAt: number;
  /** Timestamp when order was filled (null if not filled) */
  filledAt: number | null;
  /** Error message if order failed */
  error: string | null;
}

/**
 * Execution details for a single leg.
 */
export interface LegExecution {
  /** The arbitrage leg this execution is for */
  leg: ArbLeg;
  /** Order parameters used */
  params: OrderParams;
  /** Result of the order (null if not yet attempted) */
  result: OrderResult | null;
  /** Timestamp when order was submitted (ms) */
  submitTs: number | null;
  /** Timestamp when order was filled (ms) */
  fillTs: number | null;
}

/**
 * Record of an unwind operation.
 */
export interface UnwindRecord {
  /** The leg that needs to be unwound */
  legToUnwind: LegExecution;
  /** Parameters for the unwind order */
  unwindParams: OrderParams;
  /** Result of the unwind order */
  result: OrderResult | null;
  /** When unwind started (ms) */
  startTs: number;
  /** When unwind completed (ms) */
  endTs: number | null;
  /** Realized loss from unwinding */
  realizedLoss: number;
  /** Reason for unwinding */
  reason: string;
}

/**
 * Complete record of an execution attempt.
 */
export interface ExecutionRecord {
  /** Unique execution ID */
  id: string;
  /** The opportunity being executed */
  opportunity: Opportunity;
  /** Current execution status */
  status: ExecutionStatus;
  /** Leg A execution details */
  legA: LegExecution;
  /** Leg B execution details */
  legB: LegExecution;
  /** Unwind record if abort was triggered (null otherwise) */
  unwind: UnwindRecord | null;
  /** When execution started (ms) */
  startTs: number;
  /** When execution ended (ms) */
  endTs: number | null;
  /** Expected net edge at decision time */
  expectedEdgeNet: number;
  /** Realized PnL (null if not yet computed) */
  realizedPnl: number | null;
  /** Polymarket quote snapshot at execution time */
  polyQuoteSnapshot: NormalizedQuote;
  /** Kalshi quote snapshot at execution time */
  kalshiQuoteSnapshot: NormalizedQuote;
}

/**
 * Global execution state.
 */
export interface ExecutionState {
  /** Whether an execution is currently in progress */
  busy: boolean;
  /** Current execution record (null if not executing) */
  currentExecution: ExecutionRecord | null;
  /** Timestamp of last failed execution (null if none) */
  lastFailureTs: number | null;
  /** Cumulative realized PnL for the day */
  dailyRealizedPnl: number;
  /** Start of the current trading day (ms) */
  dailyStartTs: number;
  /** Whether kill switch has been triggered */
  killSwitchTriggered: boolean;
  /** Total notional deployed (cost of open positions) */
  totalNotional: number;
}

/**
 * Result of an execution attempt.
 */
export interface ExecutionResult {
  /** Whether execution was successful */
  success: boolean;
  /** The execution record */
  record: ExecutionRecord;
  /** Whether to enter cooldown after this execution */
  shouldEnterCooldown: boolean;
  /** Whether to trigger kill switch */
  shouldTriggerKillSwitch: boolean;
  /** Error message if execution failed */
  error: string | null;
}

/**
 * Context provided to the executor.
 */
export interface ExecutionContext {
  /** The opportunity to execute */
  opportunity: Opportunity;
  /** Market mapping for the current interval */
  mapping: IntervalMapping;
  /** Current Polymarket quote */
  polyQuote: NormalizedQuote;
  /** Current Kalshi quote */
  kalshiQuote: NormalizedQuote;
  /** Whether this is a dry run (log only, no real orders) */
  dryRun: boolean;
}

/**
 * Status of an order on a venue.
 */
export interface OrderStatusResult {
  /** Raw status string from the venue */
  status: string;
  /** Whether the order has been filled */
  filled: boolean;
  /** Actual fill price (0-1 decimal), if filled */
  fillPrice?: number;
  /** Quantity filled */
  fillQty?: number;
}

/**
 * Venue client interfaces for order operations.
 */
export interface VenueClients {
  /** Place an order on a venue */
  placeOrder: (params: OrderParams) => Promise<OrderResult>;
  /** Cancel an order on a venue */
  cancelOrder: (venue: Venue, orderId: string) => Promise<boolean>;
  /** Get current quote for a venue */
  getQuote: (venue: Venue) => NormalizedQuote | null;
  /** Get the status of an order (for cancel-then-verify flow) */
  getOrderStatus: (venue: Venue, orderId: string) => Promise<OrderStatusResult>;
  /** Get actual token balance for a Polymarket position (for sell qty validation) */
  getTokenBalance?: (venue: Venue, tokenId: string) => Promise<number>;
  /** Pre-compute auth/signatures for an upcoming order (latency optimization) */
  prepareOrder?: (params: OrderParams) => void;
}

/**
 * Generate a unique execution ID.
 */
export function generateExecutionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `exec_${timestamp}_${random}`;
}

/**
 * Generate a unique client order ID.
 */
export function generateClientOrderId(venue: Venue, leg: "A" | "B" | "U"): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${venue}_${leg}_${timestamp}_${random}`;
}

/**
 * Pending settlement for a completed box trade.
 *
 * Contracts settle at the END of the interval, not immediately.
 * This tracks unrealized PnL until settlement.
 */
export interface PendingSettlement {
  /** Unique execution ID */
  executionId: string;
  /** Interval key for this settlement */
  intervalKey: IntervalKey;
  /** Timestamp when interval ends and settlement occurs */
  settlesAt: number;
  /** Expected PnL at settlement ($1 - total cost) */
  expectedPnl: number;
  /** Actual cost paid for the box */
  actualCost: number;
  /** Quantity of contracts in the box */
  qty: number;
  /** When the box was completed */
  completedAt: number;
}
