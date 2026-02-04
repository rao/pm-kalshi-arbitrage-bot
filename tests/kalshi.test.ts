import { test, expect, describe } from "bun:test";
import {
  buildEventTicker,
  parseEventTicker,
  getETOffset,
  toEasternTime,
  getIntervalEndET,
  centsToDecimal,
  normalizeEvent,
} from "../src/venues/kalshi/client";
import type { KalshiEventRaw } from "../src/venues/kalshi/types";

describe("kalshi utilities", () => {
  describe("getETOffset", () => {
    test("returns -5 for winter (EST)", () => {
      // January is EST
      const winterDate = new Date("2026-01-15T12:00:00Z");
      expect(getETOffset(winterDate)).toBe(-5);
    });

    test("returns -4 for summer (EDT)", () => {
      // July is EDT
      const summerDate = new Date("2026-07-15T12:00:00Z");
      expect(getETOffset(summerDate)).toBe(-4);
    });

    test("handles DST transition in March", () => {
      // Before DST (early March)
      const beforeDst = new Date("2026-03-05T12:00:00Z");
      expect(getETOffset(beforeDst)).toBe(-5);

      // After DST (late March)
      const afterDst = new Date("2026-03-20T12:00:00Z");
      expect(getETOffset(afterDst)).toBe(-4);
    });

    test("handles DST transition in November", () => {
      // Before DST ends (early November)
      const beforeEnd = new Date("2026-11-01T05:00:00Z");
      expect(getETOffset(beforeEnd)).toBe(-4);

      // After DST ends (mid November)
      const afterEnd = new Date("2026-11-15T12:00:00Z");
      expect(getETOffset(afterEnd)).toBe(-5);
    });
  });

  describe("toEasternTime", () => {
    test("converts UTC to EST correctly", () => {
      // 22:30 UTC on Feb 3, 2026 should be 17:30 EST
      const utcDate = new Date("2026-02-03T22:30:00Z");
      const et = toEasternTime(utcDate);

      expect(et.year).toBe(2026);
      expect(et.month).toBe(1); // February (0-indexed)
      expect(et.day).toBe(3);
      expect(et.hour).toBe(17);
      expect(et.minute).toBe(30);
    });

    test("converts UTC to EDT correctly", () => {
      // 22:30 UTC on July 3, 2026 should be 18:30 EDT
      const utcDate = new Date("2026-07-03T22:30:00Z");
      const et = toEasternTime(utcDate);

      expect(et.year).toBe(2026);
      expect(et.month).toBe(6); // July (0-indexed)
      expect(et.day).toBe(3);
      expect(et.hour).toBe(18);
      expect(et.minute).toBe(30);
    });

    test("handles day rollover", () => {
      // 03:00 UTC should be previous day in ET (winter)
      const utcDate = new Date("2026-02-04T03:00:00Z");
      const et = toEasternTime(utcDate);

      expect(et.day).toBe(3); // Previous day
      expect(et.hour).toBe(22); // 10 PM
    });
  });

  describe("getIntervalEndET", () => {
    test("computes interval end for :07 minute", () => {
      // 22:07 UTC = 17:07 ET -> interval is 17:00-17:15 -> end is 17:15
      const date = new Date("2026-02-03T22:07:00Z");
      const end = getIntervalEndET(date);

      expect(end.hour).toBe(17);
      expect(end.minute).toBe(15);
    });

    test("computes interval end for :22 minute", () => {
      // 22:22 UTC = 17:22 ET -> interval is 17:15-17:30 -> end is 17:30
      const date = new Date("2026-02-03T22:22:00Z");
      const end = getIntervalEndET(date);

      expect(end.hour).toBe(17);
      expect(end.minute).toBe(30);
    });

    test("computes interval end for :45 minute", () => {
      // 22:47 UTC = 17:47 ET -> interval is 17:45-18:00 -> end is 18:00
      const date = new Date("2026-02-03T22:47:00Z");
      const end = getIntervalEndET(date);

      expect(end.hour).toBe(18);
      expect(end.minute).toBe(0);
    });

    test("handles hour rollover", () => {
      // 22:55 UTC = 17:55 ET -> interval is 17:45-18:00 -> end is 18:00
      const date = new Date("2026-02-03T22:55:00Z");
      const end = getIntervalEndET(date);

      expect(end.hour).toBe(18);
      expect(end.minute).toBe(0);
    });
  });

  describe("buildEventTicker", () => {
    test("builds correct ticker for BTC", () => {
      // 22:22 UTC on Feb 3, 2026 = 17:22 ET -> interval 17:15-17:30 -> end 17:30
      const date = new Date("2026-02-03T22:22:00Z");
      const ticker = buildEventTicker("KXBTC15M", date);

      expect(ticker).toBe("KXBTC15M-26FEB031730");
    });

    test("builds correct ticker for ETH", () => {
      const date = new Date("2026-02-03T22:22:00Z");
      const ticker = buildEventTicker("KXETH15M", date);

      expect(ticker).toBe("KXETH15M-26FEB031730");
    });

    test("handles midnight correctly", () => {
      // 05:05 UTC on Feb 4 = 00:05 ET on Feb 4 -> interval 00:00-00:15 -> end 00:15
      const date = new Date("2026-02-04T05:05:00Z");
      const ticker = buildEventTicker("KXBTC15M", date);

      expect(ticker).toBe("KXBTC15M-26FEB040015");
    });

    test("formats single-digit day with leading zero", () => {
      const date = new Date("2026-02-03T22:22:00Z");
      const ticker = buildEventTicker("KXBTC15M", date);

      expect(ticker).toMatch(/-26FEB03/);
    });

    test("formats single-digit hour with leading zero", () => {
      // 14:05 UTC = 09:05 ET -> interval 09:00-09:15 -> end 09:15
      const date = new Date("2026-02-03T14:05:00Z");
      const ticker = buildEventTicker("KXBTC15M", date);

      expect(ticker).toBe("KXBTC15M-26FEB030915");
    });
  });

  describe("parseEventTicker", () => {
    test("parses valid BTC ticker", () => {
      const result = parseEventTicker("KXBTC15M-26FEB031730");

      expect(result).not.toBeNull();
      expect(result!.seriesTicker).toBe("KXBTC15M");
      expect(result!.year).toBe(2026);
      expect(result!.month).toBe(1); // February (0-indexed)
      expect(result!.day).toBe(3);
      expect(result!.hour).toBe(17);
      expect(result!.minute).toBe(30);
    });

    test("parses valid ETH ticker", () => {
      const result = parseEventTicker("KXETH15M-26JUL151430");

      expect(result).not.toBeNull();
      expect(result!.seriesTicker).toBe("KXETH15M");
      expect(result!.year).toBe(2026);
      expect(result!.month).toBe(6); // July (0-indexed)
      expect(result!.day).toBe(15);
      expect(result!.hour).toBe(14);
      expect(result!.minute).toBe(30);
    });

    test("returns null for invalid format", () => {
      expect(parseEventTicker("invalid")).toBeNull();
      expect(parseEventTicker("KXBTC15M")).toBeNull();
      expect(parseEventTicker("KXBTC15M-")).toBeNull();
      expect(parseEventTicker("")).toBeNull();
    });

    test("returns null for invalid series", () => {
      expect(parseEventTicker("KXFOO15M-26FEB031730")).toBeNull();
    });

    test("returns null for invalid month", () => {
      expect(parseEventTicker("KXBTC15M-26FOO031730")).toBeNull();
    });
  });

  describe("centsToDecimal", () => {
    test("converts cents to decimal", () => {
      expect(centsToDecimal(23)).toBe(0.23);
      expect(centsToDecimal(50)).toBe(0.5);
      expect(centsToDecimal(100)).toBe(1.0);
      expect(centsToDecimal(0)).toBe(0);
    });
  });

  describe("normalizeEvent", () => {
    test("normalizes raw event data", () => {
      const raw: KalshiEventRaw = {
        event_ticker: "KXBTC15M-26FEB031730",
        series_ticker: "KXBTC15M",
        category: "Crypto",
        title: "BTC Up or Down - 15 minutes",
        sub_title: "Feb 3 - 5:15PM EST to 5:30PM EST",
        strike_date: "2026-02-03T22:30:00Z",
        markets: [
          {
            ticker: "KXBTC15M-26FEB031730-30",
            market_type: "binary",
            status: "active",
            title: "BTC price up in next 15 mins?",
            yes_bid: 23,
            yes_ask: 24,
            no_bid: 76,
            no_ask: 77,
            close_time: "2026-02-03T22:30:00Z",
            expiration_time: "2026-02-10T22:30:00Z",
            open_interest: 6668,
            volume: 12319,
            liquidity: 2123532,
          },
        ],
      };

      const result = normalizeEvent(raw);

      expect(result.eventTicker).toBe("KXBTC15M-26FEB031730");
      expect(result.seriesTicker).toBe("KXBTC15M");
      expect(result.marketTicker).toBe("KXBTC15M-26FEB031730-30");
      expect(result.title).toBe("BTC Up or Down - 15 minutes");
      expect(result.subtitle).toBe("Feb 3 - 5:15PM EST to 5:30PM EST");
      expect(result.isActive).toBe(true);
      expect(result.yesPrices.bid).toBe(0.23);
      expect(result.yesPrices.ask).toBe(0.24);
      expect(result.noPrices.bid).toBe(0.76);
      expect(result.noPrices.ask).toBe(0.77);
    });

    test("computes interval key from close time", () => {
      const raw: KalshiEventRaw = {
        event_ticker: "KXBTC15M-26FEB031730",
        series_ticker: "KXBTC15M",
        category: "Crypto",
        title: "BTC Up or Down",
        sub_title: "Test",
        strike_date: "2026-02-03T22:30:00Z",
        markets: [
          {
            ticker: "KXBTC15M-26FEB031730-30",
            market_type: "binary",
            status: "active",
            title: "Test",
            yes_bid: 50,
            yes_ask: 51,
            no_bid: 49,
            no_ask: 50,
            close_time: "2026-02-03T22:30:00Z",
            expiration_time: "2026-02-10T22:30:00Z",
            open_interest: 0,
            volume: 0,
            liquidity: 0,
          },
        ],
      };

      const result = normalizeEvent(raw);

      // Close time is 22:30 UTC, which is end of interval
      // Start should be 22:15 UTC (22:30 - 15 min)
      const expectedEndTs = Math.floor(
        new Date("2026-02-03T22:30:00Z").getTime() / 1000
      );
      const expectedStartTs = expectedEndTs - 900;

      expect(result.intervalKey.endTs).toBe(expectedEndTs);
      expect(result.intervalKey.startTs).toBe(expectedStartTs);
    });

    test("handles event without markets", () => {
      const raw: KalshiEventRaw = {
        event_ticker: "KXBTC15M-26FEB031730",
        series_ticker: "KXBTC15M",
        category: "Crypto",
        title: "BTC Up or Down",
        sub_title: "Test",
        strike_date: "2026-02-03T22:30:00Z",
        markets: [],
      };

      const result = normalizeEvent(raw);

      expect(result.eventTicker).toBe("KXBTC15M-26FEB031730");
      expect(result.marketTicker).toBe("");
      expect(result.isActive).toBe(false);
      expect(result.yesPrices.bid).toBe(0);
      expect(result.yesPrices.ask).toBe(0);
    });
  });
});
