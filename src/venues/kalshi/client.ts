/**
 * Kalshi API client for market discovery.
 *
 * The Kalshi API provides event and market data for 15-minute crypto markets.
 */

import { loadConfig } from "../../config/config";
import {
  type IntervalKey,
  INTERVAL_DURATION_S,
} from "../../time/interval";
import {
  type KalshiEventRaw,
  type KalshiEventInfo,
  type KalshiSeriesTicker,
  COIN_TO_KALSHI_SERIES,
  MONTH_ABBREVS,
  isKalshiSeriesTicker,
} from "./types";

export interface KalshiClientOptions {
  /** Kalshi API host URL */
  host?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

const DEFAULT_HOST = "https://api.elections.kalshi.com";

/**
 * Client for Kalshi's trading API.
 *
 * Used to discover 15-minute Up/Down events and get market metadata.
 */
export class KalshiClient {
  private host: string;
  private timeout: number;

  constructor(options: KalshiClientOptions = {}) {
    this.host = (options.host || DEFAULT_HOST).replace(/\/$/, "");
    this.timeout = options.timeout || 10_000;
  }

  /**
   * Get event data by ticker.
   *
   * @param eventTicker - Event ticker (e.g., "KXBTC15M-26FEB031730")
   * @returns Event data or null if not found
   */
  async getEventByTicker(eventTicker: string): Promise<KalshiEventRaw | null> {
    const url = `${this.host}/trade-api/v2/events/${eventTicker}?with_nested_markets=true`;

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
        const data = await response.json();
        return data.event as KalshiEventRaw;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get open events for a series.
   *
   * @param seriesTicker - Series ticker (e.g., "KXBTC15M")
   * @param limit - Maximum number of events to return
   * @returns Array of events
   */
  async getOpenEvents(
    seriesTicker: KalshiSeriesTicker,
    limit: number = 5
  ): Promise<KalshiEventRaw[]> {
    const url = `${this.host}/trade-api/v2/events?series_ticker=${seriesTicker}&status=open&limit=${limit}&with_nested_markets=true`;

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
        const data = await response.json();
        return (data.events || []) as KalshiEventRaw[];
      }
      return [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get the current active 15-minute event for a coin.
   *
   * @param coin - Coin symbol (BTC, ETH, SOL, XRP)
   * @returns Normalized event info or null
   */
  async getCurrentEvent(coin: string): Promise<KalshiEventInfo | null> {
    const normalizedCoin = coin.toUpperCase();
    const seriesTicker = COIN_TO_KALSHI_SERIES[normalizedCoin];

    if (!seriesTicker) {
      throw new Error(
        `Unsupported coin: ${coin}. Use: ${Object.keys(COIN_TO_KALSHI_SERIES).join(", ")}`
      );
    }

    const now = new Date();

    // Try computed current interval event ticker
    const currentTicker = buildEventTicker(seriesTicker, now);
    let event = await this.getEventByTicker(currentTicker);

    if (event && hasActiveMarket(event)) {
      return normalizeEvent(event);
    }

    // Try next interval (market might have rolled over)
    const nextTime = new Date(now.getTime() + INTERVAL_DURATION_S * 1000);
    const nextTicker = buildEventTicker(seriesTicker, nextTime);
    event = await this.getEventByTicker(nextTicker);

    if (event && hasActiveMarket(event)) {
      return normalizeEvent(event);
    }

    // Fallback: query open events and find the most relevant
    const openEvents = await this.getOpenEvents(seriesTicker, 3);
    if (openEvents.length > 0) {
      // Find the event with the earliest close time that's still in the future
      const nowTs = Math.floor(now.getTime() / 1000);
      const activeEvent = openEvents.find((e) => {
        if (!e.markets || e.markets.length === 0) return false;
        const market = e.markets[0];
        const closeTs = Math.floor(new Date(market.close_time).getTime() / 1000);
        return market.status === "active" && closeTs > nowTs;
      });

      if (activeEvent) {
        return normalizeEvent(activeEvent);
      }
    }

    return null;
  }

  /**
   * Get the next upcoming 15-minute event for a coin.
   *
   * @param coin - Coin symbol (BTC, ETH, SOL, XRP)
   * @returns Normalized event info or null
   */
  async getNextEvent(coin: string): Promise<KalshiEventInfo | null> {
    const normalizedCoin = coin.toUpperCase();
    const seriesTicker = COIN_TO_KALSHI_SERIES[normalizedCoin];

    if (!seriesTicker) {
      throw new Error(
        `Unsupported coin: ${coin}. Use: ${Object.keys(COIN_TO_KALSHI_SERIES).join(", ")}`
      );
    }

    const now = new Date();

    // Compute next interval end time
    const nextTime = new Date(now.getTime() + INTERVAL_DURATION_S * 1000);
    const nextTicker = buildEventTicker(seriesTicker, nextTime);

    // Try the computed next event
    let event = await this.getEventByTicker(nextTicker);
    if (event) {
      return normalizeEvent(event);
    }

    // Try one more interval ahead
    const afterNextTime = new Date(now.getTime() + 2 * INTERVAL_DURATION_S * 1000);
    const afterNextTicker = buildEventTicker(seriesTicker, afterNextTime);
    event = await this.getEventByTicker(afterNextTicker);

    if (event) {
      return normalizeEvent(event);
    }

    return null;
  }
}

/**
 * Check if an event has an active market.
 */
function hasActiveMarket(event: KalshiEventRaw): boolean {
  if (!event.markets || event.markets.length === 0) return false;
  return event.markets.some((m) => m.status === "active");
}

/**
 * Get Eastern Time offset in hours (handles EST/EDT).
 *
 * EST (winter): UTC-5
 * EDT (summer): UTC-4
 *
 * DST in US: starts 2nd Sunday of March, ends 1st Sunday of November
 */
export function getETOffset(date: Date): number {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed

  // March (2) - check if after 2nd Sunday
  // November (10) - check if before 1st Sunday

  // Simple approximation: March 8-14 could be 2nd Sunday
  // November 1-7 could be 1st Sunday

  // More accurate: find the actual Sunday
  const marchSecondSunday = getNthSundayOfMonth(year, 2, 2); // March, 2nd Sunday
  const novFirstSunday = getNthSundayOfMonth(year, 10, 1); // November, 1st Sunday

  // DST starts at 2:00 AM local time on marchSecondSunday
  // DST ends at 2:00 AM local time on novFirstSunday

  // Convert to UTC timestamps for comparison
  // DST starts: March 2nd Sunday at 2:00 AM EST = 7:00 AM UTC
  const dstStartUtc = new Date(
    Date.UTC(year, 2, marchSecondSunday, 7, 0, 0)
  ).getTime();

  // DST ends: November 1st Sunday at 2:00 AM EDT = 6:00 AM UTC
  const dstEndUtc = new Date(
    Date.UTC(year, 10, novFirstSunday, 6, 0, 0)
  ).getTime();

  const timestamp = date.getTime();

  if (timestamp >= dstStartUtc && timestamp < dstEndUtc) {
    return -4; // EDT
  }
  return -5; // EST
}

/**
 * Get the day of month for the nth Sunday of a given month.
 */
function getNthSundayOfMonth(year: number, month: number, n: number): number {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const firstDayOfWeek = firstDay.getUTCDay(); // 0 = Sunday

  // Days until first Sunday
  const daysUntilFirstSunday = (7 - firstDayOfWeek) % 7;
  const firstSunday = 1 + daysUntilFirstSunday;

  // nth Sunday
  return firstSunday + (n - 1) * 7;
}

/**
 * Convert UTC date to Eastern Time components.
 */
export function toEasternTime(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const offset = getETOffset(date);
  const etTime = new Date(date.getTime() + offset * 60 * 60 * 1000);

  return {
    year: etTime.getUTCFullYear(),
    month: etTime.getUTCMonth(),
    day: etTime.getUTCDate(),
    hour: etTime.getUTCHours(),
    minute: etTime.getUTCMinutes(),
  };
}

/**
 * Get the interval end time in Eastern Time.
 *
 * Rounds up to the next 15-minute boundary.
 */
export function getIntervalEndET(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const et = toEasternTime(date);

  // Round down to 15-minute boundary to get interval start
  const intervalStartMinute = Math.floor(et.minute / 15) * 15;

  // Add 15 minutes for end time
  let endMinute = intervalStartMinute + 15;
  let endHour = et.hour;
  let endDay = et.day;
  let endMonth = et.month;
  let endYear = et.year;

  if (endMinute >= 60) {
    endMinute = 0;
    endHour++;
  }

  if (endHour >= 24) {
    endHour = 0;
    endDay++;

    // Handle month/year rollover (simplified)
    const daysInMonth = new Date(endYear, endMonth + 1, 0).getDate();
    if (endDay > daysInMonth) {
      endDay = 1;
      endMonth++;
      if (endMonth > 11) {
        endMonth = 0;
        endYear++;
      }
    }
  }

  return {
    year: endYear,
    month: endMonth,
    day: endDay,
    hour: endHour,
    minute: endMinute,
  };
}

/**
 * Build an event ticker from series and timestamp.
 *
 * Format: {SERIES}-{YY}{MON}{DD}{HHMM}
 * Where HHMM is the interval END time in Eastern Time.
 *
 * @param seriesTicker - Series ticker (e.g., "KXBTC15M")
 * @param date - Date within the interval
 * @returns Event ticker (e.g., "KXBTC15M-26FEB031730")
 */
export function buildEventTicker(
  seriesTicker: KalshiSeriesTicker,
  date: Date
): string {
  const end = getIntervalEndET(date);

  const yy = (end.year % 100).toString().padStart(2, "0");
  const mon = MONTH_ABBREVS[end.month];
  const dd = end.day.toString().padStart(2, "0");
  const hh = end.hour.toString().padStart(2, "0");
  const mm = end.minute.toString().padStart(2, "0");

  return `${seriesTicker}-${yy}${mon}${dd}${hh}${mm}`;
}

/**
 * Parse an event ticker to extract components.
 *
 * @param ticker - Event ticker (e.g., "KXBTC15M-26FEB031730")
 * @returns Parsed components or null if invalid
 */
export function parseEventTicker(ticker: string): {
  seriesTicker: KalshiSeriesTicker;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} | null {
  const match = ticker.match(
    /^(KX[A-Z]+15M)-(\d{2})([A-Z]{3})(\d{2})(\d{2})(\d{2})$/
  );
  if (!match) return null;

  const [, series, yy, mon, dd, hh, mm] = match;

  if (!isKalshiSeriesTicker(series)) return null;

  const monthIndex = MONTH_ABBREVS.indexOf(mon as (typeof MONTH_ABBREVS)[number]);
  if (monthIndex === -1) return null;

  const year = 2000 + parseInt(yy, 10);
  const day = parseInt(dd, 10);
  const hour = parseInt(hh, 10);
  const minute = parseInt(mm, 10);

  return {
    seriesTicker: series,
    year,
    month: monthIndex,
    day,
    hour,
    minute,
  };
}

/**
 * Convert Kalshi price (cents) to decimal (0-1).
 */
export function centsToDecimal(cents: number): number {
  return cents / 100;
}

/**
 * Normalize raw event data into KalshiEventInfo.
 *
 * @param raw - Raw event data from API
 * @returns Normalized event info
 */
export function normalizeEvent(raw: KalshiEventRaw): KalshiEventInfo {
  const market = raw.markets?.[0];

  const closeTime = market?.close_time || raw.strike_date || "";
  const closeTs = closeTime
    ? Math.floor(new Date(closeTime).getTime() / 1000)
    : 0;

  // Compute interval key from close time (end of interval)
  const endTs = closeTs;
  const startTs = endTs - INTERVAL_DURATION_S;
  const intervalKey: IntervalKey = { startTs, endTs };

  return {
    eventTicker: raw.event_ticker,
    seriesTicker: raw.series_ticker,
    marketTicker: market?.ticker || "",
    title: raw.title,
    subtitle: raw.sub_title,
    closeTime,
    closeTs,
    isActive: market?.status === "active",
    yesPrices: {
      bid: market ? centsToDecimal(market.yes_bid) : 0,
      ask: market ? centsToDecimal(market.yes_ask) : 0,
    },
    noPrices: {
      bid: market ? centsToDecimal(market.no_bid) : 0,
      ask: market ? centsToDecimal(market.no_ask) : 0,
    },
    intervalKey,
  };
}
