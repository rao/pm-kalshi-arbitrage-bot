import { test, expect, describe, beforeEach } from "bun:test";
import {
  MappingStore,
  type PolymarketMapping,
  type KalshiMapping,
} from "../src/markets/mappingStore";
import { getIntervalKey, getNextIntervalKey } from "../src/time/interval";

describe("MappingStore", () => {
  let store: MappingStore;

  const testPolymarketMapping: PolymarketMapping = {
    upToken: "token-up-123",
    downToken: "token-down-456",
    slug: "btc-updown-15m-1705330800",
    endTs: 1705331700,
  };

  const testKalshiMapping: KalshiMapping = {
    eventTicker: "KXBTC15M-26FEB031730",
    marketTicker: "KXBTC15M-26FEB031730-30",
    seriesTicker: "KXBTC15M",
    closeTs: 1705331700,
  };

  const testInterval = { startTs: 1705330800, endTs: 1705331700 };

  beforeEach(() => {
    store = new MappingStore();
  });

  describe("setMapping / getMapping", () => {
    test("stores and retrieves polymarket mapping", () => {
      store.setPolymarketMapping(testInterval, testPolymarketMapping);

      const result = store.getMapping(testInterval);

      expect(result).not.toBeNull();
      expect(result!.polymarket?.upToken).toBe("token-up-123");
      expect(result!.polymarket?.downToken).toBe("token-down-456");
      expect(result!.polymarket?.slug).toBe("btc-updown-15m-1705330800");
      expect(result!.intervalKey).toEqual(testInterval);
    });

    test("stores and retrieves kalshi mapping", () => {
      store.setKalshiMapping(testInterval, testKalshiMapping);

      const result = store.getMapping(testInterval);

      expect(result).not.toBeNull();
      expect(result!.kalshi?.eventTicker).toBe("KXBTC15M-26FEB031730");
      expect(result!.kalshi?.marketTicker).toBe("KXBTC15M-26FEB031730-30");
      expect(result!.kalshi?.seriesTicker).toBe("KXBTC15M");
    });

    test("stores both polymarket and kalshi mappings", () => {
      store.setPolymarketMapping(testInterval, testPolymarketMapping);
      store.setKalshiMapping(testInterval, testKalshiMapping);

      const result = store.getMapping(testInterval);

      expect(result).not.toBeNull();
      expect(result!.polymarket?.slug).toBe("btc-updown-15m-1705330800");
      expect(result!.kalshi?.eventTicker).toBe("KXBTC15M-26FEB031730");
    });

    test("preserves existing mapping when adding another venue", () => {
      store.setPolymarketMapping(testInterval, testPolymarketMapping);
      store.setKalshiMapping(testInterval, testKalshiMapping);

      const result = store.getMapping(testInterval);

      // Both should be present
      expect(result!.polymarket).toBeDefined();
      expect(result!.kalshi).toBeDefined();
    });

    test("returns null for non-existent mapping", () => {
      const result = store.getMapping({
        startTs: 9999999,
        endTs: 9999999 + 900,
      });
      expect(result).toBeNull();
    });

    test("overwrites existing mapping for same venue", () => {
      store.setPolymarketMapping(testInterval, testPolymarketMapping);

      const newMapping: PolymarketMapping = {
        upToken: "new-up-789",
        downToken: "new-down-012",
        slug: "btc-updown-15m-new",
        endTs: 1705331700,
      };

      store.setPolymarketMapping(testInterval, newMapping);

      const result = store.getMapping(testInterval);
      expect(result!.polymarket?.upToken).toBe("new-up-789");
    });

    test("records discoveredAt timestamp", () => {
      const before = Date.now();
      store.setPolymarketMapping(testInterval, testPolymarketMapping);
      const after = Date.now();

      const result = store.getMapping(testInterval);

      expect(result!.discoveredAt).toBeGreaterThanOrEqual(before);
      expect(result!.discoveredAt).toBeLessThanOrEqual(after);
    });
  });

  describe("getCurrentMapping / getNextMapping", () => {
    test("getCurrentMapping returns mapping for current interval", () => {
      const currentInterval = getIntervalKey();
      store.setPolymarketMapping(currentInterval, testPolymarketMapping);

      const result = store.getCurrentMapping();
      expect(result).not.toBeNull();
      expect(result!.polymarket?.upToken).toBe("token-up-123");
    });

    test("getNextMapping returns mapping for next interval", () => {
      const nextInterval = getNextIntervalKey();
      store.setKalshiMapping(nextInterval, testKalshiMapping);

      const result = store.getNextMapping();
      expect(result).not.toBeNull();
      expect(result!.kalshi?.eventTicker).toBe("KXBTC15M-26FEB031730");
    });

    test("returns null when mapping not found", () => {
      expect(store.getCurrentMapping()).toBeNull();
      expect(store.getNextMapping()).toBeNull();
    });
  });

  describe("hasMapping / deleteMapping", () => {
    test("hasMapping returns true when mapping exists", () => {
      store.setPolymarketMapping(testInterval, testPolymarketMapping);
      expect(store.hasMapping(testInterval)).toBe(true);
    });

    test("hasMapping returns false when mapping does not exist", () => {
      expect(store.hasMapping(testInterval)).toBe(false);
    });

    test("deleteMapping removes a mapping", () => {
      store.setPolymarketMapping(testInterval, testPolymarketMapping);
      store.setKalshiMapping(testInterval, testKalshiMapping);
      expect(store.hasMapping(testInterval)).toBe(true);

      const deleted = store.deleteMapping(testInterval);

      expect(deleted).toBe(true);
      expect(store.hasMapping(testInterval)).toBe(false);
    });

    test("deleteMapping returns false for non-existent mapping", () => {
      const deleted = store.deleteMapping(testInterval);
      expect(deleted).toBe(false);
    });
  });

  describe("pruneOldMappings", () => {
    test("removes mappings older than max age", async () => {
      store.setPolymarketMapping(testInterval, testPolymarketMapping);

      // Wait a bit then prune with very short max age
      await new Promise((resolve) => setTimeout(resolve, 10));

      const pruned = store.pruneOldMappings(5); // 5ms max age

      expect(pruned).toBe(1);
      expect(store.size()).toBe(0);
    });

    test("keeps recent mappings", () => {
      store.setPolymarketMapping(testInterval, testPolymarketMapping);

      const pruned = store.pruneOldMappings(60_000); // 1 minute max age

      expect(pruned).toBe(0);
      expect(store.size()).toBe(1);
    });

    test("returns count of pruned mappings", async () => {
      const interval1 = { startTs: 1000, endTs: 1900 };
      const interval2 = { startTs: 2000, endTs: 2900 };
      const interval3 = { startTs: 3000, endTs: 3900 };

      store.setPolymarketMapping(interval1, testPolymarketMapping);
      store.setKalshiMapping(interval2, testKalshiMapping);
      store.setPolymarketMapping(interval3, testPolymarketMapping);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const pruned = store.pruneOldMappings(5);

      expect(pruned).toBe(3);
    });
  });

  describe("getAllMappings / size / clear", () => {
    test("getAllMappings returns all stored mappings", () => {
      const interval1 = { startTs: 1000, endTs: 1900 };
      const interval2 = { startTs: 2000, endTs: 2900 };

      store.setPolymarketMapping(interval1, testPolymarketMapping);
      store.setKalshiMapping(interval2, testKalshiMapping);

      const all = store.getAllMappings();

      expect(all.length).toBe(2);
    });

    test("size returns number of mappings", () => {
      expect(store.size()).toBe(0);

      store.setPolymarketMapping(testInterval, testPolymarketMapping);
      expect(store.size()).toBe(1);

      const interval2 = { startTs: 2000, endTs: 2900 };
      store.setKalshiMapping(interval2, testKalshiMapping);
      expect(store.size()).toBe(2);
    });

    test("adding both venues to same interval counts as one mapping", () => {
      store.setPolymarketMapping(testInterval, testPolymarketMapping);
      expect(store.size()).toBe(1);

      store.setKalshiMapping(testInterval, testKalshiMapping);
      expect(store.size()).toBe(1); // Still 1 because same interval
    });

    test("clear removes all mappings", () => {
      store.setPolymarketMapping(testInterval, testPolymarketMapping);
      store.setKalshiMapping({ startTs: 2000, endTs: 2900 }, testKalshiMapping);

      expect(store.size()).toBe(2);

      store.clear();

      expect(store.size()).toBe(0);
    });
  });
});
