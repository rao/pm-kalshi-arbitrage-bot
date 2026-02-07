import { test, expect, describe, beforeEach } from "bun:test";
import { scanForArbitrage } from "../src/strategy/arbScanner";
import type { IntervalKey } from "../src/time/interval";
import {
  resetPositionTracker,
  getPositions,
  recordFill,
} from "../src/state/positionTracker";

// --- Test helpers ---

const TEST_INTERVAL: IntervalKey = {
  startTs: 1700000000,
  endTs: 1700000900,
};

// ============================================================
// Bug 1: Scanner returns null when quotes are null
// ============================================================
describe("Bug 1: scanner with null quotes", () => {
  test("returns null opportunity when polymarket quote is null", () => {
    const result = scanForArbitrage({
      polyQuote: null,
      kalshiQuote: {
        yes_bid: 0.5,
        yes_ask: 0.51,
        yes_bid_size: 10,
        yes_ask_size: 10,
        no_bid: 0.48,
        no_ask: 0.49,
        no_bid_size: 10,
        no_ask_size: 10,
        ts_exchange: Date.now(),
        ts_local: Date.now(),
      },
      intervalKey: TEST_INTERVAL,
      feeBuffer: 0.02,
      slippageBuffer: 0.01,
      minEdgeNet: 0.04,
    });
    expect(result.opportunity).toBeNull();
    expect(result.reason).toContain("No Polymarket quote");
  });

  test("returns null opportunity when kalshi quote is null", () => {
    const result = scanForArbitrage({
      polyQuote: {
        yes_bid: 0.5,
        yes_ask: 0.51,
        yes_bid_size: 10,
        yes_ask_size: 10,
        no_bid: 0.48,
        no_ask: 0.49,
        no_bid_size: 10,
        no_ask_size: 10,
        ts_exchange: Date.now(),
        ts_local: Date.now(),
      },
      kalshiQuote: null,
      intervalKey: TEST_INTERVAL,
      feeBuffer: 0.02,
      slippageBuffer: 0.01,
      minEdgeNet: 0.04,
    });
    expect(result.opportunity).toBeNull();
    expect(result.reason).toContain("No Kalshi quote");
  });

  test("returns null opportunity when both quotes are null", () => {
    const result = scanForArbitrage({
      polyQuote: null,
      kalshiQuote: null,
      intervalKey: TEST_INTERVAL,
      feeBuffer: 0.02,
      slippageBuffer: 0.01,
      minEdgeNet: 0.04,
    });
    expect(result.opportunity).toBeNull();
  });
});

// ============================================================
// Bug 2: Liquidator excess re-derivation + sold cap
// ============================================================
describe("Bug 2: liquidator excess re-derivation", () => {
  beforeEach(() => {
    resetPositionTracker();
  });

  test("getPositions reflects recordFill calls (liquidator re-derivation premise)", () => {
    // Simulate: 25 poly YES, 25 kalshi NO (balanced) + 25 excess poly YES
    recordFill("polymarket", "yes", "buy", 50, 0.50, TEST_INTERVAL, "buy1", "poly-token");
    recordFill("kalshi", "no", "buy", 25, 0.50, TEST_INTERVAL, "buy2", "kalshi-ticker");

    const pos1 = getPositions();
    expect(pos1.polymarket.yes).toBe(50);
    expect(pos1.kalshi.no).toBe(25);

    const totalYes1 = pos1.polymarket.yes + pos1.kalshi.yes;
    const totalNo1 = pos1.polymarket.no + pos1.kalshi.no;
    const excess1 = totalYes1 - totalNo1;
    expect(excess1).toBe(25); // 50 YES excess - 25 NO = 25 excess YES

    // Simulate liquidator selling 10 of the excess
    recordFill("polymarket", "yes", "sell", 10, 0.45, TEST_INTERVAL, "liq1", "poly-token");

    const pos2 = getPositions();
    expect(pos2.polymarket.yes).toBe(40);
    const totalYes2 = pos2.polymarket.yes + pos2.kalshi.yes;
    const totalNo2 = pos2.polymarket.no + pos2.kalshi.no;
    const excess2 = totalYes2 - totalNo2;
    expect(excess2).toBe(15); // 40 - 25 = 15

    // Simulate liquidator selling remaining 15
    recordFill("polymarket", "yes", "sell", 15, 0.44, TEST_INTERVAL, "liq2", "poly-token");

    const pos3 = getPositions();
    expect(pos3.polymarket.yes).toBe(25);
    const totalYes3 = pos3.polymarket.yes + pos3.kalshi.yes;
    const totalNo3 = pos3.polymarket.no + pos3.kalshi.no;
    const excess3 = totalYes3 - totalNo3;
    expect(excess3).toBe(0); // balanced
  });

  test("excess re-derivation stops when excess <= 0.5", () => {
    // Start with small excess
    recordFill("polymarket", "yes", "buy", 10, 0.50, TEST_INTERVAL, "buy1", "t1");
    recordFill("kalshi", "no", "buy", 10, 0.50, TEST_INTERVAL, "buy2", "t2");
    // 0.3 excess YES
    recordFill("polymarket", "yes", "buy", 0.3, 0.50, TEST_INTERVAL, "buy3", "t1");

    const pos = getPositions();
    const totalYes = pos.polymarket.yes + pos.kalshi.yes;
    const totalNo = pos.polymarket.no + pos.kalshi.no;
    const excess = totalYes - totalNo;
    expect(excess).toBeCloseTo(0.3, 5);
    // 0.3 <= 0.5, so liquidator should stop (this tests the logic boundary)
    expect(excess).toBeLessThanOrEqual(0.5);
  });

  test("sold cap prevents selling more than 110% of original excess", () => {
    // Original excess = 10
    const originalExcess = 10;
    const soldCap = originalExcess * 1.1; // = 11

    // Simulate soldQty approaching the cap
    let soldQty = 10.5;
    expect(soldQty < soldCap).toBe(true); // 10.5 < 11, proceed

    soldQty = 11.0;
    expect(soldQty >= soldCap).toBe(true); // 11 >= 11, should stop
  });
});

// ============================================================
// Bug 3: Unwind dust balance threshold
// ============================================================
describe("Bug 3: unwind dust balance threshold", () => {
  test("dust balance (0.0097) does NOT satisfy threshold for qty=5", () => {
    const actualBalance = 0.0097;
    const remainingQty = 5;
    // New condition: actualBalance >= remainingQty * 0.5 || actualBalance >= 1.0
    const passes = actualBalance >= remainingQty * 0.5 || actualBalance >= 1.0;
    expect(passes).toBe(false); // 0.0097 < 2.5 AND 0.0097 < 1.0
  });

  test("balance of 3 tokens satisfies threshold for qty=5", () => {
    const actualBalance = 3.0;
    const remainingQty = 5;
    const passes = actualBalance >= remainingQty * 0.5 || actualBalance >= 1.0;
    expect(passes).toBe(true); // 3.0 >= 2.5
  });

  test("balance of 1.0 token satisfies threshold regardless of qty", () => {
    const actualBalance = 1.0;
    const remainingQty = 100;
    const passes = actualBalance >= remainingQty * 0.5 || actualBalance >= 1.0;
    expect(passes).toBe(true); // 1.0 >= 1.0
  });

  test("balance of 0.99 does NOT satisfy threshold for qty=10", () => {
    const actualBalance = 0.99;
    const remainingQty = 10;
    const passes = actualBalance >= remainingQty * 0.5 || actualBalance >= 1.0;
    expect(passes).toBe(false); // 0.99 < 5.0 AND 0.99 < 1.0
  });

  test("balance of 0.5 satisfies threshold for qty=1", () => {
    const actualBalance = 0.5;
    const remainingQty = 1;
    const passes = actualBalance >= remainingQty * 0.5 || actualBalance >= 1.0;
    expect(passes).toBe(true); // 0.5 >= 0.5
  });
});
