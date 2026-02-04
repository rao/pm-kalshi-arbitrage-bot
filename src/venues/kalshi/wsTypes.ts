/**
 * Kalshi WebSocket message types.
 *
 * Based on Kalshi API documentation.
 * URL: wss://api.elections.kalshi.com/trade-api/ws/v2
 */

/**
 * Price level in Kalshi orderbook.
 * Format: [price_cents, quantity]
 */
export type KalshiPriceLevel = [number, number];

/**
 * Orderbook snapshot message.
 *
 * Contains the full state of YES and NO bids.
 * Note: Kalshi only sends BIDS. Asks are implied:
 * - YES ask = 100 - best NO bid
 * - NO ask = 100 - best YES bid
 */
export interface KalshiOrderbookSnapshot {
  type: "orderbook_snapshot";
  /** Subscription ID */
  sid: number;
  /** Sequence number */
  seq: number;
  msg: {
    /** Market ticker */
    market_ticker: string;
    /** Market ID */
    market_id: string;
    /** YES bids: [price_cents, quantity][] sorted ascending (best bid is last) */
    yes: KalshiPriceLevel[];
    /** YES bids in dollars (optional, for display) */
    yes_dollars?: [string, number][];
    /** YES bids in fixed-point dollars (optional) */
    yes_dollars_fp?: [string, string][];
    /** NO bids: [price_cents, quantity][] sorted ascending (best bid is last) */
    no: KalshiPriceLevel[];
    /** NO bids in dollars (optional, for display) */
    no_dollars?: [string, number][];
    /** NO bids in fixed-point dollars (optional) */
    no_dollars_fp?: [string, string][];
  };
}

/**
 * Orderbook delta message.
 *
 * Contains incremental update to the orderbook.
 */
export interface KalshiOrderbookDelta {
  type: "orderbook_delta";
  /** Subscription ID */
  sid: number;
  /** Sequence number */
  seq: number;
  msg: {
    /** Market ticker */
    market_ticker: string;
    /** Market ID */
    market_id: string;
    /** Price in cents (1-99) */
    price: number;
    /** Price in dollars (string) */
    price_dollars?: string;
    /** Delta to apply to quantity (positive = add, negative = remove) */
    delta: number;
    /** Delta in fixed-point format */
    delta_fp?: string;
    /** Side of the book being updated */
    side: "yes" | "no";
    /** Timestamp ISO 8601 */
    ts: string;
    /** Client order ID (present if you caused this change) */
    client_order_id?: string;
  };
}

/**
 * Subscribed response from Kalshi.
 */
export interface KalshiSubscribedResponse {
  type: "subscribed";
  /** Message ID from subscribe command */
  id: number;
  msg: {
    /** Assigned subscription ID */
    sid: number;
    /** Channel name */
    channel: string;
  };
}

/**
 * Unsubscribed response from Kalshi.
 */
export interface KalshiUnsubscribedResponse {
  type: "unsubscribed";
  /** Message ID from unsubscribe command */
  id: number;
}

/**
 * OK response from Kalshi.
 */
export interface KalshiOkResponse {
  type: "ok";
  /** Message ID from command */
  id: number;
}

/**
 * Error response from Kalshi.
 */
export interface KalshiErrorResponse {
  type: "error";
  /** Message ID from command (if applicable) */
  id?: number;
  msg: {
    /** Error code */
    code: number;
    /** Error message */
    msg: string;
  };
}

/**
 * All possible Kalshi WebSocket messages.
 */
export type KalshiWsMessage =
  | KalshiOrderbookSnapshot
  | KalshiOrderbookDelta
  | KalshiSubscribedResponse
  | KalshiUnsubscribedResponse
  | KalshiOkResponse
  | KalshiErrorResponse;

/**
 * Subscribe command to send to Kalshi WebSocket.
 */
export interface KalshiSubscribeCommand {
  /** Unique message ID */
  id: number;
  /** Command type */
  cmd: "subscribe";
  params: {
    /** Channels to subscribe to */
    channels: string[];
    /** Market tickers to subscribe to */
    market_tickers: string[];
  };
}

/**
 * Unsubscribe command to send to Kalshi WebSocket.
 */
export interface KalshiUnsubscribeCommand {
  /** Unique message ID */
  id: number;
  /** Command type */
  cmd: "unsubscribe";
  params: {
    /** Subscription IDs to unsubscribe from */
    sids: number[];
  };
}

/**
 * Update subscription command (add markets).
 */
export interface KalshiUpdateSubscriptionAddCommand {
  /** Unique message ID */
  id: number;
  /** Command type */
  cmd: "update_subscription";
  params: {
    /** Subscription ID to update */
    sids: number[];
    /** Action to take */
    action: "add_markets";
    /** Market tickers to add */
    market_tickers: string[];
  };
}

/**
 * Update subscription command (delete markets).
 */
export interface KalshiUpdateSubscriptionDeleteCommand {
  /** Unique message ID */
  id: number;
  /** Command type */
  cmd: "update_subscription";
  params: {
    /** Subscription ID to update */
    sids: number[];
    /** Action to take */
    action: "delete_markets";
    /** Market tickers to remove */
    market_tickers: string[];
  };
}

/**
 * Kalshi WebSocket error codes.
 */
export const KALSHI_WS_ERROR_CODES = {
  UNABLE_TO_PROCESS: 1,
  PARAMS_REQUIRED: 2,
  CHANNELS_REQUIRED: 3,
  SIDS_REQUIRED: 4,
  UNKNOWN_COMMAND: 5,
  ALREADY_SUBSCRIBED: 6,
  UNKNOWN_SID: 7,
  UNKNOWN_CHANNEL: 8,
  AUTH_REQUIRED: 9,
  CHANNEL_ERROR: 10,
  INVALID_PARAMETER: 11,
  ONE_SID_REQUIRED: 12,
  UNSUPPORTED_ACTION: 13,
  MARKET_TICKER_REQUIRED: 14,
  ACTION_REQUIRED: 15,
  MARKET_NOT_FOUND: 16,
  INTERNAL_ERROR: 17,
  COMMAND_TIMEOUT: 18,
} as const;

/**
 * Default Kalshi WebSocket URLs.
 */
export const KALSHI_WS_URL_PROD = "wss://api.elections.kalshi.com/trade-api/ws/v2";
export const KALSHI_WS_URL_DEMO = "wss://demo-api.kalshi.co/trade-api/ws/v2";

/**
 * Convert Kalshi price in cents to decimal (0-1).
 */
export function kalshiCentsToDecimal(cents: number): number {
  return cents / 100;
}

/**
 * Convert decimal price (0-1) to Kalshi cents.
 */
export function decimalToKalshiCents(decimal: number): number {
  return Math.round(decimal * 100);
}

/**
 * Get the best bid from a sorted price level array.
 *
 * Kalshi arrays are sorted ascending, so best bid is last.
 */
export function getBestBid(levels: KalshiPriceLevel[]): KalshiPriceLevel | null {
  if (levels.length === 0) return null;
  return levels[levels.length - 1];
}

/**
 * Find a price level in the array.
 */
export function findPriceLevel(
  levels: KalshiPriceLevel[],
  priceCents: number
): number {
  return levels.findIndex(([price]) => price === priceCents);
}
