/**
 * Polymarket orderbook normalization.
 *
 * Converts Polymarket UP/DOWN token orderbooks to NormalizedQuote format.
 *
 * Mapping:
 * - UP token = YES equivalent
 * - DOWN token = NO equivalent
 */

import type { NormalizedQuote, PriceLevel } from "./types";
import {
  type PolyBookMessage,
  type PolyPriceChangeMessage,
  parsePolyPrice,
  parsePolySize,
} from "../venues/polymarket/wsTypes";

/**
 * Extract best bid and ask from a Polymarket book message.
 *
 * @param book - Polymarket book message
 * @returns Best bid and ask with sizes
 */
export function extractBestLevels(book: PolyBookMessage): {
  bestBid: PriceLevel | null;
  bestAsk: PriceLevel | null;
} {
  let bestBid: PriceLevel | null = null;
  let bestAsk: PriceLevel | null = null;

  // Find best bid (highest price in bids array)
  if (book.bids && book.bids.length > 0) {
    let maxBidPrice = 0;
    let maxBidSize = 0;
    for (const bid of book.bids) {
      const price = parsePolyPrice(bid.price);
      if (price > maxBidPrice) {
        maxBidPrice = price;
        maxBidSize = parsePolySize(bid.size);
      }
    }
    if (maxBidPrice > 0) {
      bestBid = { price: maxBidPrice, size: maxBidSize };
    }
  }

  // Find best ask (lowest price in asks array)
  if (book.asks && book.asks.length > 0) {
    let minAskPrice = Infinity;
    let minAskSize = 0;
    for (const ask of book.asks) {
      const price = parsePolyPrice(ask.price);
      if (price > 0 && price < minAskPrice) {
        minAskPrice = price;
        minAskSize = parsePolySize(ask.size);
      }
    }
    if (minAskPrice < Infinity) {
      bestAsk = { price: minAskPrice, size: minAskSize };
    }
  }

  return { bestBid, bestAsk };
}

/**
 * Extract best bid/ask from a price_change message.
 *
 * The price_change message includes best_bid and best_ask directly.
 *
 * @param priceChange - Polymarket price change message
 * @param assetId - The asset ID to extract for
 * @returns Best bid and ask prices
 */
export function extractFromPriceChange(
  priceChange: PolyPriceChangeMessage,
  assetId: string
): { bestBid: number; bestAsk: number } | null {
  const change = priceChange.price_changes.find((pc) => pc.asset_id === assetId);
  if (!change) return null;

  return {
    bestBid: parsePolyPrice(change.best_bid),
    bestAsk: parsePolyPrice(change.best_ask),
  };
}

/**
 * Normalize two Polymarket orderbooks (UP and DOWN tokens) into a NormalizedQuote.
 *
 * @param upBook - Orderbook for the UP token (YES equivalent)
 * @param downBook - Orderbook for the DOWN token (NO equivalent)
 * @param tsLocal - Local timestamp (defaults to Date.now())
 * @returns NormalizedQuote or null if insufficient data
 */
export function normalizePolymarketBooks(
  upBook: PolyBookMessage | null,
  downBook: PolyBookMessage | null,
  tsLocal: number = Date.now()
): NormalizedQuote | null {
  // Need at least one book to normalize
  if (!upBook && !downBook) {
    return null;
  }

  // Extract UP (YES) levels
  let yes_bid = 0;
  let yes_ask = 1;
  let yes_bid_size = 0;
  let yes_ask_size = 0;
  let ts_exchange = 0;

  if (upBook) {
    const upLevels = extractBestLevels(upBook);
    if (upLevels.bestBid) {
      yes_bid = upLevels.bestBid.price;
      yes_bid_size = upLevels.bestBid.size;
    }
    if (upLevels.bestAsk) {
      yes_ask = upLevels.bestAsk.price;
      yes_ask_size = upLevels.bestAsk.size;
    }
    ts_exchange = parseInt(upBook.timestamp, 10) || 0;
  }

  // Extract DOWN (NO) levels
  let no_bid = 0;
  let no_ask = 1;
  let no_bid_size = 0;
  let no_ask_size = 0;

  if (downBook) {
    const downLevels = extractBestLevels(downBook);
    if (downLevels.bestBid) {
      no_bid = downLevels.bestBid.price;
      no_bid_size = downLevels.bestBid.size;
    }
    if (downLevels.bestAsk) {
      no_ask = downLevels.bestAsk.price;
      no_ask_size = downLevels.bestAsk.size;
    }
    // Use the later timestamp if available
    const downTs = parseInt(downBook.timestamp, 10) || 0;
    if (downTs > ts_exchange) {
      ts_exchange = downTs;
    }
  }

  return {
    yes_bid,
    yes_ask,
    yes_bid_size,
    yes_ask_size,
    no_bid,
    no_ask,
    no_bid_size,
    no_ask_size,
    ts_exchange,
    ts_local: tsLocal,
  };
}

/**
 * Update a NormalizedQuote with a price change event from Polymarket.
 *
 * @param current - Current normalized quote
 * @param priceChange - Price change message
 * @param upTokenId - Token ID for the UP token
 * @param downTokenId - Token ID for the DOWN token
 * @param tsLocal - Local timestamp
 * @returns Updated NormalizedQuote
 */
export function applyPolymarketPriceChange(
  current: NormalizedQuote,
  priceChange: PolyPriceChangeMessage,
  upTokenId: string,
  downTokenId: string,
  tsLocal: number = Date.now()
): NormalizedQuote {
  const result = { ...current, ts_local: tsLocal };

  // Update exchange timestamp
  const msgTs = parseInt(priceChange.timestamp, 10) || 0;
  if (msgTs > result.ts_exchange) {
    result.ts_exchange = msgTs;
  }

  // Apply UP token (YES) changes
  const upChange = extractFromPriceChange(priceChange, upTokenId);
  if (upChange) {
    if (upChange.bestBid > 0) {
      result.yes_bid = upChange.bestBid;
    }
    if (upChange.bestAsk > 0 && upChange.bestAsk < 1) {
      result.yes_ask = upChange.bestAsk;
    }
    // Note: price_change doesn't include size info for best levels
    // In a real implementation, you'd need to track the full book or use REST fallback
  }

  // Apply DOWN token (NO) changes
  const downChange = extractFromPriceChange(priceChange, downTokenId);
  if (downChange) {
    if (downChange.bestBid > 0) {
      result.no_bid = downChange.bestBid;
    }
    if (downChange.bestAsk > 0 && downChange.bestAsk < 1) {
      result.no_ask = downChange.bestAsk;
    }
  }

  return result;
}

/**
 * Parse all price levels from a book message.
 *
 * Useful for maintaining a full orderbook locally.
 */
export function parseBookLevels(book: PolyBookMessage): {
  bids: PriceLevel[];
  asks: PriceLevel[];
} {
  const bids: PriceLevel[] = [];
  const asks: PriceLevel[] = [];

  if (book.bids) {
    for (const bid of book.bids) {
      const price = parsePolyPrice(bid.price);
      const size = parsePolySize(bid.size);
      if (price > 0 && size > 0) {
        bids.push({ price, size });
      }
    }
    // Sort descending by price (best bid first)
    bids.sort((a, b) => b.price - a.price);
  }

  if (book.asks) {
    for (const ask of book.asks) {
      const price = parsePolyPrice(ask.price);
      const size = parsePolySize(ask.size);
      if (price > 0 && size > 0) {
        asks.push({ price, size });
      }
    }
    // Sort ascending by price (best ask first)
    asks.sort((a, b) => a.price - b.price);
  }

  return { bids, asks };
}
