/**
 * Kalshi WebSocket client for real-time market data.
 *
 * Subscribes to orderbook updates and emits normalized quotes through callbacks.
 * Maintains internal orderbook state to apply deltas.
 */

import type { IntervalKey } from "../../time/interval";
import {
  type NormalizedQuote,
  type QuoteUpdateEvent,
  type ConnectionState,
  type QuoteUpdateCallback,
  type ConnectionStateCallback,
} from "../../normalization/types";
import {
  type KalshiOrderbookSnapshot,
  type KalshiOrderbookDelta,
  type KalshiWsMessage,
  type KalshiSubscribeCommand,
  type KalshiUnsubscribeCommand,
  type KalshiPriceLevel,
  KALSHI_WS_URL_PROD,
  KALSHI_WS_URL_DEMO,
} from "./wsTypes";
import {
  normalizeKalshiSnapshot,
  applyKalshiDelta,
  initializeBidsFromSnapshot,
  computeQuoteFromBids,
} from "../../normalization/normalizeKalshi";
import { type KalshiAuth, createKalshiAuth, type KalshiAuthHeaders } from "./auth";

/**
 * Options for KalshiWsClient.
 */
export interface KalshiWsClientOptions {
  /** Kalshi API key ID */
  apiKeyId: string;
  /** Path to private key file or PEM string */
  privateKey: string;
  /** WebSocket URL (defaults to production) */
  wsUrl?: string;
  /** Use demo environment (default: false) */
  demo?: boolean;
  /** Reconnect delay in milliseconds (default: 5000) */
  reconnectDelayMs?: number;
  /** Maximum reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Internal subscription state.
 */
interface Subscription {
  marketTicker: string;
  intervalKey: IntervalKey;
  subscriptionId: number | null;
  yesBids: KalshiPriceLevel[];
  noBids: KalshiPriceLevel[];
  currentQuote: NormalizedQuote | null;
  lastSeq: number;
}

/**
 * Pending command state.
 */
interface PendingCommand {
  resolve: (sid: number) => void;
  reject: (error: Error) => void;
  marketTicker: string;
}

/**
 * Kalshi WebSocket client.
 *
 * Handles connection management with RSA-PSS authentication,
 * subscriptions, orderbook state management, and quote normalization.
 */
export class KalshiWsClient {
  private apiKeyId: string;
  private privateKeySource: string;
  private wsUrl: string;
  private reconnectDelayMs: number;
  private maxReconnectAttempts: number;
  private debug: boolean;

  private auth: KalshiAuth | null = null;
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private messageId = 1;
  private subscriptions: Map<string, Subscription> = new Map();
  private subscriptionsBySid: Map<number, Subscription> = new Map();
  private pendingCommands: Map<number, PendingCommand> = new Map();

  private quoteCallbacks: QuoteUpdateCallback[] = [];
  private stateCallbacks: ConnectionStateCallback[] = [];

  constructor(options: KalshiWsClientOptions) {
    this.apiKeyId = options.apiKeyId;
    this.privateKeySource = options.privateKey;
    this.reconnectDelayMs = options.reconnectDelayMs || 5000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.debug = options.debug || false;

    // Determine WebSocket URL
    if (options.wsUrl) {
      this.wsUrl = options.wsUrl;
    } else if (options.demo) {
      this.wsUrl = KALSHI_WS_URL_DEMO;
    } else {
      this.wsUrl = KALSHI_WS_URL_PROD;
    }
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
   *
   * Includes RSA-PSS authentication handshake.
   */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    // Initialize auth if needed
    if (!this.auth) {
      this.auth = await createKalshiAuth(this.apiKeyId, this.privateKeySource);
    }

    // Get auth headers
    const headers = await this.auth.getWsHeaders();

    return new Promise((resolve, reject) => {
      this.setState("connecting");
      this.log("Connecting to", this.wsUrl);

      try {
        // Bun's WebSocket supports headers in the constructor
        this.ws = new WebSocket(this.wsUrl, {
          headers: headers as Record<string, string>,
        } as any);

        this.ws.onopen = () => {
          this.log("Connected");
          this.setState("connected");
          this.reconnectAttempts = 0;

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

    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }

    // Reject any pending commands
    for (const [id, pending] of this.pendingCommands) {
      pending.reject(new Error("Disconnected"));
    }
    this.pendingCommands.clear();

    this.setState("disconnected");
  }

  /**
   * Subscribe to a market's orderbook.
   *
   * @param marketTicker - Kalshi market ticker
   * @param intervalKey - The interval this subscription is for
   * @returns Subscription ID
   */
  async subscribe(
    marketTicker: string,
    intervalKey: IntervalKey
  ): Promise<number> {
    // Store subscription state (sid will be set when we get response)
    const sub: Subscription = {
      marketTicker,
      intervalKey,
      subscriptionId: null,
      yesBids: [],
      noBids: [],
      currentQuote: null,
      lastSeq: 0,
    };
    this.subscriptions.set(marketTicker, sub);

    if (this.state !== "connected" || !this.ws) {
      this.log("Not connected, subscription will be sent on connect");
      return -1; // Return -1 to indicate pending
    }

    return this.sendSubscribe(marketTicker);
  }

  /**
   * Unsubscribe from a market.
   *
   * @param subscriptionId - Subscription ID returned from subscribe
   */
  async unsubscribe(subscriptionId: number): Promise<void> {
    const sub = this.subscriptionsBySid.get(subscriptionId);
    if (sub) {
      this.subscriptions.delete(sub.marketTicker);
      this.subscriptionsBySid.delete(subscriptionId);
    }

    if (this.state !== "connected" || !this.ws) {
      return;
    }

    this.sendUnsubscribe(subscriptionId);
  }

  /**
   * Unsubscribe from all markets.
   */
  async unsubscribeAll(): Promise<void> {
    const sids = Array.from(this.subscriptionsBySid.keys());

    this.subscriptions.clear();
    this.subscriptionsBySid.clear();

    if (this.state === "connected" && this.ws && sids.length > 0) {
      const command: KalshiUnsubscribeCommand = {
        id: this.nextMessageId(),
        cmd: "unsubscribe",
        params: { sids },
      };
      this.ws.send(JSON.stringify(command));
      this.log("Unsubscribed from all markets");
    }
  }

  /**
   * Get the current quote for a market.
   */
  getQuote(marketTicker: string): NormalizedQuote | null {
    const sub = this.subscriptions.get(marketTicker);
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

  private nextMessageId(): number {
    return this.messageId++;
  }

  private async sendSubscribe(marketTicker: string): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("Not connected"));
        return;
      }

      const id = this.nextMessageId();
      const command: KalshiSubscribeCommand = {
        id,
        cmd: "subscribe",
        params: {
          channels: ["orderbook_delta"],
          market_tickers: [marketTicker],
        },
      };

      this.pendingCommands.set(id, {
        resolve,
        reject,
        marketTicker,
      });

      this.ws.send(JSON.stringify(command));
      this.log("Subscribing to market:", marketTicker);
    });
  }

  private sendUnsubscribe(subscriptionId: number): void {
    if (!this.ws) return;

    const command: KalshiUnsubscribeCommand = {
      id: this.nextMessageId(),
      cmd: "unsubscribe",
      params: { sids: [subscriptionId] },
    };
    this.ws.send(JSON.stringify(command));
    this.log("Unsubscribed from SID:", subscriptionId);
  }

  private async resubscribeAll(): Promise<void> {
    // Clear old SID mappings
    this.subscriptionsBySid.clear();

    for (const sub of this.subscriptions.values()) {
      sub.subscriptionId = null;
      sub.yesBids = [];
      sub.noBids = [];
      sub.currentQuote = null;
      sub.lastSeq = 0;

      try {
        const sid = await this.sendSubscribe(sub.marketTicker);
        sub.subscriptionId = sid;
        this.subscriptionsBySid.set(sid, sub);
      } catch (error) {
        this.log("Failed to resubscribe to", sub.marketTicker, error);
      }
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as KalshiWsMessage;

      switch (message.type) {
        case "subscribed":
          this.handleSubscribed(message);
          break;
        case "orderbook_snapshot":
          this.handleSnapshot(message);
          break;
        case "orderbook_delta":
          this.handleDelta(message);
          break;
        case "error":
          this.handleError(message);
          break;
        case "unsubscribed":
        case "ok":
          // Acknowledgments, no action needed
          break;
      }
    } catch (error) {
      this.log("Error parsing message:", error);
    }
  }

  private handleSubscribed(message: { type: "subscribed"; id: number; msg: { sid: number; channel: string } }): void {
    const pending = this.pendingCommands.get(message.id);
    if (pending) {
      this.pendingCommands.delete(message.id);

      const sid = message.msg.sid;
      const sub = this.subscriptions.get(pending.marketTicker);
      if (sub) {
        sub.subscriptionId = sid;
        this.subscriptionsBySid.set(sid, sub);
      }

      pending.resolve(sid);
      this.log("Subscribed to", pending.marketTicker, "SID:", sid);
    }
  }

  private handleSnapshot(snapshot: KalshiOrderbookSnapshot): void {
    const sid = snapshot.sid;
    const sub = this.subscriptionsBySid.get(sid);

    if (!sub) {
      this.log("Received snapshot for unknown SID:", sid);
      return;
    }

    // Initialize orderbook state
    const { yesBids, noBids } = initializeBidsFromSnapshot(snapshot);
    sub.yesBids = yesBids;
    sub.noBids = noBids;
    sub.lastSeq = snapshot.seq;

    // Compute and emit quote
    const tsLocal = Date.now();
    const quote = normalizeKalshiSnapshot(snapshot, tsLocal);
    sub.currentQuote = quote;
    this.emitQuote(sub.intervalKey, quote);

    this.log("Received snapshot for", sub.marketTicker, "seq:", snapshot.seq);
  }

  private handleDelta(delta: KalshiOrderbookDelta): void {
    const sid = delta.sid;
    const sub = this.subscriptionsBySid.get(sid);

    if (!sub) {
      this.log("Received delta for unknown SID:", sid);
      return;
    }

    // Check sequence number
    if (delta.seq !== sub.lastSeq + 1) {
      this.log("Sequence gap detected:", sub.lastSeq, "->", delta.seq);
      // In production, you might want to request a new snapshot here
    }
    sub.lastSeq = delta.seq;

    // Apply delta and get new quote
    const tsLocal = Date.now();
    const result = applyKalshiDelta(sub.yesBids, sub.noBids, delta, tsLocal);

    sub.yesBids = result.yesBids;
    sub.noBids = result.noBids;
    sub.currentQuote = result.quote;

    this.emitQuote(sub.intervalKey, result.quote);
  }

  private handleError(message: { type: "error"; id?: number; msg: { code: number; msg: string } }): void {
    this.log("Received error:", message.msg.code, message.msg.msg);

    if (message.id) {
      const pending = this.pendingCommands.get(message.id);
      if (pending) {
        this.pendingCommands.delete(message.id);
        pending.reject(new Error(`Kalshi error ${message.msg.code}: ${message.msg.msg}`));
      }
    }
  }

  private emitQuote(intervalKey: IntervalKey, quote: NormalizedQuote): void {
    const event: QuoteUpdateEvent = {
      venue: "kalshi",
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

    // Reject any pending commands
    for (const [id, pending] of this.pendingCommands) {
      pending.reject(new Error("Disconnected"));
    }
    this.pendingCommands.clear();

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
      console.log("[KalshiWs]", ...args);
    }
  }
}
