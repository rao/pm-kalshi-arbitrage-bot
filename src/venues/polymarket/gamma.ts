/**
 * Gamma API client for Polymarket market discovery.
 *
 * The Gamma API provides market metadata including token IDs, prices, and status.
 */

import { loadConfig } from "../../config/config";
import {
  getIntervalKey,
  getNextIntervalKey,
  getPreviousIntervalKey,
  type IntervalKey,
  INTERVAL_DURATION_S,
} from "../../time/interval";
import {
  type GammaMarketRaw,
  type MarketInfo,
  type TokenIds,
  type SupportedCoin,
  COIN_SLUG_PREFIXES,
  isSupportedCoin,
} from "./types";

export interface GammaClientOptions {
  /** Gamma API host URL */
  host?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Client for Polymarket's Gamma API.
 *
 * Used to discover 15-minute Up/Down markets and get market metadata.
 */
export class GammaClient {
  private host: string;
  private timeout: number;

  constructor(options: GammaClientOptions = {}) {
    const config = loadConfig();
    this.host = (options.host || config.gammaApiHost).replace(/\/$/, "");
    this.timeout = options.timeout || 10_000;
  }

  /**
   * Get market data by slug.
   *
   * @param slug - Market slug (e.g., "btc-updown-15m-1234567800")
   * @returns Market data or null if not found
   */
  async getMarketBySlug(slug: string): Promise<GammaMarketRaw | null> {
    const url = `${this.host}/markets/slug/${slug}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });

      clearTimeout(timeoutId);

      if (response.status === 200) {
        return (await response.json()) as GammaMarketRaw;
      }
      return null;
    } catch (error) {
      // Network error or timeout
      return null;
    }
  }

  /**
   * Get the current active 15-minute market for a coin.
   *
   * Tries current, next, and previous intervals to find an active market.
   *
   * @param coin - Coin symbol (BTC, ETH, SOL, XRP)
   * @returns Normalized market info or null
   */
  async getCurrentMarket(coin: SupportedCoin): Promise<MarketInfo | null> {
    const normalizedCoin = coin.toUpperCase();
    if (!isSupportedCoin(normalizedCoin)) {
      throw new Error(
        `Unsupported coin: ${coin}. Use: ${Object.keys(COIN_SLUG_PREFIXES).join(", ")}`
      );
    }

    const now = new Date();

    // Try current interval
    const currentInterval = getIntervalKey(now);
    let market = await this.tryGetMarket(normalizedCoin, currentInterval);
    if (market && market.acceptingOrders) {
      return market;
    }

    // Try next interval (market might have rolled over)
    const nextInterval = getNextIntervalKey(now);
    market = await this.tryGetMarket(normalizedCoin, nextInterval);
    if (market && market.acceptingOrders) {
      return market;
    }

    // Try previous interval (might still be active)
    const prevInterval = getPreviousIntervalKey(now);
    market = await this.tryGetMarket(normalizedCoin, prevInterval);
    if (market && market.acceptingOrders) {
      return market;
    }

    return null;
  }

  /**
   * Get the next upcoming 15-minute market for a coin.
   *
   * @param coin - Coin symbol (BTC, ETH, SOL, XRP)
   * @returns Normalized market info or null
   */
  async getNextMarket(coin: SupportedCoin): Promise<MarketInfo | null> {
    const normalizedCoin = coin.toUpperCase();
    if (!isSupportedCoin(normalizedCoin)) {
      throw new Error(
        `Unsupported coin: ${coin}. Use: ${Object.keys(COIN_SLUG_PREFIXES).join(", ")}`
      );
    }

    const now = new Date();
    const nextInterval = getNextIntervalKey(now);

    return this.tryGetMarket(normalizedCoin, nextInterval);
  }

  /**
   * Try to get a market for a specific interval.
   */
  private async tryGetMarket(
    coin: SupportedCoin,
    interval: IntervalKey
  ): Promise<MarketInfo | null> {
    const slug = buildSlug(coin, interval.startTs);
    const raw = await this.getMarketBySlug(slug);

    if (!raw) return null;

    return normalizeMarket(raw, interval);
  }
}

/**
 * Build a market slug from coin and timestamp.
 *
 * @param coin - Coin symbol
 * @param startTs - Start timestamp in Unix seconds
 * @returns Slug like "btc-updown-15m-1234567800"
 */
export function buildSlug(coin: SupportedCoin, startTs: number): string {
  const prefix = COIN_SLUG_PREFIXES[coin];
  return `${prefix}-${startTs}`;
}

/**
 * Parse a JSON field that may be a string or already parsed.
 */
function parseJsonField<T>(value: unknown): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return value as T;
}

/**
 * Parse token IDs from raw market data.
 *
 * Maps outcomes to their corresponding token IDs.
 *
 * @param market - Raw market data
 * @returns TokenIds with up/down token IDs
 */
export function parseTokenIds(market: GammaMarketRaw): TokenIds {
  const tokenIds = parseJsonField<string[]>(market.clobTokenIds);
  const outcomes = parseJsonField<string[]>(market.outcomes);

  const result: TokenIds = { up: "", down: "" };

  for (let i = 0; i < outcomes.length && i < tokenIds.length; i++) {
    const outcome = outcomes[i].toLowerCase();
    if (outcome === "up") {
      result.up = tokenIds[i];
    } else if (outcome === "down") {
      result.down = tokenIds[i];
    }
  }

  return result;
}

/**
 * Parse prices from raw market data.
 *
 * @param market - Raw market data
 * @returns Prices with up/down values
 */
export function parsePrices(market: GammaMarketRaw): {
  up: number;
  down: number;
} {
  const prices = parseJsonField<string[]>(market.outcomePrices);
  const outcomes = parseJsonField<string[]>(market.outcomes);

  const result = { up: 0.5, down: 0.5 };

  for (let i = 0; i < outcomes.length && i < prices.length; i++) {
    const outcome = outcomes[i].toLowerCase();
    const price = parseFloat(prices[i]);
    if (outcome === "up") {
      result.up = price;
    } else if (outcome === "down") {
      result.down = price;
    }
  }

  return result;
}

/**
 * Parse end timestamp from ISO date string.
 *
 * @param endDate - ISO date string
 * @returns Unix timestamp in seconds, or 0 if invalid
 */
export function parseEndTs(endDate: string): number {
  if (!endDate) return 0;

  try {
    // Handle both "Z" and "+00:00" suffixes
    const normalized = endDate.replace("Z", "+00:00");
    const ts = Math.floor(new Date(normalized).getTime() / 1000);
    return isNaN(ts) ? 0 : ts;
  } catch {
    return 0;
  }
}

/**
 * Extract start timestamp from market slug.
 *
 * @param slug - Market slug like "btc-updown-15m-1234567800"
 * @returns Unix timestamp in seconds, or null if invalid
 */
export function extractSlugTimestamp(slug: string): number | null {
  if (!slug) return null;

  const parts = slug.split("-");
  const lastPart = parts[parts.length - 1];

  if (!/^\d+$/.test(lastPart)) return null;

  const ts = parseInt(lastPart, 10);
  return isNaN(ts) ? null : ts;
}

/**
 * Parse a BTC reference/strike price from a question or title string.
 *
 * Matches patterns like "$97,320" or "$100,123.45" and returns the numeric value.
 * Returns null if no price pattern found.
 */
export function parseReferencePrice(text: string): number | null {
  const match = text.match(/\$([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  const cleaned = match[1].replace(/,/g, "");
  const value = parseFloat(cleaned);
  return isNaN(value) ? null : value;
}

/**
 * Normalize raw market data into MarketInfo.
 *
 * @param raw - Raw market data from Gamma API
 * @param interval - Optional interval key to use (computed from slug if not provided)
 * @returns Normalized MarketInfo
 */
export function normalizeMarket(
  raw: GammaMarketRaw,
  interval?: IntervalKey
): MarketInfo {
  const tokenIds = parseTokenIds(raw);
  const prices = parsePrices(raw);
  const endTs = parseEndTs(raw.endDate);

  // Compute interval from slug if not provided
  let intervalKey = interval;
  if (!intervalKey) {
    const startTs = extractSlugTimestamp(raw.slug);
    if (startTs) {
      intervalKey = {
        startTs,
        endTs: startTs + INTERVAL_DURATION_S,
      };
    } else {
      // Fallback to current interval
      intervalKey = getIntervalKey();
    }
  }

  // Parse reference price from question text (e.g. "Will the price of BTC be above $97,320 at...?")
  const referencePrice = parseReferencePrice(raw.question);

  return {
    slug: raw.slug,
    question: raw.question,
    endDate: raw.endDate,
    endTs,
    tokenIds,
    prices,
    acceptingOrders: raw.acceptingOrders,
    intervalKey,
    referencePrice: referencePrice ?? undefined,
  };
}
