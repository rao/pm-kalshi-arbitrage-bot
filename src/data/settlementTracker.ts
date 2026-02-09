/**
 * Settlement outcome tracker.
 *
 * Queries both venues after interval close to determine actual settlement outcomes.
 * Runs on a delay after rollover (venues need time to settle).
 *
 * IMPORTANT: All interval-end state (TWAP, spot, analytics, ref prices) is captured
 * at rollover time into an IntervalCloseSnapshot and passed here. The delayed check
 * only queries venue APIs for resolution — everything else is pre-captured.
 */

import type { IntervalKey } from "../time/interval";
import type { IntervalMapping } from "../markets/mappingStore";
import type { Logger } from "../logging/logger";

/**
 * Immutable snapshot of interval-end state, captured at rollover BEFORE resets.
 */
export interface IntervalCloseSnapshot {
  intervalKey: IntervalKey;
  btcTwap60s: number | null;
  btcSpot: number | null;
  kalshiRefPrice: number | null;
  polyRefPrice: number | null;
  crossingCount: number;
  rangeUsd: number;
  distFromRefUsd: number;
  mapping: IntervalMapping | null;
}

/**
 * Settlement outcome for a single interval.
 */
export interface SettlementOutcome {
  intervalKey: IntervalKey;
  btcSpotAtClose: number | null;
  btcTwap60sAtClose: number | null;
  kalshiRefPrice: number | null;
  polyRefPrice: number | null;
  kalshiResolution: "yes" | "no" | "unknown";
  polyResolution: "up" | "down" | "unknown";
  oraclesAgree: boolean;
  deadZoneHit: boolean;
  crossingCount: number;
  rangeUsd: number;
  distFromRefUsd: number;
  checkedAt: number;
}

/** Maximum outcomes to keep in memory. */
const MAX_OUTCOMES = 10;

/** Retry schedule for resolution checks (ms after rollover). */
const RETRY_DELAYS_MS = [15_000, 120_000, 300_000]; // 15s, 2min, 5min

// --- Module state ---

const outcomes: Map<string, SettlementOutcome> = new Map();
let pendingTimers: ReturnType<typeof setTimeout>[] = [];

// --- Internal helpers ---

function outcomeKey(ik: IntervalKey): string {
  return `${ik.startTs}-${ik.endTs}`;
}

/**
 * Determine if oracles agree based on reference prices and BTC values.
 *
 * Kalshi uses 60s TWAP, Polymarket uses spot at close.
 */
function determineAgreement(
  twap: number | null,
  spot: number | null,
  kalshiRef: number | null,
  polyRef: number | null,
): { kalshiSaysUp: boolean | null; polySaysUp: boolean | null; agree: boolean; deadZone: boolean } {
  const kalshiSaysUp = twap != null && kalshiRef != null ? twap >= kalshiRef : null;
  const polySaysUp = spot != null && polyRef != null ? spot >= polyRef : null;

  if (kalshiSaysUp === null || polySaysUp === null) {
    return { kalshiSaysUp, polySaysUp, agree: true, deadZone: false };
  }

  const agree = kalshiSaysUp === polySaysUp;
  return { kalshiSaysUp, polySaysUp, agree, deadZone: !agree };
}

/**
 * Query Kalshi for settlement result.
 */
async function queryKalshiSettlement(
  eventTicker: string,
  kalshiHost: string,
  logger: Logger,
): Promise<"yes" | "no" | "unknown"> {
  try {
    const url = `${kalshiHost}/trade-api/v2/events/${eventTicker}?with_nested_markets=true`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeoutId);

    if (response.status !== 200) {
      logger.warn(`[SETTLEMENT] Kalshi query returned status ${response.status}`);
      return "unknown";
    }

    const data = await response.json();
    const market = data.event?.markets?.[0];
    if (!market) {
      logger.warn(`[SETTLEMENT] Kalshi event has no markets`);
      return "unknown";
    }

    if (market.result === "yes") return "yes";
    if (market.result === "no") return "no";

    return "unknown";
  } catch (error) {
    logger.warn(`[SETTLEMENT] Kalshi query failed: ${error instanceof Error ? error.message : String(error)}`);
    return "unknown";
  }
}

/**
 * Query Polymarket for settlement result.
 */
async function queryPolymarketSettlement(
  slug: string,
  gammaHost: string,
  logger: Logger,
): Promise<"up" | "down" | "unknown"> {
  try {
    const url = `${gammaHost}/markets/slug/${slug}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeoutId);

    if (response.status !== 200) {
      logger.warn(`[SETTLEMENT] Polymarket query returned status ${response.status}`);
      return "unknown";
    }

    const data = await response.json();

    if (data.resolved && data.resolution) {
      const res = data.resolution.toLowerCase();
      if (res === "up") return "up";
      if (res === "down") return "down";
    }

    return "unknown";
  } catch (error) {
    logger.warn(`[SETTLEMENT] Polymarket query failed: ${error instanceof Error ? error.message : String(error)}`);
    return "unknown";
  }
}

// --- Public API ---

export interface SettlementCheckDeps {
  kalshiHost?: string;
  gammaHost?: string;
  /** Override retry delays for testing. */
  retryDelaysMs?: number[];
}

/**
 * Schedule a settlement check for the given interval.
 *
 * Uses a pre-captured snapshot of interval-end state. The delayed checks
 * only query venue APIs for resolution — everything else comes from the snapshot.
 * Retries at increasing intervals if resolutions are still "unknown".
 */
export function scheduleSettlementCheck(
  snapshot: IntervalCloseSnapshot,
  logger: Logger,
  deps?: SettlementCheckDeps,
): void {
  const delays = deps?.retryDelaysMs ?? RETRY_DELAYS_MS;

  for (let attempt = 0; attempt < delays.length; attempt++) {
    const timer = setTimeout(async () => {
      try {
        // On retry, check if we already have a resolved outcome
        if (attempt > 0) {
          const existing = outcomes.get(outcomeKey(snapshot.intervalKey));
          if (
            existing &&
            existing.kalshiResolution !== "unknown" &&
            existing.polyResolution !== "unknown"
          ) {
            logger.debug(
              `[SETTLEMENT] Retry ${attempt + 1} skipped — both resolutions already known`
            );
            return;
          }
          logger.info(
            `[SETTLEMENT] Retry ${attempt + 1}/${delays.length} for ${snapshot.intervalKey.startTs}-${snapshot.intervalKey.endTs}`
          );
        }

        await performSettlementCheck(snapshot, logger, deps);
      } catch (error) {
        logger.error(
          `[SETTLEMENT] Check failed (attempt ${attempt + 1}): ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }, delays[attempt]);

    pendingTimers.push(timer);
  }
}

/**
 * Perform the actual settlement check (exposed for testing).
 *
 * Reads TWAP/spot/ref prices/analytics from the snapshot.
 * Only queries venue APIs for resolution.
 */
export async function performSettlementCheck(
  snapshot: IntervalCloseSnapshot,
  logger: Logger,
  deps?: SettlementCheckDeps,
): Promise<SettlementOutcome> {
  const kalshiHost = deps?.kalshiHost ?? "https://api.elections.kalshi.com";
  const gammaHost = deps?.gammaHost ?? "https://gamma-api.polymarket.com";

  const mapping = snapshot.mapping;

  // Query both venues in parallel for resolution
  const [kalshiRes, polyRes] = await Promise.all([
    mapping?.kalshi?.eventTicker
      ? queryKalshiSettlement(mapping.kalshi.eventTicker, kalshiHost, logger)
      : Promise.resolve("unknown" as const),
    mapping?.polymarket?.slug
      ? queryPolymarketSettlement(mapping.polymarket.slug, gammaHost, logger)
      : Promise.resolve("unknown" as const),
  ]);

  // Determine oracle agreement from snapshot data
  const { agree, deadZone } = determineAgreement(
    snapshot.btcTwap60s,
    snapshot.btcSpot,
    snapshot.kalshiRefPrice,
    snapshot.polyRefPrice,
  );

  const outcome: SettlementOutcome = {
    intervalKey: snapshot.intervalKey,
    btcSpotAtClose: snapshot.btcSpot,
    btcTwap60sAtClose: snapshot.btcTwap60s,
    kalshiRefPrice: snapshot.kalshiRefPrice,
    polyRefPrice: snapshot.polyRefPrice,
    kalshiResolution: kalshiRes,
    polyResolution: polyRes,
    oraclesAgree: agree,
    deadZoneHit: deadZone,
    crossingCount: snapshot.crossingCount,
    rangeUsd: snapshot.rangeUsd,
    distFromRefUsd: snapshot.distFromRefUsd,
    checkedAt: Date.now(),
  };

  // Store outcome
  const key = outcomeKey(snapshot.intervalKey);
  outcomes.set(key, outcome);

  // Prune old outcomes
  if (outcomes.size > MAX_OUTCOMES) {
    const keys = Array.from(outcomes.keys());
    for (let i = 0; i < keys.length - MAX_OUTCOMES; i++) {
      outcomes.delete(keys[i]);
    }
  }

  // Log the result
  const deadZoneTag = deadZone ? " [DEAD ZONE]" : "";
  const resTag =
    kalshiRes === "unknown" || polyRes === "unknown" ? " (pending)" : "";
  logger.info(
    `[SETTLEMENT]${deadZoneTag}${resTag} interval=${snapshot.intervalKey.startTs}-${snapshot.intervalKey.endTs} ` +
    `kalshi=${kalshiRes} poly=${polyRes} agree=${agree} ` +
    `twap=${snapshot.btcTwap60s?.toFixed(0) ?? "?"} spot=${snapshot.btcSpot?.toFixed(0) ?? "?"} ` +
    `kRef=${snapshot.kalshiRefPrice?.toFixed(0) ?? "?"} pRef=${snapshot.polyRefPrice?.toFixed(0) ?? "?"} ` +
    `crossings=${snapshot.crossingCount} range=$${snapshot.rangeUsd.toFixed(1)}`
  );

  // Write to settlements CSV
  try {
    const { logSettlement } = await import("../logging/settlementLogger");
    logSettlement(outcome, snapshot);
  } catch (error) {
    logger.error(
      `[SETTLEMENT] Failed to write CSV: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return outcome;
}

/**
 * Get the settlement outcome for an interval.
 */
export function getOutcome(intervalKey: IntervalKey): SettlementOutcome | null {
  return outcomes.get(outcomeKey(intervalKey)) ?? null;
}

/**
 * Reset state for a new session (clears old outcomes and timers).
 */
export function resetForInterval(): void {
  // Clear pending timers
  for (const timer of pendingTimers) {
    clearTimeout(timer);
  }
  pendingTimers = [];
}

/**
 * Reset all state (for testing).
 */
export function resetStore(): void {
  resetForInterval();
  outcomes.clear();
}

/**
 * Exported for testing.
 */
export const _test = { determineAgreement, queryKalshiSettlement, queryPolymarketSettlement, outcomes, outcomeKey };
