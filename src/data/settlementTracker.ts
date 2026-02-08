/**
 * Settlement outcome tracker.
 *
 * Queries both venues after interval close to determine actual settlement outcomes.
 * Runs on a delay after rollover (venues need time to settle).
 */

import type { IntervalKey } from "../time/interval";
import type { IntervalMapping } from "../markets/mappingStore";
import type { Logger } from "../logging/logger";
import { getFrozenTwap, getFrozenSpot } from "./twapStore";

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
  checkedAt: number;
}

/** Maximum outcomes to keep in memory. */
const MAX_OUTCOMES = 10;

/** Delay before querying settlement (ms). */
const SETTLEMENT_CHECK_DELAY_MS = 15_000;

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

    if (response.status !== 200) return "unknown";

    const data = await response.json();
    const market = data.event?.markets?.[0];
    if (!market) return "unknown";

    if (market.result === "yes") return "yes";
    if (market.result === "no") return "no";

    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Query Polymarket for settlement result.
 */
async function queryPolymarketSettlement(
  slug: string,
  gammaHost: string,
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

    if (response.status !== 200) return "unknown";

    const data = await response.json();

    if (data.resolved && data.resolution) {
      const res = data.resolution.toLowerCase();
      if (res === "up") return "up";
      if (res === "down") return "down";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

// --- Public API ---

export interface SettlementCheckDeps {
  kalshiHost?: string;
  gammaHost?: string;
}

/**
 * Schedule a settlement check for the given interval.
 *
 * Fires after a delay to allow venues time to settle.
 */
export function scheduleSettlementCheck(
  intervalKey: IntervalKey,
  mapping: IntervalMapping | null,
  logger: Logger,
  deps?: SettlementCheckDeps,
): void {
  const timer = setTimeout(async () => {
    try {
      await performSettlementCheck(intervalKey, mapping, logger, deps);
    } catch (error) {
      logger.error(
        `[SETTLEMENT] Check failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, SETTLEMENT_CHECK_DELAY_MS);

  pendingTimers.push(timer);
}

/**
 * Perform the actual settlement check (exposed for testing).
 */
export async function performSettlementCheck(
  intervalKey: IntervalKey,
  mapping: IntervalMapping | null,
  logger: Logger,
  deps?: SettlementCheckDeps,
): Promise<SettlementOutcome> {
  const kalshiHost = deps?.kalshiHost ?? "https://api.elections.kalshi.com";
  const gammaHost = deps?.gammaHost ?? "https://gamma-api.polymarket.com";

  const btcTwap = getFrozenTwap();
  const btcSpot = getFrozenSpot();
  const kalshiRef = mapping?.kalshi?.referencePrice ?? null;
  const polyRef = mapping?.polymarket?.referencePrice ?? null;

  // Query both venues in parallel
  const [kalshiRes, polyRes] = await Promise.all([
    mapping?.kalshi?.eventTicker
      ? queryKalshiSettlement(mapping.kalshi.eventTicker, kalshiHost)
      : Promise.resolve("unknown" as const),
    mapping?.polymarket?.slug
      ? queryPolymarketSettlement(mapping.polymarket.slug, gammaHost)
      : Promise.resolve("unknown" as const),
  ]);

  // Determine oracle agreement from our local TWAP/spot data
  const { agree, deadZone } = determineAgreement(btcTwap, btcSpot, kalshiRef, polyRef);

  const outcome: SettlementOutcome = {
    intervalKey,
    btcSpotAtClose: btcSpot,
    btcTwap60sAtClose: btcTwap,
    kalshiRefPrice: kalshiRef,
    polyRefPrice: polyRef,
    kalshiResolution: kalshiRes,
    polyResolution: polyRes,
    oraclesAgree: agree,
    deadZoneHit: deadZone,
    checkedAt: Date.now(),
  };

  // Store outcome
  const key = outcomeKey(intervalKey);
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
  logger.info(
    `[SETTLEMENT]${deadZoneTag} interval=${intervalKey.startTs}-${intervalKey.endTs} ` +
    `kalshi=${kalshiRes} poly=${polyRes} agree=${agree} ` +
    `twap=${btcTwap?.toFixed(0) ?? "?"} spot=${btcSpot?.toFixed(0) ?? "?"} ` +
    `kRef=${kalshiRef?.toFixed(0) ?? "?"} pRef=${polyRef?.toFixed(0) ?? "?"}`
  );

  // Write to settlements CSV
  try {
    const { logSettlement } = await import("../logging/settlementLogger");
    logSettlement(outcome, mapping);
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
