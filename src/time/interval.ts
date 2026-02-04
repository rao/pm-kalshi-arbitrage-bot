/**
 * Interval time utilities for 15-minute market windows.
 *
 * Markets run on fixed 15-minute intervals aligned to HH:00, HH:15, HH:30, HH:45.
 */

export interface IntervalKey {
  /** Start timestamp in Unix seconds (UTC) */
  startTs: number;
  /** End timestamp in Unix seconds (UTC) */
  endTs: number;
}

/** Duration of each interval in seconds (15 minutes) */
export const INTERVAL_DURATION_S = 900;

/** Default prefetch window before rollover (60 seconds) */
export const DEFAULT_PREFETCH_WINDOW_MS = 60_000;

/**
 * Get the interval key for the current 15-minute window.
 *
 * Rounds down to the nearest 15-minute boundary.
 *
 * @param now - Date to use (defaults to current time)
 * @returns IntervalKey with start and end timestamps
 *
 * @example
 * // At 14:23:45 UTC
 * getIntervalKey() // { startTs: 1234567800, endTs: 1234568700 }
 * // where 1234567800 = 14:15:00 UTC
 */
export function getIntervalKey(now: Date = new Date()): IntervalKey {
  const utcMinute = now.getUTCMinutes();
  const roundedMinute = Math.floor(utcMinute / 15) * 15;

  // Create a new date at the start of the interval
  const startDate = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      roundedMinute,
      0,
      0
    )
  );

  const startTs = Math.floor(startDate.getTime() / 1000);
  const endTs = startTs + INTERVAL_DURATION_S;

  return { startTs, endTs };
}

/**
 * Get the interval key for the next 15-minute window.
 *
 * @param now - Date to use (defaults to current time)
 * @returns IntervalKey for the next interval
 */
export function getNextIntervalKey(now: Date = new Date()): IntervalKey {
  const current = getIntervalKey(now);
  return {
    startTs: current.endTs,
    endTs: current.endTs + INTERVAL_DURATION_S,
  };
}

/**
 * Get the interval key for the previous 15-minute window.
 *
 * @param now - Date to use (defaults to current time)
 * @returns IntervalKey for the previous interval
 */
export function getPreviousIntervalKey(now: Date = new Date()): IntervalKey {
  const current = getIntervalKey(now);
  return {
    startTs: current.startTs - INTERVAL_DURATION_S,
    endTs: current.startTs,
  };
}

/**
 * Get milliseconds until the next interval rollover.
 *
 * @param now - Date to use (defaults to current time)
 * @returns Milliseconds until rollover
 */
export function msUntilRollover(now: Date = new Date()): number {
  const current = getIntervalKey(now);
  const endMs = current.endTs * 1000;
  return Math.max(0, endMs - now.getTime());
}

/**
 * Check if we should prefetch the next interval's market data.
 *
 * Returns true when we're within the prefetch window of the next rollover.
 *
 * @param now - Date to use (defaults to current time)
 * @param prefetchWindowMs - Prefetch window in ms (default: 30000)
 * @returns true if we should prefetch
 */
export function shouldPrefetchNextInterval(
  now: Date = new Date(),
  prefetchWindowMs: number = DEFAULT_PREFETCH_WINDOW_MS
): boolean {
  const msUntil = msUntilRollover(now);
  return msUntil <= prefetchWindowMs && msUntil > 0;
}

/**
 * Convert an IntervalKey to a string key for use in Maps.
 *
 * @param interval - The interval key
 * @returns String representation like "1234567800-1234568700"
 */
export function intervalKeyToString(interval: IntervalKey): string {
  return `${interval.startTs}-${interval.endTs}`;
}

/**
 * Parse a string key back to an IntervalKey.
 *
 * @param key - String like "1234567800-1234568700"
 * @returns IntervalKey or null if invalid
 */
export function parseIntervalKeyString(key: string): IntervalKey | null {
  const parts = key.split("-");
  if (parts.length !== 2) return null;

  const startTs = parseInt(parts[0], 10);
  const endTs = parseInt(parts[1], 10);

  if (isNaN(startTs) || isNaN(endTs)) return null;

  return { startTs, endTs };
}

/**
 * Format an IntervalKey for display.
 *
 * @param interval - The interval key
 * @returns Formatted string like "14:15-14:30 UTC"
 */
export function formatIntervalKey(interval: IntervalKey): string {
  const start = new Date(interval.startTs * 1000);
  const end = new Date(interval.endTs * 1000);

  const formatTime = (d: Date) =>
    `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;

  return `${formatTime(start)}-${formatTime(end)} UTC`;
}
