/**
 * Settlement CSV Logger — one row per interval.
 *
 * Append-only CSV at logs_v2/settlements.csv.
 * Each row = one interval's settlement outcome data.
 * Fire-and-forget writes — zero latency impact.
 */

import { join } from "path";
import { appendFile, mkdir } from "node:fs/promises";
import type { SettlementOutcome } from "../data/settlementTracker";
import type { IntervalMapping } from "../markets/mappingStore";
import { getAnalytics } from "../data/btcPriceStore";

const CSV_DIR = join(process.cwd(), "logs_v2");
const CSV_PATH = join(CSV_DIR, "settlements.csv");

let headerWritten = false;

/** CSV column names. */
const COLUMNS: string[] = [
  "interval_start_ts",
  "interval_end_ts",
  "btc_ref_price_kalshi",
  "btc_ref_price_poly",
  "ref_price_diff_usd",
  "btc_spot_at_close",
  "btc_twap_60s_at_close",
  "twap_spot_divergence_usd",
  "kalshi_resolution",
  "poly_resolution",
  "oracles_agree",
  "dead_zone_hit",
  "btc_crossing_count",
  "btc_range_usd",
  "btc_dist_from_ref_at_close",
  "checked_at",
];

/** Initialize the settlements CSV (create dir + header if needed). */
export async function initSettlementLogger(): Promise<void> {
  try {
    await mkdir(CSV_DIR, { recursive: true });

    const file = Bun.file(CSV_PATH);
    const exists = await file.exists();

    if (!exists || (await file.size) === 0) {
      await appendFile(CSV_PATH, COLUMNS.join(",") + "\n", { encoding: "utf-8" });
    }

    headerWritten = true;
  } catch (error) {
    console.error(
      `[SETTLEMENT_LOGGER] Failed to init: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Format a value for CSV. null/undefined -> empty string. */
function v(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number" && isNaN(val)) return "";
  return String(val);
}

/**
 * Log a settlement outcome to CSV. Fire-and-forget.
 */
export function logSettlement(
  outcome: SettlementOutcome,
  mapping: IntervalMapping | null,
): void {
  try {
    if (!headerWritten) {
      // Lazy init if not already initialized
      initSettlementLogger().then(() => logSettlement(outcome, mapping));
      return;
    }

    const kalshiRef = outcome.kalshiRefPrice;
    const polyRef = outcome.polyRefPrice;
    const refDiff = kalshiRef != null && polyRef != null
      ? Math.abs(kalshiRef - polyRef)
      : null;

    const twapSpotDiv = outcome.btcTwap60sAtClose != null && outcome.btcSpotAtClose != null
      ? Math.abs(outcome.btcTwap60sAtClose - outcome.btcSpotAtClose)
      : null;

    // Use the average ref price for distance calculation
    const avgRef = kalshiRef != null && polyRef != null
      ? (kalshiRef + polyRef) / 2
      : kalshiRef ?? polyRef;
    const distFromRef = outcome.btcSpotAtClose != null && avgRef != null
      ? Math.abs(outcome.btcSpotAtClose - avgRef)
      : null;

    // Get BTC price analytics (crossing count, range) - may be stale after reset
    // These are best-effort; the btcPriceStore may already be reset for the new interval
    const analytics = getAnalytics();

    const values: string[] = [
      v(outcome.intervalKey.startTs),
      v(outcome.intervalKey.endTs),
      v(kalshiRef),
      v(polyRef),
      v(refDiff),
      v(outcome.btcSpotAtClose),
      v(outcome.btcTwap60sAtClose),
      v(twapSpotDiv),
      v(outcome.kalshiResolution),
      v(outcome.polyResolution),
      outcome.oraclesAgree ? "1" : "0",
      outcome.deadZoneHit ? "1" : "0",
      v(analytics.crossingCount),
      v(analytics.rangeUsd),
      v(distFromRef),
      v(outcome.checkedAt),
    ];

    const row = values.join(",") + "\n";

    appendFile(CSV_PATH, row, { encoding: "utf-8" }).catch((error) => {
      console.error(
        `[SETTLEMENT_LOGGER] Failed to append row: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  } catch (error) {
    console.error(
      `[SETTLEMENT_LOGGER] Failed to build row: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Exported for testing. */
export const _test = { COLUMNS, CSV_PATH };
