/**
 * Type definitions for Polymarket venues.
 */

import type { IntervalKey } from "../../time/interval";

/**
 * Raw market data from Gamma API.
 * Fields come as JSON strings that need parsing.
 */
export interface GammaMarketRaw {
  /** Market slug identifier (e.g., "btc-updown-15m-1234567800") */
  slug: string;
  /** Market question text */
  question: string;
  /** End date ISO string */
  endDate: string;
  /** JSON array of CLOB token IDs: '["token1", "token2"]' */
  clobTokenIds: string;
  /** JSON array of outcomes: '["Up", "Down"]' */
  outcomes: string;
  /** JSON array of prices: '["0.45", "0.55"]' */
  outcomePrices: string;
  /** Whether market is accepting orders */
  acceptingOrders: boolean;
}

/**
 * Parsed token IDs for Up/Down outcomes.
 */
export interface TokenIds {
  /** Token ID for the "Up" outcome */
  up: string;
  /** Token ID for the "Down" outcome */
  down: string;
}

/**
 * Normalized market information.
 */
export interface MarketInfo {
  /** Market slug identifier */
  slug: string;
  /** Market question text */
  question: string;
  /** End date ISO string */
  endDate: string;
  /** End timestamp in Unix seconds */
  endTs: number;
  /** Parsed token IDs */
  tokenIds: TokenIds;
  /** Current prices for each outcome */
  prices: { up: number; down: number };
  /** Whether market is accepting orders */
  acceptingOrders: boolean;
  /** Associated interval key */
  intervalKey: IntervalKey;
}

/**
 * Supported coins for 15-minute Up/Down markets.
 */
export type SupportedCoin = "BTC" | "ETH" | "SOL" | "XRP";

/**
 * Slug prefixes for each supported coin's 15m market.
 */
export const COIN_SLUG_PREFIXES: Record<SupportedCoin, string> = {
  BTC: "btc-updown-15m",
  ETH: "eth-updown-15m",
  SOL: "sol-updown-15m",
  XRP: "xrp-updown-15m",
};

/**
 * All supported coins.
 */
export const SUPPORTED_COINS: SupportedCoin[] = ["BTC", "ETH", "SOL", "XRP"];

/**
 * Check if a string is a supported coin.
 */
export function isSupportedCoin(coin: string): coin is SupportedCoin {
  return SUPPORTED_COINS.includes(coin.toUpperCase() as SupportedCoin);
}

// ============================================================================
// Order Types
// ============================================================================

/**
 * Polymarket order type.
 */
export type PolymarketOrderType = "GTC" | "GTD" | "FOK";

/**
 * Order side.
 */
export type PolymarketSide = "BUY" | "SELL";

/**
 * Order status.
 */
export type PolymarketOrderStatus =
  | "live"
  | "matched"
  | "delayed"
  | "unmatched"
  | "canceled";

/**
 * Response from posting an order.
 */
export interface PolymarketPostOrderResponse {
  success: boolean;
  errorMsg?: string;
  orderId?: string;
  orderHashes?: string[];
  status?: PolymarketOrderStatus;
}

/**
 * Response from canceling orders.
 */
export interface PolymarketCancelResponse {
  canceled: string[];
  not_canceled: Record<string, string>;
}

/**
 * Open order returned from API.
 */
export interface PolymarketOpenOrder {
  /** Order ID (hash) */
  id: string;
  /** Order status */
  status: string;
  /** Market condition ID */
  market: string;
  /** Token ID (asset ID) */
  asset_id: string;
  /** Original order size at placement */
  original_size: string;
  /** Human-readable outcome */
  outcome: string;
  /** Maker address (funder) */
  maker_address: string;
  /** API key owner */
  owner: string;
  /** Price (0-1) */
  price: string;
  /** Side: BUY or SELL */
  side: PolymarketSide;
  /** Size that has been matched/filled */
  size_matched: string;
  /** Expiration timestamp (0 = no expiration) */
  expiration: string;
  /** Order type (GTC, FOK, GTD) */
  type: PolymarketOrderType;
  /** Created timestamp (Unix) */
  created_at: string;
  /** Associated trade IDs */
  associate_trades?: string[];
}

/**
 * Response from getting open orders.
 */
export interface PolymarketGetOrdersResponse {
  orders: PolymarketOpenOrder[];
}
