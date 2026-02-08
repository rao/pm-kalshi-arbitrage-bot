/**
 * BTC Price History & Analytics store.
 *
 * Module-level singleton (matches positionTracker.ts pattern).
 * Tracks reference price, crossing detection, and range analytics
 * for the current interval.
 */

/** Price entry in the rolling buffer. */
interface PriceEntry {
  price: number;
  ts: number;
}

/** Analytics snapshot returned by getAnalytics(). */
export interface BtcPriceAnalytics {
  referencePrice: number | null;
  crossingCount: number;
  rangeUsd: number;
  distFromRefUsd: number;
  currentSide: "above" | "below" | null;
  sampleCount: number;
}

/** Maximum entries in the rolling price buffer. */
const MAX_HISTORY = 500;

// --- Module state ---

let referencePrice: number | null = null;
let priceHistory: PriceEntry[] = [];
let crossingCount = 0;
let intervalHigh = -Infinity;
let intervalLow = Infinity;
let lastSide: "above" | "below" | null = null;
let currentIntervalKey: string | null = null;

// --- Public API ---

/**
 * Record a BTC price tick. Updates analytics and detects reference crossings.
 */
export function recordPrice(price: number, ts: number): void {
  // Add to rolling buffer
  priceHistory.push({ price, ts });
  if (priceHistory.length > MAX_HISTORY) {
    priceHistory = priceHistory.slice(-MAX_HISTORY);
  }

  // Update range
  if (price > intervalHigh) intervalHigh = price;
  if (price < intervalLow) intervalLow = price;

  // Crossing detection (only after reference is set)
  if (referencePrice !== null) {
    const side: "above" | "below" = price >= referencePrice ? "above" : "below";

    if (lastSide !== null && side !== lastSide) {
      crossingCount++;
    }
    lastSide = side;
  }
}

/**
 * Reset state for a new interval.
 */
export function resetForInterval(intervalKey?: string): void {
  referencePrice = null;
  priceHistory = [];
  crossingCount = 0;
  intervalHigh = -Infinity;
  intervalLow = Infinity;
  lastSide = null;
  currentIntervalKey = intervalKey ?? null;
}

/**
 * Set the reference price (typically from first Binance tick after interval start).
 */
export function setReferencePrice(price: number): void {
  referencePrice = price;
  // Initialize lastSide based on current latest price
  if (priceHistory.length > 0) {
    const latest = priceHistory[priceHistory.length - 1].price;
    lastSide = latest >= price ? "above" : "below";
  }
}

/**
 * Get the reference price for the current interval.
 */
export function getReferencePrice(): number | null {
  return referencePrice;
}

/**
 * Get analytics snapshot.
 */
export function getAnalytics(): BtcPriceAnalytics {
  const latestPrice = priceHistory.length > 0
    ? priceHistory[priceHistory.length - 1].price
    : null;

  const rangeUsd = intervalHigh > -Infinity && intervalLow < Infinity
    ? intervalHigh - intervalLow
    : 0;

  const distFromRefUsd = referencePrice !== null && latestPrice !== null
    ? Math.abs(latestPrice - referencePrice)
    : 0;

  return {
    referencePrice,
    crossingCount,
    rangeUsd,
    distFromRefUsd,
    currentSide: lastSide,
    sampleCount: priceHistory.length,
  };
}

/**
 * Get the current side relative to reference price.
 */
export function getCurrentSide(): "above" | "below" | null {
  return lastSide;
}

/**
 * Get the latest BTC price from the store.
 */
export function getLatestPrice(): number | null {
  if (priceHistory.length === 0) return null;
  return priceHistory[priceHistory.length - 1].price;
}

/**
 * Reset only crossing count and lastSide.
 * Called when entering MONITORING to ensure crossings are counted
 * only from the monitoring window onward (not accumulated from interval start).
 * Preserves range, history, and reference price.
 */
export function resetCrossingCount(): void {
  crossingCount = 0;
  lastSide = null;
}

/**
 * Reset all store state (for testing).
 */
export function resetStore(): void {
  resetForInterval();
}
