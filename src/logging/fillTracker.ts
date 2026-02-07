/**
 * Fill-rate tracker — records execution outcomes by interval for analysis.
 *
 * Tracks fill rates, latencies, and PnL per interval with O(1) updates.
 * Persists to logs/fill_rates.json for offline analysis.
 */

import type { IntervalKey } from "../time/interval";
import { intervalKeyToString, formatIntervalKey } from "../time/interval";
import type { OrderResult } from "../execution/types";

/**
 * Per-interval fill record with running statistics.
 */
export interface FillRecord {
  /** Interval key string "startTs-endTs" */
  interval: string;
  /** Human-readable display "HH:MM-HH:MM UTC" */
  intervalDisplay: string;
  /** Hour of day (0-23 UTC) for time-of-day grouping */
  hourOfDay: number;
  /** Total execution attempts in this interval */
  attempts: number;
  /** Polymarket fills (Leg A) */
  polyFills: number;
  /** Polymarket misses (Leg A unfilled) */
  polyMisses: number;
  /** Kalshi fills (Leg B) */
  kalshiFills: number;
  /** Kalshi misses (Leg B unfilled or unwind) */
  kalshiMisses: number;
  /** Partial fills (Poly fillQty < requestedQty) */
  partialFills: number;
  /** Running average Polymarket latency (ms) */
  avgPolyLatencyMs: number;
  /** Running average Kalshi latency (ms) */
  avgKalshiLatencyMs: number;
  /** Running average edgeNet at detection */
  avgEdgeNet: number;
  /** Running average spread at detection (volatility proxy) */
  avgSpreadAtDetection: number;
  /** Cumulative realized PnL for this interval */
  totalPnl: number;
  /** Last update timestamp */
  lastUpdated: number;
}

/**
 * Parameters for recording a fill attempt.
 */
export interface FillAttemptParams {
  intervalKey: IntervalKey;
  legAResult: OrderResult;
  legBResult: OrderResult | null;
  requestedQty: number;
  legALatencyMs: number;
  legBLatencyMs: number | null;
  edgeNet: number;
  spreadAtDetection: number;
  realizedPnl: number;
}

/** In-memory fill records indexed by interval key string */
const fillRecords = new Map<string, FillRecord>();

/** Whether initial load from disk has been attempted */
let loaded = false;

/** Path to persistence file */
const FILL_RATES_PATH = "logs/fill_rates.json";

/**
 * Load fill records from disk on first use.
 */
async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;

  try {
    const file = Bun.file(FILL_RATES_PATH);
    if (await file.exists()) {
      const data = await file.json() as Record<string, FillRecord>;
      for (const [key, record] of Object.entries(data)) {
        fillRecords.set(key, record);
      }
    }
  } catch {
    // File doesn't exist or is corrupt — start fresh
  }
}

/**
 * Persist fill records to disk (fire-and-forget).
 */
function persistToDisk(): void {
  const data: Record<string, FillRecord> = {};
  for (const [key, record] of fillRecords) {
    data[key] = record;
  }
  Bun.write(FILL_RATES_PATH, JSON.stringify(data, null, 2)).catch(() => {});
}

/**
 * Incremental running average: newAvg = oldAvg + (value - oldAvg) / newCount
 */
function updateAvg(oldAvg: number, newValue: number, newCount: number): number {
  return oldAvg + (newValue - oldAvg) / newCount;
}

/**
 * Record an execution attempt outcome.
 *
 * Called AFTER execution completes (all 3 outcome paths).
 * O(1) map lookup + O(1) incremental average updates.
 */
export async function recordFillAttempt(params: FillAttemptParams): Promise<void> {
  await ensureLoaded();

  const key = intervalKeyToString(params.intervalKey);
  let record = fillRecords.get(key);

  if (!record) {
    const startDate = new Date(params.intervalKey.startTs * 1000);
    record = {
      interval: key,
      intervalDisplay: formatIntervalKey(params.intervalKey),
      hourOfDay: startDate.getUTCHours(),
      attempts: 0,
      polyFills: 0,
      polyMisses: 0,
      kalshiFills: 0,
      kalshiMisses: 0,
      partialFills: 0,
      avgPolyLatencyMs: 0,
      avgKalshiLatencyMs: 0,
      avgEdgeNet: 0,
      avgSpreadAtDetection: 0,
      totalPnl: 0,
      lastUpdated: 0,
    };
    fillRecords.set(key, record);
  }

  record.attempts++;
  record.lastUpdated = Date.now();

  // Leg A (Polymarket) outcome
  const legAFilled = params.legAResult.success || params.legAResult.status === "filled";
  if (legAFilled) {
    record.polyFills++;
    // Check for partial fill
    if (params.legAResult.fillQty < params.requestedQty) {
      record.partialFills++;
    }
  } else {
    record.polyMisses++;
  }

  // Leg B (Kalshi) outcome
  if (params.legBResult) {
    const legBFilled = params.legBResult.success || params.legBResult.status === "filled";
    if (legBFilled) {
      record.kalshiFills++;
    } else {
      record.kalshiMisses++;
    }
  } else if (legAFilled) {
    // Leg A filled but Leg B never submitted (e.g. qty too small for Kalshi)
    record.kalshiMisses++;
  }

  // Latency averages (only count filled legs)
  if (legAFilled && params.legALatencyMs > 0) {
    record.avgPolyLatencyMs = updateAvg(
      record.avgPolyLatencyMs, params.legALatencyMs, record.polyFills
    );
  }
  if (params.legBResult && params.legBLatencyMs !== null && params.legBLatencyMs > 0) {
    const kalshiAttempts = record.kalshiFills + record.kalshiMisses;
    if (kalshiAttempts > 0) {
      record.avgKalshiLatencyMs = updateAvg(
        record.avgKalshiLatencyMs, params.legBLatencyMs, kalshiAttempts
      );
    }
  }

  // Edge and spread averages
  record.avgEdgeNet = updateAvg(record.avgEdgeNet, params.edgeNet, record.attempts);
  record.avgSpreadAtDetection = updateAvg(
    record.avgSpreadAtDetection, params.spreadAtDetection, record.attempts
  );

  // PnL
  record.totalPnl += params.realizedPnl;

  // Persist (fire-and-forget)
  persistToDisk();
}

/**
 * Get all fill records (for reporting).
 */
export async function getFillRecords(): Promise<Map<string, FillRecord>> {
  await ensureLoaded();
  return new Map(fillRecords);
}

/**
 * Get fill record for a specific interval.
 */
export async function getFillRecord(intervalKey: IntervalKey): Promise<FillRecord | undefined> {
  await ensureLoaded();
  return fillRecords.get(intervalKeyToString(intervalKey));
}

/**
 * Get summary statistics grouped by hour of day.
 */
export async function getHourlySummary(): Promise<Map<number, {
  attempts: number;
  polyFillRate: number;
  kalshiFillRate: number;
  avgEdgeNet: number;
  avgSpread: number;
  totalPnl: number;
}>> {
  await ensureLoaded();
  const hourly = new Map<number, {
    attempts: number;
    polyFills: number;
    polyMisses: number;
    kalshiFills: number;
    kalshiMisses: number;
    edgeSum: number;
    spreadSum: number;
    totalPnl: number;
  }>();

  for (const record of fillRecords.values()) {
    let h = hourly.get(record.hourOfDay);
    if (!h) {
      h = { attempts: 0, polyFills: 0, polyMisses: 0, kalshiFills: 0, kalshiMisses: 0, edgeSum: 0, spreadSum: 0, totalPnl: 0 };
      hourly.set(record.hourOfDay, h);
    }
    h.attempts += record.attempts;
    h.polyFills += record.polyFills;
    h.polyMisses += record.polyMisses;
    h.kalshiFills += record.kalshiFills;
    h.kalshiMisses += record.kalshiMisses;
    h.edgeSum += record.avgEdgeNet * record.attempts;
    h.spreadSum += record.avgSpreadAtDetection * record.attempts;
    h.totalPnl += record.totalPnl;
  }

  const result = new Map<number, {
    attempts: number;
    polyFillRate: number;
    kalshiFillRate: number;
    avgEdgeNet: number;
    avgSpread: number;
    totalPnl: number;
  }>();

  for (const [hour, h] of hourly) {
    const polyTotal = h.polyFills + h.polyMisses;
    const kalshiTotal = h.kalshiFills + h.kalshiMisses;
    result.set(hour, {
      attempts: h.attempts,
      polyFillRate: polyTotal > 0 ? h.polyFills / polyTotal : 0,
      kalshiFillRate: kalshiTotal > 0 ? h.kalshiFills / kalshiTotal : 0,
      avgEdgeNet: h.attempts > 0 ? h.edgeSum / h.attempts : 0,
      avgSpread: h.attempts > 0 ? h.spreadSum / h.attempts : 0,
      totalPnl: h.totalPnl,
    });
  }

  return result;
}
