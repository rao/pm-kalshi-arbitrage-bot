/**
 * File-based execution logging.
 *
 * Creates a unique log file per run:
 * logs/execution_YYYY-MM-DD_HH-MM-SS.txt
 *
 * Uses Node.js appendFile for O(1) append operations.
 */

import { join, dirname } from "path";
import { appendFile, mkdir } from "node:fs/promises";

// Capture startup time once (used for unique log filename per run)
const STARTUP_TS = new Date();

/**
 * Log entry types for execution events.
 */
export type ExecutionLogType =
  | "OPPORTUNITY"
  | "EXECUTION_START"
  | "LEG_SUBMIT"
  | "LEG_FILL"
  | "LEG_FAIL"
  | "UNWIND_START"
  | "UNWIND_RESULT"
  | "EXECUTION_COMPLETE"
  | "KILL_SWITCH"
  | "KILL_SWITCH_RECOVERY"
  | "COOLDOWN"
  | "ERROR"
  | "STATE"
  | "BTC_PRICE";

/**
 * Structured log entry for file logging.
 */
export interface ExecutionLogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Type of log entry */
  type: ExecutionLogType;
  /** Log data (type-specific) */
  data: Record<string, unknown>;
}

/**
 * Get the log file path for this run (unique per startup).
 */
export function getLogFilePath(): string {
  const year = STARTUP_TS.getUTCFullYear();
  const month = String(STARTUP_TS.getUTCMonth() + 1).padStart(2, "0");
  const day = String(STARTUP_TS.getUTCDate()).padStart(2, "0");
  const hours = String(STARTUP_TS.getUTCHours()).padStart(2, "0");
  const minutes = String(STARTUP_TS.getUTCMinutes()).padStart(2, "0");
  const seconds = String(STARTUP_TS.getUTCSeconds()).padStart(2, "0");

  const filename = `execution_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.txt`;

  // Logs directory is at project root
  return join(process.cwd(), "logs", filename);
}

/**
 * Format a log entry as a single line for file output.
 */
function formatLogEntry(entry: ExecutionLogEntry): string {
  const dataStr = JSON.stringify(entry.data);
  return `[${entry.timestamp}] [${entry.type}] ${dataStr}\n`;
}

/**
 * Append a log entry to the execution log file.
 *
 * Creates the directory and file if they don't exist.
 * Uses O(1) append operation instead of read-all/write-all.
 */
export async function appendToExecutionLog(
  entry: ExecutionLogEntry
): Promise<void> {
  const filePath = getLogFilePath();
  const line = formatLogEntry(entry);

  try {
    // Ensure logs directory exists
    await mkdir(dirname(filePath), { recursive: true });
    // Append to file (creates if doesn't exist)
    await appendFile(filePath, line, { encoding: "utf-8" });
  } catch (error) {
    // Log to console if file write fails
    console.error(`[FILE_LOGGER] Failed to write to ${filePath}:`, error);
  }
}

/**
 * Create a log entry with current timestamp.
 */
export function createLogEntry(
  type: ExecutionLogType,
  data: Record<string, unknown>
): ExecutionLogEntry {
  return {
    timestamp: new Date().toISOString(),
    type,
    data,
  };
}

/**
 * Convenience function to log an entry (creates and appends).
 */
export async function logEntry(
  type: ExecutionLogType,
  data: Record<string, unknown>
): Promise<void> {
  const entry = createLogEntry(type, data);
  await appendToExecutionLog(entry);
}

/**
 * Log opportunity detected.
 */
export async function logOpportunityToFile(data: {
  intervalKey: string;
  edgeGross: number;
  edgeNet: number;
  cost: number;
  legs: Array<{ venue: string; side: string; price: number; size: number }>;
}): Promise<void> {
  await logEntry("OPPORTUNITY", data);
}

/**
 * Log execution start.
 */
export async function logExecutionStartToFile(data: {
  executionId: string;
  intervalKey: string;
  expectedEdgeNet: number;
  legA: { venue: string; side: string; price: number };
  legB: { venue: string; side: string; price: number };
}): Promise<void> {
  await logEntry("EXECUTION_START", data);
}

/**
 * Log leg submission.
 */
export async function logLegSubmitToFile(data: {
  executionId: string;
  leg: "A" | "B";
  venue: string;
  side: string;
  price: number;
  qty: number;
  clientOrderId: string;
}): Promise<void> {
  await logEntry("LEG_SUBMIT", data);
}

/**
 * Log leg fill.
 */
export async function logLegFillToFile(data: {
  executionId: string;
  leg: "A" | "B";
  venue: string;
  orderId: string;
  fillQty: number;
  fillPrice: number;
  latencyMs: number;
}): Promise<void> {
  await logEntry("LEG_FILL", data);
}

/**
 * Log leg failure.
 */
export async function logLegFailToFile(data: {
  executionId: string;
  leg: "A" | "B";
  venue: string;
  reason: string;
  error?: string;
}): Promise<void> {
  await logEntry("LEG_FAIL", data);
}

/**
 * Log unwind start.
 */
export async function logUnwindStartToFile(data: {
  executionId: string;
  reason: string;
  legToUnwind: { venue: string; side: string; fillPrice: number };
}): Promise<void> {
  await logEntry("UNWIND_START", data);
}

/**
 * Log unwind result.
 */
export async function logUnwindResultToFile(data: {
  executionId: string;
  success: boolean;
  unwindPrice: number;
  realizedLoss: number;
  error?: string;
}): Promise<void> {
  await logEntry("UNWIND_RESULT", data);
}

/**
 * Log execution complete.
 */
export async function logExecutionCompleteToFile(data: {
  executionId: string;
  status: string;
  success: boolean;
  realizedPnl: number | null;
  latencyMs: number;
  legALatencyMs: number;
  legBLatencyMs: number | null;
}): Promise<void> {
  await logEntry("EXECUTION_COMPLETE", data);
}

/**
 * Log kill switch trigger.
 */
export async function logKillSwitchToFile(data: {
  dailyLoss: number;
  maxDailyLoss: number;
  trigger: string;
}): Promise<void> {
  await logEntry("KILL_SWITCH", data);
}

/**
 * Log kill switch recovery.
 */
export async function logKillSwitchRecoveryToFile(data: {
  trigger: string;
  previousReason: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await logEntry("KILL_SWITCH_RECOVERY", data);
}

/**
 * Log cooldown entry.
 */
export async function logCooldownToFile(data: {
  reason: string;
  durationMs: number;
}): Promise<void> {
  await logEntry("COOLDOWN", data);
}

/**
 * Log an error.
 */
export async function logErrorToFile(data: {
  context: string;
  error: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await logEntry("ERROR", data);
}

/**
 * Log state snapshot.
 */
export async function logStateToFile(data: {
  busy: boolean;
  inCooldown: boolean;
  dailyPnl: number;
  totalNotional: number;
  killSwitchTriggered: boolean;
}): Promise<void> {
  await logEntry("STATE", data);
}

/**
 * Log BTC price to file.
 */
export async function logBtcPriceToFile(price: number): Promise<void> {
  await logEntry("BTC_PRICE", { price });
}

// === Buffered writes for high-frequency logging ===

/** Maximum entries to buffer before auto-flush */
const MAX_BUFFER_SIZE = 100;
/** Maximum time before auto-flush (ms) */
const MAX_BUFFER_AGE_MS = 1000;

/** Buffer state for batched writes */
interface BufferState {
  entries: string[];
  firstEntryTs: number | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const bufferState: BufferState = {
  entries: [],
  firstEntryTs: null,
  flushTimer: null,
};

/**
 * Flush the buffer to disk.
 */
async function flushBufferInternal(): Promise<void> {
  if (bufferState.entries.length === 0) {
    return;
  }

  // Clear timer
  if (bufferState.flushTimer) {
    clearTimeout(bufferState.flushTimer);
    bufferState.flushTimer = null;
  }

  // Grab and clear entries
  const entries = bufferState.entries;
  bufferState.entries = [];
  bufferState.firstEntryTs = null;

  // Write all entries at once
  const filePath = getLogFilePath();
  const content = entries.join("");

  try {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, content, { encoding: "utf-8" });
  } catch (error) {
    console.error(`[FILE_LOGGER] Failed to flush buffer to ${filePath}:`, error);
  }
}

/**
 * Add an entry to the buffer.
 * Flushes when buffer is full or after MAX_BUFFER_AGE_MS.
 */
export async function appendToExecutionLogBuffered(
  entry: ExecutionLogEntry
): Promise<void> {
  const line = formatLogEntry(entry);
  bufferState.entries.push(line);

  // Track first entry time
  if (bufferState.firstEntryTs === null) {
    bufferState.firstEntryTs = Date.now();
  }

  // Flush if buffer full
  if (bufferState.entries.length >= MAX_BUFFER_SIZE) {
    await flushBufferInternal();
    return;
  }

  // Set up timer for age-based flush if not already set
  if (!bufferState.flushTimer) {
    bufferState.flushTimer = setTimeout(() => {
      flushBufferInternal().catch((error) => {
        console.error("[FILE_LOGGER] Timer flush failed:", error);
      });
    }, MAX_BUFFER_AGE_MS);
  }
}

/**
 * Flush any pending buffered entries and close.
 * Call this during graceful shutdown.
 */
export async function flushAndClose(): Promise<void> {
  await flushBufferInternal();
}

/**
 * Get buffer statistics (for monitoring).
 */
export function getBufferStats(): { count: number; ageMs: number | null } {
  return {
    count: bufferState.entries.length,
    ageMs: bufferState.firstEntryTs ? Date.now() - bufferState.firstEntryTs : null,
  };
}
