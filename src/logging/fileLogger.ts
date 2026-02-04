/**
 * File-based execution logging.
 *
 * Appends structured log entries to daily log files:
 * logs/execution_YYYY-MM-DD.txt
 *
 * Uses Bun.file() for file operations.
 */

import { join } from "path";

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
  | "COOLDOWN"
  | "ERROR"
  | "STATE";

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
 * Get the current log file path based on date.
 */
export function getLogFilePath(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const filename = `execution_${year}-${month}-${day}.txt`;

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
 * Creates the file if it doesn't exist.
 */
export async function appendToExecutionLog(
  entry: ExecutionLogEntry
): Promise<void> {
  const filePath = getLogFilePath();
  const line = formatLogEntry(entry);

  try {
    // Use Bun.file().writer() for appending
    const file = Bun.file(filePath);
    const writer = file.writer();

    // Check if file exists and read existing content
    if (await file.exists()) {
      // Read existing content
      const existingContent = await file.text();
      // Write existing + new
      await Bun.write(filePath, existingContent + line);
    } else {
      // Create new file with just this entry
      await Bun.write(filePath, line);
    }
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
