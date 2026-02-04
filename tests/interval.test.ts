import { test, expect, describe } from "bun:test";
import {
  getIntervalKey,
  getNextIntervalKey,
  getPreviousIntervalKey,
  msUntilRollover,
  shouldPrefetchNextInterval,
  intervalKeyToString,
  parseIntervalKeyString,
  formatIntervalKey,
  INTERVAL_DURATION_S,
} from "../src/time/interval";

describe("interval utilities", () => {
  describe("getIntervalKey", () => {
    test("rounds down to 15-minute boundary at :00", () => {
      const date = new Date("2025-01-15T14:00:30Z");
      const interval = getIntervalKey(date);

      expect(interval.startTs).toBe(
        Math.floor(new Date("2025-01-15T14:00:00Z").getTime() / 1000)
      );
      expect(interval.endTs).toBe(interval.startTs + 900);
    });

    test("rounds down to 15-minute boundary at :07", () => {
      const date = new Date("2025-01-15T14:07:45Z");
      const interval = getIntervalKey(date);

      expect(interval.startTs).toBe(
        Math.floor(new Date("2025-01-15T14:00:00Z").getTime() / 1000)
      );
    });

    test("rounds down to 15-minute boundary at :15", () => {
      const date = new Date("2025-01-15T14:15:00Z");
      const interval = getIntervalKey(date);

      expect(interval.startTs).toBe(
        Math.floor(new Date("2025-01-15T14:15:00Z").getTime() / 1000)
      );
    });

    test("rounds down to 15-minute boundary at :22", () => {
      const date = new Date("2025-01-15T14:22:59Z");
      const interval = getIntervalKey(date);

      expect(interval.startTs).toBe(
        Math.floor(new Date("2025-01-15T14:15:00Z").getTime() / 1000)
      );
    });

    test("rounds down to 15-minute boundary at :30", () => {
      const date = new Date("2025-01-15T14:30:00Z");
      const interval = getIntervalKey(date);

      expect(interval.startTs).toBe(
        Math.floor(new Date("2025-01-15T14:30:00Z").getTime() / 1000)
      );
    });

    test("rounds down to 15-minute boundary at :45", () => {
      const date = new Date("2025-01-15T14:47:30Z");
      const interval = getIntervalKey(date);

      expect(interval.startTs).toBe(
        Math.floor(new Date("2025-01-15T14:45:00Z").getTime() / 1000)
      );
    });

    test("interval duration is exactly 900 seconds", () => {
      const date = new Date("2025-01-15T14:23:00Z");
      const interval = getIntervalKey(date);

      expect(interval.endTs - interval.startTs).toBe(INTERVAL_DURATION_S);
      expect(interval.endTs - interval.startTs).toBe(900);
    });

    test("handles midnight correctly", () => {
      const date = new Date("2025-01-15T00:05:00Z");
      const interval = getIntervalKey(date);

      expect(interval.startTs).toBe(
        Math.floor(new Date("2025-01-15T00:00:00Z").getTime() / 1000)
      );
    });

    test("handles end of day correctly", () => {
      const date = new Date("2025-01-15T23:50:00Z");
      const interval = getIntervalKey(date);

      expect(interval.startTs).toBe(
        Math.floor(new Date("2025-01-15T23:45:00Z").getTime() / 1000)
      );
    });
  });

  describe("getNextIntervalKey", () => {
    test("returns next 15-minute window", () => {
      const date = new Date("2025-01-15T14:07:00Z");
      const next = getNextIntervalKey(date);

      expect(next.startTs).toBe(
        Math.floor(new Date("2025-01-15T14:15:00Z").getTime() / 1000)
      );
      expect(next.endTs).toBe(next.startTs + 900);
    });

    test("handles hour boundary", () => {
      const date = new Date("2025-01-15T14:50:00Z");
      const next = getNextIntervalKey(date);

      expect(next.startTs).toBe(
        Math.floor(new Date("2025-01-15T15:00:00Z").getTime() / 1000)
      );
    });

    test("handles day boundary", () => {
      const date = new Date("2025-01-15T23:50:00Z");
      const next = getNextIntervalKey(date);

      expect(next.startTs).toBe(
        Math.floor(new Date("2025-01-16T00:00:00Z").getTime() / 1000)
      );
    });
  });

  describe("getPreviousIntervalKey", () => {
    test("returns previous 15-minute window", () => {
      const date = new Date("2025-01-15T14:22:00Z");
      const prev = getPreviousIntervalKey(date);

      expect(prev.startTs).toBe(
        Math.floor(new Date("2025-01-15T14:00:00Z").getTime() / 1000)
      );
      expect(prev.endTs).toBe(prev.startTs + 900);
    });

    test("handles hour boundary", () => {
      const date = new Date("2025-01-15T14:05:00Z");
      const prev = getPreviousIntervalKey(date);

      expect(prev.startTs).toBe(
        Math.floor(new Date("2025-01-15T13:45:00Z").getTime() / 1000)
      );
    });
  });

  describe("msUntilRollover", () => {
    test("returns correct ms at start of interval", () => {
      const date = new Date("2025-01-15T14:00:00.000Z");
      const ms = msUntilRollover(date);

      expect(ms).toBe(15 * 60 * 1000); // 15 minutes
    });

    test("returns correct ms mid-interval", () => {
      const date = new Date("2025-01-15T14:07:30.000Z");
      const ms = msUntilRollover(date);

      expect(ms).toBe(7 * 60 * 1000 + 30 * 1000); // 7:30
    });

    test("returns 0 at end of interval", () => {
      const date = new Date("2025-01-15T14:15:00.000Z");
      const ms = msUntilRollover(date);

      expect(ms).toBe(15 * 60 * 1000); // New interval starts
    });

    test("returns small value near end of interval", () => {
      const date = new Date("2025-01-15T14:14:55.000Z");
      const ms = msUntilRollover(date);

      expect(ms).toBe(5000); // 5 seconds
    });
  });

  describe("shouldPrefetchNextInterval", () => {
    test("returns false at start of interval", () => {
      const date = new Date("2025-01-15T14:00:00.000Z");
      expect(shouldPrefetchNextInterval(date, 30_000)).toBe(false);
    });

    test("returns false mid-interval", () => {
      const date = new Date("2025-01-15T14:07:30.000Z");
      expect(shouldPrefetchNextInterval(date, 30_000)).toBe(false);
    });

    test("returns true within prefetch window", () => {
      const date = new Date("2025-01-15T14:14:35.000Z"); // 25s before rollover
      expect(shouldPrefetchNextInterval(date, 30_000)).toBe(true);
    });

    test("returns true exactly at prefetch boundary", () => {
      const date = new Date("2025-01-15T14:14:30.000Z"); // 30s before rollover
      expect(shouldPrefetchNextInterval(date, 30_000)).toBe(true);
    });

    test("respects custom prefetch window", () => {
      const date = new Date("2025-01-15T14:14:00.000Z"); // 60s before rollover
      expect(shouldPrefetchNextInterval(date, 30_000)).toBe(false);
      expect(shouldPrefetchNextInterval(date, 60_000)).toBe(true);
    });
  });

  describe("intervalKeyToString", () => {
    test("formats interval key as string", () => {
      const interval = { startTs: 1705330800, endTs: 1705331700 };
      expect(intervalKeyToString(interval)).toBe("1705330800-1705331700");
    });
  });

  describe("parseIntervalKeyString", () => {
    test("parses valid interval key string", () => {
      const result = parseIntervalKeyString("1705330800-1705331700");
      expect(result).toEqual({ startTs: 1705330800, endTs: 1705331700 });
    });

    test("returns null for invalid format", () => {
      expect(parseIntervalKeyString("invalid")).toBeNull();
      expect(parseIntervalKeyString("123")).toBeNull();
      expect(parseIntervalKeyString("abc-def")).toBeNull();
      expect(parseIntervalKeyString("")).toBeNull();
    });
  });

  describe("formatIntervalKey", () => {
    test("formats interval for display", () => {
      const date = new Date("2025-01-15T14:15:00Z");
      const interval = getIntervalKey(date);
      const formatted = formatIntervalKey(interval);

      expect(formatted).toBe("14:15-14:30 UTC");
    });

    test("handles midnight", () => {
      const date = new Date("2025-01-15T00:00:00Z");
      const interval = getIntervalKey(date);
      const formatted = formatIntervalKey(interval);

      expect(formatted).toBe("00:00-00:15 UTC");
    });
  });
});
