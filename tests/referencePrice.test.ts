import { test, expect, describe } from "bun:test";
import { parseReferencePrice as parseKalshiRef } from "../src/venues/kalshi/client";
import { parseReferencePrice as parsePolyRef } from "../src/venues/polymarket/gamma";

describe("parseReferencePrice", () => {
  describe("Kalshi title format", () => {
    test("parses price from standard Kalshi title", () => {
      expect(
        parseKalshiRef("Bitcoin above $97,330 at 5:30 PM ET")
      ).toBe(97330);
    });

    test("parses price with no comma separator", () => {
      expect(parseKalshiRef("Bitcoin above $100 at 5:30 PM ET")).toBe(100);
    });

    test("parses 6-digit price", () => {
      expect(
        parseKalshiRef("Bitcoin above $100,123 at 5:30 PM ET")
      ).toBe(100123);
    });

    test("parses price with decimal", () => {
      expect(
        parseKalshiRef("Bitcoin above $97,330.50 at 5:30 PM ET")
      ).toBe(97330.5);
    });

    test("returns null for no price", () => {
      expect(parseKalshiRef("Bitcoin market at 5:30 PM ET")).toBeNull();
    });

    test("returns null for empty string", () => {
      expect(parseKalshiRef("")).toBeNull();
    });
  });

  describe("Polymarket question format", () => {
    test("parses price from standard Polymarket question", () => {
      expect(
        parsePolyRef("Will the price of BTC be above $97,320 at 5:30 PM ET?")
      ).toBe(97320);
    });

    test("parses price with decimals", () => {
      expect(
        parsePolyRef("Will the price of BTC be above $97,320.75 at 5:30 PM ET?")
      ).toBe(97320.75);
    });

    test("parses 6-digit price", () => {
      expect(
        parsePolyRef("Will the price of BTC be above $105,000 at 5:30 PM ET?")
      ).toBe(105000);
    });

    test("returns null for no price", () => {
      expect(parsePolyRef("Will BTC go up?")).toBeNull();
    });
  });

  describe("both parsers produce same result for same price", () => {
    test("$97,330 matches", () => {
      const kalshi = parseKalshiRef("Bitcoin above $97,330 at 5:30 PM ET");
      const poly = parsePolyRef("Will BTC be above $97,330 at 5:30 PM ET?");
      expect(kalshi).toBe(97330);
      expect(poly).toBe(97330);
      expect(kalshi).toBe(poly);
    });
  });
});
