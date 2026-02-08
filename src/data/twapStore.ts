/**
 * Rolling 60-second TWAP (Time-Weighted Average Price) store.
 *
 * Module-level singleton (matches btcPriceStore.ts pattern).
 * Mirrors Kalshi's 60s TWAP oracle for dead zone detection.
 */

import { CircularBuffer } from "../utils/circularBuffer";

/** Price entry in the circular buffer. */
interface PriceEntry {
  price: number;
  ts: number;
}

/** Maximum entries in the circular buffer. */
const MAX_ENTRIES = 1000;

/** Minimum samples required for a valid TWAP computation. */
const MIN_SAMPLES = 5;

/** TWAP window in milliseconds (60 seconds). */
const TWAP_WINDOW_MS = 60_000;

// --- Module state ---

let buffer = new CircularBuffer<PriceEntry>(MAX_ENTRIES);
let frozenTwap: number | null = null;
let frozenSpot: number | null = null;

// --- Public API ---

/**
 * Record a BTC price tick. Called on every Binance aggTrade.
 */
export function recordTick(price: number, ts: number): void {
  buffer.push({ price, ts });
}

/**
 * Compute arithmetic mean of prices in the last 60s window.
 *
 * Returns null if fewer than MIN_SAMPLES in the window.
 */
export function getTwap60s(now?: number): number | null {
  const cutoff = (now ?? Date.now()) - TWAP_WINDOW_MS;
  const inWindow = buffer.filter((e) => e.ts >= cutoff);

  if (inWindow.length < MIN_SAMPLES) return null;

  let sum = 0;
  for (let i = 0; i < inWindow.length; i++) {
    sum += inWindow[i].price;
  }
  return sum / inWindow.length;
}

/**
 * Get the latest spot price in the buffer.
 */
export function getSpotPrice(): number | null {
  const latest = buffer.last();
  return latest ? latest.price : null;
}

/**
 * Freeze current TWAP + spot values for post-close logging.
 * Call BEFORE resetForInterval() so the buffer is still populated.
 */
export function freezeAtClose(): void {
  frozenTwap = getTwap60s();
  frozenSpot = getSpotPrice();
}

/**
 * Get the frozen TWAP value (set at interval close).
 */
export function getFrozenTwap(): number | null {
  return frozenTwap;
}

/**
 * Get the frozen spot value (set at interval close).
 */
export function getFrozenSpot(): number | null {
  return frozenSpot;
}

/**
 * Reset all state for a new interval.
 */
export function resetForInterval(): void {
  buffer = new CircularBuffer<PriceEntry>(MAX_ENTRIES);
  frozenTwap = null;
  frozenSpot = null;
}

/**
 * Get buffer length (for testing / diagnostics).
 */
export function getBufferLength(): number {
  return buffer.length;
}

/**
 * Reset all store state (for testing).
 */
export function resetStore(): void {
  resetForInterval();
}
