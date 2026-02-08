/**
 * Binance Futures aggTrade WebSocket client for live BTC price data.
 *
 * Connects to wss://fstream.binance.com/ws/btcusdt@aggTrade and streams
 * real-time trade prices. No authentication or subscription message needed —
 * the stream is embedded in the URL path.
 *
 * Handles:
 * - Unsolicited pong keepalive every 5 minutes (Binance pings every ~3min)
 * - Pre-emptive reconnect at 23.5h (Binance forces disconnect at 24h)
 * - Automatic reconnect with exponential backoff on unexpected disconnects
 */

import type { ConnectionState, ConnectionStateCallback } from "../normalization/types";

/** BTC price update from WebSocket feed. */
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

/** Default Binance Futures aggTrade WebSocket URL. */
export const BINANCE_AGGTRADE_URL = "wss://fstream.binance.com/ws/btcusdt@aggTrade";

/** Options for BinanceWsClient. */
export interface BinanceWsClientOptions {
  /** WebSocket URL (defaults to production futures aggTrade) */
  wsUrl?: string;
  /** Reconnect delay in milliseconds (default: 5000) */
  reconnectDelayMs?: number;
  /** Maximum reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Pong keepalive interval in ms (default: 300000 = 5 minutes) */
  pongIntervalMs?: number;
  /** Pre-emptive reconnect before Binance 24h disconnect, in ms (default: 84600000 = 23.5h) */
  reconnectBeforeMs?: number;
}

/** Raw Binance aggTrade message. */
interface AggTradeMessage {
  /** Event type */
  e: string;
  /** Event time (ms) */
  E: number;
  /** Symbol */
  s: string;
  /** Price (string) */
  p: string;
  /** Quantity (string) */
  q: string;
  /** Aggregate trade ID */
  a: number;
  /** First trade ID */
  f: number;
  /** Last trade ID */
  l: number;
  /** Trade time (ms) */
  T: number;
  /** Is buyer the maker? */
  m: boolean;
}

/**
 * Binance Futures aggTrade WebSocket client.
 *
 * Streams real-time BTC/USDT aggregate trade data directly from Binance.
 * No authentication required.
 */
export class BinanceWsClient {
  private wsUrl: string;
  private reconnectDelayMs: number;
  private maxReconnectAttempts: number;
  private debug_: boolean;
  private pongIntervalMs: number;
  private reconnectBeforeMs: number;

  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setInterval> | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;

  private latestPrice: BtcPriceUpdate | null = null;
  private priceCallbacks: BtcPriceCallback[] = [];
  private stateCallbacks: ConnectionStateCallback[] = [];

  constructor(options: BinanceWsClientOptions = {}) {
    this.wsUrl = options.wsUrl || BINANCE_AGGTRADE_URL;
    this.reconnectDelayMs = options.reconnectDelayMs || 5000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.debug_ = options.debug || false;
    this.pongIntervalMs = options.pongIntervalMs || 300_000; // 5 minutes
    this.reconnectBeforeMs = options.reconnectBeforeMs || 84_600_000; // 23.5 hours
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

  /** Connect to the Binance aggTrade WebSocket stream. */
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

          // No subscription message needed — stream is in the URL path

          // Start pong keepalive
          this.startPong();

          // Start 23.5h session timer for pre-emptive reconnect
          this.startSessionTimer();

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
            reject(new Error("Binance WebSocket connection failed"));
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

  /** Disconnect from the Binance WebSocket stream. */
  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.stopPong();
    this.stopSessionTimer();

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
          console.error("Error in Binance state callback:", error);
        }
      }
    }
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data) as AggTradeMessage;

      // Only process aggTrade events
      if (msg.e !== "aggTrade") return;

      const price = parseFloat(msg.p);
      if (isNaN(price)) return;

      const tsLocal = Date.now();
      const update: BtcPriceUpdate = {
        symbol: "btcusdt",
        price,
        ts_exchange: msg.E,
        ts_local: tsLocal,
      };

      this.latestPrice = update;

      for (const callback of this.priceCallbacks) {
        try {
          callback(update);
        } catch (error) {
          console.error("Error in Binance price callback:", error);
        }
      }
    } catch {
      // Non-JSON messages (ping frames, etc.) — ignore silently
      return;
    }
  }

  private handleDisconnect(): void {
    this.ws = null;
    this.stopPong();
    this.stopSessionTimer();

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

  private startPong(): void {
    this.stopPong();
    this.pongTimer = setInterval(() => {
      if (this.ws && this.state === "connected") {
        try {
          this.ws.send("pong");
          this.log("Sent keepalive pong");
        } catch {
          this.log("Pong send failed");
        }
      }
    }, this.pongIntervalMs);
  }

  private stopPong(): void {
    if (this.pongTimer) {
      clearInterval(this.pongTimer);
      this.pongTimer = null;
    }
  }

  /** Pre-emptive reconnect at 23.5h to avoid Binance's 24h forced disconnect. */
  private startSessionTimer(): void {
    this.stopSessionTimer();
    this.sessionTimer = setTimeout(async () => {
      this.log("23.5h session limit approaching — pre-emptive reconnect");
      // Clean disconnect + immediate reconnect
      if (this.ws) {
        this.ws.onclose = null; // Prevent normal reconnect handling
        this.ws.close();
        this.ws = null;
      }
      this.stopPong();
      this.reconnectAttempts = 0; // Fresh reconnect attempt counter
      try {
        await this.connect();
      } catch (error) {
        this.log("Pre-emptive reconnect failed:", error);
        this.handleDisconnect();
      }
    }, this.reconnectBeforeMs);
  }

  private stopSessionTimer(): void {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
  }

  private log(...args: unknown[]): void {
    if (this.debug_) {
      console.log("[BinanceWS]", ...args);
    }
  }
}
