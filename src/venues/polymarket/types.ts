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
  /** Whether market has been resolved */
  resolved?: boolean;
  /** Resolution outcome (e.g., "Up", "Down") */
  resolution?: string;
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
  /** BTC strike/reference price parsed from question text */
  referencePrice?: number;
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

// Note: Order types (PolymarketOrderType, PolymarketSide, etc.) have been removed.
// Use types from @polymarket/clob-client instead (Side, OrderType, OpenOrder, etc.).
