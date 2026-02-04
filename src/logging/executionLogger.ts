/**
 * Execution-specific structured logging.
 *
 * Logs to both console (formatted) and file (structured JSON).
 * Provides detailed visibility into execution flow.
 */

import type { Opportunity } from "../strategy/types";
import type {
  ExecutionRecord,
  OrderParams,
  OrderResult,
  UnwindRecord,
} from "../execution/types";
import type { NormalizedQuote } from "../normalization/types";
import { formatIntervalKey, type IntervalKey } from "../time/interval";

import {
  logOpportunityToFile,
  logExecutionStartToFile,
  logLegSubmitToFile,
  logLegFillToFile,
  logLegFailToFile,
  logUnwindStartToFile,
  logUnwindResultToFile,
  logExecutionCompleteToFile,
  logKillSwitchToFile,
  logCooldownToFile,
  logErrorToFile,
} from "./fileLogger";

/**
 * Format timestamp for console output.
 */
function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Format price for display.
 */
function formatPrice(price: number): string {
  return price.toFixed(4);
}

/**
 * Format dollar amount for display.
 */
function formatDollars(amount: number): string {
  const sign = amount >= 0 ? "+" : "";
  return `${sign}$${amount.toFixed(4)}`;
}

/**
 * Log opportunity detected.
 */
export function logOpportunityDetected(
  opp: Opportunity,
  quotes: { polyQuote: NormalizedQuote; kalshiQuote: NormalizedQuote }
): void {
  const intervalStr = formatIntervalKey(opp.intervalKey);

  // Console output
  console.log("");
  console.log("=".repeat(70));
  console.log(`[${formatTimestamp()}] OPPORTUNITY DETECTED`);
  console.log(`  Interval: ${intervalStr}`);
  console.log(
    `  Edge: gross=${formatDollars(opp.edgeGross)} net=${formatDollars(opp.edgeNet)}`
  );
  console.log(
    `  Legs: ${opp.legs[0].venue.toUpperCase()} ${opp.legs[0].side.toUpperCase()} @ ${formatPrice(opp.legs[0].price)} + ` +
      `${opp.legs[1].venue.toUpperCase()} ${opp.legs[1].side.toUpperCase()} @ ${formatPrice(opp.legs[1].price)} = $${opp.cost.toFixed(4)}`
  );
  console.log("=".repeat(70));
  console.log("");

  // File output (fire and forget)
  logOpportunityToFile({
    intervalKey: intervalStr,
    edgeGross: opp.edgeGross,
    edgeNet: opp.edgeNet,
    cost: opp.cost,
    legs: opp.legs.map((leg) => ({
      venue: leg.venue,
      side: leg.side,
      price: leg.price,
      size: leg.size,
    })),
  }).catch(() => {});
}

/**
 * Log execution start.
 */
export function logExecutionStart(record: ExecutionRecord): void {
  const intervalStr = formatIntervalKey(record.opportunity.intervalKey);

  // Console output
  console.log("");
  console.log(`[${formatTimestamp()}] EXECUTION START id=${record.id}`);
  console.log(`  Interval: ${intervalStr}`);
  console.log(`  Expected edge: ${formatDollars(record.expectedEdgeNet)}`);
  console.log(
    `  Leg A: ${record.legA.params.venue.toUpperCase()} ${record.legA.params.side.toUpperCase()} @ ${formatPrice(record.legA.params.price)}`
  );
  console.log(
    `  Leg B: ${record.legB.params.venue.toUpperCase()} ${record.legB.params.side.toUpperCase()} @ ${formatPrice(record.legB.params.price)}`
  );

  // File output
  logExecutionStartToFile({
    executionId: record.id,
    intervalKey: intervalStr,
    expectedEdgeNet: record.expectedEdgeNet,
    legA: {
      venue: record.legA.params.venue,
      side: record.legA.params.side,
      price: record.legA.params.price,
    },
    legB: {
      venue: record.legB.params.venue,
      side: record.legB.params.side,
      price: record.legB.params.price,
    },
  }).catch(() => {});
}

/**
 * Log leg submission.
 */
export function logLegSubmit(
  executionId: string,
  leg: "A" | "B",
  params: OrderParams
): void {
  // Console output
  console.log(
    `[${formatTimestamp()}] LEG ${leg} SUBMIT -> ${params.venue.toUpperCase()} FOK ` +
      `${params.side.toUpperCase()} @ ${formatPrice(params.price)} x${params.qty}`
  );

  // File output
  logLegSubmitToFile({
    executionId,
    leg,
    venue: params.venue,
    side: params.side,
    price: params.price,
    qty: params.qty,
    clientOrderId: params.clientOrderId,
  }).catch(() => {});
}

/**
 * Log leg fill result.
 */
export function logLegResult(
  executionId: string,
  leg: "A" | "B",
  result: OrderResult,
  latencyMs: number
): void {
  if (result.success) {
    // Console output
    console.log(
      `[${formatTimestamp()}] LEG ${leg} FILLED in ${latencyMs}ms | ` +
        `orderId=${result.orderId?.substring(0, 16) ?? "N/A"}... ` +
        `@ ${formatPrice(result.fillPrice)} x${result.fillQty}`
    );

    // File output
    logLegFillToFile({
      executionId,
      leg,
      venue: result.venue,
      orderId: result.orderId ?? "unknown",
      fillQty: result.fillQty,
      fillPrice: result.fillPrice,
      latencyMs,
    }).catch(() => {});
  } else {
    // Console output
    console.log(
      `[${formatTimestamp()}] LEG ${leg} FAILED (${result.status}) | ` +
        `${result.error ?? "no error details"}`
    );

    // File output
    logLegFailToFile({
      executionId,
      leg,
      venue: result.venue,
      reason: result.status,
      error: result.error ?? undefined,
    }).catch(() => {});
  }
}

/**
 * Log unwind start.
 */
export function logUnwindStart(
  executionId: string,
  reason: string,
  legToUnwind: { venue: string; side: string; fillPrice: number }
): void {
  // Console output
  console.log("");
  console.log(`[${formatTimestamp()}] UNWIND START`);
  console.log(`  Reason: ${reason}`);
  console.log(
    `  Unwinding: ${legToUnwind.venue.toUpperCase()} ${legToUnwind.side.toUpperCase()} ` +
      `bought @ ${formatPrice(legToUnwind.fillPrice)}`
  );

  // File output
  logUnwindStartToFile({
    executionId,
    reason,
    legToUnwind,
  }).catch(() => {});
}

/**
 * Log unwind result.
 */
export function logUnwindResult(
  executionId: string,
  unwind: UnwindRecord
): void {
  const success = unwind.result?.success ?? false;

  if (success) {
    // Console output
    console.log(
      `[${formatTimestamp()}] UNWIND COMPLETE | ` +
        `Sold @ ${formatPrice(unwind.result?.fillPrice ?? 0)} | ` +
        `Loss: $${unwind.realizedLoss.toFixed(4)}`
    );
  } else {
    // Console output
    console.log(
      `[${formatTimestamp()}] UNWIND FAILED | ` +
        `Error: ${unwind.result?.error ?? "unknown"} | ` +
        `Assumed loss: $${unwind.realizedLoss.toFixed(4)}`
    );
  }

  // File output
  logUnwindResultToFile({
    executionId,
    success,
    unwindPrice: unwind.result?.fillPrice ?? 0,
    realizedLoss: unwind.realizedLoss,
    error: unwind.result?.error ?? undefined,
  }).catch(() => {});
}

/**
 * Log execution complete.
 */
export function logExecutionComplete(record: ExecutionRecord): void {
  const totalLatency = record.endTs
    ? record.endTs - record.startTs
    : 0;

  const legALatency =
    record.legA.fillTs && record.legA.submitTs
      ? record.legA.fillTs - record.legA.submitTs
      : 0;

  const legBLatency =
    record.legB.fillTs && record.legB.submitTs
      ? record.legB.fillTs - record.legB.submitTs
      : null;

  const success = record.status === "success";

  // Console output
  console.log("");
  console.log(`[${formatTimestamp()}] EXECUTION COMPLETE`);
  console.log(`  Status: ${record.status.toUpperCase()}`);
  console.log(
    `  PnL: ${record.realizedPnl !== null ? formatDollars(record.realizedPnl) : "N/A"} ` +
      `(expected: ${formatDollars(record.expectedEdgeNet)})`
  );
  console.log(
    `  Latency: A=${legALatency}ms B=${legBLatency ?? "N/A"}ms Total=${totalLatency}ms`
  );
  console.log("");

  // File output
  logExecutionCompleteToFile({
    executionId: record.id,
    status: record.status,
    success,
    realizedPnl: record.realizedPnl,
    latencyMs: totalLatency,
    legALatencyMs: legALatency,
    legBLatencyMs: legBLatency,
  }).catch(() => {});
}

/**
 * Log kill switch triggered.
 */
export function logKillSwitch(
  dailyLoss: number,
  maxDailyLoss: number,
  trigger: string
): void {
  // Console output - very prominent
  console.log("");
  console.log("!".repeat(70));
  console.log(`[${formatTimestamp()}] !!! KILL SWITCH TRIGGERED !!!`);
  console.log(`  Daily loss: $${dailyLoss.toFixed(2)}`);
  console.log(`  Max allowed: $${maxDailyLoss.toFixed(2)}`);
  console.log(`  Trigger: ${trigger}`);
  console.log("  ALL TRADING HALTED - Manual intervention required");
  console.log("!".repeat(70));
  console.log("");

  // File output
  logKillSwitchToFile({
    dailyLoss,
    maxDailyLoss,
    trigger,
  }).catch(() => {});
}

/**
 * Log cooldown entry.
 */
export function logCooldownEntry(reason: string, durationMs: number): void {
  // Console output
  console.log(
    `[${formatTimestamp()}] COOLDOWN entered for ${durationMs}ms | ${reason}`
  );

  // File output
  logCooldownToFile({
    reason,
    durationMs,
  }).catch(() => {});
}

/**
 * Log an error.
 */
export function logExecutionError(
  context: string,
  error: Error | string,
  details?: Record<string, unknown>
): void {
  const errorMsg = error instanceof Error ? error.message : error;

  // Console output
  console.error(`[${formatTimestamp()}] [ERROR] ${context}: ${errorMsg}`);
  if (details) {
    console.error("  Details:", JSON.stringify(details));
  }

  // File output
  logErrorToFile({
    context,
    error: errorMsg,
    details,
  }).catch(() => {});
}

/**
 * Log dry run execution (simulated).
 */
export function logDryRunExecution(
  opp: Opportunity,
  record: ExecutionRecord
): void {
  const intervalStr = formatIntervalKey(opp.intervalKey);

  // Console output
  console.log("");
  console.log("-".repeat(70));
  console.log(`[${formatTimestamp()}] DRY RUN EXECUTION (no real orders)`);
  console.log(`  Interval: ${intervalStr}`);
  console.log(`  Would execute: ${record.id}`);
  console.log(
    `  Leg A: ${record.legA.params.venue.toUpperCase()} ${record.legA.params.side.toUpperCase()} @ ${formatPrice(record.legA.params.price)}`
  );
  console.log(
    `  Leg B: ${record.legB.params.venue.toUpperCase()} ${record.legB.params.side.toUpperCase()} @ ${formatPrice(record.legB.params.price)}`
  );
  console.log(`  Expected PnL: ${formatDollars(opp.edgeNet)}`);
  console.log("-".repeat(70));
  console.log("");
}

/**
 * Log guard check failure.
 */
export function logGuardFailed(guardName: string, reason: string): void {
  console.log(
    `[${formatTimestamp()}] [GUARD] ${guardName} failed: ${reason}`
  );
}

/**
 * Log busy lock acquisition failure.
 */
export function logBusyLockFailed(): void {
  console.log(
    `[${formatTimestamp()}] [GUARD] Busy lock failed: execution already in progress`
  );
}
