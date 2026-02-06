/**
 * Market discovery orchestration module.
 *
 * Handles automatic discovery of markets for each 15-minute interval,
 * including prefetching next interval markets before rollover.
 * Supports both Polymarket and Kalshi venues.
 */

import {
  type IntervalKey,
  getIntervalKey,
  getNextIntervalKey,
  msUntilRollover,
  shouldPrefetchNextInterval,
  intervalKeyToString,
  DEFAULT_PREFETCH_WINDOW_MS,
} from "../time/interval";
import {
  GammaClient,
  type GammaClientOptions,
} from "../venues/polymarket/gamma";
import {
  type SupportedCoin,
  type MarketInfo as PolymarketMarketInfo,
  SUPPORTED_COINS,
  isSupportedCoin,
} from "../venues/polymarket/types";
import {
  KalshiClient,
  type KalshiClientOptions,
} from "../venues/kalshi/client";
import { type KalshiEventInfo } from "../venues/kalshi/types";
import {
  MappingStore,
  type IntervalMapping,
  type PolymarketMapping,
  type KalshiMapping,
} from "./mappingStore";

/**
 * Venue identifier.
 */
export type Venue = "polymarket" | "kalshi";

/**
 * Discovery event types.
 */
export type DiscoveryEvent =
  | {
      type: "MARKET_DISCOVERED";
      venue: Venue;
      intervalKey: IntervalKey;
      mapping: IntervalMapping;
    }
  | {
      type: "MARKET_CHANGED";
      venue: Venue;
      oldMapping: IntervalMapping | null;
      newMapping: IntervalMapping;
    }
  | { type: "PREFETCH_STARTED"; venue: Venue; intervalKey: IntervalKey }
  | {
      type: "PREFETCH_COMPLETED";
      venue: Venue;
      intervalKey: IntervalKey;
      success: boolean;
    }
  | { type: "ROLLOVER"; oldInterval: IntervalKey; newInterval: IntervalKey }
  | { type: "ERROR"; venue: Venue; error: Error; context: string };

export type DiscoveryEventCallback = (event: DiscoveryEvent) => void;

export interface MarketDiscoveryOptions {
  /** Coin to discover markets for (default: BTC) */
  coin?: SupportedCoin;
  /** Which venues to discover (default: both) */
  venues?: Venue[];
  /** GammaClient instance (created if not provided) */
  gamma?: GammaClient;
  /** KalshiClient instance (created if not provided) */
  kalshi?: KalshiClient;
  /** MappingStore instance (created if not provided) */
  store?: MappingStore;
  /** GammaClient options (used if gamma not provided) */
  gammaOptions?: GammaClientOptions;
  /** KalshiClient options (used if kalshi not provided) */
  kalshiOptions?: KalshiClientOptions;
}

export interface DiscoveryStartOptions {
  /** Interval between market checks in ms (default: 30000) */
  checkIntervalMs?: number;
  /** Time before rollover to prefetch next market (default: 30000) */
  prefetchBeforeMs?: number;
  /** Whether to perform initial discovery immediately (default: true) */
  discoverImmediately?: boolean;
  /** Delay after rollover before discovering new markets (default: 15000ms) */
  postRolloverDelayMs?: number;
}

/**
 * Market discovery orchestrator.
 *
 * Automatically discovers and tracks markets for 15-minute intervals,
 * with prefetching to minimize downtime during rollovers.
 * Supports both Polymarket and Kalshi venues.
 */
export class MarketDiscovery {
  private coin: SupportedCoin;
  private venues: Set<Venue>;
  private gamma: GammaClient | null;
  private kalshiClient: KalshiClient | null;
  private store: MappingStore;
  private eventCallbacks: DiscoveryEventCallback[];
  private running: boolean;
  private checkTimerId: ReturnType<typeof setInterval> | null;
  private prefetchTimerId: ReturnType<typeof setTimeout> | null;
  private rolloverTimerId: ReturnType<typeof setTimeout> | null;
  private lastIntervalKey: string | null;
  private checkIntervalMs: number;
  private prefetchBeforeMs: number;
  private postRolloverDelayMs: number;
  private postRolloverTimerId: ReturnType<typeof setTimeout> | null;

  constructor(options: MarketDiscoveryOptions = {}) {
    const coin = options.coin || "BTC";
    if (!isSupportedCoin(coin)) {
      throw new Error(
        `Unsupported coin: ${coin}. Use: ${SUPPORTED_COINS.join(", ")}`
      );
    }

    this.coin = coin;
    this.venues = new Set(options.venues || ["polymarket", "kalshi"]);
    this.store = options.store || new MappingStore();
    this.eventCallbacks = [];
    this.running = false;
    this.checkTimerId = null;
    this.prefetchTimerId = null;
    this.rolloverTimerId = null;
    this.lastIntervalKey = null;
    this.checkIntervalMs = 30_000;
    this.prefetchBeforeMs = DEFAULT_PREFETCH_WINDOW_MS;
    this.postRolloverDelayMs = 15_000; // Default 15 second delay after rollover
    this.postRolloverTimerId = null;

    // Initialize venue clients based on configured venues
    this.gamma = this.venues.has("polymarket")
      ? options.gamma || new GammaClient(options.gammaOptions)
      : null;

    this.kalshiClient = this.venues.has("kalshi")
      ? options.kalshi || new KalshiClient(options.kalshiOptions)
      : null;
  }

  /**
   * Register an event callback.
   */
  onEvent(callback: DiscoveryEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /**
   * Remove an event callback.
   */
  offEvent(callback: DiscoveryEventCallback): void {
    const index = this.eventCallbacks.indexOf(callback);
    if (index !== -1) {
      this.eventCallbacks.splice(index, 1);
    }
  }

  /**
   * Emit an event to all callbacks.
   */
  private emit(event: DiscoveryEvent): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error("Error in discovery event callback:", error);
      }
    }
  }

  /**
   * Convert PolymarketMarketInfo to PolymarketMapping.
   */
  private polymarketInfoToMapping(
    market: PolymarketMarketInfo
  ): PolymarketMapping {
    return {
      upToken: market.tokenIds.up,
      downToken: market.tokenIds.down,
      slug: market.slug,
      endTs: market.endTs,
    };
  }

  /**
   * Convert KalshiEventInfo to KalshiMapping.
   */
  private kalshiInfoToMapping(event: KalshiEventInfo): KalshiMapping {
    return {
      eventTicker: event.eventTicker,
      marketTicker: event.marketTicker,
      seriesTicker: event.seriesTicker,
      closeTs: event.closeTs,
    };
  }

  /**
   * Discover Polymarket market for an interval.
   */
  private async discoverPolymarketMarket(
    getCurrent: boolean
  ): Promise<{ intervalKey: IntervalKey; mapping: PolymarketMapping } | null> {
    if (!this.gamma) return null;

    try {
      const market = getCurrent
        ? await this.gamma.getCurrentMarket(this.coin)
        : await this.gamma.getNextMarket(this.coin);

      if (!market) return null;

      return {
        intervalKey: market.intervalKey,
        mapping: this.polymarketInfoToMapping(market),
      };
    } catch (error) {
      this.emit({
        type: "ERROR",
        venue: "polymarket",
        error: error instanceof Error ? error : new Error(String(error)),
        context: getCurrent
          ? "discoverPolymarketCurrent"
          : "discoverPolymarketNext",
      });
      return null;
    }
  }

  /**
   * Discover Kalshi event for an interval.
   */
  private async discoverKalshiEvent(
    getCurrent: boolean
  ): Promise<{ intervalKey: IntervalKey; mapping: KalshiMapping } | null> {
    if (!this.kalshiClient) return null;

    try {
      const event = getCurrent
        ? await this.kalshiClient.getCurrentEvent(this.coin)
        : await this.kalshiClient.getNextEvent(this.coin);

      if (!event) return null;

      return {
        intervalKey: event.intervalKey,
        mapping: this.kalshiInfoToMapping(event),
      };
    } catch (error) {
      this.emit({
        type: "ERROR",
        venue: "kalshi",
        error: error instanceof Error ? error : new Error(String(error)),
        context: getCurrent ? "discoverKalshiCurrent" : "discoverKalshiNext",
      });
      return null;
    }
  }

  /**
   * Discover and store the current interval's markets.
   *
   * @returns IntervalMapping or null if nothing found
   */
  async discoverCurrentMarket(): Promise<IntervalMapping | null> {

    const results = await Promise.all([
      this.discoverPolymarketMarket(true),
      this.discoverKalshiEvent(true),
    ]);

    const polyResult = results[0];
    const kalshiResult = results[1];

    console.log(`[MarketDiscovery / SANITY ] Discovery results:`);
    // console.log(`  Same Interval: ${parseInt(polyResult?.intervalKey ?? 1) === parseInt(kalshiResult?.intervalKey) ? '✅' : '❌'} | Slug=${polyResult?.mapping.slug ?? 'unknown(!)'} | ticker=${kalshiResult?.mapping.marketTicker ?? 'unknown(!)'}`)
    console.log("  Polymarket:", polyResult ?
      `interval=${intervalKeyToString(polyResult.intervalKey)}, slug=${polyResult.mapping.slug}` : "not found");
    console.log("  Kalshi:", kalshiResult ?
      `interval=${intervalKeyToString(kalshiResult.intervalKey)}, ticker=${kalshiResult.mapping.marketTicker}` : "not found");

    if (!polyResult && !kalshiResult) {
      console.log("[MarketDiscovery] No markets discovered for any venue");
      return null;
    }

    // Use whichever interval key we got (prefer Polymarket if both available)
    const intervalKey =
      polyResult?.intervalKey || kalshiResult?.intervalKey || getIntervalKey();

    // Check existing mapping
    const existing = this.store.getMapping(intervalKey);

    // Store mappings
    if (polyResult) {
      this.store.setPolymarketMapping(intervalKey, polyResult.mapping);
    }
    if (kalshiResult) {
      this.store.setKalshiMapping(intervalKey, kalshiResult.mapping);
    }

    const newMapping = this.store.getMapping(intervalKey)!;

    // Emit events for each venue
    if (polyResult) {
      if (!existing?.polymarket) {
        this.emit({
          type: "MARKET_DISCOVERED",
          venue: "polymarket",
          intervalKey,
          mapping: newMapping,
        });
      } else if (existing.polymarket.slug !== polyResult.mapping.slug) {
        this.emit({
          type: "MARKET_CHANGED",
          venue: "polymarket",
          oldMapping: existing,
          newMapping,
        });
      }
    }

    if (kalshiResult) {
      if (!existing?.kalshi) {
        this.emit({
          type: "MARKET_DISCOVERED",
          venue: "kalshi",
          intervalKey,
          mapping: newMapping,
        });
      } else if (
        existing.kalshi.eventTicker !== kalshiResult.mapping.eventTicker
      ) {
        this.emit({
          type: "MARKET_CHANGED",
          venue: "kalshi",
          oldMapping: existing,
          newMapping,
        });
      }
    }

    return newMapping;
  }

  /**
   * Prefetch the next interval's markets.
   *
   * @returns IntervalMapping or null if not found
   */
  async prefetchNextMarket(): Promise<IntervalMapping | null> {
    const nextInterval = getNextIntervalKey();

    // Emit prefetch started for each venue
    if (this.venues.has("polymarket")) {
      this.emit({
        type: "PREFETCH_STARTED",
        venue: "polymarket",
        intervalKey: nextInterval,
      });
    }
    if (this.venues.has("kalshi")) {
      this.emit({
        type: "PREFETCH_STARTED",
        venue: "kalshi",
        intervalKey: nextInterval,
      });
    }

    const results = await Promise.all([
      this.discoverPolymarketMarket(false),
      this.discoverKalshiEvent(false),
    ]);

    const polyResult = results[0];
    const kalshiResult = results[1];

    // Store mappings
    if (polyResult) {
      this.store.setPolymarketMapping(nextInterval, polyResult.mapping);
      this.emit({
        type: "PREFETCH_COMPLETED",
        venue: "polymarket",
        intervalKey: nextInterval,
        success: true,
      });
    } else if (this.venues.has("polymarket")) {
      this.emit({
        type: "PREFETCH_COMPLETED",
        venue: "polymarket",
        intervalKey: nextInterval,
        success: false,
      });
    }

    if (kalshiResult) {
      this.store.setKalshiMapping(nextInterval, kalshiResult.mapping);
      this.emit({
        type: "PREFETCH_COMPLETED",
        venue: "kalshi",
        intervalKey: nextInterval,
        success: true,
      });
    } else if (this.venues.has("kalshi")) {
      this.emit({
        type: "PREFETCH_COMPLETED",
        venue: "kalshi",
        intervalKey: nextInterval,
        success: false,
      });
    }

    if (!polyResult && !kalshiResult) {
      return null;
    }

    return this.store.getMapping(nextInterval);
  }

  /**
   * Schedule precise rollover detection using setTimeout.
   * Fires ~100ms after the boundary to ensure we're in the new interval.
   */
  private scheduleRollover(): void {
    if (!this.running) return;
    this.clearRolloverTimer();

    const msUntil = msUntilRollover();
    // Fire 100ms after boundary to ensure we're in the new interval
    const targetMs = Math.max(100, msUntil + 100);

    this.rolloverTimerId = setTimeout(() => {
      if (!this.running) return;
      this.checkAndUpdate();
      this.scheduleRollover(); // Schedule next
    }, targetMs);
  }

  /**
   * Clear the rollover timer.
   */
  private clearRolloverTimer(): void {
    if (this.rolloverTimerId) {
      clearTimeout(this.rolloverTimerId);
      this.rolloverTimerId = null;
    }
  }

  /**
   * Schedule the next prefetch based on time until rollover.
   */
  private schedulePrefetch(): void {
    if (!this.running) return;

    const msUntil = msUntilRollover();
    const prefetchAt = Math.max(0, msUntil - this.prefetchBeforeMs);

    if (prefetchAt > 0) {
      this.prefetchTimerId = setTimeout(async () => {
        if (!this.running) return;

        if (shouldPrefetchNextInterval(new Date(), this.prefetchBeforeMs)) {
          await this.prefetchNextMarket();
        }

        this.schedulePrefetch();
      }, prefetchAt);
    } else {
      this.prefetchNextMarket().then(() => {
        if (this.running) {
          const nextRollover = msUntilRollover();
          setTimeout(() => this.schedulePrefetch(), nextRollover + 1000);
        }
      });
    }
  }

  /**
   * Check for interval rollover and rediscover if needed.
   */
  private async checkAndUpdate(): Promise<void> {
    if (!this.running) return;

    const currentInterval = getIntervalKey();
    const currentKey = intervalKeyToString(currentInterval);

    // Check if we've rolled over to a new interval
    const isRollover = this.lastIntervalKey && this.lastIntervalKey !== currentKey;

    if (isRollover) {
      console.log("[MarketDiscovery] ROLLOVER DETECTED:", this.lastIntervalKey, "->", currentKey);
      const parts = this.lastIntervalKey!.split("-");
      const oldInterval: IntervalKey = {
        startTs: parseInt(parts[0], 10),
        endTs: parseInt(parts[1], 10),
      };

      // Emit ROLLOVER immediately so coordinator can unsubscribe from old markets
      this.emit({
        type: "ROLLOVER",
        oldInterval,
        newInterval: currentInterval,
      });

      this.store.pruneOldMappings();
    }

    this.lastIntervalKey = currentKey;

    // If this is a rollover, delay discovery to give venues time to have new markets ready
    if (isRollover && this.postRolloverDelayMs > 0) {
      console.log(
        `[MarketDiscovery] Rollover detected, delaying discovery by ${this.postRolloverDelayMs}ms`
      );

      // Clear any existing post-rollover timer
      if (this.postRolloverTimerId) {
        clearTimeout(this.postRolloverTimerId);
      }

      this.postRolloverTimerId = setTimeout(async () => {
        if (!this.running) return;
        this.postRolloverTimerId = null;
        await this.discoverCurrentMarket();
      }, this.postRolloverDelayMs);
    } else {
      await this.discoverCurrentMarket();
    }
  }

  /**
   * Start automatic market discovery.
   */
  start(options: DiscoveryStartOptions = {}): void {
    if (this.running) {
      return;
    }

    this.checkIntervalMs = options.checkIntervalMs || 30_000;
    this.prefetchBeforeMs =
      options.prefetchBeforeMs || DEFAULT_PREFETCH_WINDOW_MS;
    this.postRolloverDelayMs = options.postRolloverDelayMs ?? 2_000;
    this.running = true;

    if (options.discoverImmediately !== false) {
      this.checkAndUpdate();
    }

    // Precise rollover scheduling instead of frequent polling
    this.scheduleRollover();

    // Keep a backup interval check (less frequent) in case setTimeout drift occurs
    this.checkTimerId = setInterval(() => {
      this.checkAndUpdate();
    }, 5 * 60 * 1000); // 5 minute backup check

    this.schedulePrefetch();
  }

  /**
   * Stop automatic market discovery.
   */
  stop(): void {
    this.running = false;

    if (this.checkTimerId) {
      clearInterval(this.checkTimerId);
      this.checkTimerId = null;
    }

    if (this.prefetchTimerId) {
      clearTimeout(this.prefetchTimerId);
      this.prefetchTimerId = null;
    }

    if (this.postRolloverTimerId) {
      clearTimeout(this.postRolloverTimerId);
      this.postRolloverTimerId = null;
    }

    this.clearRolloverTimer();
  }

  /**
   * Check if discovery is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the mapping store.
   */
  getStore(): MappingStore {
    return this.store;
  }

  /**
   * Get the current coin being tracked.
   */
  getCoin(): SupportedCoin {
    return this.coin;
  }

  /**
   * Get the configured venues.
   */
  getVenues(): Venue[] {
    return Array.from(this.venues);
  }

  /**
   * Initialize interval tracking. Must be called after direct discoverCurrentMarket() calls
   * to ensure subsequent checkAndUpdate() calls can detect rollovers.
   */
  initializeIntervalTracking(): void {
    if (!this.lastIntervalKey) {
      this.lastIntervalKey = intervalKeyToString(getIntervalKey());
      console.log("[MarketDiscovery] Initialized lastIntervalKey to:", this.lastIntervalKey);
    }
  }
}
