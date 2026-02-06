/**
 * Global execution state management.
 *
 * Singleton module that tracks:
 * - Busy flag (prevents concurrent executions)
 * - Cooldown after failures
 * - Daily PnL tracking
 * - Kill switch status
 * - Total notional deployed
 */

import type { ExecutionState, ExecutionRecord, PendingSettlement } from "./types";
import type { IntervalKey } from "../time/interval";
import { intervalKeyToString } from "../time/interval";
import { RISK_PARAMS } from "../config/riskParams";

/**
 * Get the start of the current day in milliseconds (UTC midnight).
 */
function getDayStart(now: number = Date.now()): number {
  const date = new Date(now);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0
  );
}

/**
 * Global execution state - singleton.
 */
const state: ExecutionState = {
  busy: false,
  currentExecution: null,
  lastFailureTs: null,
  dailyRealizedPnl: 0,
  dailyStartTs: getDayStart(),
  killSwitchTriggered: false,
  totalNotional: 0,
};

/**
 * Cumulative unwind losses for the current day (stored as positive number).
 * Tracked separately from dailyRealizedPnl so we can show arb profits vs losses independently.
 */
let dailyUnwindLoss = 0;

/**
 * Whether a forced liquidation is currently in progress.
 */
let liquidationInProgress = false;

/**
 * Pending settlements state - tracks unrealized PnL until interval ends.
 */
const pendingSettlements: Map<string, PendingSettlement> = new Map();

/**
 * Attempt to acquire the busy lock for execution.
 *
 * @returns true if lock acquired, false if already busy
 */
export function acquireBusyLock(): boolean {
  if (state.busy) {
    return false;
  }
  state.busy = true;
  return true;
}

/**
 * Release the busy lock after execution completes.
 */
export function releaseBusyLock(): void {
  state.busy = false;
  state.currentExecution = null;
}

/**
 * Check if an execution is currently in progress.
 */
export function isExecutionBusy(): boolean {
  return state.busy;
}

/**
 * Set the current execution record.
 */
export function setCurrentExecution(record: ExecutionRecord): void {
  state.currentExecution = record;
}

/**
 * Get the current execution record.
 */
export function getCurrentExecution(): ExecutionRecord | null {
  return state.currentExecution;
}

/**
 * Check if we're currently in cooldown after a failure.
 *
 * @param now - Current timestamp in ms (default: Date.now())
 * @returns true if in cooldown
 */
export function isInCooldown(now: number = Date.now()): boolean {
  if (state.lastFailureTs === null) {
    return false;
  }

  const elapsed = now - state.lastFailureTs;
  return elapsed < RISK_PARAMS.cooldownMsAfterFailure;
}

/**
 * Get time remaining in cooldown (ms).
 *
 * @param now - Current timestamp in ms
 * @returns Milliseconds remaining, or 0 if not in cooldown
 */
export function getCooldownRemaining(now: number = Date.now()): number {
  if (state.lastFailureTs === null) {
    return 0;
  }

  const elapsed = now - state.lastFailureTs;
  const remaining = RISK_PARAMS.cooldownMsAfterFailure - elapsed;
  return Math.max(0, remaining);
}

/**
 * Enter cooldown after a failure.
 *
 * @param timestamp - Failure timestamp (default: now)
 */
export function enterCooldown(timestamp: number = Date.now()): void {
  state.lastFailureTs = timestamp;
}

/**
 * Clear cooldown (e.g., after successful execution).
 */
export function clearCooldown(): void {
  state.lastFailureTs = null;
}

/**
 * Record realized PnL from an execution.
 *
 * Handles daily reset if crossing midnight boundary.
 *
 * @param pnl - Realized PnL (positive or negative)
 */
export function recordPnl(pnl: number): void {
  const now = Date.now();
  const todayStart = getDayStart(now);

  // Reset daily tracking if day changed
  if (todayStart > state.dailyStartTs) {
    state.dailyRealizedPnl = 0;
    state.dailyStartTs = todayStart;
    dailyUnwindLoss = 0;
    // Note: do NOT reset kill switch on day change - requires manual reset
  }

  state.dailyRealizedPnl += pnl;
}

/**
 * Get current daily realized PnL.
 */
export function getDailyPnl(): number {
  // Check for day rollover
  const now = Date.now();
  const todayStart = getDayStart(now);

  if (todayStart > state.dailyStartTs) {
    state.dailyRealizedPnl = 0;
    state.dailyStartTs = todayStart;
  }

  return state.dailyRealizedPnl;
}

/**
 * Get current daily loss (absolute value of negative PnL).
 *
 * Returns 0 if daily PnL is positive.
 */
export function getDailyLoss(): number {
  const pnl = getDailyPnl();
  return pnl < 0 ? Math.abs(pnl) : 0;
}

/**
 * Record an unwind loss (separate from daily PnL for display purposes).
 *
 * @param loss - Positive number representing the loss amount
 */
export function recordUnwindLoss(loss: number): void {
  // Handle day rollover
  const now = Date.now();
  const todayStart = getDayStart(now);
  if (todayStart > state.dailyStartTs) {
    dailyUnwindLoss = 0;
  }

  dailyUnwindLoss += loss;
}

/**
 * Get cumulative unwind losses for the current day.
 *
 * @returns Positive number representing total unwind losses
 */
export function getDailyUnwindLoss(): number {
  const now = Date.now();
  const todayStart = getDayStart(now);
  if (todayStart > state.dailyStartTs) {
    dailyUnwindLoss = 0;
  }
  return dailyUnwindLoss;
}

/**
 * Trigger the kill switch - stops all trading.
 */
export function triggerKillSwitch(): void {
  state.killSwitchTriggered = true;
}

/**
 * Check if kill switch has been triggered.
 */
export function isKillSwitchTriggered(): boolean {
  return state.killSwitchTriggered;
}

/**
 * Reset the kill switch (manual operation).
 *
 * Only call this after investigating why kill switch was triggered.
 */
export function resetKillSwitch(): void {
  state.killSwitchTriggered = false;
}

/**
 * Reset daily tracking (for new trading day).
 */
export function resetDailyTracking(): void {
  state.dailyRealizedPnl = 0;
  state.dailyStartTs = getDayStart();
  dailyUnwindLoss = 0;
}

/**
 * Get total notional currently deployed.
 */
export function getTotalNotional(): number {
  return state.totalNotional;
}

/**
 * Add to total notional deployed.
 */
export function addNotional(amount: number): void {
  state.totalNotional += amount;
}

/**
 * Remove from total notional deployed.
 */
export function removeNotional(amount: number): void {
  state.totalNotional = Math.max(0, state.totalNotional - amount);
}

/**
 * Reset total notional (e.g., at day start or after reconciliation).
 */
export function resetNotional(): void {
  state.totalNotional = 0;
}

/**
 * Get the last failure timestamp.
 */
export function getLastFailureTs(): number | null {
  return state.lastFailureTs;
}

/**
 * Get a copy of the full execution state (for logging/inspection).
 */
export function getExecutionState(): Readonly<ExecutionState> {
  return { ...state };
}

// === Liquidation state ===

/**
 * Mark that a forced liquidation is in progress.
 */
export function startLiquidation(): void {
  liquidationInProgress = true;
}

/**
 * Check if a forced liquidation is in progress.
 */
export function isLiquidationInProgress(): boolean {
  return liquidationInProgress;
}

/**
 * Mark that a forced liquidation has completed.
 */
export function stopLiquidation(): void {
  liquidationInProgress = false;
}

/**
 * Reset all state (for testing).
 *
 * WARNING: Only use in tests!
 */
export function resetAllState(): void {
  state.busy = false;
  state.currentExecution = null;
  state.lastFailureTs = null;
  state.dailyRealizedPnl = 0;
  state.dailyStartTs = getDayStart();
  state.killSwitchTriggered = false;
  state.totalNotional = 0;
  dailyUnwindLoss = 0;
  liquidationInProgress = false;
  pendingSettlements.clear();
}

// === Pending Settlement Tracking ===

/**
 * Add a pending settlement for a completed box trade.
 *
 * The settlement is tracked until the interval ends and settles.
 */
export function addPendingSettlement(settlement: PendingSettlement): void {
  pendingSettlements.set(settlement.executionId, settlement);
}

/**
 * Get total unrealized PnL from pending settlements.
 */
export function getUnrealizedPnl(): number {
  let total = 0;
  for (const settlement of pendingSettlements.values()) {
    total += settlement.expectedPnl;
  }
  return total;
}

/**
 * Get all pending settlements.
 */
export function getPendingSettlements(): PendingSettlement[] {
  return Array.from(pendingSettlements.values());
}

/**
 * Get pending settlements for a specific interval.
 */
export function getPendingSettlementsForInterval(
  intervalKey: IntervalKey
): PendingSettlement[] {
  const key = intervalKeyToString(intervalKey);
  return Array.from(pendingSettlements.values()).filter(
    (s) => intervalKeyToString(s.intervalKey) === key
  );
}

/**
 * Settle pending settlements for an interval.
 *
 * Called when an interval ends. Moves unrealized PnL to realized.
 *
 * @param intervalKey - The interval that just ended
 * @returns Object with realized total and settled settlements
 */
export function settlePending(intervalKey: IntervalKey): {
  realized: number;
  settled: PendingSettlement[];
} {
  const key = intervalKeyToString(intervalKey);
  const toSettle: PendingSettlement[] = [];
  let realized = 0;

  // Find all settlements for this interval
  for (const [execId, settlement] of pendingSettlements.entries()) {
    if (intervalKeyToString(settlement.intervalKey) === key) {
      toSettle.push(settlement);
      realized += settlement.expectedPnl;
      pendingSettlements.delete(execId);
    }
  }

  // Record the realized PnL
  if (realized !== 0) {
    recordPnl(realized);
  }

  return { realized, settled: toSettle };
}

/**
 * Get settlement statistics.
 */
export function getSettlementStats(): {
  pendingCount: number;
  unrealizedPnl: number;
  nextSettlement: number | null;
} {
  const settlements = Array.from(pendingSettlements.values());

  let nextSettlement: number | null = null;
  for (const s of settlements) {
    if (nextSettlement === null || s.settlesAt < nextSettlement) {
      nextSettlement = s.settlesAt;
    }
  }

  return {
    pendingCount: settlements.length,
    unrealizedPnl: getUnrealizedPnl(),
    nextSettlement,
  };
}
