/**
 * Polymarket WebSocket client for real-time market data.
 *
 * Subscribes to orderbook updates for UP/DOWN token pairs and
 * emits normalized quotes through callbacks.
 */

import type { IntervalKey } from "../../time/interval";
import {
  type NormalizedQuote,
  type QuoteUpdateEvent,
  type ConnectionState,
  type QuoteUpdateCallback,
  type ConnectionStateCallback,
  createEmptyQuote,
} from "../../normalization/types";
import {
  type PolyBookMessage,
  type PolyPriceChangeMessage,
  type PolyWsMessage,
  type PolySubscribeMessage,
  type PolyUnsubscribeMessage,
  POLYMARKET_WS_URL,
} from "./wsTypes";
import { normalizePolymarketBooks, applyPolymarketPriceChange } from "../../normalization/normalizePolymarket";

/**
 * Options for PolymarketWsClient.
 */
export interface PolymarketWsClientOptions {
  /** WebSocket URL (defaults to production) */
  wsUrl?: string;
  /** Reconnect delay in milliseconds (default: 5000) */
  reconnectDelayMs?: number;
  /** Maximum reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Timeout for receiving both books after subscription (default: 10000ms) */
  bookTimeoutMs?: number;
}

/**
 * Internal subscription state.
 */
interface Subscription {
  upTokenId: string;
  downTokenId: string;
  intervalKey: IntervalKey;
  upBook: PolyBookMessage | null;
  downBook: PolyBookMessage | null;
  currentQuote: NormalizedQuote | null;
  /** Timestamp when subscription was initiated */
  subscribedAt: number;
  /** Whether UP book has been received since subscription */
  upBookReceived: boolean;
  /** Whether DOWN book has been received since subscription */
  downBookReceived: boolean;
}

/**
 * Polymarket WebSocket client.
 *
 * Handles connection management, subscriptions, and quote normalization.
 */
export class PolymarketWsClient {
  private wsUrl: string;
  private reconnectDelayMs: number;
  private maxReconnectAttempts: number;
  private debug: boolean;
  private bookTimeoutMs: number;

  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private subscriptions: Map<string, Subscription> = new Map();
  private quoteCallbacks: QuoteUpdateCallback[] = [];
  private stateCallbacks: ConnectionStateCallback[] = [];

  // Diagnostic tracking for unmatched asset IDs
  private recentUnmatchedAssetIds: Set<string> = new Set();
  private lastUnmatchedLogTime: number = 0;

  // Staleness detection
  private stalenessCheckInterval: ReturnType<typeof setInterval> | null = null;
  private readonly STALENESS_THRESHOLD_MS = 30_000; // 30 seconds without quotes = stale

  constructor(options: PolymarketWsClientOptions = {}) {
    this.wsUrl = options.wsUrl || POLYMARKET_WS_URL;
    this.reconnectDelayMs = options.reconnectDelayMs || 5000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.debug = options.debug || false;
    this.bookTimeoutMs = options.bookTimeoutMs || 10_000;
  }

  /**
   * Get current connection state.
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Register a callback for quote updates.
   */
  onQuoteUpdate(callback: QuoteUpdateCallback): void {
    this.quoteCallbacks.push(callback);
  }

  /**
   * Remove a quote update callback.
   */
  offQuoteUpdate(callback: QuoteUpdateCallback): void {
    const index = this.quoteCallbacks.indexOf(callback);
    if (index !== -1) {
      this.quoteCallbacks.splice(index, 1);
    }
  }

  /**
   * Register a callback for connection state changes.
   */
  onStateChange(callback: ConnectionStateCallback): void {
    this.stateCallbacks.push(callback);
  }

  /**
   * Remove a state change callback.
   */
  offStateChange(callback: ConnectionStateCallback): void {
    const index = this.stateCallbacks.indexOf(callback);
    if (index !== -1) {
      this.stateCallbacks.splice(index, 1);
    }
  }

  /**
   * Connect to the WebSocket server.
   */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    return new Promise((resolve, reject) => {
      this.setState("connecting");
      this.log("Connecting to", this.wsUrl);

      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          this.log("Connected");
          this.setState("connected");
          this.reconnectAttempts = 0;

          // Start staleness detection
          this.startStalenessChecker();

          // Re-subscribe to any existing subscriptions
          this.resubscribeAll();

          resolve();
        };

        this.ws.onclose = (event) => {
          this.log("Connection closed:", event.code, event.reason);
          this.handleDisconnect();
        };

        this.ws.onerror = (error) => {
          this.log("WebSocket error:", error);
          if (this.state === "connecting") {
            this.setState("error");
            reject(new Error("WebSocket connection failed"));
          }
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        this.setState("error");
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server.
   */
  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.stopStalenessChecker();

    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }

    this.setState("disconnected");
  }

  /**
   * Subscribe to a market's UP/DOWN token pair.
   *
   * @param upTokenId - Token ID for the UP outcome
   * @param downTokenId - Token ID for the DOWN outcome
   * @param intervalKey - The interval this subscription is for
   */
  async subscribe(
    upTokenId: string,
    downTokenId: string,
    intervalKey: IntervalKey
  ): Promise<void> {
    const key = this.getSubscriptionKey(upTokenId, downTokenId);

    // Store subscription state
    this.subscriptions.set(key, {
      upTokenId,
      downTokenId,
      intervalKey,
      upBook: null,
      downBook: null,
      currentQuote: null,
      subscribedAt: Date.now(),
      upBookReceived: false,
      downBookReceived: false,
    });

    if (this.state !== "connected" || !this.ws) {
      this.log("Not connected, subscription will be sent on connect");
      return;
    }

    this.sendSubscribe(upTokenId, downTokenId);

    // Schedule timeout check
    setTimeout(() => this.checkBookTimeout(key), this.bookTimeoutMs);
  }

  /**
   * Unsubscribe from a market's token pair.
   */
  async unsubscribe(upTokenId: string, downTokenId: string): Promise<void> {
    const key = this.getSubscriptionKey(upTokenId, downTokenId);
    this.subscriptions.delete(key);

    if (this.state !== "connected" || !this.ws) {
      return;
    }

    this.sendUnsubscribe(upTokenId, downTokenId);
  }

  /**
   * Unsubscribe from all markets.
   */
  async unsubscribeAll(): Promise<void> {
    const allTokens: string[] = [];
    for (const sub of this.subscriptions.values()) {
      allTokens.push(sub.upTokenId, sub.downTokenId);
    }

    this.subscriptions.clear();

    if (this.state === "connected" && this.ws && allTokens.length > 0) {
      const message: PolyUnsubscribeMessage = {
        assets_ids: allTokens,
        operation: "unsubscribe",
      };
      this.ws.send(JSON.stringify(message));
      this.log("Unsubscribed from all tokens");
    }
  }

  /**
   * Get the current quote for a subscription.
   */
  getQuote(upTokenId: string, downTokenId: string): NormalizedQuote | null {
    const key = this.getSubscriptionKey(upTokenId, downTokenId);
    const sub = this.subscriptions.get(key);
    return sub?.currentQuote || null;
  }

  // Private methods

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      for (const callback of this.stateCallbacks) {
        try {
          callback(state);
        } catch (error) {
          console.error("Error in state callback:", error);
        }
      }
    }
  }

  private getSubscriptionKey(upTokenId: string, downTokenId: string): string {
    return `${upTokenId}:${downTokenId}`;
  }

  private sendSubscribe(upTokenId: string, downTokenId: string): void {
    if (!this.ws) return;

    const message: PolySubscribeMessage = {
      assets_ids: [upTokenId, downTokenId],
      type: "MARKET",
    };
    this.ws.send(JSON.stringify(message));
    this.log("Subscribed to tokens:", upTokenId, downTokenId);
  }

  private sendUnsubscribe(upTokenId: string, downTokenId: string): void {
    if (!this.ws) return;

    const message: PolyUnsubscribeMessage = {
      assets_ids: [upTokenId, downTokenId],
      operation: "unsubscribe",
    };
    this.ws.send(JSON.stringify(message));
    this.log("Unsubscribed from tokens:", upTokenId, downTokenId);
  }

  private resubscribeAll(): void {
    for (const [key, sub] of this.subscriptions.entries()) {
      // Reset book received flags on resubscribe
      sub.upBookReceived = false;
      sub.downBookReceived = false;
      sub.subscribedAt = Date.now();
      this.sendSubscribe(sub.upTokenId, sub.downTokenId);
      // Schedule timeout check
      setTimeout(() => this.checkBookTimeout(key), this.bookTimeoutMs);
    }
  }

  /**
   * Check if both books have been received within the timeout period.
   * If not, re-send the subscription request.
   */
  private checkBookTimeout(subscriptionKey: string): void {
    const sub = this.subscriptions.get(subscriptionKey);
    if (!sub) return;

    if (!sub.upBookReceived || !sub.downBookReceived) {
      this.log(
        `Book timeout for ${subscriptionKey}: UP=${sub.upBookReceived}, DOWN=${sub.downBookReceived}`
      );

      // Re-send subscription request if still connected
      if (this.state === "connected" && this.ws) {
        this.sendSubscribe(sub.upTokenId, sub.downTokenId);
        sub.subscribedAt = Date.now();
        setTimeout(() => this.checkBookTimeout(subscriptionKey), this.bookTimeoutMs);
      }
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as PolyWsMessage;

      if (message.event_type === "book") {
        this.handleBookMessage(message);
      } else if (message.event_type === "price_change") {
        this.handlePriceChangeMessage(message);
      }
      // Ignore other message types (tick_size_change, last_trade_price)
    } catch (error) {
      this.log("Error parsing message:", error);
    }
  }

  private handleBookMessage(book: PolyBookMessage): void {
    const assetId = book.asset_id;
    const tsLocal = Date.now();
    let matched = false;

    // Find which subscription this belongs to
    for (const [key, sub] of this.subscriptions.entries()) {
      let updated = false;

      if (sub.upTokenId === assetId) {
        sub.upBook = book;
        sub.upBookReceived = true;
        updated = true;
        matched = true;
        this.log(`Book received for UP token: ${assetId.slice(0, 16)}...`);
      } else if (sub.downTokenId === assetId) {
        sub.downBook = book;
        sub.downBookReceived = true;
        updated = true;
        matched = true;
        this.log(`Book received for DOWN token: ${assetId.slice(0, 16)}...`);
      }

      if (updated) {
        // Only emit when BOTH books have been received
        if (!sub.upBookReceived || !sub.downBookReceived) {
          this.log(
            `Waiting for both books before emitting quote (UP=${sub.upBookReceived}, DOWN=${sub.downBookReceived})`
          );
          break;
        }

        // Normalize and emit quote
        const quote = normalizePolymarketBooks(sub.upBook, sub.downBook, tsLocal);
        if (quote) {
          sub.currentQuote = quote;
          this.emitQuote(sub.intervalKey, quote);
        }
        break;
      }
    }

    // Log unmatched asset IDs for debugging
    if (!matched) {
      this.logUnmatchedAssetId(assetId, "book");
    }
  }

  private handlePriceChangeMessage(priceChange: PolyPriceChangeMessage): void {
    const tsLocal = Date.now();
    let matched = false;

    // Find which subscription this affects
    for (const sub of this.subscriptions.values()) {
      const hasUpChange = priceChange.price_changes.some(
        (pc) => pc.asset_id === sub.upTokenId
      );
      const hasDownChange = priceChange.price_changes.some(
        (pc) => pc.asset_id === sub.downTokenId
      );

      if (hasUpChange || hasDownChange) {
        matched = true;

        if (!sub.currentQuote) {
          // Log when price_change is dropped because currentQuote is null
          this.log(
            `price_change dropped: currentQuote is null (UP=${sub.upBookReceived}, DOWN=${sub.downBookReceived})`
          );
          continue;
        }

        // Apply delta to current quote
        const quote = applyPolymarketPriceChange(
          sub.currentQuote,
          priceChange,
          sub.upTokenId,
          sub.downTokenId,
          tsLocal
        );
        sub.currentQuote = quote;
        this.emitQuote(sub.intervalKey, quote);
      }
    }

    // Log unmatched price changes
    if (!matched) {
      const firstChange = priceChange.price_changes[0];
      if (firstChange) {
        this.logUnmatchedAssetId(firstChange.asset_id, "price_change");
      }
    }
  }

  private emitQuote(intervalKey: IntervalKey, quote: NormalizedQuote): void {
    const event: QuoteUpdateEvent = {
      venue: "polymarket",
      intervalKey,
      quote,
    };

    for (const callback of this.quoteCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error("Error in quote callback:", error);
      }
    }
  }

  private handleDisconnect(): void {
    this.ws = null;
    this.stopStalenessChecker();

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.setState("reconnecting");
      this.scheduleReconnect();
    } else {
      this.setState("error");
      this.log("Max reconnect attempts reached");
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const delay = this.reconnectDelayMs * Math.pow(2, this.reconnectAttempts);
    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect();
      } catch (error) {
        this.log("Reconnect failed:", error);
        this.handleDisconnect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[PolymarketWs]", ...args);
    }
  }

  /**
   * Log unmatched asset IDs for debugging.
   * Rate-limited to avoid spam.
   */
  private logUnmatchedAssetId(assetId: string, messageType: string): void {
    const now = Date.now();
    const isNew = !this.recentUnmatchedAssetIds.has(assetId);

    if (isNew || now - this.lastUnmatchedLogTime > 5000) {
      this.recentUnmatchedAssetIds.add(assetId);
      this.lastUnmatchedLogTime = now;

      const subscriptionTokens = Array.from(this.subscriptions.values())
        .map(sub => `UP:${sub.upTokenId.slice(0, 8)}... DOWN:${sub.downTokenId.slice(0, 8)}...`)
        .join(", ");

      console.warn(
        `[PolymarketWs] UNMATCHED ${messageType}: asset_id=${assetId.slice(0, 16)}... ` +
        `| Active subscriptions: [${subscriptionTokens || "none"}]`
      );
    }

    // Prevent memory leak
    if (this.recentUnmatchedAssetIds.size > 100) {
      this.recentUnmatchedAssetIds.clear();
    }
  }

  /**
   * Start staleness detection checker.
   * Periodically checks if quotes have become stale and resubscribes if needed.
   */
  private startStalenessChecker(): void {
    if (this.stalenessCheckInterval) return;

    this.stalenessCheckInterval = setInterval(() => {
      if (this.state !== "connected" || !this.ws) return;

      const now = Date.now();
      for (const [key, sub] of this.subscriptions.entries()) {
        // Only check subscriptions that have received both books
        if (!sub.upBookReceived || !sub.downBookReceived) continue;

        if (sub.currentQuote) {
          const staleness = now - sub.currentQuote.ts_local;
          if (staleness > this.STALENESS_THRESHOLD_MS) {
            console.warn(
              `[PolymarketWs] Subscription stale (${staleness}ms since last quote). ` +
              `Resubscribing to: UP=${sub.upTokenId.slice(0, 8)}... DOWN=${sub.downTokenId.slice(0, 8)}...`
            );

            // Reset book state and resubscribe
            sub.upBookReceived = false;
            sub.downBookReceived = false;
            sub.currentQuote = null;
            sub.subscribedAt = now;

            this.sendSubscribe(sub.upTokenId, sub.downTokenId);
            setTimeout(() => this.checkBookTimeout(key), this.bookTimeoutMs);
          }
        }
      }
    }, 10_000); // Check every 10 seconds
  }

  /**
   * Stop staleness detection checker.
   */
  private stopStalenessChecker(): void {
    if (this.stalenessCheckInterval) {
      clearInterval(this.stalenessCheckInterval);
      this.stalenessCheckInterval = null;
    }
  }
}
