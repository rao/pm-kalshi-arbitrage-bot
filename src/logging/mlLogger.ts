/**
 * ML Training Data Logger — CSV per arb execution attempt.
 *
 * Append-only CSV at logs_v2/arb_executions.csv.
 * Each row = one execution attempt (success, leg-A-fail, unwind).
 * Fire-and-forget writes — zero latency impact on the hot path.
 */

import { join, dirname } from "path";
import { appendFile, mkdir } from "node:fs/promises";
import type { ExecutionRecord, ExecutionContext } from "../execution/types";
import type { NormalizedQuote } from "../normalization/types";

const CSV_DIR = join(process.cwd(), "logs_v2");
const CSV_PATH = join(CSV_DIR, "arb_executions.csv");

let headerWritten = false;

/** CSV column names — 83 total. */
const COLUMNS: string[] = [
  // Metadata (7)
  "decision_ts",
  "execution_id",
  "status",
  "dry_run",
  "interval_start_ts",
  "interval_end_ts",
  "time_to_expiry_ms",
  // Polymarket Quote Snapshot (10)
  "poly_yes_bid",
  "poly_yes_ask",
  "poly_yes_bid_size",
  "poly_yes_ask_size",
  "poly_no_bid",
  "poly_no_ask",
  "poly_no_bid_size",
  "poly_no_ask_size",
  "poly_ts_exchange",
  "poly_ts_local",
  // Kalshi Quote Snapshot (10)
  "kalshi_yes_bid",
  "kalshi_yes_ask",
  "kalshi_yes_bid_size",
  "kalshi_yes_ask_size",
  "kalshi_no_bid",
  "kalshi_no_ask",
  "kalshi_no_bid_size",
  "kalshi_no_ask_size",
  "kalshi_ts_exchange",
  "kalshi_ts_local",
  // Derived ML Features (12)
  "poly_yes_spread",
  "poly_no_spread",
  "kalshi_yes_spread",
  "kalshi_no_spread",
  "poly_yes_imbalance",
  "poly_no_imbalance",
  "kalshi_yes_imbalance",
  "kalshi_no_imbalance",
  "cross_venue_yes_spread",
  "cross_venue_no_spread",
  "poly_quote_age_ms",
  "kalshi_quote_age_ms",
  // Opportunity / Decision (12)
  "opp_cost",
  "opp_edge_gross",
  "opp_edge_net",
  "opp_qty",
  "opp_leg0_venue",
  "opp_leg0_side",
  "opp_leg0_price",
  "opp_leg0_size",
  "opp_leg1_venue",
  "opp_leg1_side",
  "opp_leg1_price",
  "opp_leg1_size",
  // Leg A Execution (12)
  "leg_a_venue",
  "leg_a_side",
  "leg_a_limit_price",
  "leg_a_qty",
  "leg_a_tif",
  "leg_a_market_id",
  "leg_a_filled",
  "leg_a_fill_price",
  "leg_a_fill_qty",
  "leg_a_submit_ts",
  "leg_a_fill_ts",
  "leg_a_latency_ms",
  // Leg B Execution (10)
  "leg_b_venue",
  "leg_b_side",
  "leg_b_limit_price",
  "leg_b_qty",
  "leg_b_filled",
  "leg_b_fill_price",
  "leg_b_fill_qty",
  "leg_b_submit_ts",
  "leg_b_fill_ts",
  "leg_b_latency_ms",
  // Outcomes (10)
  "both_filled",
  "had_unwind",
  "unwind_realized_loss",
  "unwind_reason",
  "realized_pnl",
  "expected_edge_net",
  "execution_start_ts",
  "execution_end_ts",
  "total_execution_ms",
  "inter_leg_ms",
];

/** Call once at startup — creates logs_v2/ dir, writes CSV header if file is new/empty. */
export async function initMlLogger(): Promise<void> {
  try {
    await mkdir(CSV_DIR, { recursive: true });

    const file = Bun.file(CSV_PATH);
    const exists = await file.exists();

    if (!exists || (await file.size) === 0) {
      await appendFile(CSV_PATH, COLUMNS.join(",") + "\n", { encoding: "utf-8" });
    }

    headerWritten = true;
  } catch (error) {
    console.error(`[ML_LOGGER] Failed to init: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Compute spread: ask - bid */
function spread(ask: number, bid: number): number {
  return ask - bid;
}

/** Compute imbalance: bid_size / (bid_size + ask_size), 0 if denom=0 */
function imbalance(bidSize: number, askSize: number): number {
  const denom = bidSize + askSize;
  return denom === 0 ? 0 : bidSize / denom;
}

/** Sanitize string for CSV — replace commas with semicolons, strip newlines. */
function sanitize(val: string | undefined | null): string {
  if (val == null) return "";
  return val.replace(/,/g, ";").replace(/[\r\n]/g, " ");
}

/** Format a value for CSV. null/undefined → empty string. */
function v(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number" && isNaN(val)) return "";
  return String(val);
}

/**
 * Build a CSV row from an execution record + context.
 * Pure function — returns comma-joined values string (no trailing newline).
 */
export function buildCsvRow(record: ExecutionRecord, context: ExecutionContext): string {
  const opp = record.opportunity;
  const poly = record.polyQuoteSnapshot;
  const kalshi = record.kalshiQuoteSnapshot;
  const legA = record.legA;
  const legB = record.legB;

  // Leg A result fields
  const legAResult = legA.result;
  const legAFilled = legAResult ? (legAResult.success || legAResult.status === "filled" ? 1 : 0) : 0;
  const legAFillPrice = legAResult?.fillPrice ?? "";
  const legAFillQty = legAResult?.fillQty ?? "";
  const legASubmitTs = legA.submitTs ?? "";
  const legAFillTs = legAResult?.filledAt ?? "";
  const legALatency = legA.submitTs != null && legAResult?.filledAt != null
    ? legAResult.filledAt - legA.submitTs
    : "";

  // Leg B result fields
  const legBResult = legB.result;
  const legBFilled = legBResult ? (legBResult.success || legBResult.status === "filled" ? 1 : 0) : 0;
  const legBFillPrice = legBResult?.fillPrice ?? "";
  const legBFillQty = legBResult?.fillQty ?? "";
  const legBSubmitTs = legB.submitTs ?? "";
  const legBFillTs = legBResult?.filledAt ?? "";
  const legBLatency = legB.submitTs != null && legBResult?.filledAt != null
    ? legBResult.filledAt - legB.submitTs
    : "";

  // Outcomes
  const bothFilled = legAFilled === 1 && legBFilled === 1 ? 1 : 0;
  const hadUnwind = record.unwind ? 1 : 0;
  const unwindRealizedLoss = record.unwind?.realizedLoss ?? "";
  const unwindReason = sanitize(record.unwind?.reason);

  // Inter-leg gap: legB submit - legA fill
  const interLegMs = legB.submitTs != null && legA.fillTs != null
    ? legB.submitTs - legA.fillTs
    : "";

  // Total execution time
  const totalExecMs = record.endTs != null && record.startTs != null
    ? record.endTs - record.startTs
    : "";

  const values: (string | number)[] = [
    // Metadata (7)
    v(opp.timestamp),
    v(record.id),
    v(record.status),
    context.dryRun ? 1 : 0,
    v(opp.intervalKey.startTs),
    v(opp.intervalKey.endTs),
    opp.intervalKey.endTs != null && record.startTs != null
      ? (opp.intervalKey.endTs * 1000) - record.startTs
      : "",

    // Polymarket Quote Snapshot (10)
    v(poly.yes_bid),
    v(poly.yes_ask),
    v(poly.yes_bid_size),
    v(poly.yes_ask_size),
    v(poly.no_bid),
    v(poly.no_ask),
    v(poly.no_bid_size),
    v(poly.no_ask_size),
    v(poly.ts_exchange),
    v(poly.ts_local),

    // Kalshi Quote Snapshot (10)
    v(kalshi.yes_bid),
    v(kalshi.yes_ask),
    v(kalshi.yes_bid_size),
    v(kalshi.yes_ask_size),
    v(kalshi.no_bid),
    v(kalshi.no_ask),
    v(kalshi.no_bid_size),
    v(kalshi.no_ask_size),
    v(kalshi.ts_exchange),
    v(kalshi.ts_local),

    // Derived ML Features (12)
    spread(poly.yes_ask, poly.yes_bid),
    spread(poly.no_ask, poly.no_bid),
    spread(kalshi.yes_ask, kalshi.yes_bid),
    spread(kalshi.no_ask, kalshi.no_bid),
    imbalance(poly.yes_bid_size, poly.yes_ask_size),
    imbalance(poly.no_bid_size, poly.no_ask_size),
    imbalance(kalshi.yes_bid_size, kalshi.yes_ask_size),
    imbalance(kalshi.no_bid_size, kalshi.no_ask_size),
    Math.abs(poly.yes_ask - kalshi.yes_ask),
    Math.abs(poly.no_ask - kalshi.no_ask),
    poly.ts_local - poly.ts_exchange,
    kalshi.ts_local - kalshi.ts_exchange,

    // Opportunity / Decision (12)
    v(opp.cost),
    v(opp.edgeGross),
    v(opp.edgeNet),
    v(opp.qty),
    v(opp.legs[0].venue),
    v(opp.legs[0].side),
    v(opp.legs[0].price),
    v(opp.legs[0].size),
    v(opp.legs[1].venue),
    v(opp.legs[1].side),
    v(opp.legs[1].price),
    v(opp.legs[1].size),

    // Leg A Execution (12)
    v(legA.params.venue),
    v(legA.params.side),
    v(legA.params.price),
    v(legA.params.qty),
    v(legA.params.timeInForce),
    v(legA.params.marketId),
    legAFilled,
    v(legAFillPrice),
    v(legAFillQty),
    v(legASubmitTs),
    v(legAFillTs),
    v(legALatency),

    // Leg B Execution (10)
    v(legB.params.venue),
    v(legB.params.side),
    v(legB.params.price),
    v(legB.params.qty),
    legBFilled,
    v(legBFillPrice),
    v(legBFillQty),
    v(legBSubmitTs),
    v(legBFillTs),
    v(legBLatency),

    // Outcomes (10)
    bothFilled,
    hadUnwind,
    v(unwindRealizedLoss),
    unwindReason,
    v(record.realizedPnl),
    v(record.expectedEdgeNet),
    v(record.startTs),
    v(record.endTs),
    v(totalExecMs),
    v(interLegMs),
  ];

  return values.join(",");
}

/** Append one row to the CSV file. Fire-and-forget. */
function appendRow(line: string): void {
  appendFile(CSV_PATH, line + "\n", { encoding: "utf-8" }).catch((error) => {
    console.error(`[ML_LOGGER] Failed to append row: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/** Append one execution as a CSV row. Fire-and-forget (no await needed). */
export function logExecutionToCsv(record: ExecutionRecord, context: ExecutionContext): void {
  try {
    const row = buildCsvRow(record, context);
    appendRow(row);
  } catch (error) {
    console.error(`[ML_LOGGER] Failed to build CSV row: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Exported for testing. */
export const _test = { COLUMNS, CSV_PATH, spread, imbalance, sanitize };
