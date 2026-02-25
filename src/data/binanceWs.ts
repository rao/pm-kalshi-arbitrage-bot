/**
 * Binance WebSocket client for live BTC price data + local order book.
 *
 * Three independent connections:
 * 1. Futures aggTrade (wss://fstream.binance.com/ws/btcusdt@aggTrade) — real-time trade prices
 * 2. Spot depth (wss://stream.binance.com:9443/ws/btcusdt@depth@100ms) — diff depth + REST sync
 * 3. Aux combined (wss://stream.binance.com:9443/stream?streams=...) — bookTicker, depth5, USDC BBO
 *
 * The order book is maintained locally using Binance's diff depth + REST snapshot sync algorithm.
 *
 * Handles:
 * - Unsolicited pong keepalive every 5 minutes (Binance pings every ~3min)
 * - Pre-emptive reconnect at 23.5h (Binance forces disconnect at 24h)
 * - Automatic reconnect with exponential backoff on unexpected disconnects
 * - Order book sync state machine with gap detection and automatic resync
 */

import type { ConnectionState, ConnectionStateCallback } from "../normalization/types";

// ── Price types ──

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

// ── Order book types ──

/** Local order book state. */
export interface LocalOrderBook {
  bids: Map<string, string>; // price -> qty
  asks: Map<string, string>; // price -> qty
  lastUpdateId: number;
  lastUpdateTs: number;
}

/** Top-of-book snapshot derived from the local order book. */
export interface TopOfBook {
  bestBid: number;
  bestBidQty: number;
  bestAsk: number;
  bestAskQty: number;
  bidDepth: number; // number of bid levels
  askDepth: number; // number of ask levels
  spread: number;
  ts: number;
}

export type OrderBookCallback = (topOfBook: TopOfBook) => void;

// ── BookTicker / partial depth types ──

/** Best bid/offer update from bookTicker stream. */
export interface BookTickerUpdate {
  symbol: string;
  bestBid: number;
  bestBidQty: number;
  bestAsk: number;
  bestAskQty: number;
  ts_local: number;
}

/** Top-N depth snapshot from partial depth stream. */
export interface PartialDepthUpdate {
  bids: { price: number; qty: number }[];
  asks: { price: number; qty: number }[];
  lastUpdateId: number;
  ts_local: number;
}

export type BookTickerCallback = (update: BookTickerUpdate) => void;
export type PartialDepthCallback = (update: PartialDepthUpdate) => void;

/** Order book sync state machine states. */
type OrderBookSyncState = "IDLE" | "BUFFERING" | "SYNCING" | "SYNCED" | "RESYNCING";

/** Raw Binance diff depth stream event. */
interface DiffDepthEvent {
  e: "depthUpdate";
  E: number; // Event time
  s: string; // Symbol
  U: number; // First update ID in event
  u: number; // Final update ID in event
  b: [string, string][]; // Bids [price, qty]
  a: [string, string][]; // Asks [price, qty]
}

/** REST depth snapshot response. */
interface DepthSnapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

/** Raw Binance bookTicker event (BBO). */
interface RawBookTickerEvent {
  u: number;     // order book updateId
  s: string;     // symbol (e.g. "BTCUSDT")
  b: string;     // best bid price
  B: string;     // best bid qty
  a: string;     // best ask price
  A: string;     // best ask qty
}

/** Raw Binance partial depth event (depth5/depth10/depth20). */
interface RawPartialDepthEvent {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

/** Combined stream wrapper. */
interface CombinedStreamMessage {
  stream: string;
  data: unknown;
}

// ── Constants ──

/** Default Binance Futures aggTrade WebSocket URL. */
export const BINANCE_AGGTRADE_URL = "wss://fstream.binance.com/ws/btcusdt@aggTrade";

/** Default Binance REST API base URL. */
const BINANCE_REST_BASE = "https://api.binance.com";

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
  /** Enable local order book maintenance via depth stream (default: false) */
  enableOrderBook?: boolean;
  /** Depth stream update speed (default: "100ms") */
  depthUpdateSpeed?: "100ms" | "1000ms";
  /** REST API base URL for depth snapshots (default: "https://api.binance.com") */
  restApiBaseUrl?: string;
  /** Depth snapshot limit — number of levels to fetch (default: 1000) */
  depthSnapshotLimit?: number;
  /** Console print interval in ms for status line. -1 to disable (default: 5000) */
  printIntervalMs?: number;
  /** Periodic REST snapshot refresh interval in ms. -1 to disable (default: 60000) */
  snapshotRefreshIntervalMs?: number;
  /** Enable btcusdt@bookTicker stream — real-time BBO (default: false) */
  enableBookTicker?: boolean;
  /** Enable btcusdt@depth5@100ms stream — top 5 levels (default: false) */
  enableDepth5?: boolean;
  /** Enable usdcusdt@bookTicker stream — USDT/USD basis (default: false) */
  enableUsdcBookTicker?: boolean;
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
  // ── aggTrade config ──
  private wsUrl: string;
  private reconnectDelayMs: number;
  private maxReconnectAttempts: number;
  private debug_: boolean;
  private pongIntervalMs: number;
  private reconnectBeforeMs: number;

  // ── aggTrade state ──
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setInterval> | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;

  private latestPrice: BtcPriceUpdate | null = null;
  private priceCallbacks: BtcPriceCallback[] = [];
  private stateCallbacks: ConnectionStateCallback[] = [];

  // ── Order book config ──
  private enableOrderBook: boolean;
  private depthWsUrl: string;
  private restApiBaseUrl: string;
  private depthSnapshotLimit: number;
  private printIntervalMs: number;
  private snapshotRefreshIntervalMs: number;

  // ── Order book state ──
  private depthWs: WebSocket | null = null;
  private depthSyncState: OrderBookSyncState = "IDLE";
  private orderBook: LocalOrderBook | null = null;
  private depthBuffer: DiffDepthEvent[] = [];
  private latestTopOfBook: TopOfBook | null = null;
  private orderBookCallbacks: OrderBookCallback[] = [];

  // ── Depth WS resilience timers ──
  private depthReconnectAttempts = 0;
  private depthReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private depthPongTimer: ReturnType<typeof setInterval> | null = null;
  private depthSessionTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotRefreshTimer: ReturnType<typeof setInterval> | null = null;

  // ── Console print throttle ──
  private lastPrintTs = 0;

  // ── Aux stream config ──
  private enableBookTicker: boolean;
  private enableDepth5: boolean;
  private enableUsdcBookTicker: boolean;

  // ── Aux stream state ──
  private auxWs: WebSocket | null = null;
  private auxReconnectAttempts = 0;
  private auxReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private auxPongTimer: ReturnType<typeof setInterval> | null = null;
  private auxSessionTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Aux stream data + callbacks ──
  private latestBookTicker: BookTickerUpdate | null = null;
  private latestUsdcBookTicker: BookTickerUpdate | null = null;
  private latestDepth5: PartialDepthUpdate | null = null;

  private bookTickerCallbacks: BookTickerCallback[] = [];
  private depth5Callbacks: PartialDepthCallback[] = [];
  private usdcBookTickerCallbacks: BookTickerCallback[] = [];

  constructor(options: BinanceWsClientOptions = {}) {
    this.wsUrl = options.wsUrl || BINANCE_AGGTRADE_URL;
    this.reconnectDelayMs = options.reconnectDelayMs || 5000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.debug_ = options.debug || false;
    this.pongIntervalMs = options.pongIntervalMs || 300_000; // 5 minutes
    this.reconnectBeforeMs = options.reconnectBeforeMs || 84_600_000; // 23.5 hours

    // Order book options
    this.enableOrderBook = options.enableOrderBook || false;
    const speed = options.depthUpdateSpeed || "100ms";
    this.depthWsUrl = `wss://stream.binance.com:9443/ws/btcusdt@depth@${speed}`;
    this.restApiBaseUrl = options.restApiBaseUrl || BINANCE_REST_BASE;
    this.depthSnapshotLimit = options.depthSnapshotLimit || 1000;
    this.printIntervalMs = options.printIntervalMs ?? 5000;
    this.snapshotRefreshIntervalMs = options.snapshotRefreshIntervalMs ?? 60_000;

    // Aux stream options
    this.enableBookTicker = options.enableBookTicker || false;
    this.enableDepth5 = options.enableDepth5 || false;
    this.enableUsdcBookTicker = options.enableUsdcBookTicker || false;
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

  // ── Order book public API ──

  /** Register a callback for top-of-book updates. */
  onOrderBookUpdate(callback: OrderBookCallback): void {
    this.orderBookCallbacks.push(callback);
  }

  /** Remove an order book update callback. */
  offOrderBookUpdate(callback: OrderBookCallback): void {
    const index = this.orderBookCallbacks.indexOf(callback);
    if (index !== -1) {
      this.orderBookCallbacks.splice(index, 1);
    }
  }

  /** Get the latest top-of-book snapshot (synchronous). */
  getTopOfBook(): TopOfBook | null {
    return this.latestTopOfBook;
  }

  /** Get the full local order book (synchronous). */
  getOrderBook(): LocalOrderBook | null {
    return this.orderBook;
  }

  /** Get the current order book sync state. */
  getOrderBookSyncState(): OrderBookSyncState {
    return this.depthSyncState;
  }

  // ── BookTicker public API ──

  /** Register a callback for btcusdt bookTicker (BBO) updates. */
  onBookTicker(callback: BookTickerCallback): void {
    this.bookTickerCallbacks.push(callback);
  }

  /** Remove a bookTicker callback. */
  offBookTicker(callback: BookTickerCallback): void {
    const index = this.bookTickerCallbacks.indexOf(callback);
    if (index !== -1) this.bookTickerCallbacks.splice(index, 1);
  }

  /** Get the latest btcusdt bookTicker update (synchronous). */
  getLatestBookTicker(): BookTickerUpdate | null {
    return this.latestBookTicker;
  }

  // ── Depth5 public API ──

  /** Register a callback for depth5 (top 5 levels) updates. */
  onDepth5(callback: PartialDepthCallback): void {
    this.depth5Callbacks.push(callback);
  }

  /** Remove a depth5 callback. */
  offDepth5(callback: PartialDepthCallback): void {
    const index = this.depth5Callbacks.indexOf(callback);
    if (index !== -1) this.depth5Callbacks.splice(index, 1);
  }

  /** Get the latest depth5 update (synchronous). */
  getLatestDepth5(): PartialDepthUpdate | null {
    return this.latestDepth5;
  }

  // ── USDC BookTicker public API ──

  /** Register a callback for usdcusdt bookTicker updates. */
  onUsdcBookTicker(callback: BookTickerCallback): void {
    this.usdcBookTickerCallbacks.push(callback);
  }

  /** Remove a usdcusdt bookTicker callback. */
  offUsdcBookTicker(callback: BookTickerCallback): void {
    const index = this.usdcBookTickerCallbacks.indexOf(callback);
    if (index !== -1) this.usdcBookTickerCallbacks.splice(index, 1);
  }

  /** Get the latest usdcusdt bookTicker update (synchronous). */
  getLatestUsdcBookTicker(): BookTickerUpdate | null {
    return this.latestUsdcBookTicker;
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

          // Start depth stream if enabled
          if (this.enableOrderBook) {
            this.connectDepthStream();
          }

          // Start aux combined stream if any lightweight streams are enabled
          if (this.enableBookTicker || this.enableDepth5 || this.enableUsdcBookTicker) {
            this.connectAuxStream();
          }

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

    // Tear down depth stream
    this.teardownDepthStream();

    // Tear down aux stream
    this.teardownAuxStream();

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

  // ── Depth stream: connection ──

  private connectDepthStream(): void {
    if (this.depthWs) return;

    this.depthSyncState = "BUFFERING";
    this.depthBuffer = [];
    this.log("Depth: connecting to", this.depthWsUrl);

    try {
      this.depthWs = new WebSocket(this.depthWsUrl);

      this.depthWs.onopen = () => {
        this.log("Depth: connected, buffering events");
        this.depthReconnectAttempts = 0;
        this.startDepthPong();
        this.startDepthSessionTimer();

        // Kick off REST snapshot fetch
        this.fetchAndApplySnapshot();
      };

      this.depthWs.onclose = (event) => {
        this.log("Depth: connection closed:", event.code, event.reason);
        this.handleDepthDisconnect();
      };

      this.depthWs.onerror = (error) => {
        this.log("Depth: WebSocket error:", error);
      };

      this.depthWs.onmessage = (event) => {
        this.handleDepthMessage(event.data as string);
      };
    } catch (error) {
      this.log("Depth: connect failed:", error);
      this.scheduleDepthReconnect();
    }
  }

  private teardownDepthStream(): void {
    this.clearDepthReconnectTimer();
    this.stopDepthPong();
    this.stopDepthSessionTimer();
    this.stopSnapshotRefreshTimer();

    if (this.depthWs) {
      this.depthWs.onclose = null;
      this.depthWs.close();
      this.depthWs = null;
    }

    this.depthSyncState = "IDLE";
    this.orderBook = null;
    this.depthBuffer = [];
    this.latestTopOfBook = null;
  }

  // ── Depth stream: message handling & sync state machine ──

  private handleDepthMessage(data: string): void {
    try {
      const msg = JSON.parse(data) as DiffDepthEvent;
      if (msg.e !== "depthUpdate") return;

      switch (this.depthSyncState) {
        case "BUFFERING":
        case "SYNCING":
          // Buffer events until snapshot is applied
          this.depthBuffer.push(msg);
          break;

        case "SYNCED":
          this.applyDepthEventLive(msg);
          break;

        // IDLE, RESYNCING — ignore
      }
    } catch {
      // Non-JSON or malformed — ignore
    }
  }

  private async fetchAndApplySnapshot(): Promise<void> {
    this.depthSyncState = "SYNCING";
    const url = `${this.restApiBaseUrl}/api/v3/depth?symbol=BTCUSDT&limit=${this.depthSnapshotLimit}`;
    this.log("Depth: fetching snapshot from", url);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const snapshot = (await response.json()) as DepthSnapshot;

      // Initialize order book from snapshot
      const bids = new Map<string, string>();
      const asks = new Map<string, string>();
      for (const [price, qty] of snapshot.bids) {
        if (parseFloat(qty) > 0) bids.set(price, qty);
      }
      for (const [price, qty] of snapshot.asks) {
        if (parseFloat(qty) > 0) asks.set(price, qty);
      }

      this.orderBook = {
        bids,
        asks,
        lastUpdateId: snapshot.lastUpdateId,
        lastUpdateTs: Date.now(),
      };

      this.log("Depth: snapshot applied, lastUpdateId =", snapshot.lastUpdateId, `(${bids.size} bids, ${asks.size} asks)`);

      // Filter buffered events: drop any with u <= snapshot.lastUpdateId
      const relevant = this.depthBuffer.filter((e) => e.u > snapshot.lastUpdateId);
      this.depthBuffer = [];

      if (relevant.length === 0) {
        // No buffered events to apply — go straight to SYNCED
        this.depthSyncState = "SYNCED";
        this.log("Depth: SYNCED (no buffered events to replay)");
        this.emitTopOfBook();
        this.startSnapshotRefreshTimer();
        return;
      }

      // Validate first relevant event: U <= lastUpdateId+1 <= u
      const first = relevant[0]!;
      const expectedNext = snapshot.lastUpdateId + 1;
      if (first.U > expectedNext || first.u < expectedNext) {
        this.log("Depth: first buffered event fails validation — resyncing",
          `(U=${first.U}, u=${first.u}, expected=${expectedNext})`);
        this.resync();
        return;
      }

      // Apply buffered events
      for (const event of relevant) {
        this.applyDepthUpdate(event);
      }

      this.depthSyncState = "SYNCED";
      this.log("Depth: SYNCED after replaying", relevant.length, "buffered events");
      this.emitTopOfBook();
      this.startSnapshotRefreshTimer();
    } catch (error) {
      this.log("Depth: snapshot fetch failed:", error);
      this.resync();
    }
  }

  /** Apply a depth event in live (SYNCED) mode with gap detection. */
  private applyDepthEventLive(event: DiffDepthEvent): void {
    if (!this.orderBook) return;

    // Gap detection: event.U should be lastUpdateId + 1
    const expectedU = this.orderBook.lastUpdateId + 1;
    if (event.U !== expectedU) {
      this.log("Depth: gap detected — expected U =", expectedU, "got U =", event.U);
      this.resync();
      return;
    }

    this.applyDepthUpdate(event);
    this.emitTopOfBook();
  }

  /** Apply bid/ask updates from a depth event to the local book. */
  private applyDepthUpdate(event: DiffDepthEvent): void {
    if (!this.orderBook) return;

    for (const [price, qty] of event.b) {
      if (parseFloat(qty) === 0) {
        this.orderBook.bids.delete(price);
      } else {
        this.orderBook.bids.set(price, qty);
      }
    }

    for (const [price, qty] of event.a) {
      if (parseFloat(qty) === 0) {
        this.orderBook.asks.delete(price);
      } else {
        this.orderBook.asks.set(price, qty);
      }
    }

    this.orderBook.lastUpdateId = event.u;
    this.orderBook.lastUpdateTs = Date.now();
  }

  /** Resync: tear down depth stream and reconnect from scratch. */
  private resync(): void {
    this.log("Depth: resyncing...");
    this.depthSyncState = "RESYNCING";
    this.depthBuffer = [];
    this.orderBook = null;
    this.latestTopOfBook = null;

    this.stopDepthPong();
    this.stopDepthSessionTimer();
    this.stopSnapshotRefreshTimer();

    if (this.depthWs) {
      this.depthWs.onclose = null;
      this.depthWs.close();
      this.depthWs = null;
    }

    // Reconnect after a short delay
    this.depthReconnectTimer = setTimeout(() => {
      this.connectDepthStream();
    }, 1000);
  }

  // ── Depth stream: top-of-book computation & emission ──

  private computeTopOfBook(): TopOfBook | null {
    if (!this.orderBook) return null;

    let bestBid = -Infinity;
    let bestBidQty = 0;
    for (const [price, qty] of this.orderBook.bids) {
      const p = parseFloat(price);
      if (p > bestBid) {
        bestBid = p;
        bestBidQty = parseFloat(qty);
      }
    }

    let bestAsk = Infinity;
    let bestAskQty = 0;
    for (const [price, qty] of this.orderBook.asks) {
      const p = parseFloat(price);
      if (p < bestAsk) {
        bestAsk = p;
        bestAskQty = parseFloat(qty);
      }
    }

    if (bestBid === -Infinity || bestAsk === Infinity) return null;

    return {
      bestBid,
      bestBidQty,
      bestAsk,
      bestAskQty,
      bidDepth: this.orderBook.bids.size,
      askDepth: this.orderBook.asks.size,
      spread: bestAsk - bestBid,
      ts: Date.now(),
    };
  }

  private emitTopOfBook(): void {
    const tob = this.computeTopOfBook();
    if (!tob) return;

    this.latestTopOfBook = tob;

    for (const callback of this.orderBookCallbacks) {
      try {
        callback(tob);
      } catch (error) {
        console.error("Error in order book callback:", error);
      }
    }

    this.maybePrintStatus(tob);
  }

  // ── Console print (throttled) ──

  private maybePrintStatus(tob: TopOfBook): void {
    if (this.printIntervalMs < 0) return;

    const now = Date.now();
    if (now - this.lastPrintTs < this.printIntervalMs) return;
    this.lastPrintTs = now;

    const priceStr = this.latestPrice
      ? `$${this.latestPrice.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "N/A";

    const bidStr = tob.bestBid.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const askStr = tob.bestAsk.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const spreadStr = tob.spread.toFixed(2);

    console.log(
      `[BTC] ${priceStr} | Book: ${bidStr} / ${askStr} (spread: $${spreadStr}) [${tob.bidDepth} bids, ${tob.askDepth} asks]`
    );
  }

  // ── Depth stream: resilience (mirrors aggTrade pattern) ──

  private handleDepthDisconnect(): void {
    this.depthWs = null;
    this.stopDepthPong();
    this.stopDepthSessionTimer();

    if (this.depthReconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleDepthReconnect();
    } else {
      this.log("Depth: max reconnect attempts reached");
    }
  }

  private scheduleDepthReconnect(): void {
    this.clearDepthReconnectTimer();

    const delay = this.reconnectDelayMs * Math.pow(2, this.depthReconnectAttempts);
    this.log(`Depth: reconnecting in ${delay}ms (attempt ${this.depthReconnectAttempts + 1})`);

    this.depthReconnectTimer = setTimeout(() => {
      this.depthReconnectAttempts++;
      this.connectDepthStream();
    }, delay);
  }

  private clearDepthReconnectTimer(): void {
    if (this.depthReconnectTimer) {
      clearTimeout(this.depthReconnectTimer);
      this.depthReconnectTimer = null;
    }
  }

  private startDepthPong(): void {
    this.stopDepthPong();
    this.depthPongTimer = setInterval(() => {
      if (this.depthWs) {
        try {
          this.depthWs.send("pong");
          this.log("Depth: sent keepalive pong");
        } catch {
          this.log("Depth: pong send failed");
        }
      }
    }, this.pongIntervalMs);
  }

  private stopDepthPong(): void {
    if (this.depthPongTimer) {
      clearInterval(this.depthPongTimer);
      this.depthPongTimer = null;
    }
  }

  /** Periodically re-fetch a REST snapshot to correct any drift in the local book. */
  private startSnapshotRefreshTimer(): void {
    if (this.snapshotRefreshIntervalMs < 0) return;
    if (this.snapshotRefreshTimer) return; // already running

    this.snapshotRefreshTimer = setInterval(() => {
      this.log("Depth: periodic snapshot refresh");
      this.depthSyncState = "BUFFERING";
      this.depthBuffer = [];
      this.fetchAndApplySnapshot();
    }, this.snapshotRefreshIntervalMs);
  }

  private stopSnapshotRefreshTimer(): void {
    if (this.snapshotRefreshTimer) {
      clearInterval(this.snapshotRefreshTimer);
      this.snapshotRefreshTimer = null;
    }
  }

  private startDepthSessionTimer(): void {
    this.stopDepthSessionTimer();
    this.depthSessionTimer = setTimeout(() => {
      this.log("Depth: 23.5h session limit — pre-emptive reconnect");
      this.resync();
    }, this.reconnectBeforeMs);
  }

  private stopDepthSessionTimer(): void {
    if (this.depthSessionTimer) {
      clearTimeout(this.depthSessionTimer);
      this.depthSessionTimer = null;
    }
  }

  // ── Aux combined stream: connection ──

  private buildAuxStreamUrl(): string {
    const streams: string[] = [];
    if (this.enableBookTicker) streams.push("btcusdt@bookTicker");
    if (this.enableDepth5) streams.push("btcusdt@depth5@100ms");
    if (this.enableUsdcBookTicker) streams.push("usdcusdt@bookTicker");
    return `wss://stream.binance.com:9443/stream?streams=${streams.join("/")}`;
  }

  private connectAuxStream(): void {
    if (this.auxWs) return;

    const url = this.buildAuxStreamUrl();
    this.log("Aux: connecting to", url);

    try {
      this.auxWs = new WebSocket(url);

      this.auxWs.onopen = () => {
        this.log("Aux: connected");
        this.auxReconnectAttempts = 0;
        this.startAuxPong();
        this.startAuxSessionTimer();
      };

      this.auxWs.onclose = (event) => {
        this.log("Aux: connection closed:", event.code, event.reason);
        this.handleAuxDisconnect();
      };

      this.auxWs.onerror = (error) => {
        this.log("Aux: WebSocket error:", error);
      };

      this.auxWs.onmessage = (event) => {
        this.handleAuxMessage(event.data as string);
      };
    } catch (error) {
      this.log("Aux: connect failed:", error);
      this.scheduleAuxReconnect();
    }
  }

  private teardownAuxStream(): void {
    this.clearAuxReconnectTimer();
    this.stopAuxPong();
    this.stopAuxSessionTimer();

    if (this.auxWs) {
      this.auxWs.onclose = null;
      this.auxWs.close();
      this.auxWs = null;
    }

    this.latestBookTicker = null;
    this.latestUsdcBookTicker = null;
    this.latestDepth5 = null;
  }

  // ── Aux combined stream: message handling ──

  private handleAuxMessage(data: string): void {
    try {
      const msg = JSON.parse(data) as CombinedStreamMessage;
      if (!msg.stream || !msg.data) return;

      const tsLocal = Date.now();

      switch (msg.stream) {
        case "btcusdt@bookTicker": {
          const raw = msg.data as RawBookTickerEvent;
          const update: BookTickerUpdate = {
            symbol: raw.s.toLowerCase(),
            bestBid: parseFloat(raw.b),
            bestBidQty: parseFloat(raw.B),
            bestAsk: parseFloat(raw.a),
            bestAskQty: parseFloat(raw.A),
            ts_local: tsLocal,
          };
          this.latestBookTicker = update;
          for (const cb of this.bookTickerCallbacks) {
            try { cb(update); } catch (e) { console.error("Error in bookTicker callback:", e); }
          }
          break;
        }

        case "btcusdt@depth5@100ms": {
          const raw = msg.data as RawPartialDepthEvent;
          const update: PartialDepthUpdate = {
            bids: raw.bids.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
            asks: raw.asks.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
            lastUpdateId: raw.lastUpdateId,
            ts_local: tsLocal,
          };
          this.latestDepth5 = update;
          for (const cb of this.depth5Callbacks) {
            try { cb(update); } catch (e) { console.error("Error in depth5 callback:", e); }
          }
          break;
        }

        case "usdcusdt@bookTicker": {
          const raw = msg.data as RawBookTickerEvent;
          const update: BookTickerUpdate = {
            symbol: raw.s.toLowerCase(),
            bestBid: parseFloat(raw.b),
            bestBidQty: parseFloat(raw.B),
            bestAsk: parseFloat(raw.a),
            bestAskQty: parseFloat(raw.A),
            ts_local: tsLocal,
          };
          this.latestUsdcBookTicker = update;
          for (const cb of this.usdcBookTickerCallbacks) {
            try { cb(update); } catch (e) { console.error("Error in usdcBookTicker callback:", e); }
          }
          break;
        }
      }
    } catch {
      // Non-JSON or malformed — ignore
    }
  }

  // ── Aux combined stream: resilience ──

  private handleAuxDisconnect(): void {
    this.auxWs = null;
    this.stopAuxPong();
    this.stopAuxSessionTimer();

    if (this.auxReconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleAuxReconnect();
    } else {
      this.log("Aux: max reconnect attempts reached");
    }
  }

  private scheduleAuxReconnect(): void {
    this.clearAuxReconnectTimer();

    const delay = this.reconnectDelayMs * Math.pow(2, this.auxReconnectAttempts);
    this.log(`Aux: reconnecting in ${delay}ms (attempt ${this.auxReconnectAttempts + 1})`);

    this.auxReconnectTimer = setTimeout(() => {
      this.auxReconnectAttempts++;
      this.connectAuxStream();
    }, delay);
  }

  private clearAuxReconnectTimer(): void {
    if (this.auxReconnectTimer) {
      clearTimeout(this.auxReconnectTimer);
      this.auxReconnectTimer = null;
    }
  }

  private startAuxPong(): void {
    this.stopAuxPong();
    this.auxPongTimer = setInterval(() => {
      if (this.auxWs) {
        try {
          this.auxWs.send("pong");
          this.log("Aux: sent keepalive pong");
        } catch {
          this.log("Aux: pong send failed");
        }
      }
    }, this.pongIntervalMs);
  }

  private stopAuxPong(): void {
    if (this.auxPongTimer) {
      clearInterval(this.auxPongTimer);
      this.auxPongTimer = null;
    }
  }

  private startAuxSessionTimer(): void {
    this.stopAuxSessionTimer();
    this.auxSessionTimer = setTimeout(() => {
      this.log("Aux: 23.5h session limit — pre-emptive reconnect");
      // Clean teardown + reconnect
      this.stopAuxPong();
      if (this.auxWs) {
        this.auxWs.onclose = null;
        this.auxWs.close();
        this.auxWs = null;
      }
      this.auxReconnectAttempts = 0;
      this.connectAuxStream();
    }, this.reconnectBeforeMs);
  }

  private stopAuxSessionTimer(): void {
    if (this.auxSessionTimer) {
      clearTimeout(this.auxSessionTimer);
      this.auxSessionTimer = null;
    }
  }

  private log(...args: unknown[]): void {
    if (this.debug_) {
      console.log("[BinanceWS]", ...args);
    }
  }
}
