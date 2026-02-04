/**
 * Polymarket WebSocket message types.
 *
 * Based on the CLOB market channel documentation.
 * URL: wss://ws-subscriptions-clob.polymarket.com/ws/market
 */

/**
 * Order summary in orderbook (price level).
 */
export interface PolyOrderSummary {
  /** Price level (string, e.g., "0.48" or ".48") */
  price: string;
  /** Size available at this price level (string) */
  size: string;
}

/**
 * Book message - full orderbook snapshot.
 *
 * Emitted on:
 * - First subscription to a market
 * - When there is a trade that affects the book
 */
export interface PolyBookMessage {
  event_type: "book";
  /** Asset ID (token ID) */
  asset_id: string;
  /** Condition ID of market */
  market: string;
  /** Bid orders (buy side) */
  bids: PolyOrderSummary[];
  /** Ask orders (sell side) */
  asks: PolyOrderSummary[];
  /** Unix timestamp in milliseconds */
  timestamp: string;
  /** Hash summary of the orderbook content */
  hash: string;
}

/**
 * Price change object within a price_change message.
 */
export interface PolyPriceChange {
  /** Asset ID (token ID) */
  asset_id: string;
  /** Price level affected */
  price: string;
  /** New aggregate size for price level */
  size: string;
  /** "BUY" or "SELL" */
  side: "BUY" | "SELL";
  /** Hash of the order */
  hash: string;
  /** Current best bid price */
  best_bid: string;
  /** Current best ask price */
  best_ask: string;
}

/**
 * Price change message - delta update.
 *
 * Emitted on:
 * - A new order is placed
 * - An order is cancelled
 */
export interface PolyPriceChangeMessage {
  event_type: "price_change";
  /** Condition ID of market */
  market: string;
  /** Array of price change objects */
  price_changes: PolyPriceChange[];
  /** Unix timestamp in milliseconds */
  timestamp: string;
}

/**
 * Tick size change message.
 *
 * Emitted when the minimum tick size changes
 * (when price > 0.96 or price < 0.04).
 */
export interface PolyTickSizeChangeMessage {
  event_type: "tick_size_change";
  /** Asset ID (token ID) */
  asset_id: string;
  /** Condition ID of market */
  market: string;
  /** Previous minimum tick size */
  old_tick_size: string;
  /** Current minimum tick size */
  new_tick_size: string;
  /** Unix timestamp */
  timestamp: string;
}

/**
 * Last trade price message.
 *
 * Emitted when a maker and taker order is matched.
 */
export interface PolyLastTradePriceMessage {
  event_type: "last_trade_price";
  /** Asset ID (token ID) */
  asset_id: string;
  /** Condition ID of market */
  market: string;
  /** Trade price */
  price: string;
  /** Trade side */
  side: "BUY" | "SELL";
  /** Trade size */
  size: string;
  /** Fee rate in basis points */
  fee_rate_bps: string;
  /** Unix timestamp in milliseconds */
  timestamp: string;
}

/**
 * All possible Polymarket WebSocket messages.
 */
export type PolyWsMessage =
  | PolyBookMessage
  | PolyPriceChangeMessage
  | PolyTickSizeChangeMessage
  | PolyLastTradePriceMessage;

/**
 * Subscribe message to send to Polymarket WebSocket.
 */
export interface PolySubscribeMessage {
  /** Array of asset IDs (token IDs) to subscribe to */
  assets_ids: string[];
  /** Channel type - "MARKET" for market data */
  type: "MARKET";
}

/**
 * Unsubscribe message to send to Polymarket WebSocket.
 */
export interface PolyUnsubscribeMessage {
  /** Array of asset IDs (token IDs) to unsubscribe from */
  assets_ids: string[];
  /** Operation type */
  operation: "unsubscribe";
}

/**
 * Default Polymarket WebSocket URL for market data.
 */
export const POLYMARKET_WS_URL =
  "wss://ws-subscriptions-clob.polymarket.com/ws/market";

/**
 * Parse a price string to a number.
 *
 * Handles formats like "0.48", ".48", "0.5", etc.
 */
export function parsePolyPrice(priceStr: string): number {
  const price = parseFloat(priceStr);
  return isNaN(price) ? 0 : price;
}

/**
 * Parse a size string to a number.
 */
export function parsePolySize(sizeStr: string): number {
  const size = parseFloat(sizeStr);
  return isNaN(size) ? 0 : size;
}
