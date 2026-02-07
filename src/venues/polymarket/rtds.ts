/**
 * Polymarket RTDS (Real-Time Data Socket) client for BTC price data.
 *
 * Connects to wss://ws-live-data.polymarket.com and subscribes to
 * Binance crypto_prices topic for btcusdt. No auth required.
 *
 * Separate from the CLOB orderbook WS (ws-subscriptions-clob).
 */

import type { ConnectionState, ConnectionStateCallback } from "../../normalization/types";

/** RTDS WebSocket URL. */
export const POLYMARKET_RTDS_URL = "wss://ws-live-data.polymarket.com";

/** BTC price update from RTDS. */
export interface BtcPriceUpdate {
  /** Symbol (e.g., "btcusdt") */
  symbol: string;
  /** BTC price in USD */
  price: number;
  /** Exchange timestamp (ms) */
  ts_exchange: number;
  /** Local receive timestamp (ms) */
  ts_local: number;
}

export type BtcPriceCallback = (update: BtcPriceUpdate) => void;

/** Raw RTDS message from Binance crypto_prices topic. */
interface RtdsMessage {
  topic: string;
  type: string;
  timestamp: number;
  payload: {
    symbol: string;
    timestamp: number;
    value: number;
  };
}

/** Options for PolymarketRtdsClient. */
export interface PolymarketRtdsClientOptions {
  /** WebSocket URL (defaults to production) */
  wsUrl?: string;
  /** Reconnect delay in milliseconds (default: 5000) */
  reconnectDelayMs?: number;
  /** Maximum reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Ping keepalive interval in ms (default: 5000) */
  pingIntervalMs?: number;
}

/**
 * Polymarket RTDS WebSocket client.
 *
 * Subscribes to Binance BTC/USDT prices via Polymarket's
 * real-time data socket. No authentication required.
 */
export class PolymarketRtdsClient {
  private wsUrl: string;
  private reconnectDelayMs: number;
  private maxReconnectAttempts: number;
  private debug: boolean;
  private pingIntervalMs: number;

  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private latestPrice: BtcPriceUpdate | null = null;
  private priceCallbacks: BtcPriceCallback[] = [];
  private stateCallbacks: ConnectionStateCallback[] = [];

  constructor(options: PolymarketRtdsClientOptions = {}) {
    this.wsUrl = options.wsUrl || POLYMARKET_RTDS_URL;
    this.reconnectDelayMs = options.reconnectDelayMs || 5000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.debug = options.debug || false;
    this.pingIntervalMs = options.pingIntervalMs || 5000;
  }

  /** Get current connection state. */
  getState(): ConnectionState {
    return this.state;
  }

  /** Get the latest cached BTC price (synchronous). */
  getLatestPrice(): BtcPriceUpdate | null {
    return this.latestPrice;
  }

  /** Register a callback for BTC price updates. */
  onPriceUpdate(callback: BtcPriceCallback): void {
    this.priceCallbacks.push(callback);
  }

  /** Remove a BTC price update callback. */
  offPriceUpdate(callback: BtcPriceCallback): void {
    const index = this.priceCallbacks.indexOf(callback);
    if (index !== -1) {
      this.priceCallbacks.splice(index, 1);
    }
  }

  /** Register a callback for connection state changes. */
  onStateChange(callback: ConnectionStateCallback): void {
    this.stateCallbacks.push(callback);
  }

  /** Remove a state change callback. */
  offStateChange(callback: ConnectionStateCallback): void {
    const index = this.stateCallbacks.indexOf(callback);
    if (index !== -1) {
      this.stateCallbacks.splice(index, 1);
    }
  }

  /** Connect to the RTDS WebSocket server. */
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

          // Subscribe to btcusdt prices
          this.sendSubscribe();

          // Start ping keepalive
          this.startPing();

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
            reject(new Error("RTDS WebSocket connection failed"));
          }
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data as string);
        };
      } catch (error) {
        this.setState("error");
        reject(error);
      }
    });
  }

  /** Disconnect from the RTDS WebSocket server. */
  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.stopPing();

    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }

    this.setState("disconnected");
  }

  // Private methods

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      for (const callback of this.stateCallbacks) {
        try {
          callback(state);
        } catch (error) {
          console.error("Error in RTDS state callback:", error);
        }
      }
    }
  }

  private sendSubscribe(): void {
    if (!this.ws) return;

    const message = {
      action: "subscribe",
      subscriptions: [
        {
          topic: "crypto_prices",
          type: "update",
          filters: JSON.stringify({ symbol: "btcusdt" }),
        },
      ],
    };
    this.ws.send(JSON.stringify(message));
    this.log("Subscribed to crypto_prices (btcusdt)");
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.state === "connected") {
        try {
          this.ws.send("ping");
        } catch {
          this.log("Ping failed");
        }
      }
    }, this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private handleMessage(data: string): void {
    // Ignore pong responses
    if (data === "pong" || data === "ping") return;

    try {
      const message = JSON.parse(data) as RtdsMessage;

      if (message.topic !== "crypto_prices") return;
      if (!message.payload || message.payload.symbol !== "btcusdt") return;
      if (typeof message.payload.value !== "number") return;

      const tsLocal = Date.now();
      const update: BtcPriceUpdate = {
        symbol: message.payload.symbol,
        price: message.payload.value,
        ts_exchange: message.payload.timestamp,
        ts_local: tsLocal,
      };

      this.latestPrice = update;

      for (const callback of this.priceCallbacks) {
        try {
          callback(update);
        } catch (error) {
          console.error("Error in RTDS price callback:", error);
        }
      }
    } catch {
      // Non-JSON messages (acks, empty frames) are expected after connect — ignore silently
      return;
    }
  }

  private handleDisconnect(): void {
    this.ws = null;
    this.stopPing();

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
      console.log("[PolymarketRTDS]", ...args);
    }
  }
}
