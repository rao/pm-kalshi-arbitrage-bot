import { describe, test, expect } from "bun:test";
import {
  normalizeKalshiSnapshot,
  applyKalshiDelta,
  centsToDecimal,
  initializeBidsFromSnapshot,
  computeQuoteFromBids,
  validateKalshiQuote,
} from "../src/normalization/normalizeKalshi";
import type {
  KalshiOrderbookSnapshot,
  KalshiOrderbookDelta,
} from "../src/venues/kalshi/wsTypes";

describe("normalizeKalshi", () => {
  describe("centsToDecimal", () => {
    test("converts cents to decimal", () => {
      expect(centsToDecimal(50)).toBe(0.5);
      expect(centsToDecimal(42)).toBe(0.42);
      expect(centsToDecimal(1)).toBe(0.01);
      expect(centsToDecimal(99)).toBe(0.99);
    });
  });

  describe("normalizeKalshiSnapshot", () => {
    test("normalizes snapshot with both YES and NO bids", () => {
      const snapshot: KalshiOrderbookSnapshot = {
        type: "orderbook_snapshot",
        sid: 1,
        seq: 1,
        msg: {
          market_ticker: "KXBTC15M-26FEB031730-30",
          market_id: "abc123",
          // Bids sorted ascending - best bid is LAST
          yes: [
            [35, 100], // 35 cents, 100 contracts
            [38, 50],
            [42, 25], // Best YES bid: 42 cents
          ],
          no: [
            [50, 200],
            [54, 75],
            [56, 30], // Best NO bid: 56 cents
          ],
        },
      };

      const quote = normalizeKalshiSnapshot(snapshot);

      // YES bid is best YES bid
      expect(quote.yes_bid).toBe(0.42);
      expect(quote.yes_bid_size).toBe(25);

      // YES ask is IMPLIED from best NO bid: 100 - 56 = 44 cents
      expect(quote.yes_ask).toBe(0.44);
      expect(quote.yes_ask_size).toBe(30); // Size at best NO bid

      // NO bid is best NO bid
      expect(quote.no_bid).toBe(0.56);
      expect(quote.no_bid_size).toBe(30);

      // NO ask is IMPLIED from best YES bid: 100 - 42 = 58 cents
      expect(quote.no_ask).toBe(0.58);
      expect(quote.no_ask_size).toBe(25); // Size at best YES bid
    });

    test("handles empty YES bids", () => {
      const snapshot: KalshiOrderbookSnapshot = {
        type: "orderbook_snapshot",
        sid: 1,
        seq: 1,
        msg: {
          market_ticker: "KXBTC15M-26FEB031730-30",
          market_id: "abc123",
          yes: [], // No YES bids
          no: [[56, 30]],
        },
      };

      const quote = normalizeKalshiSnapshot(snapshot);

      expect(quote.yes_bid).toBe(0); // No bid
      expect(quote.yes_bid_size).toBe(0);
      expect(quote.yes_ask).toBe(0.44); // Implied from NO bid
      expect(quote.no_bid).toBe(0.56);
      expect(quote.no_ask).toBe(1); // No YES bid to imply from
    });

    test("handles empty NO bids", () => {
      const snapshot: KalshiOrderbookSnapshot = {
        type: "orderbook_snapshot",
        sid: 1,
        seq: 1,
        msg: {
          market_ticker: "KXBTC15M-26FEB031730-30",
          market_id: "abc123",
          yes: [[42, 25]],
          no: [], // No NO bids
        },
      };

      const quote = normalizeKalshiSnapshot(snapshot);

      expect(quote.yes_bid).toBe(0.42);
      expect(quote.yes_ask).toBe(1); // No NO bid to imply from
      expect(quote.no_bid).toBe(0); // No bid
      expect(quote.no_ask).toBe(0.58); // Implied from YES bid
    });

    test("handles empty orderbook", () => {
      const snapshot: KalshiOrderbookSnapshot = {
        type: "orderbook_snapshot",
        sid: 1,
        seq: 1,
        msg: {
          market_ticker: "KXBTC15M-26FEB031730-30",
          market_id: "abc123",
          yes: [],
          no: [],
        },
      };

      const quote = normalizeKalshiSnapshot(snapshot);

      expect(quote.yes_bid).toBe(0);
      expect(quote.yes_ask).toBe(1);
      expect(quote.no_bid).toBe(0);
      expect(quote.no_ask).toBe(1);
    });
  });

  describe("applyKalshiDelta", () => {
    test("applies positive delta to YES side", () => {
      const yesBids: [number, number][] = [[42, 25]];
      const noBids: [number, number][] = [[56, 30]];

      const delta: KalshiOrderbookDelta = {
        type: "orderbook_delta",
        sid: 1,
        seq: 2,
        msg: {
          market_ticker: "KXBTC15M-26FEB031730-30",
          market_id: "abc123",
          price: 45, // New YES bid at 45 cents
          delta: 100, // Add 100 contracts
          side: "yes",
          ts: "2024-02-03T12:00:00Z",
        },
      };

      const result = applyKalshiDelta(yesBids, noBids, delta);

      // New best YES bid should be 45
      expect(result.quote.yes_bid).toBe(0.45);
      expect(result.yesBids).toContainEqual([45, 100]);
    });

    test("applies negative delta removing a level", () => {
      const yesBids: [number, number][] = [
        [35, 100],
        [42, 25],
      ];
      const noBids: [number, number][] = [[56, 30]];

      const delta: KalshiOrderbookDelta = {
        type: "orderbook_delta",
        sid: 1,
        seq: 2,
        msg: {
          market_ticker: "KXBTC15M-26FEB031730-30",
          market_id: "abc123",
          price: 42,
          delta: -25, // Remove all 25 contracts
          side: "yes",
          ts: "2024-02-03T12:00:00Z",
        },
      };

      const result = applyKalshiDelta(yesBids, noBids, delta);

      // Best YES bid should now be 35
      expect(result.quote.yes_bid).toBe(0.35);
      expect(result.yesBids).not.toContainEqual([42, expect.anything()]);
    });

    test("applies partial delta", () => {
      const yesBids: [number, number][] = [[42, 100]];
      const noBids: [number, number][] = [[56, 30]];

      const delta: KalshiOrderbookDelta = {
        type: "orderbook_delta",
        sid: 1,
        seq: 2,
        msg: {
          market_ticker: "KXBTC15M-26FEB031730-30",
          market_id: "abc123",
          price: 42,
          delta: -30, // Remove 30 of 100
          side: "yes",
          ts: "2024-02-03T12:00:00Z",
        },
      };

      const result = applyKalshiDelta(yesBids, noBids, delta);

      expect(result.quote.yes_bid).toBe(0.42);
      expect(result.quote.yes_bid_size).toBe(70);
      expect(result.yesBids).toContainEqual([42, 70]);
    });

    test("applies delta to NO side and updates implied YES ask", () => {
      const yesBids: [number, number][] = [[42, 25]];
      const noBids: [number, number][] = [[56, 30]];

      const delta: KalshiOrderbookDelta = {
        type: "orderbook_delta",
        sid: 1,
        seq: 2,
        msg: {
          market_ticker: "KXBTC15M-26FEB031730-30",
          market_id: "abc123",
          price: 60, // New best NO bid at 60 cents
          delta: 50,
          side: "no",
          ts: "2024-02-03T12:00:00Z",
        },
      };

      const result = applyKalshiDelta(yesBids, noBids, delta);

      // Best NO bid is now 60
      expect(result.quote.no_bid).toBe(0.6);
      // YES ask (implied) is now 100 - 60 = 40
      expect(result.quote.yes_ask).toBe(0.4);
    });

    test("maintains sorted order after delta", () => {
      const yesBids: [number, number][] = [
        [30, 50],
        [40, 100],
      ];
      const noBids: [number, number][] = [[56, 30]];

      const delta: KalshiOrderbookDelta = {
        type: "orderbook_delta",
        sid: 1,
        seq: 2,
        msg: {
          market_ticker: "KXBTC15M-26FEB031730-30",
          market_id: "abc123",
          price: 35, // Insert between 30 and 40
          delta: 75,
          side: "yes",
          ts: "2024-02-03T12:00:00Z",
        },
      };

      const result = applyKalshiDelta(yesBids, noBids, delta);

      // Should be sorted ascending
      expect(result.yesBids[0][0]).toBe(30);
      expect(result.yesBids[1][0]).toBe(35);
      expect(result.yesBids[2][0]).toBe(40);
    });
  });

  describe("initializeBidsFromSnapshot", () => {
    test("clones bid arrays from snapshot", () => {
      const snapshot: KalshiOrderbookSnapshot = {
        type: "orderbook_snapshot",
        sid: 1,
        seq: 1,
        msg: {
          market_ticker: "KXBTC15M-26FEB031730-30",
          market_id: "abc123",
          yes: [[42, 25]],
          no: [[56, 30]],
        },
      };

      const { yesBids, noBids } = initializeBidsFromSnapshot(snapshot);

      // Should be copies, not references
      expect(yesBids).toEqual([[42, 25]]);
      expect(noBids).toEqual([[56, 30]]);
      expect(yesBids).not.toBe(snapshot.msg.yes);
      expect(noBids).not.toBe(snapshot.msg.no);
    });
  });

  describe("computeQuoteFromBids", () => {
    test("computes quote from bid arrays", () => {
      const yesBids: [number, number][] = [
        [35, 100],
        [42, 25],
      ];
      const noBids: [number, number][] = [
        [50, 200],
        [56, 30],
      ];

      const quote = computeQuoteFromBids(yesBids, noBids, 1234567890000);

      expect(quote.yes_bid).toBe(0.42);
      expect(quote.yes_bid_size).toBe(25);
      expect(quote.yes_ask).toBe(0.44); // 100 - 56
      expect(quote.yes_ask_size).toBe(30);
      expect(quote.no_bid).toBe(0.56);
      expect(quote.no_bid_size).toBe(30);
      expect(quote.no_ask).toBe(0.58); // 100 - 42
      expect(quote.no_ask_size).toBe(25);
      expect(quote.ts_exchange).toBe(1234567890000);
    });
  });

  describe("validateKalshiQuote", () => {
    test("returns true for valid quote", () => {
      // YES ask + NO ask should be close to 1.0
      const quote = {
        yes_bid: 0.42,
        yes_ask: 0.44, // From NO bid of 56
        yes_bid_size: 25,
        yes_ask_size: 30,
        no_bid: 0.56,
        no_ask: 0.58, // From YES bid of 42
        no_bid_size: 30,
        no_ask_size: 25,
        ts_exchange: 0,
        ts_local: 0,
      };

      // 0.44 + 0.58 = 1.02 (within tolerance)
      expect(validateKalshiQuote(quote)).toBe(true);
    });

    test("returns false for invalid quote", () => {
      const quote = {
        yes_bid: 0.42,
        yes_ask: 0.44,
        yes_bid_size: 25,
        yes_ask_size: 30,
        no_bid: 0.56,
        no_ask: 0.70, // Invalid - would make sum > 1.14
        no_bid_size: 30,
        no_ask_size: 25,
        ts_exchange: 0,
        ts_local: 0,
      };

      expect(validateKalshiQuote(quote)).toBe(false);
    });

    test("respects custom tolerance", () => {
      const quote = {
        yes_bid: 0.42,
        yes_ask: 0.48,
        yes_bid_size: 25,
        yes_ask_size: 30,
        no_bid: 0.52,
        no_ask: 0.58,
        no_bid_size: 30,
        no_ask_size: 25,
        ts_exchange: 0,
        ts_local: 0,
      };

      // 0.48 + 0.58 = 1.06 (6% deviation)
      expect(validateKalshiQuote(quote, 0.05)).toBe(false);
      expect(validateKalshiQuote(quote, 0.10)).toBe(true);
    });
  });

  describe("implied ask calculation", () => {
    test("YES ask is implied from NO bid correctly", () => {
      // If best NO bid is 56 cents, someone is willing to pay 56c for NO
      // This means they're willing to sell YES at 44c (100 - 56)
      // So YES ask = 0.44
      const snapshot: KalshiOrderbookSnapshot = {
        type: "orderbook_snapshot",
        sid: 1,
        seq: 1,
        msg: {
          market_ticker: "KXBTC15M-26FEB031730-30",
          market_id: "abc123",
          yes: [],
          no: [[56, 100]],
        },
      };

      const quote = normalizeKalshiSnapshot(snapshot);
      expect(quote.yes_ask).toBe(0.44);
    });

    test("NO ask is implied from YES bid correctly", () => {
      // If best YES bid is 42 cents, someone is willing to pay 42c for YES
      // This means they're willing to sell NO at 58c (100 - 42)
      // So NO ask = 0.58
      const snapshot: KalshiOrderbookSnapshot = {
        type: "orderbook_snapshot",
        sid: 1,
        seq: 1,
        msg: {
          market_ticker: "KXBTC15M-26FEB031730-30",
          market_id: "abc123",
          yes: [[42, 100]],
          no: [],
        },
      };

      const quote = normalizeKalshiSnapshot(snapshot);
      expect(quote.no_ask).toBe(0.58);
    });
  });
});
