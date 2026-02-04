import { test, expect, describe, mock, beforeEach } from "bun:test";
import {
  buildSlug,
  parseTokenIds,
  parsePrices,
  parseEndTs,
  extractSlugTimestamp,
  normalizeMarket,
} from "../src/venues/polymarket/gamma";
import type { GammaMarketRaw } from "../src/venues/polymarket/types";

describe("gamma utilities", () => {
  describe("buildSlug", () => {
    test("builds correct slug for BTC", () => {
      expect(buildSlug("BTC", 1705330800)).toBe("btc-updown-15m-1705330800");
    });

    test("builds correct slug for ETH", () => {
      expect(buildSlug("ETH", 1705330800)).toBe("eth-updown-15m-1705330800");
    });

    test("builds correct slug for SOL", () => {
      expect(buildSlug("SOL", 1705330800)).toBe("sol-updown-15m-1705330800");
    });

    test("builds correct slug for XRP", () => {
      expect(buildSlug("XRP", 1705330800)).toBe("xrp-updown-15m-1705330800");
    });
  });

  describe("parseTokenIds", () => {
    test("parses token IDs from JSON strings", () => {
      const market: GammaMarketRaw = {
        slug: "btc-updown-15m-1705330800",
        question: "Will BTC go up?",
        endDate: "2025-01-15T14:30:00Z",
        clobTokenIds: '["token-up-123", "token-down-456"]',
        outcomes: '["Up", "Down"]',
        outcomePrices: '["0.45", "0.55"]',
        acceptingOrders: true,
      };

      const result = parseTokenIds(market);
      expect(result.up).toBe("token-up-123");
      expect(result.down).toBe("token-down-456");
    });

    test("handles reversed outcomes", () => {
      const market: GammaMarketRaw = {
        slug: "btc-updown-15m-1705330800",
        question: "Will BTC go up?",
        endDate: "2025-01-15T14:30:00Z",
        clobTokenIds: '["token-down-456", "token-up-123"]',
        outcomes: '["Down", "Up"]',
        outcomePrices: '["0.55", "0.45"]',
        acceptingOrders: true,
      };

      const result = parseTokenIds(market);
      expect(result.up).toBe("token-up-123");
      expect(result.down).toBe("token-down-456");
    });

    test("handles already parsed arrays", () => {
      const market = {
        slug: "btc-updown-15m-1705330800",
        question: "Will BTC go up?",
        endDate: "2025-01-15T14:30:00Z",
        clobTokenIds: ["token-up-123", "token-down-456"],
        outcomes: ["Up", "Down"],
        outcomePrices: ["0.45", "0.55"],
        acceptingOrders: true,
      } as unknown as GammaMarketRaw;

      const result = parseTokenIds(market);
      expect(result.up).toBe("token-up-123");
      expect(result.down).toBe("token-down-456");
    });
  });

  describe("parsePrices", () => {
    test("parses prices from JSON strings", () => {
      const market: GammaMarketRaw = {
        slug: "btc-updown-15m-1705330800",
        question: "Will BTC go up?",
        endDate: "2025-01-15T14:30:00Z",
        clobTokenIds: '["token-up-123", "token-down-456"]',
        outcomes: '["Up", "Down"]',
        outcomePrices: '["0.45", "0.55"]',
        acceptingOrders: true,
      };

      const result = parsePrices(market);
      expect(result.up).toBe(0.45);
      expect(result.down).toBe(0.55);
    });

    test("handles reversed outcomes", () => {
      const market: GammaMarketRaw = {
        slug: "btc-updown-15m-1705330800",
        question: "Will BTC go up?",
        endDate: "2025-01-15T14:30:00Z",
        clobTokenIds: '["token-down-456", "token-up-123"]',
        outcomes: '["Down", "Up"]',
        outcomePrices: '["0.55", "0.45"]',
        acceptingOrders: true,
      };

      const result = parsePrices(market);
      expect(result.up).toBe(0.45);
      expect(result.down).toBe(0.55);
    });
  });

  describe("parseEndTs", () => {
    test("parses ISO date with Z suffix", () => {
      const result = parseEndTs("2025-01-15T14:30:00Z");
      expect(result).toBe(
        Math.floor(new Date("2025-01-15T14:30:00Z").getTime() / 1000)
      );
    });

    test("parses ISO date with timezone offset", () => {
      const result = parseEndTs("2025-01-15T14:30:00+00:00");
      expect(result).toBe(
        Math.floor(new Date("2025-01-15T14:30:00Z").getTime() / 1000)
      );
    });

    test("returns 0 for empty string", () => {
      expect(parseEndTs("")).toBe(0);
    });

    test("returns 0 for invalid date", () => {
      expect(parseEndTs("not-a-date")).toBe(0);
    });
  });

  describe("extractSlugTimestamp", () => {
    test("extracts timestamp from valid slug", () => {
      expect(extractSlugTimestamp("btc-updown-15m-1705330800")).toBe(
        1705330800
      );
    });

    test("extracts timestamp from ETH slug", () => {
      expect(extractSlugTimestamp("eth-updown-15m-1705330800")).toBe(
        1705330800
      );
    });

    test("returns null for empty slug", () => {
      expect(extractSlugTimestamp("")).toBeNull();
    });

    test("returns null for slug without timestamp", () => {
      expect(extractSlugTimestamp("btc-updown-15m")).toBeNull();
    });

    test("returns null for slug with non-numeric suffix", () => {
      expect(extractSlugTimestamp("btc-updown-15m-abc")).toBeNull();
    });
  });

  describe("normalizeMarket", () => {
    test("normalizes raw market data", () => {
      const raw: GammaMarketRaw = {
        slug: "btc-updown-15m-1705330800",
        question: "Will BTC be higher?",
        endDate: "2025-01-15T14:30:00Z",
        clobTokenIds: '["token-up-123", "token-down-456"]',
        outcomes: '["Up", "Down"]',
        outcomePrices: '["0.45", "0.55"]',
        acceptingOrders: true,
      };

      const result = normalizeMarket(raw);

      expect(result.slug).toBe("btc-updown-15m-1705330800");
      expect(result.question).toBe("Will BTC be higher?");
      expect(result.endDate).toBe("2025-01-15T14:30:00Z");
      expect(result.tokenIds.up).toBe("token-up-123");
      expect(result.tokenIds.down).toBe("token-down-456");
      expect(result.prices.up).toBe(0.45);
      expect(result.prices.down).toBe(0.55);
      expect(result.acceptingOrders).toBe(true);
    });

    test("computes interval from slug when not provided", () => {
      const raw: GammaMarketRaw = {
        slug: "btc-updown-15m-1705330800",
        question: "Will BTC be higher?",
        endDate: "2025-01-15T14:30:00Z",
        clobTokenIds: '["token-up-123", "token-down-456"]',
        outcomes: '["Up", "Down"]',
        outcomePrices: '["0.45", "0.55"]',
        acceptingOrders: true,
      };

      const result = normalizeMarket(raw);

      expect(result.intervalKey.startTs).toBe(1705330800);
      expect(result.intervalKey.endTs).toBe(1705330800 + 900);
    });

    test("uses provided interval", () => {
      const raw: GammaMarketRaw = {
        slug: "btc-updown-15m-1705330800",
        question: "Will BTC be higher?",
        endDate: "2025-01-15T14:30:00Z",
        clobTokenIds: '["token-up-123", "token-down-456"]',
        outcomes: '["Up", "Down"]',
        outcomePrices: '["0.45", "0.55"]',
        acceptingOrders: true,
      };

      const interval = { startTs: 9999999, endTs: 9999999 + 900 };
      const result = normalizeMarket(raw, interval);

      expect(result.intervalKey.startTs).toBe(9999999);
      expect(result.intervalKey.endTs).toBe(9999999 + 900);
    });
  });
});
