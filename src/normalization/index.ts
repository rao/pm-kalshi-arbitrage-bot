/**
 * Normalization module exports.
 */

// Types
export {
  type NormalizedQuote,
  type QuoteUpdateEvent,
  type ConnectionState,
  type QuoteUpdateCallback,
  type ConnectionStateCallback,
  type PriceLevel,
  createEmptyQuote,
  isValidQuote,
  hasCrossedBook,
} from "./types";

// Polymarket normalization
export {
  normalizePolymarketBooks,
  extractBestLevels,
  applyPolymarketPriceChange,
  parseBookLevels,
} from "./normalizePolymarket";

// Kalshi normalization
export {
  normalizeKalshiSnapshot,
  applyKalshiDelta,
  centsToDecimal,
  initializeBidsFromSnapshot,
  computeQuoteFromBids,
  validateKalshiQuote,
  convertPriceLevels,
} from "./normalizeKalshi";
