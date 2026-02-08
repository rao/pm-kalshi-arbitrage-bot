/**
 * Type definitions for Kalshi venues.
 */

import type { IntervalKey } from "../../time/interval";

/**
 * Raw market data from Kalshi API (nested in event).
 */
export interface KalshiMarketRaw {
  /** Market ticker (e.g., "KXBTC15M-26FEB031730-30") */
  ticker: string;
  /** Market type (e.g., "binary") */
  market_type: string;
  /** Market status (e.g., "active", "closed", "settled") */
  status: string;
  /** Market title */
  title: string;
  /** Yes bid price in cents (e.g., 23 = $0.23) */
  yes_bid: number;
  /** Yes ask price in cents */
  yes_ask: number;
  /** No bid price in cents */
  no_bid: number;
  /** No ask price in cents */
  no_ask: number;
  /** When trading closes (ISO 8601) */
  close_time: string;
  /** When contract expires (ISO 8601) */
  expiration_time: string;
  /** Open interest in contracts */
  open_interest: number;
  /** Volume traded */
  volume: number;
  /** Liquidity in cents */
  liquidity: number;
  /** Settlement result ("yes", "no", or absent if unsettled) */
  result?: string;
}

/**
 * Raw event data from Kalshi API.
 */
export interface KalshiEventRaw {
  /** Event ticker (e.g., "KXBTC15M-26FEB031730") */
  event_ticker: string;
  /** Series ticker (e.g., "KXBTC15M") */
  series_ticker: string;
  /** Event category (e.g., "Crypto") */
  category: string;
  /** Event title */
  title: string;
  /** Event subtitle with time range */
  sub_title: string;
  /** Strike/settlement date (ISO 8601) */
  strike_date: string;
  /** Nested markets (when with_nested_markets=true) */
  markets?: KalshiMarketRaw[];
}

/**
 * Normalized Kalshi event info.
 */
export interface KalshiEventInfo {
  /** Event ticker */
  eventTicker: string;
  /** Series ticker */
  seriesTicker: string;
  /** Primary market ticker */
  marketTicker: string;
  /** Event title */
  title: string;
  /** Event subtitle with time range */
  subtitle: string;
  /** Close time (ISO 8601) */
  closeTime: string;
  /** Close timestamp in Unix seconds */
  closeTs: number;
  /** Whether event is active for trading */
  isActive: boolean;
  /** Yes prices (bid/ask) as decimals (0-1) */
  yesPrices: { bid: number; ask: number };
  /** No prices (bid/ask) as decimals (0-1) */
  noPrices: { bid: number; ask: number };
  /** Associated interval key */
  intervalKey: IntervalKey;
  /** BTC strike/reference price parsed from event title */
  referencePrice?: number;
}

/**
 * Supported series tickers for Kalshi 15-minute markets.
 */
export type KalshiSeriesTicker =
  | "KXBTC15M"
  | "KXETH15M"
  | "KXSOL15M"
  | "KXXRP15M";

/**
 * Mapping from coin symbol to Kalshi series ticker.
 */
export const COIN_TO_KALSHI_SERIES: Record<string, KalshiSeriesTicker> = {
  BTC: "KXBTC15M",
  ETH: "KXETH15M",
  SOL: "KXSOL15M",
  XRP: "KXXRP15M",
};

/**
 * All supported Kalshi series tickers.
 */
export const KALSHI_SERIES_TICKERS: KalshiSeriesTicker[] = [
  "KXBTC15M",
  "KXETH15M",
  "KXSOL15M",
  "KXXRP15M",
];

/**
 * Check if a string is a supported Kalshi series ticker.
 */
export function isKalshiSeriesTicker(
  ticker: string
): ticker is KalshiSeriesTicker {
  return KALSHI_SERIES_TICKERS.includes(ticker as KalshiSeriesTicker);
}

/**
 * Month abbreviations for Kalshi event ticker format.
 */
export const MONTH_ABBREVS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

// ============================================================================
// Order Types
// ============================================================================

/**
 * Kalshi order type.
 */
export type KalshiOrderType = "limit" | "market";

/**
 * Kalshi time in force options.
 */
export type KalshiTimeInForce =
  | "fill_or_kill"
  | "immediate_or_cancel"
  | "good_till_canceled";

/**
 * Side of the order (yes or no).
 */
export type KalshiSide = "yes" | "no";

/**
 * Action to take (buy or sell).
 */
export type KalshiAction = "buy" | "sell";

/**
 * Order status.
 */
export type KalshiOrderStatus = "resting" | "canceled" | "executed";

/**
 * Request to create a new order.
 */
export interface KalshiOrderRequest {
  /** Market ticker (e.g., "KXBTC15M-26FEB031730-30") */
  ticker: string;
  /** Side of the order: "yes" or "no" */
  side: KalshiSide;
  /** Action: "buy" or "sell" */
  action: KalshiAction;
  /** Number of contracts (whole numbers only, >= 1) */
  count: number;
  /** Order type: "limit" (default) or "market" */
  type?: KalshiOrderType;
  /** Price in cents (1-99) for yes side */
  yes_price?: number;
  /** Price in cents (1-99) for no side */
  no_price?: number;
  /** Time in force setting */
  time_in_force?: KalshiTimeInForce;
  /** Client-provided order ID for deduplication */
  client_order_id?: string;
  /** Unix timestamp for order expiration */
  expiration_ts?: number;
  /** Max cost in cents (auto-enables FOK) */
  buy_max_cost?: number;
  /** If true, order must be maker only */
  post_only?: boolean;
  /** If true, order can only reduce position */
  reduce_only?: boolean;
}

/**
 * Full order object returned from Kalshi API.
 */
export interface KalshiOrder {
  /** Unique order ID */
  order_id: string;
  /** Market ticker */
  ticker: string;
  /** Side: "yes" or "no" */
  side: KalshiSide;
  /** Action: "buy" or "sell" */
  action: KalshiAction;
  /** Original order count */
  count: number;
  /** Remaining count */
  remaining_count: number;
  /** Yes price in cents */
  yes_price: number;
  /** No price in cents */
  no_price: number;
  /** Order status */
  status: KalshiOrderStatus;
  /** Client order ID */
  client_order_id?: string;
  /** Order type */
  type: KalshiOrderType;
  /** Time in force */
  time_in_force: KalshiTimeInForce;
  /** Created timestamp (ISO 8601) */
  created_time: string;
  /** Expiration timestamp */
  expiration_ts?: number;
}

/**
 * Response from creating an order.
 */
export interface KalshiCreateOrderResponse {
  order: KalshiOrder;
}

/**
 * Response from canceling an order.
 */
export interface KalshiCancelOrderResponse {
  order: KalshiOrder;
  /** Number of contracts reduced/canceled */
  reduced_by: number;
}

/**
 * Response from getting a single order.
 */
export interface KalshiGetOrderResponse {
  order: KalshiOrder;
}

/**
 * Response from getting multiple orders.
 */
export interface KalshiGetOrdersResponse {
  orders: KalshiOrder[];
  cursor: string;
}

/**
 * Options for querying orders.
 */
export interface KalshiGetOrdersOptions {
  /** Filter by market ticker */
  ticker?: string;
  /** Filter by event ticker (comma-separated, max 10) */
  event_ticker?: string;
  /** Filter items after this Unix timestamp */
  min_ts?: number;
  /** Filter items before this Unix timestamp */
  max_ts?: number;
  /** Filter by status */
  status?: KalshiOrderStatus;
  /** Number of results per page (1-200, default 100) */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
}

/**
 * Response from batch canceling orders.
 */
export interface KalshiBatchCancelResponse {
  orders: Array<{
    order: KalshiOrder;
    reduced_by: number;
  }>;
}

// ============================================================================
// Fill Types
// ============================================================================

/**
 * A single fill from the Kalshi fills API.
 *
 * A fill represents when an order is matched (partially or fully).
 */
export interface KalshiFill {
  /** Unique fill ID */
  fill_id: string;
  /** Market ticker */
  ticker: string;
  /** Order ID this fill belongs to */
  order_id: string;
  /** Side: "yes" or "no" */
  side: KalshiSide;
  /** Action: "buy" or "sell" */
  action: KalshiAction;
  /** Number of contracts filled */
  count: number;
  /** Yes price in cents at which the fill executed */
  yes_price: number;
  /** No price in cents at which the fill executed */
  no_price: number;
  /** Whether this was a taker fill */
  is_taker: boolean;
  /** Timestamp of the fill (ISO 8601) */
  created_time: string;
}

/**
 * Response from getting fills.
 */
export interface KalshiGetFillsResponse {
  fills: KalshiFill[];
  cursor: string;
}

/**
 * Options for querying fills.
 */
export interface KalshiGetFillsOptions {
  /** Filter by market ticker */
  ticker?: string;
  /** Filter by order ID */
  order_id?: string;
  /** Filter items after this Unix timestamp */
  min_ts?: number;
  /** Filter items before this Unix timestamp */
  max_ts?: number;
  /** Number of results per page (1-200, default 100) */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
}

// ============================================================================
// Position Types
// ============================================================================

/**
 * A single market position from the Kalshi portfolio positions API.
 */
export interface KalshiMarketPosition {
  /** Market ticker */
  ticker: string;
  /** Signed position: +N = long YES, -N = long NO */
  position: number;
  /** Market exposure in centi-cents */
  market_exposure: number;
  /** Realized PnL in centi-cents */
  realized_pnl: number;
  /** Total contracts traded */
  total_traded: number;
}

/**
 * Response from getting portfolio positions.
 */
export interface KalshiGetPositionsResponse {
  market_positions: KalshiMarketPosition[];
  event_positions: unknown[];
  cursor: string;
}

/**
 * Options for querying portfolio positions.
 */
export interface KalshiGetPositionsOptions {
  /** Filter by market ticker */
  ticker?: string;
  /** Filter by count: "all" or "with_positions" */
  count_filter?: string;
}
