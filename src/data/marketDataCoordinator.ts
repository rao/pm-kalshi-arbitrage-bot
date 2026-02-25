/**
 * Market Data Coordinator.
 *
 * Orchestrates WebSocket subscriptions for both Polymarket and Kalshi,
 * handling subscription management and rollovers.
 *
 * No quote caching - events flow directly through callbacks.
 */

import type { IntervalKey } from "../time/interval";
import { intervalKeyToString, formatIntervalKey } from "../time/interval";
import type { IntervalMapping } from "../markets/mappingStore";
import {
  type QuoteUpdateEvent,
  type ConnectionState,
  type QuoteUpdateCallback,
  type ConnectionStateCallback,
} from "../normalization/types";
import {
  type MarketDiscovery,
  type DiscoveryEvent,
  type Venue,
  type DiscoveryEventCallback,
} from "../markets/discovery";
import { PolymarketWsClient, type PolymarketWsClientOptions } from "../venues/polymarket/ws";
import { KalshiWsClient, type KalshiWsClientOptions } from "../venues/kalshi/ws";
import {
  BinanceWsClient,
  type BinanceWsClientOptions,
} from "./binanceWs";
import type { BtcPriceUpdate, BtcPriceCallback } from "./binanceWs";

/**
 * Coordinator events for external monitoring.
 */
export type CoordinatorEvent =
  | {
      type: "ROLLOVER_STARTED";
      oldInterval: IntervalKey;
      newInterval: IntervalKey;
    }
  | {
      type: "ROLLOVER_COMPLETED";
      newInterval: IntervalKey;
    }
  | {
      type: "CONNECTION_STATE";
      venue: Venue;
      state: ConnectionState;
    }
  | {
      type: "SUBSCRIPTION_ACTIVE";
      venue: Venue;
      intervalKey: IntervalKey;
    }
  | {
      type: "ERROR";
      venue: Venue;
      error: Error;
      context: string;
    };

export type CoordinatorEventCallback = (event: CoordinatorEvent) => void;

/**
 * Callbacks for canceling orders on rollover.
 */
export interface OrderCancellationCallbacks {
  /** Cancel all Kalshi orders for a market ticker. Returns number of orders canceled. */
  cancelKalshiOrders?: (ticker: string) => Promise<number>;
  /** Cancel all Polymarket orders for the given token IDs. */
  cancelPolymarketOrders?: (upToken: string, downToken: string) => Promise<void>;
}

/**
 * Options for MarketDataCoordinator.
 */
export interface MarketDataCoordinatorOptions {
  /** MarketDiscovery instance */
  discovery: MarketDiscovery;
  /** Polymarket WebSocket client options (optional - skips if not provided) */
  polymarketWsOptions?: PolymarketWsClientOptions;
  /** Kalshi WebSocket client options (required for Kalshi) */
  kalshiWsOptions?: KalshiWsClientOptions;
  /** Enable debug logging */
  debug?: boolean;
  /** Delay after rollover before reconnecting (default: 5000ms) */
  rolloverReconnectDelayMs?: number;
  /** Callbacks for canceling orders on rollover */
  orderCancellation?: OrderCancellationCallbacks;
  /** Enable Binance BTC price feed (default: true when polymarket venue is active) */
  enableBtcPriceFeed?: boolean;
  /** Binance WS client options */
  binanceWsOptions?: BinanceWsClientOptions;
}

/**
 * Market Data Coordinator.
 *
 * Orchestrates real-time market data subscriptions across venues,
 * handling rollovers and forwarding quote events.
 *
 * Design principle: No caching. Quotes flow directly through callbacks.
 */
export class MarketDataCoordinator {
  private discovery: MarketDiscovery;
  private polymarketWs: PolymarketWsClient | null = null;
  private kalshiWs: KalshiWsClient | null = null;
  private btcPriceClient: BinanceWsClient | null = null;
  private debug: boolean;
  private rolloverReconnectDelayMs: number;
  private orderCancellation: OrderCancellationCallbacks | undefined;

  private running = false;
  private currentInterval: IntervalKey | null = null;

  // Current subscription identifiers
  private currentPolyUpToken: string | null = null;
  private currentPolyDownToken: string | null = null;
  private currentKalshiTicker: string | null = null;
  private currentKalshiSid: number | null = null;

  // Prefetched mapping reference
  private prefetchedInterval: IntervalKey | null = null;

  // Pending subscription state (for deferred subscription after rollover)
  private pendingSubscriptionInterval: IntervalKey | null = null;

  // Pending Kalshi-only subscription (when Polymarket subscribed but Kalshi wasn't available)
  private pendingKalshiSubscription: IntervalKey | null = null;

  // Pending Polymarket-only subscription (when Kalshi subscribed but Polymarket wasn't available)
  private pendingPolymarketSubscription: IntervalKey | null = null;

  private quoteCallbacks: QuoteUpdateCallback[] = [];
  private eventCallbacks: CoordinatorEventCallback[] = [];
  private btcPriceCallbacks: BtcPriceCallback[] = [];
  private discoveryCallback: DiscoveryEventCallback | null = null;

  constructor(options: MarketDataCoordinatorOptions) {
    this.discovery = options.discovery;
    this.debug = options.debug || false;
    this.rolloverReconnectDelayMs = options.rolloverReconnectDelayMs ?? 5000;
    this.orderCancellation = options.orderCancellation;

    // Initialize venue clients based on options
    const venues = this.discovery.getVenues();

    if (venues.includes("polymarket") && options.polymarketWsOptions) {
      this.polymarketWs = new PolymarketWsClient({
        ...options.polymarketWsOptions,
        debug: options.debug,
      });
    } else if (venues.includes("polymarket")) {
      // Create with default options
      this.polymarketWs = new PolymarketWsClient({ debug: options.debug });
    }

    if (venues.includes("kalshi") && options.kalshiWsOptions) {
      this.kalshiWs = new KalshiWsClient({
        ...options.kalshiWsOptions,
        debug: options.debug,
      });
    }

    // Initialize Binance WS client for BTC price feed (continuous, not tied to intervals)
    const enableBtcPriceFeed = options.enableBtcPriceFeed ?? venues.includes("polymarket");
    if (enableBtcPriceFeed) {
      this.btcPriceClient = new BinanceWsClient({
        ...options.binanceWsOptions,
        debug: options.debug,
        enableOrderBook: true,
      });
    }
  }

  /**
   * Register a callback for quote updates.
   */
  onQuote(callback: QuoteUpdateCallback): void {
    this.quoteCallbacks.push(callback);
  }

  /**
   * Remove a quote callback.
   */
  offQuote(callback: QuoteUpdateCallback): void {
    const index = this.quoteCallbacks.indexOf(callback);
    if (index !== -1) {
      this.quoteCallbacks.splice(index, 1);
    }
  }

  /**
   * Register a callback for coordinator events.
   */
  onEvent(callback: CoordinatorEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /**
   * Remove an event callback.
   */
  offEvent(callback: CoordinatorEventCallback): void {
    const index = this.eventCallbacks.indexOf(callback);
    if (index !== -1) {
      this.eventCallbacks.splice(index, 1);
    }
  }

  /**
   * Register a callback for BTC price updates from RTDS.
   */
  onBtcPrice(callback: BtcPriceCallback): void {
    this.btcPriceCallbacks.push(callback);
  }

  /**
   * Remove a BTC price callback.
   */
  offBtcPrice(callback: BtcPriceCallback): void {
    const index = this.btcPriceCallbacks.indexOf(callback);
    if (index !== -1) {
      this.btcPriceCallbacks.splice(index, 1);
    }
  }

  /**
   * Get the latest cached BTC price (synchronous).
   */
  getLatestBtcPrice(): BtcPriceUpdate | null {
    return this.btcPriceClient?.getLatestPrice() ?? null;
  }

  /**
   * Get the BTC price client (for testing/debugging).
   */
  getBtcPriceClient(): BinanceWsClient | null {
    return this.btcPriceClient;
  }

  /**
   * Check if the coordinator is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Start the coordinator.
   *
   * Connects WebSockets, discovers markets, and subscribes.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.log("Starting coordinator");

    // Set up discovery event listener
    this.discoveryCallback = (event: DiscoveryEvent) => {
      this.handleDiscoveryEvent(event);
    };
    this.discovery.onEvent(this.discoveryCallback);

    // Connect WebSocket clients
    const connectPromises: Promise<void>[] = [];

    if (this.polymarketWs) {
      // Forward quote events
      this.polymarketWs.onQuoteUpdate((event) => this.forwardQuote(event));
      // Track state changes
      this.polymarketWs.onStateChange((state) => {
        this.emitEvent({ type: "CONNECTION_STATE", venue: "polymarket", state });
      });
      connectPromises.push(
        this.polymarketWs.connect().catch((error) => {
          this.emitEvent({
            type: "ERROR",
            venue: "polymarket",
            error: error instanceof Error ? error : new Error(String(error)),
            context: "connect",
          });
        })
      );
    }

    if (this.kalshiWs) {
      // Forward quote events
      this.kalshiWs.onQuoteUpdate((event) => this.forwardQuote(event));
      // Track state changes
      this.kalshiWs.onStateChange((state) => {
        this.emitEvent({ type: "CONNECTION_STATE", venue: "kalshi", state });
      });
      connectPromises.push(
        this.kalshiWs.connect().catch((error) => {
          this.emitEvent({
            type: "ERROR",
            venue: "kalshi",
            error: error instanceof Error ? error : new Error(String(error)),
            context: "connect",
          });
        })
      );
    }

    // Connect Binance WS (BTC price feed — continuous, not tied to intervals)
    if (this.btcPriceClient) {
      this.btcPriceClient.onPriceUpdate((update) => {
        for (const callback of this.btcPriceCallbacks) {
          try {
            callback(update);
          } catch (error) {
            console.error("Error in BTC price callback:", error);
          }
        }
      });
      this.btcPriceClient.onStateChange((state) => {
        this.log("Binance WS connection state:", state);
      });
      connectPromises.push(
        this.btcPriceClient.connect().catch((error) => {
          this.log("Binance WS connect failed (non-fatal):", error);
        })
      );
    }

    // Wait for connections
    await Promise.all(connectPromises);

    // Start discovery if not already running
    if (!this.discovery.isRunning()) {
      this.discovery.start({ discoverImmediately: false }); // Don't discover immediately - we'll await it
    }

    // Perform initial discovery and wait for it to complete
    console.log("[MarketDataCoordinator] Waiting for initial market discovery...");
    const initialMapping = await this.discovery.discoverCurrentMarket();

    // CRITICAL: Initialize interval tracking so rollovers are detected
    // This must be called after direct discoverCurrentMarket() calls since we use discoverImmediately: false
    this.discovery.initializeIntervalTracking();

    if (initialMapping) {
      console.log("[MarketDataCoordinator] Initial discovery complete, subscribing...");
      await this.subscribeToCurrentMarkets();
    } else {
      console.log("[MarketDataCoordinator] Initial discovery found no markets, will retry via MARKET_DISCOVERED events");
    }
  }

  /**
   * Stop the coordinator.
   *
   * Unsubscribes and disconnects all WebSocket clients.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.log("Stopping coordinator");

    // Remove discovery listener
    if (this.discoveryCallback) {
      this.discovery.offEvent(this.discoveryCallback);
      this.discoveryCallback = null;
    }

    // Unsubscribe and disconnect
    const disconnectPromises: Promise<void>[] = [];

    if (this.polymarketWs) {
      disconnectPromises.push(
        this.polymarketWs.unsubscribeAll().then(() => this.polymarketWs!.disconnect())
      );
    }

    if (this.kalshiWs) {
      disconnectPromises.push(
        this.kalshiWs.unsubscribeAll().then(() => this.kalshiWs!.disconnect())
      );
    }

    // Disconnect Binance WS (continuous feed, no unsubscribe needed)
    if (this.btcPriceClient) {
      disconnectPromises.push(this.btcPriceClient.disconnect());
    }

    await Promise.all(disconnectPromises);

    // Clear state
    this.currentInterval = null;
    this.currentPolyUpToken = null;
    this.currentPolyDownToken = null;
    this.currentKalshiTicker = null;
    this.currentKalshiSid = null;
    this.prefetchedInterval = null;
    this.pendingSubscriptionInterval = null;
    this.pendingKalshiSubscription = null;
    this.pendingPolymarketSubscription = null;
  }

  /**
   * Get the Polymarket WebSocket client (for testing/debugging).
   */
  getPolymarketWs(): PolymarketWsClient | null {
    return this.polymarketWs;
  }

  /**
   * Get the Kalshi WebSocket client (for testing/debugging).
   */
  getKalshiWs(): KalshiWsClient | null {
    return this.kalshiWs;
  }

  // Private methods

  private handleDiscoveryEvent(event: DiscoveryEvent): void {
    switch (event.type) {
      case "ROLLOVER":
        this.handleRollover(event.oldInterval, event.newInterval);
        break;

      case "PREFETCH_COMPLETED":
        if (event.success) {
          this.prefetchedInterval = event.intervalKey;
          this.log("Prefetch completed for", formatIntervalKey(event.intervalKey));
        }
        break;

      case "MARKET_DISCOVERED":
        // Check if this discovery fulfills a pending full subscription
        if (
          this.pendingSubscriptionInterval &&
          intervalKeyToString(event.intervalKey) === intervalKeyToString(this.pendingSubscriptionInterval)
        ) {
          const pendingInterval = this.pendingSubscriptionInterval;
          this.currentInterval = pendingInterval;
          this.pendingSubscriptionInterval = null;

          this.subscribeWithMapping(event.mapping).then(() => {
            // Set up pending subscriptions for venues that weren't in this mapping
            if (!event.mapping.kalshi && this.kalshiWs) {
              this.log("Kalshi mapping missing, deferring Kalshi subscription");
              this.pendingKalshiSubscription = pendingInterval;
            }
            if (!event.mapping.polymarket && this.polymarketWs) {
              this.log("Polymarket mapping missing, deferring Polymarket subscription");
              this.pendingPolymarketSubscription = pendingInterval;
            }

            this.emitEvent({
              type: "ROLLOVER_COMPLETED",
              newInterval: pendingInterval,
            });
          });
        }
        // Check if this is a Kalshi-only pending subscription (Polymarket already subscribed)
        else if (
          this.pendingKalshiSubscription &&
          intervalKeyToString(event.intervalKey) === intervalKeyToString(this.pendingKalshiSubscription) &&
          event.venue === "kalshi" &&
          event.mapping.kalshi
        ) {
          this.log("Pending Kalshi subscription fulfilled by MARKET_DISCOVERED");
          this.pendingKalshiSubscription = null;
          this.subscribeKalshiOnly(event.mapping);
        }
        // Check if this is a Polymarket-only pending subscription (Kalshi already subscribed)
        else if (
          this.pendingPolymarketSubscription &&
          intervalKeyToString(event.intervalKey) === intervalKeyToString(this.pendingPolymarketSubscription) &&
          event.venue === "polymarket" &&
          event.mapping.polymarket
        ) {
          this.log("Pending Polymarket subscription fulfilled by MARKET_DISCOVERED");
          this.pendingPolymarketSubscription = null;
          this.subscribePolymarketOnly(event.mapping);
        }
        // Fallback: If we don't have current subscriptions at all (initial startup)
        else if (!this.currentInterval && !this.pendingSubscriptionInterval) {
          this.subscribeToCurrentMarkets();
        }
        break;

      case "ERROR":
        this.emitEvent({
          type: "ERROR",
          venue: event.venue,
          error: event.error,
          context: event.context,
        });
        break;
    }
  }

  private async handleRollover(
    oldInterval: IntervalKey,
    newInterval: IntervalKey
  ): Promise<void> {
    console.log("[MarketDataCoordinator] Handling rollover:", formatIntervalKey(oldInterval), "->", formatIntervalKey(newInterval));

    this.emitEvent({
      type: "ROLLOVER_STARTED",
      oldInterval,
      newInterval,
    });

    // Step 0: Cancel all open orders for current interval (safety-critical)
    await this.cancelAllOrdersForCurrentInterval();

    // Clear subscription state
    this.pendingSubscriptionInterval = null;
    this.pendingKalshiSubscription = null;
    this.pendingPolymarketSubscription = null;

    // Save current market identifiers before clearing (needed for cancel-all)
    const polyUpToken = this.currentPolyUpToken;
    const polyDownToken = this.currentPolyDownToken;
    const kalshiTicker = this.currentKalshiTicker;

    this.currentInterval = null;
    this.currentPolyUpToken = null;
    this.currentPolyDownToken = null;
    this.currentKalshiTicker = null;
    this.currentKalshiSid = null;

    // Step 1: Clear subscriptions and disconnect both WebSocket clients
    console.log("[MarketDataCoordinator] Disconnecting WebSocket clients...");
    const disconnectPromises: Promise<void>[] = [];

    if (this.polymarketWs) {
      disconnectPromises.push(
        this.polymarketWs.unsubscribeAll()
          .then(() => this.polymarketWs!.disconnect())
          .catch((error) => {
            console.error("[MarketDataCoordinator] Error disconnecting Polymarket:", error);
          })
      );
    }

    if (this.kalshiWs) {
      disconnectPromises.push(
        this.kalshiWs.unsubscribeAll()
          .then(() => this.kalshiWs!.disconnect())
          .catch((error) => {
            console.error("[MarketDataCoordinator] Error disconnecting Kalshi:", error);
          })
      );
    }

    await Promise.all(disconnectPromises);
    console.log("[MarketDataCoordinator] WebSocket clients disconnected");

    // Step 2: Wait for venues to have new markets ready
    console.log(`[MarketDataCoordinator] Waiting ${this.rolloverReconnectDelayMs}ms before reconnecting...`);
    await new Promise((resolve) => setTimeout(resolve, this.rolloverReconnectDelayMs));

    // Step 3: Reconnect both WebSocket clients
    console.log("[MarketDataCoordinator] Reconnecting WebSocket clients...");
    const reconnectPromises: Promise<void>[] = [];

    if (this.polymarketWs) {
      reconnectPromises.push(
        this.polymarketWs.connect().catch((error) => {
          this.emitEvent({
            type: "ERROR",
            venue: "polymarket",
            error: error instanceof Error ? error : new Error(String(error)),
            context: "reconnect",
          });
        })
      );
    }

    if (this.kalshiWs) {
      reconnectPromises.push(
        this.kalshiWs.connect().catch((error) => {
          this.emitEvent({
            type: "ERROR",
            venue: "kalshi",
            error: error instanceof Error ? error : new Error(String(error)),
            context: "reconnect",
          });
        })
      );
    }

    await Promise.all(reconnectPromises);
    console.log("[MarketDataCoordinator] WebSocket clients reconnected");

    // Step 4: Discover current markets
    console.log("[MarketDataCoordinator] Discovering markets for new interval...");
    const mapping = await this.discovery.discoverCurrentMarket();

    if (mapping) {
      // Step 5: Subscribe to new markets
      console.log("[MarketDataCoordinator] Subscribing to new markets...");
      this.currentInterval = newInterval;
      await this.subscribeWithMapping(mapping);

      this.emitEvent({
        type: "ROLLOVER_COMPLETED",
        newInterval,
      });
      console.log("[MarketDataCoordinator] Rollover completed successfully");
    } else {
      console.error("[MarketDataCoordinator] Failed to discover markets after rollover");
      // Set pending so future MARKET_DISCOVERED events can trigger subscription
      this.pendingSubscriptionInterval = newInterval;
    }
  }

  private async subscribeToCurrentMarkets(): Promise<void> {
    const mapping = this.discovery.getStore().getCurrentMapping();
    if (!mapping) {
      this.log("No current mapping available - waiting for discovery");
      return;
    }

    this.currentInterval = mapping.intervalKey;
    await this.subscribeWithMapping(mapping);
  }

  /**
   * Subscribe to markets using a specific mapping.
   * Extracted to allow both subscribeToCurrentMarkets and handleRollover to share logic.
   */
  private async subscribeWithMapping(mapping: IntervalMapping): Promise<void> {
    // Subscribe to Polymarket
    if (this.polymarketWs && mapping.polymarket) {
      const { upToken, downToken } = mapping.polymarket;
      this.currentPolyUpToken = upToken;
      this.currentPolyDownToken = downToken;

      try {
        await this.polymarketWs.subscribe(upToken, downToken, mapping.intervalKey);
        this.emitEvent({
          type: "SUBSCRIPTION_ACTIVE",
          venue: "polymarket",
          intervalKey: mapping.intervalKey,
        });
        this.log("Subscribed to Polymarket:", upToken, downToken);
      } catch (error) {
        this.emitEvent({
          type: "ERROR",
          venue: "polymarket",
          error: error instanceof Error ? error : new Error(String(error)),
          context: "subscribe",
        });
      }
    }

    // Subscribe to Kalshi
    if (this.kalshiWs && mapping.kalshi) {
      const { marketTicker } = mapping.kalshi;
      this.currentKalshiTicker = marketTicker;

      try {
        const sid = await this.kalshiWs.subscribe(marketTicker, mapping.intervalKey);
        this.currentKalshiSid = sid;
        this.emitEvent({
          type: "SUBSCRIPTION_ACTIVE",
          venue: "kalshi",
          intervalKey: mapping.intervalKey,
        });
        this.log("Subscribed to Kalshi:", marketTicker, "SID:", sid);
      } catch (error) {
        this.emitEvent({
          type: "ERROR",
          venue: "kalshi",
          error: error instanceof Error ? error : new Error(String(error)),
          context: "subscribe",
        });
      }
    }
  }

  /**
   * Subscribe to Kalshi only (for late discovery after Polymarket already subscribed).
   */
  private async subscribeKalshiOnly(mapping: IntervalMapping): Promise<void> {
    if (!this.kalshiWs || !mapping.kalshi) {
      return;
    }

    const { marketTicker } = mapping.kalshi;
    this.currentKalshiTicker = marketTicker;

    try {
      const sid = await this.kalshiWs.subscribe(marketTicker, mapping.intervalKey);
      this.currentKalshiSid = sid;
      this.emitEvent({
        type: "SUBSCRIPTION_ACTIVE",
        venue: "kalshi",
        intervalKey: mapping.intervalKey,
      });
      this.log("Subscribed to Kalshi (late):", marketTicker, "SID:", sid);
    } catch (error) {
      this.emitEvent({
        type: "ERROR",
        venue: "kalshi",
        error: error instanceof Error ? error : new Error(String(error)),
        context: "subscribe",
      });
    }
  }

  /**
   * Subscribe to Polymarket only (for late discovery after Kalshi already subscribed).
   */
  private async subscribePolymarketOnly(mapping: IntervalMapping): Promise<void> {
    if (!this.polymarketWs || !mapping.polymarket) {
      return;
    }

    const { upToken, downToken } = mapping.polymarket;
    this.currentPolyUpToken = upToken;
    this.currentPolyDownToken = downToken;

    try {
      await this.polymarketWs.subscribe(upToken, downToken, mapping.intervalKey);
      this.emitEvent({
        type: "SUBSCRIPTION_ACTIVE",
        venue: "polymarket",
        intervalKey: mapping.intervalKey,
      });
      this.log("Subscribed to Polymarket (late):", upToken, downToken);
    } catch (error) {
      this.emitEvent({
        type: "ERROR",
        venue: "polymarket",
        error: error instanceof Error ? error : new Error(String(error)),
        context: "subscribe",
      });
    }
  }

  private async unsubscribeFromCurrentMarkets(): Promise<void> {
    const promises: Promise<void>[] = [];

    // Unsubscribe from Polymarket
    if (
      this.polymarketWs &&
      this.currentPolyUpToken &&
      this.currentPolyDownToken
    ) {
      promises.push(
        this.polymarketWs
          .unsubscribe(this.currentPolyUpToken, this.currentPolyDownToken)
          .catch((error) => {
            this.log("Error unsubscribing from Polymarket:", error);
          })
      );
      this.currentPolyUpToken = null;
      this.currentPolyDownToken = null;
    }

    // Unsubscribe from Kalshi
    if (this.kalshiWs && this.currentKalshiSid !== null) {
      promises.push(
        this.kalshiWs.unsubscribe(this.currentKalshiSid).catch((error) => {
          this.log("Error unsubscribing from Kalshi:", error);
        })
      );
      this.currentKalshiTicker = null;
      this.currentKalshiSid = null;
    }

    await Promise.all(promises);
  }

  /**
   * Cancel all open orders for the current interval.
   * Called before rollover to ensure no stale orders remain.
   */
  private async cancelAllOrdersForCurrentInterval(): Promise<void> {
    if (!this.orderCancellation) {
      this.log("No order cancellation callbacks configured, skipping cancel-all");
      return;
    }

    console.log("[MarketDataCoordinator] Canceling all orders for current interval...");

    const cancelPromises: Promise<void>[] = [];

    // Cancel Kalshi orders
    if (this.orderCancellation.cancelKalshiOrders && this.currentKalshiTicker) {
      const ticker = this.currentKalshiTicker;
      cancelPromises.push(
        this.orderCancellation.cancelKalshiOrders(ticker)
          .then((count) => {
            console.log(`[MarketDataCoordinator] Canceled ${count} Kalshi orders for ${ticker}`);
          })
          .catch((error) => {
            console.error(`[MarketDataCoordinator] Failed to cancel Kalshi orders for ${ticker}:`, error);
            this.emitEvent({
              type: "ERROR",
              venue: "kalshi",
              error: error instanceof Error ? error : new Error(String(error)),
              context: "cancel-all",
            });
          })
      );
    }

    // Cancel Polymarket orders
    if (
      this.orderCancellation.cancelPolymarketOrders &&
      this.currentPolyUpToken &&
      this.currentPolyDownToken
    ) {
      const upToken = this.currentPolyUpToken;
      const downToken = this.currentPolyDownToken;
      cancelPromises.push(
        this.orderCancellation.cancelPolymarketOrders(upToken, downToken)
          .then(() => {
            console.log(`[MarketDataCoordinator] Canceled Polymarket orders for tokens`);
          })
          .catch((error) => {
            console.error(`[MarketDataCoordinator] Failed to cancel Polymarket orders:`, error);
            this.emitEvent({
              type: "ERROR",
              venue: "polymarket",
              error: error instanceof Error ? error : new Error(String(error)),
              context: "cancel-all",
            });
          })
      );
    }

    await Promise.all(cancelPromises);
    console.log("[MarketDataCoordinator] Order cancellation complete");
  }

  private forwardQuote(event: QuoteUpdateEvent): void {
    for (const callback of this.quoteCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error("Error in quote callback:", error);
      }
    }
  }

  private emitEvent(event: CoordinatorEvent): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error("Error in coordinator event callback:", error);
      }
    }
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[MarketDataCoordinator]", ...args);
    }
  }
}
