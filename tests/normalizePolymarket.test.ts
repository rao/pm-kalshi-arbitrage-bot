import { describe, test, expect } from "bun:test";
import {
  normalizePolymarketBooks,
  extractBestLevels,
  applyPolymarketPriceChange,
  parseBookLevels,
} from "../src/normalization/normalizePolymarket";
import type { PolyBookMessage, PolyPriceChangeMessage } from "../src/venues/polymarket/wsTypes";

describe("normalizePolymarket", () => {
  describe("extractBestLevels", () => {
    test("extracts best bid and ask from book", () => {
      const book: PolyBookMessage = {
        event_type: "book",
        asset_id: "token123",
        market: "0xabc",
        bids: [
          { price: "0.45", size: "100" },
          { price: "0.48", size: "50" },
          { price: "0.42", size: "200" },
        ],
        asks: [
          { price: "0.52", size: "75" },
          { price: "0.55", size: "30" },
          { price: "0.50", size: "150" },
        ],
        timestamp: "1234567890000",
        hash: "0xhash",
      };

      const levels = extractBestLevels(book);

      expect(levels.bestBid).toEqual({ price: 0.48, size: 50 });
      expect(levels.bestAsk).toEqual({ price: 0.5, size: 150 });
    });

    test("handles empty bids", () => {
      const book: PolyBookMessage = {
        event_type: "book",
        asset_id: "token123",
        market: "0xabc",
        bids: [],
        asks: [{ price: "0.52", size: "75" }],
        timestamp: "1234567890000",
        hash: "0xhash",
      };

      const levels = extractBestLevels(book);

      expect(levels.bestBid).toBeNull();
      expect(levels.bestAsk).toEqual({ price: 0.52, size: 75 });
    });

    test("handles empty asks", () => {
      const book: PolyBookMessage = {
        event_type: "book",
        asset_id: "token123",
        market: "0xabc",
        bids: [{ price: "0.45", size: "100" }],
        asks: [],
        timestamp: "1234567890000",
        hash: "0xhash",
      };

      const levels = extractBestLevels(book);

      expect(levels.bestBid).toEqual({ price: 0.45, size: 100 });
      expect(levels.bestAsk).toBeNull();
    });

    test("handles price formats like .48", () => {
      const book: PolyBookMessage = {
        event_type: "book",
        asset_id: "token123",
        market: "0xabc",
        bids: [{ price: ".48", size: "100" }],
        asks: [{ price: ".52", size: "75" }],
        timestamp: "1234567890000",
        hash: "0xhash",
      };

      const levels = extractBestLevels(book);

      expect(levels.bestBid?.price).toBe(0.48);
      expect(levels.bestAsk?.price).toBe(0.52);
    });
  });

  describe("normalizePolymarketBooks", () => {
    test("normalizes UP and DOWN books to NormalizedQuote", () => {
      const upBook: PolyBookMessage = {
        event_type: "book",
        asset_id: "upToken",
        market: "0xabc",
        bids: [{ price: "0.45", size: "100" }],
        asks: [{ price: "0.48", size: "50" }],
        timestamp: "1234567890000",
        hash: "0xhash",
      };

      const downBook: PolyBookMessage = {
        event_type: "book",
        asset_id: "downToken",
        market: "0xabc",
        bids: [{ price: "0.50", size: "200" }],
        asks: [{ price: "0.54", size: "75" }],
        timestamp: "1234567891000",
        hash: "0xhash2",
      };

      const quote = normalizePolymarketBooks(upBook, downBook, 1234567892000);

      expect(quote).not.toBeNull();
      expect(quote!.yes_bid).toBe(0.45);
      expect(quote!.yes_ask).toBe(0.48);
      expect(quote!.yes_bid_size).toBe(100);
      expect(quote!.yes_ask_size).toBe(50);
      expect(quote!.no_bid).toBe(0.5);
      expect(quote!.no_ask).toBe(0.54);
      expect(quote!.no_bid_size).toBe(200);
      expect(quote!.no_ask_size).toBe(75);
      expect(quote!.ts_exchange).toBe(1234567891000); // Later timestamp
      expect(quote!.ts_local).toBe(1234567892000);
    });

    test("normalizes with only UP book", () => {
      const upBook: PolyBookMessage = {
        event_type: "book",
        asset_id: "upToken",
        market: "0xabc",
        bids: [{ price: "0.45", size: "100" }],
        asks: [{ price: "0.48", size: "50" }],
        timestamp: "1234567890000",
        hash: "0xhash",
      };

      const quote = normalizePolymarketBooks(upBook, null);

      expect(quote).not.toBeNull();
      expect(quote!.yes_bid).toBe(0.45);
      expect(quote!.yes_ask).toBe(0.48);
      expect(quote!.no_bid).toBe(0); // Default
      expect(quote!.no_ask).toBe(1); // Default
    });

    test("normalizes with only DOWN book", () => {
      const downBook: PolyBookMessage = {
        event_type: "book",
        asset_id: "downToken",
        market: "0xabc",
        bids: [{ price: "0.50", size: "200" }],
        asks: [{ price: "0.54", size: "75" }],
        timestamp: "1234567890000",
        hash: "0xhash",
      };

      const quote = normalizePolymarketBooks(null, downBook);

      expect(quote).not.toBeNull();
      expect(quote!.yes_bid).toBe(0); // Default
      expect(quote!.yes_ask).toBe(1); // Default
      expect(quote!.no_bid).toBe(0.5);
      expect(quote!.no_ask).toBe(0.54);
    });

    test("returns null with no books", () => {
      const quote = normalizePolymarketBooks(null, null);
      expect(quote).toBeNull();
    });
  });

  describe("applyPolymarketPriceChange", () => {
    test("updates quote with price change for UP token", () => {
      const current = {
        yes_bid: 0.45,
        yes_ask: 0.48,
        yes_bid_size: 100,
        yes_ask_size: 50,
        no_bid: 0.5,
        no_ask: 0.54,
        no_bid_size: 200,
        no_ask_size: 75,
        ts_exchange: 1234567890000,
        ts_local: 1234567890000,
      };

      const priceChange: PolyPriceChangeMessage = {
        event_type: "price_change",
        market: "0xabc",
        price_changes: [
          {
            asset_id: "upToken",
            price: "0.46",
            size: "120",
            side: "BUY",
            hash: "0xhash",
            best_bid: "0.46",
            best_ask: "0.49",
          },
        ],
        timestamp: "1234567891000",
      };

      const updated = applyPolymarketPriceChange(
        current,
        priceChange,
        "upToken",
        "downToken",
        1234567892000
      );

      expect(updated.yes_bid).toBe(0.46);
      expect(updated.yes_ask).toBe(0.49);
      expect(updated.no_bid).toBe(0.5); // Unchanged
      expect(updated.no_ask).toBe(0.54); // Unchanged
      expect(updated.ts_exchange).toBe(1234567891000);
      expect(updated.ts_local).toBe(1234567892000);
    });

    test("updates quote with price change for DOWN token", () => {
      const current = {
        yes_bid: 0.45,
        yes_ask: 0.48,
        yes_bid_size: 100,
        yes_ask_size: 50,
        no_bid: 0.5,
        no_ask: 0.54,
        no_bid_size: 200,
        no_ask_size: 75,
        ts_exchange: 1234567890000,
        ts_local: 1234567890000,
      };

      const priceChange: PolyPriceChangeMessage = {
        event_type: "price_change",
        market: "0xabc",
        price_changes: [
          {
            asset_id: "downToken",
            price: "0.51",
            size: "180",
            side: "BUY",
            hash: "0xhash",
            best_bid: "0.51",
            best_ask: "0.53",
          },
        ],
        timestamp: "1234567891000",
      };

      const updated = applyPolymarketPriceChange(
        current,
        priceChange,
        "upToken",
        "downToken"
      );

      expect(updated.yes_bid).toBe(0.45); // Unchanged
      expect(updated.yes_ask).toBe(0.48); // Unchanged
      expect(updated.no_bid).toBe(0.51);
      expect(updated.no_ask).toBe(0.53);
    });
  });

  describe("parseBookLevels", () => {
    test("parses and sorts bid levels", () => {
      const book: PolyBookMessage = {
        event_type: "book",
        asset_id: "token123",
        market: "0xabc",
        bids: [
          { price: "0.45", size: "100" },
          { price: "0.48", size: "50" },
          { price: "0.42", size: "200" },
        ],
        asks: [],
        timestamp: "1234567890000",
        hash: "0xhash",
      };

      const { bids } = parseBookLevels(book);

      // Should be sorted descending (best bid first)
      expect(bids).toHaveLength(3);
      expect(bids[0]).toEqual({ price: 0.48, size: 50 });
      expect(bids[1]).toEqual({ price: 0.45, size: 100 });
      expect(bids[2]).toEqual({ price: 0.42, size: 200 });
    });

    test("parses and sorts ask levels", () => {
      const book: PolyBookMessage = {
        event_type: "book",
        asset_id: "token123",
        market: "0xabc",
        bids: [],
        asks: [
          { price: "0.55", size: "30" },
          { price: "0.52", size: "75" },
          { price: "0.50", size: "150" },
        ],
        timestamp: "1234567890000",
        hash: "0xhash",
      };

      const { asks } = parseBookLevels(book);

      // Should be sorted ascending (best ask first)
      expect(asks).toHaveLength(3);
      expect(asks[0]).toEqual({ price: 0.5, size: 150 });
      expect(asks[1]).toEqual({ price: 0.52, size: 75 });
      expect(asks[2]).toEqual({ price: 0.55, size: 30 });
    });

    test("filters out zero-size levels", () => {
      const book: PolyBookMessage = {
        event_type: "book",
        asset_id: "token123",
        market: "0xabc",
        bids: [
          { price: "0.45", size: "0" },
          { price: "0.48", size: "50" },
        ],
        asks: [
          { price: "0.52", size: "75" },
          { price: "0.55", size: "0" },
        ],
        timestamp: "1234567890000",
        hash: "0xhash",
      };

      const { bids, asks } = parseBookLevels(book);

      expect(bids).toHaveLength(1);
      expect(bids[0].price).toBe(0.48);
      expect(asks).toHaveLength(1);
      expect(asks[0].price).toBe(0.52);
    });
  });
});
