import { describe, test, expect, beforeEach } from "bun:test";
import {
  recordFill,
  getEntryVwap,
  resetPositionTracker,
} from "../src/state/positionTracker";
import type { IntervalKey } from "../src/time/interval";

const interval: IntervalKey = {
  startTs: 1700000000,
  endTs: 1700000900,
};

describe("getEntryVwap (cost-basis)", () => {
  beforeEach(() => {
    resetPositionTracker();
  });

  test("simple VWAP for buys only", () => {
    recordFill("kalshi", "yes", "buy", 10, 0.30, interval);
    const vwap = getEntryVwap("kalshi", "yes", interval);
    expect(vwap).toBeCloseTo(0.30, 6);
  });

  test("weighted average for multiple buys", () => {
    recordFill("polymarket", "no", "buy", 20, 0.40, interval);
    recordFill("polymarket", "no", "buy", 30, 0.60, interval);
    // expected: (20*0.40 + 30*0.60) / 50 = (8 + 18) / 50 = 0.52
    const vwap = getEntryVwap("polymarket", "no", interval);
    expect(vwap).toBeCloseTo(0.52, 6);
  });

  test("excludes unwound positions — VWAP reflects only retained cost basis", () => {
    // Buy 50 @ 0.47, then buy 50 @ 0.73
    // Pool avg = (50*0.47 + 50*0.73) / 100 = 0.60
    recordFill("kalshi", "yes", "buy", 50, 0.47, interval);
    recordFill("kalshi", "yes", "buy", 50, 0.73, interval);

    // Sell (unwind) 50 — removes at pool avg (0.60), leaving 50 @ avg 0.60
    recordFill("kalshi", "yes", "sell", 50, 0.55, interval);

    const vwap = getEntryVwap("kalshi", "yes", interval);
    expect(vwap).toBeCloseTo(0.60, 4);
  });

  test("returns null when all positions sold", () => {
    recordFill("polymarket", "yes", "buy", 10, 0.50, interval);
    recordFill("polymarket", "yes", "sell", 10, 0.48, interval);

    const vwap = getEntryVwap("polymarket", "yes", interval);
    expect(vwap).toBeNull();
  });

  test("returns null when no fills", () => {
    const vwap = getEntryVwap("kalshi", "no", interval);
    expect(vwap).toBeNull();
  });

  test("handles sell exceeding buy qty gracefully", () => {
    recordFill("kalshi", "no", "buy", 5, 0.70, interval);
    // Sell more than bought (e.g. position from setVenuePositions override)
    recordFill("kalshi", "no", "sell", 10, 0.65, interval);

    const vwap = getEntryVwap("kalshi", "no", interval);
    expect(vwap).toBeNull();
  });
});
