/**
 * Metrics tracking module.
 *
 * Provides:
 * - Latency statistics (decision->submit, submit->fill, total execution)
 * - Execution counters (opportunities, executions, unwinds)
 * - Metrics summary for periodic status logging
 */

import type { Venue } from "../strategy/types";

/**
 * Latency statistics for a specific metric.
 */
export interface LatencyStats {
  /** Minimum latency in ms */
  min: number;
  /** Maximum latency in ms */
  max: number;
  /** Average latency in ms */
  avg: number;
  /** 99th percentile latency in ms */
  p99: number;
  /** Number of samples */
  count: number;
}

/**
 * Execution counters.
 */
export interface ExecutionCounters {
  /** Number of opportunities detected */
  opportunitiesDetected: number;
  /** Number of execution attempts */
  executionsAttempted: number;
  /** Number of successful executions */
  executionsSucceeded: number;
  /** Number of failed executions */
  executionsFailed: number;
  /** Number of unwind attempts */
  unwindsAttempted: number;
  /** Number of successful unwinds */
  unwindsSucceeded: number;
}

/**
 * All latency metrics.
 */
export interface AllLatencyStats {
  /** Time from decision to order submission */
  decisionToSubmit: LatencyStats;
  /** Time from order submission to fill (per venue) */
  submitToFill: {
    polymarket: LatencyStats;
    kalshi: LatencyStats;
  };
  /** Total execution time (start to end) */
  totalExecution: LatencyStats;
  /** Time between leg A fill and leg B fill */
  legAToLegB: LatencyStats;
}

/**
 * Internal storage for latency samples.
 */
interface LatencySamples {
  decisionToSubmit: number[];
  submitToFillPolymarket: number[];
  submitToFillKalshi: number[];
  totalExecution: number[];
  legAToLegB: number[];
}

/**
 * Metrics state - singleton.
 */
const samples: LatencySamples = {
  decisionToSubmit: [],
  submitToFillPolymarket: [],
  submitToFillKalshi: [],
  totalExecution: [],
  legAToLegB: [],
};

const counters: ExecutionCounters = {
  opportunitiesDetected: 0,
  executionsAttempted: 0,
  executionsSucceeded: 0,
  executionsFailed: 0,
  unwindsAttempted: 0,
  unwindsSucceeded: 0,
};

/** Maximum samples to keep per metric (rolling window) */
const MAX_SAMPLES = 1000;

/**
 * Add a sample to an array, maintaining max size.
 */
function addSample(arr: number[], value: number): void {
  arr.push(value);
  if (arr.length > MAX_SAMPLES) {
    arr.shift();
  }
}

/**
 * Calculate statistics from an array of samples.
 */
function calculateStats(arr: number[]): LatencyStats {
  if (arr.length === 0) {
    return { min: 0, max: 0, avg: 0, p99: 0, count: 0 };
  }

  const sorted = [...arr].sort((a, b) => a - b);
  const sum = arr.reduce((acc, val) => acc + val, 0);
  const p99Index = Math.floor(arr.length * 0.99);

  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: sum / arr.length,
    p99: sorted[Math.min(p99Index, sorted.length - 1)]!,
    count: arr.length,
  };
}

// === Recording functions ===

/**
 * Record time from decision to order submission.
 */
export function recordDecisionToSubmit(ms: number): void {
  addSample(samples.decisionToSubmit, ms);
}

/**
 * Record time from order submission to fill.
 */
export function recordSubmitToFill(venue: Venue, ms: number): void {
  if (venue === "polymarket") {
    addSample(samples.submitToFillPolymarket, ms);
  } else {
    addSample(samples.submitToFillKalshi, ms);
  }
}

/**
 * Record total execution time.
 */
export function recordTotalExecution(ms: number): void {
  addSample(samples.totalExecution, ms);
}

/**
 * Record time between leg A fill and leg B fill.
 */
export function recordLegAToLegB(ms: number): void {
  addSample(samples.legAToLegB, ms);
}

// === Counter functions ===

/**
 * Increment opportunities detected counter.
 */
export function incrementOpportunities(): void {
  counters.opportunitiesDetected++;
}

/**
 * Increment execution counters.
 */
export function incrementExecutions(succeeded: boolean): void {
  counters.executionsAttempted++;
  if (succeeded) {
    counters.executionsSucceeded++;
  } else {
    counters.executionsFailed++;
  }
}

/**
 * Increment unwind counters.
 */
export function incrementUnwinds(succeeded: boolean): void {
  counters.unwindsAttempted++;
  if (succeeded) {
    counters.unwindsSucceeded++;
  }
}

// === Query functions ===

/**
 * Get all latency statistics.
 */
export function getLatencyStats(): AllLatencyStats {
  return {
    decisionToSubmit: calculateStats(samples.decisionToSubmit),
    submitToFill: {
      polymarket: calculateStats(samples.submitToFillPolymarket),
      kalshi: calculateStats(samples.submitToFillKalshi),
    },
    totalExecution: calculateStats(samples.totalExecution),
    legAToLegB: calculateStats(samples.legAToLegB),
  };
}

/**
 * Get execution counters.
 */
export function getCounters(): ExecutionCounters {
  return { ...counters };
}

/**
 * Get a formatted metrics summary string for logging.
 */
export function getMetricsSummary(): string {
  const stats = getLatencyStats();
  const c = counters;

  const lines: string[] = [];

  lines.push("=== Execution Metrics ===");
  lines.push(`Opportunities: ${c.opportunitiesDetected}`);
  lines.push(
    `Executions: ${c.executionsAttempted} (${c.executionsSucceeded} success, ${c.executionsFailed} failed)`
  );
  lines.push(
    `Unwinds: ${c.unwindsAttempted} (${c.unwindsSucceeded} success)`
  );

  if (stats.decisionToSubmit.count > 0) {
    lines.push("");
    lines.push("=== Latency Stats (ms) ===");
    lines.push(
      `Decision->Submit: avg=${stats.decisionToSubmit.avg.toFixed(1)}, ` +
        `p99=${stats.decisionToSubmit.p99.toFixed(1)}, ` +
        `n=${stats.decisionToSubmit.count}`
    );
  }

  if (stats.submitToFill.polymarket.count > 0) {
    lines.push(
      `Submit->Fill (Poly): avg=${stats.submitToFill.polymarket.avg.toFixed(1)}, ` +
        `p99=${stats.submitToFill.polymarket.p99.toFixed(1)}, ` +
        `n=${stats.submitToFill.polymarket.count}`
    );
  }

  if (stats.submitToFill.kalshi.count > 0) {
    lines.push(
      `Submit->Fill (Kalshi): avg=${stats.submitToFill.kalshi.avg.toFixed(1)}, ` +
        `p99=${stats.submitToFill.kalshi.p99.toFixed(1)}, ` +
        `n=${stats.submitToFill.kalshi.count}`
    );
  }

  if (stats.legAToLegB.count > 0) {
    lines.push(
      `LegA->LegB: avg=${stats.legAToLegB.avg.toFixed(1)}, ` +
        `p99=${stats.legAToLegB.p99.toFixed(1)}, ` +
        `n=${stats.legAToLegB.count}`
    );
  }

  if (stats.totalExecution.count > 0) {
    lines.push(
      `Total Execution: avg=${stats.totalExecution.avg.toFixed(1)}, ` +
        `p99=${stats.totalExecution.p99.toFixed(1)}, ` +
        `n=${stats.totalExecution.count}`
    );
  }

  return lines.join("\n");
}

/**
 * Reset all metrics (for testing or new session).
 */
export function resetMetrics(): void {
  samples.decisionToSubmit = [];
  samples.submitToFillPolymarket = [];
  samples.submitToFillKalshi = [];
  samples.totalExecution = [];
  samples.legAToLegB = [];

  counters.opportunitiesDetected = 0;
  counters.executionsAttempted = 0;
  counters.executionsSucceeded = 0;
  counters.executionsFailed = 0;
  counters.unwindsAttempted = 0;
  counters.unwindsSucceeded = 0;
}
