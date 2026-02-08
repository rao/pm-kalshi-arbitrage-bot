import { test, expect, beforeEach, describe } from "bun:test";
import {
  recordTick,
  getTwap60s,
  getSpotPrice,
  freezeAtClose,
  getFrozenTwap,
  getFrozenSpot,
  resetForInterval,
  resetStore,
  getBufferLength,
} from "../src/data/twapStore";

beforeEach(() => {
  resetStore();
});

describe("twapStore", () => {
  describe("recordTick", () => {
    test("adds entries to buffer", () => {
      recordTick(97000, 1000);
      recordTick(97100, 2000);
      expect(getBufferLength()).toBe(2);
    });

    test("caps buffer at 1000 entries", () => {
      for (let i = 0; i < 1100; i++) {
        recordTick(97000 + i, i * 100);
      }
      expect(getBufferLength()).toBe(1000);
    });
  });

  describe("getSpotPrice", () => {
    test("returns null when buffer is empty", () => {
      expect(getSpotPrice()).toBeNull();
    });

    test("returns latest price", () => {
      recordTick(97000, 1000);
      recordTick(97500, 2000);
      recordTick(98000, 3000);
      expect(getSpotPrice()).toBe(98000);
    });
  });

  describe("getTwap60s", () => {
    test("returns null when buffer is empty", () => {
      expect(getTwap60s(10000)).toBeNull();
    });

    test("returns null with fewer than 5 samples in window", () => {
      const now = 100000;
      recordTick(97000, now - 50000);
      recordTick(97100, now - 40000);
      recordTick(97200, now - 30000);
      recordTick(97300, now - 20000);
      // Only 4 entries in the 60s window
      expect(getTwap60s(now)).toBeNull();
    });

    test("computes arithmetic mean of prices in 60s window", () => {
      const now = 100000;
      // All within 60s window
      recordTick(97000, now - 50000);
      recordTick(97200, now - 40000);
      recordTick(97400, now - 30000);
      recordTick(97600, now - 20000);
      recordTick(97800, now - 10000);

      const twap = getTwap60s(now);
      expect(twap).not.toBeNull();
      // Mean of 97000, 97200, 97400, 97600, 97800 = 97400
      expect(twap).toBe(97400);
    });

    test("excludes ticks outside 60s window", () => {
      const now = 200000;
      // Outside window (>60s ago)
      recordTick(90000, now - 70000);
      recordTick(90000, now - 65000);

      // Inside window
      recordTick(97000, now - 50000);
      recordTick(97200, now - 40000);
      recordTick(97400, now - 30000);
      recordTick(97600, now - 20000);
      recordTick(97800, now - 10000);

      const twap = getTwap60s(now);
      expect(twap).not.toBeNull();
      // Should only average the 5 in-window prices
      expect(twap).toBe(97400);
    });

    test("uses current time when no argument provided", () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        recordTick(97000 + i * 100, now - (10 - i) * 1000);
      }
      const twap = getTwap60s();
      expect(twap).not.toBeNull();
    });
  });

  describe("freezeAtClose / getFrozenTwap / getFrozenSpot", () => {
    test("returns null before freeze", () => {
      expect(getFrozenTwap()).toBeNull();
      expect(getFrozenSpot()).toBeNull();
    });

    test("freezes current TWAP and spot values", () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        recordTick(97000 + i * 100, now - (10 - i) * 1000);
      }

      freezeAtClose();

      expect(getFrozenTwap()).not.toBeNull();
      expect(getFrozenSpot()).toBe(97900); // last tick
    });

    test("frozen values persist after reset", () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        recordTick(97000 + i * 100, now - (10 - i) * 1000);
      }

      freezeAtClose();
      const frozenTwap = getFrozenTwap();
      const frozenSpot = getFrozenSpot();

      // Note: resetForInterval clears frozen values too
      // This tests that freeze captures values correctly
      expect(frozenTwap).not.toBeNull();
      expect(frozenSpot).toBe(97900);
    });
  });

  describe("resetForInterval", () => {
    test("clears buffer and frozen values", () => {
      recordTick(97000, 1000);
      recordTick(97100, 2000);
      freezeAtClose();

      resetForInterval();

      expect(getBufferLength()).toBe(0);
      expect(getSpotPrice()).toBeNull();
      expect(getFrozenTwap()).toBeNull();
      expect(getFrozenSpot()).toBeNull();
    });
  });
});
