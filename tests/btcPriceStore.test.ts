import { test, expect, describe, beforeEach } from "bun:test";
import {
  recordPrice,
  resetForInterval,
  setReferencePrice,
  getReferencePrice,
  getAnalytics,
  getCurrentSide,
  getLatestPrice,
  resetStore,
} from "../src/data/btcPriceStore";

describe("btcPriceStore", () => {
  beforeEach(() => {
    resetStore();
  });

  describe("recordPrice", () => {
    test("stores prices and updates latest", () => {
      recordPrice(100000, 1000);
      recordPrice(100050, 1001);
      expect(getLatestPrice()).toBe(100050);
    });

    test("caps history at 500 entries", () => {
      for (let i = 0; i < 600; i++) {
        recordPrice(100000 + i, 1000 + i);
      }
      const analytics = getAnalytics();
      expect(analytics.sampleCount).toBe(500);
    });

    test("tracks interval high and low", () => {
      recordPrice(100000, 1000);
      recordPrice(100200, 1001);
      recordPrice(99900, 1002);
      recordPrice(100100, 1003);

      const analytics = getAnalytics();
      expect(analytics.rangeUsd).toBe(300); // 100200 - 99900
    });
  });

  describe("reference price", () => {
    test("starts as null", () => {
      expect(getReferencePrice()).toBeNull();
    });

    test("can be set and retrieved", () => {
      setReferencePrice(100000);
      expect(getReferencePrice()).toBe(100000);
    });

    test("initializes lastSide from existing price history", () => {
      recordPrice(100050, 1000);
      setReferencePrice(100000);
      expect(getCurrentSide()).toBe("above");

      resetStore();
      recordPrice(99950, 1000);
      setReferencePrice(100000);
      expect(getCurrentSide()).toBe("below");
    });
  });

  describe("crossing detection", () => {
    test("no crossings without reference price", () => {
      recordPrice(100000, 1000);
      recordPrice(99000, 1001);
      recordPrice(101000, 1002);
      expect(getAnalytics().crossingCount).toBe(0);
    });

    test("detects single crossing from above to below", () => {
      setReferencePrice(100000);
      recordPrice(100050, 1000); // above
      recordPrice(99950, 1001);  // below — crossing!
      expect(getAnalytics().crossingCount).toBe(1);
    });

    test("detects crossing from below to above", () => {
      recordPrice(99950, 999);
      setReferencePrice(100000);
      // lastSide initialized to "below" from existing price
      recordPrice(100050, 1000); // above — crossing!
      expect(getAnalytics().crossingCount).toBe(1);
    });

    test("detects multiple crossings", () => {
      setReferencePrice(100000);
      recordPrice(100050, 1000); // above
      recordPrice(99950, 1001);  // below — cross 1
      recordPrice(100050, 1002); // above — cross 2
      recordPrice(99950, 1003);  // below — cross 3
      expect(getAnalytics().crossingCount).toBe(3);
    });

    test("staying on same side does not increment crossings", () => {
      setReferencePrice(100000);
      recordPrice(100050, 1000); // above
      recordPrice(100100, 1001); // still above
      recordPrice(100200, 1002); // still above
      expect(getAnalytics().crossingCount).toBe(0);
    });

    test("price exactly at reference counts as above", () => {
      setReferencePrice(100000);
      recordPrice(100050, 1000); // above
      recordPrice(100000, 1001); // exactly at ref = "above" (no crossing)
      expect(getAnalytics().crossingCount).toBe(0);
    });
  });

  describe("getAnalytics", () => {
    test("returns complete analytics snapshot", () => {
      setReferencePrice(100000);
      recordPrice(100050, 1000);
      recordPrice(99900, 1001);
      recordPrice(100100, 1002);

      const analytics = getAnalytics();
      expect(analytics.referencePrice).toBe(100000);
      expect(analytics.crossingCount).toBe(2); // above → below → above
      expect(analytics.rangeUsd).toBe(200); // 100100 - 99900
      expect(analytics.distFromRefUsd).toBe(100); // |100100 - 100000|
      expect(analytics.currentSide).toBe("above");
      expect(analytics.sampleCount).toBe(3);
    });

    test("returns zeros when no data", () => {
      const analytics = getAnalytics();
      expect(analytics.referencePrice).toBeNull();
      expect(analytics.crossingCount).toBe(0);
      expect(analytics.rangeUsd).toBe(0);
      expect(analytics.distFromRefUsd).toBe(0);
      expect(analytics.currentSide).toBeNull();
      expect(analytics.sampleCount).toBe(0);
    });
  });

  describe("resetForInterval", () => {
    test("clears all state", () => {
      setReferencePrice(100000);
      recordPrice(100050, 1000);
      recordPrice(99950, 1001);

      resetForInterval("new-interval");

      expect(getReferencePrice()).toBeNull();
      expect(getLatestPrice()).toBeNull();
      expect(getCurrentSide()).toBeNull();
      expect(getAnalytics().crossingCount).toBe(0);
      expect(getAnalytics().rangeUsd).toBe(0);
      expect(getAnalytics().sampleCount).toBe(0);
    });
  });

  describe("getCurrentSide", () => {
    test("returns null before reference is set", () => {
      recordPrice(100050, 1000);
      expect(getCurrentSide()).toBeNull();
    });

    test("returns correct side after reference and price", () => {
      setReferencePrice(100000);
      recordPrice(100050, 1000);
      expect(getCurrentSide()).toBe("above");
    });
  });
});
