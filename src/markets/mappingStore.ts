/**
 * In-memory mapping store for interval -> market mappings.
 *
 * Tracks discovered markets for each 15-minute interval to enable
 * fast lookups and prefetching.
 */

import {
  type IntervalKey,
  intervalKeyToString,
  getIntervalKey,
  getNextIntervalKey,
} from "../time/interval";

/**
 * Polymarket-specific mapping data.
 */
export interface PolymarketMapping {
  /** Token ID for "Up" outcome */
  upToken: string;
  /** Token ID for "Down" outcome */
  downToken: string;
  /** Market slug */
  slug: string;
  /** End timestamp in Unix seconds */
  endTs: number;
  /** BTC strike/reference price parsed from market question */
  referencePrice?: number;
}

/**
 * Kalshi-specific mapping data.
 */
export interface KalshiMapping {
  /** Event ticker (e.g., "KXBTC15M-26FEB031730") */
  eventTicker: string;
  /** Market ticker (e.g., "KXBTC15M-26FEB031730-30") */
  marketTicker: string;
  /** Series ticker (e.g., "KXBTC15M") */
  seriesTicker: string;
  /** Close timestamp in Unix seconds */
  closeTs: number;
  /** BTC strike/reference price parsed from event title */
  referencePrice?: number;
}

/**
 * Complete interval mapping with all venue data.
 */
export interface IntervalMapping {
  /** The interval this mapping is for */
  intervalKey: IntervalKey;
  /** Polymarket market data */
  polymarket?: PolymarketMapping;
  /** Kalshi market data */
  kalshi?: KalshiMapping;
  /** When this mapping was discovered (Unix ms) */
  discoveredAt: number;
}

/** Default max age for mappings before pruning (1 hour) */
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * In-memory store for interval -> market mappings.
 */
export class MappingStore {
  private mappings: Map<string, IntervalMapping>;

  constructor() {
    this.mappings = new Map();
  }

  /**
   * Store a mapping for an interval.
   *
   * Merges with existing mapping if present, preserving other venue data.
   *
   * @param intervalKey - The interval to store mapping for
   * @param polymarket - Optional Polymarket mapping data
   * @param kalshi - Optional Kalshi mapping data
   */
  setMapping(
    intervalKey: IntervalKey,
    polymarket?: PolymarketMapping,
    kalshi?: KalshiMapping
  ): void {
    const key = intervalKeyToString(intervalKey);
    const existing = this.mappings.get(key);

    const mapping: IntervalMapping = {
      intervalKey,
      polymarket: polymarket || existing?.polymarket,
      kalshi: kalshi || existing?.kalshi,
      discoveredAt: Date.now(),
    };
    this.mappings.set(key, mapping);

    // Auto-prune old mappings to prevent unbounded growth
    if (this.mappings.size > 10) {
      this.pruneOldMappings();
    }
  }

  /**
   * Set Polymarket mapping for an interval.
   *
   * @param intervalKey - The interval to store mapping for
   * @param polymarket - Polymarket mapping data
   */
  setPolymarketMapping(
    intervalKey: IntervalKey,
    polymarket: PolymarketMapping
  ): void {
    this.setMapping(intervalKey, polymarket, undefined);
  }

  /**
   * Set Kalshi mapping for an interval.
   *
   * @param intervalKey - The interval to store mapping for
   * @param kalshi - Kalshi mapping data
   */
  setKalshiMapping(intervalKey: IntervalKey, kalshi: KalshiMapping): void {
    this.setMapping(intervalKey, undefined, kalshi);
  }

  /**
   * Get the mapping for a specific interval.
   *
   * @param intervalKey - The interval to look up
   * @returns IntervalMapping or null if not found
   */
  getMapping(intervalKey: IntervalKey): IntervalMapping | null {
    const key = intervalKeyToString(intervalKey);
    return this.mappings.get(key) || null;
  }

  /**
   * Get the mapping for the current interval.
   *
   * @param now - Date to use (defaults to current time)
   * @returns IntervalMapping or null if not found
   */
  getCurrentMapping(now: Date = new Date()): IntervalMapping | null {
    const currentInterval = getIntervalKey(now);
    return this.getMapping(currentInterval);
  }

  /**
   * Get the mapping for the next interval.
   *
   * @param now - Date to use (defaults to current time)
   * @returns IntervalMapping or null if not found
   */
  getNextMapping(now: Date = new Date()): IntervalMapping | null {
    const nextInterval = getNextIntervalKey(now);
    return this.getMapping(nextInterval);
  }

  /**
   * Check if we have a mapping for an interval.
   *
   * @param intervalKey - The interval to check
   * @returns true if mapping exists
   */
  hasMapping(intervalKey: IntervalKey): boolean {
    const key = intervalKeyToString(intervalKey);
    return this.mappings.has(key);
  }

  /**
   * Delete a mapping for an interval.
   *
   * @param intervalKey - The interval to delete
   * @returns true if a mapping was deleted
   */
  deleteMapping(intervalKey: IntervalKey): boolean {
    const key = intervalKeyToString(intervalKey);
    return this.mappings.delete(key);
  }

  /**
   * Prune old mappings beyond max age.
   *
   * @param maxAgeMs - Maximum age in milliseconds (default: 1 hour)
   * @returns Number of mappings pruned
   */
  pruneOldMappings(maxAgeMs: number = DEFAULT_MAX_AGE_MS): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, mapping] of this.mappings.entries()) {
      if (now - mapping.discoveredAt > maxAgeMs) {
        this.mappings.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Get all stored mappings.
   *
   * @returns Array of all mappings
   */
  getAllMappings(): IntervalMapping[] {
    return Array.from(this.mappings.values());
  }

  /**
   * Get the number of stored mappings.
   *
   * @returns Number of mappings
   */
  size(): number {
    return this.mappings.size;
  }

  /**
   * Clear all stored mappings.
   */
  clear(): void {
    this.mappings.clear();
  }
}
