/**
 * Normalized quote types for cross-venue arbitrage.
 *
 * These types provide a common representation for orderbook data
 * from both Polymarket and Kalshi.
 */

import type { IntervalKey } from "../time/interval";
import type { Venue } from "../markets/discovery";

/**
 * Normalized quote representing best bid/ask for YES and NO outcomes.
 *
 * All prices are in decimal format (0.0 - 1.0).
 * Both venues are normalized to this common format:
 * - Polymarket: UP token = YES, DOWN token = NO
 * - Kalshi: YES/NO as labeled (asks are implied from opposite side bids)
 */
export interface NormalizedQuote {
  /** Best bid price for YES outcome (0-1) */
  yes_bid: number;
  /** Best ask price for YES outcome (0-1) */
  yes_ask: number;
  /** Size available at best YES bid */
  yes_bid_size: number;
  /** Size available at best YES ask */
  yes_ask_size: number;

  /** Best bid price for NO outcome (0-1) */
  no_bid: number;
  /** Best ask price for NO outcome (0-1) */
  no_ask: number;
  /** Size available at best NO bid */
  no_bid_size: number;
  /** Size available at best NO ask */
  no_ask_size: number;

  /** Exchange timestamp in Unix milliseconds */
  ts_exchange: number;
  /** Local receipt timestamp in Unix milliseconds */
  ts_local: number;
}

/**
 * Quote update event emitted by WebSocket clients.
 */
export interface QuoteUpdateEvent {
  /** Source venue */
  venue: Venue;
  /** Interval this quote is for */
  intervalKey: IntervalKey;
  /** The normalized quote */
  quote: NormalizedQuote;
}

/**
 * WebSocket connection state.
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/**
 * Callback type for quote updates.
 */
export type QuoteUpdateCallback = (event: QuoteUpdateEvent) => void;

/**
 * Callback type for connection state changes.
 */
export type ConnectionStateCallback = (state: ConnectionState) => void;

/**
 * Price level in an orderbook.
 */
export interface PriceLevel {
  /** Price (0-1 decimal) */
  price: number;
  /** Size at this price level */
  size: number;
}

/**
 * Create an empty/invalid normalized quote.
 *
 * Useful for representing "no data" states.
 */
export function createEmptyQuote(tsLocal: number = Date.now()): NormalizedQuote {
  return {
    yes_bid: 0,
    yes_ask: 1,
    yes_bid_size: 0,
    yes_ask_size: 0,
    no_bid: 0,
    no_ask: 1,
    no_bid_size: 0,
    no_ask_size: 0,
    ts_exchange: 0,
    ts_local: tsLocal,
  };
}

/**
 * Check if a quote is valid (has actual bids/asks).
 */
export function isValidQuote(quote: NormalizedQuote): boolean {
  return (
    quote.yes_bid > 0 ||
    quote.yes_ask < 1 ||
    quote.no_bid > 0 ||
    quote.no_ask < 1
  );
}

/**
 * Check if a quote has a crossed book (bid > ask).
 */
export function hasCrossedBook(quote: NormalizedQuote): boolean {
  return quote.yes_bid >= quote.yes_ask || quote.no_bid >= quote.no_ask;
}
