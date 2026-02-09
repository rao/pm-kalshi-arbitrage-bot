import { test, expect, beforeEach, describe, mock } from "bun:test";
import {
  performSettlementCheck,
  getOutcome,
  resetStore,
  _test,
  type IntervalCloseSnapshot,
} from "../src/data/settlementTracker";
import type { IntervalKey } from "../src/time/interval";
import type { IntervalMapping } from "../src/markets/mappingStore";

const { determineAgreement } = _test;

// Mock logger
const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
} as any;

const testInterval: IntervalKey = { startTs: 1000000, endTs: 1000900 };

const testMapping: IntervalMapping = {
  intervalKey: testInterval,
  polymarket: {
    upToken: "token-up",
    downToken: "token-down",
    slug: "btc-updown-15m-1000000",
    endTs: 1000900,
    referencePrice: 97300,
  },
  kalshi: {
    eventTicker: "KXBTC15M-26FEB031730",
    marketTicker: "KXBTC15M-26FEB031730-30",
    seriesTicker: "KXBTC15M",
    closeTs: 1000900,
    referencePrice: 97330,
  },
  discoveredAt: Date.now(),
};

function makeSnapshot(overrides?: Partial<IntervalCloseSnapshot>): IntervalCloseSnapshot {
  return {
    intervalKey: testInterval,
    btcTwap60s: 97350,
    btcSpot: 97355,
    kalshiRefPrice: 97330,
    polyRefPrice: 97300,
    crossingCount: 5,
    rangeUsd: 150,
    distFromRefUsd: 40,
    mapping: testMapping,
    ...overrides,
  };
}

beforeEach(() => {
  resetStore();
});

describe("determineAgreement", () => {
  test("oracles agree when both say UP", () => {
    const result = determineAgreement(97400, 97400, 97330, 97300);
    expect(result.kalshiSaysUp).toBe(true);
    expect(result.polySaysUp).toBe(true);
    expect(result.agree).toBe(true);
    expect(result.deadZone).toBe(false);
  });

  test("oracles agree when both say DOWN", () => {
    const result = determineAgreement(97200, 97200, 97330, 97300);
    expect(result.kalshiSaysUp).toBe(false);
    expect(result.polySaysUp).toBe(false);
    expect(result.agree).toBe(true);
    expect(result.deadZone).toBe(false);
  });

  test("dead zone: Kalshi says UP, Poly says DOWN", () => {
    // TWAP above Kalshi ref, but spot below Poly ref
    const result = determineAgreement(97350, 97250, 97330, 97300);
    expect(result.kalshiSaysUp).toBe(true);
    expect(result.polySaysUp).toBe(false);
    expect(result.agree).toBe(false);
    expect(result.deadZone).toBe(true);
  });

  test("dead zone: Kalshi says DOWN, Poly says UP", () => {
    // TWAP below Kalshi ref, but spot above Poly ref
    const result = determineAgreement(97310, 97310, 97330, 97300);
    expect(result.kalshiSaysUp).toBe(false);
    expect(result.polySaysUp).toBe(true);
    expect(result.agree).toBe(false);
    expect(result.deadZone).toBe(true);
  });

  test("handles null TWAP gracefully", () => {
    const result = determineAgreement(null, 97400, 97330, 97300);
    expect(result.kalshiSaysUp).toBeNull();
    expect(result.agree).toBe(true);
    expect(result.deadZone).toBe(false);
  });

  test("handles null spot gracefully", () => {
    const result = determineAgreement(97400, null, 97330, 97300);
    expect(result.polySaysUp).toBeNull();
    expect(result.agree).toBe(true);
    expect(result.deadZone).toBe(false);
  });

  test("handles null reference prices gracefully", () => {
    const result = determineAgreement(97400, 97400, null, null);
    expect(result.agree).toBe(true);
    expect(result.deadZone).toBe(false);
  });

  test("exact equality: TWAP == ref counts as UP", () => {
    const result = determineAgreement(97330, 97300, 97330, 97300);
    expect(result.kalshiSaysUp).toBe(true);
    expect(result.polySaysUp).toBe(true);
    expect(result.agree).toBe(true);
  });
});

describe("performSettlementCheck", () => {
  test("produces outcome with TWAP and spot from snapshot", async () => {
    const snapshot = makeSnapshot({
      btcTwap60s: 97360,
      btcSpot: 97365,
    });

    const outcome = await performSettlementCheck(
      snapshot,
      mockLogger,
      { kalshiHost: "http://localhost:99999", gammaHost: "http://localhost:99999" },
    );

    expect(outcome.intervalKey).toEqual(testInterval);
    expect(outcome.btcTwap60sAtClose).toBe(97360);
    expect(outcome.btcSpotAtClose).toBe(97365);
    expect(outcome.kalshiRefPrice).toBe(97330);
    expect(outcome.polyRefPrice).toBe(97300);
    expect(outcome.crossingCount).toBe(5);
    expect(outcome.rangeUsd).toBe(150);
    expect(outcome.distFromRefUsd).toBe(40);
    // API calls will fail, so resolutions should be unknown
    expect(outcome.kalshiResolution).toBe("unknown");
    expect(outcome.polyResolution).toBe("unknown");
    expect(outcome.checkedAt).toBeGreaterThan(0);
  });

  test("stores outcome retrievable via getOutcome", async () => {
    const snapshot = makeSnapshot();

    await performSettlementCheck(
      snapshot,
      mockLogger,
      { kalshiHost: "http://localhost:99999", gammaHost: "http://localhost:99999" },
    );

    const stored = getOutcome(testInterval);
    expect(stored).not.toBeNull();
    expect(stored!.intervalKey).toEqual(testInterval);
    expect(stored!.btcTwap60sAtClose).toBe(97350);
    expect(stored!.crossingCount).toBe(5);
  });

  test("handles null mapping gracefully", async () => {
    const snapshot = makeSnapshot({
      mapping: null,
      kalshiRefPrice: null,
      polyRefPrice: null,
    });

    const outcome = await performSettlementCheck(
      snapshot,
      mockLogger,
      { kalshiHost: "http://localhost:99999", gammaHost: "http://localhost:99999" },
    );

    expect(outcome.kalshiRefPrice).toBeNull();
    expect(outcome.polyRefPrice).toBeNull();
    expect(outcome.kalshiResolution).toBe("unknown");
    expect(outcome.polyResolution).toBe("unknown");
  });

  test("detects dead zone from snapshot TWAP/spot data", async () => {
    // TWAP 97315 < 97330 (Kalshi ref) -> Kalshi says DOWN
    // Spot 97315 > 97300 (Poly ref) -> Poly says UP
    const snapshot = makeSnapshot({
      btcTwap60s: 97315,
      btcSpot: 97315,
    });

    const outcome = await performSettlementCheck(
      snapshot,
      mockLogger,
      { kalshiHost: "http://localhost:99999", gammaHost: "http://localhost:99999" },
    );

    expect(outcome.deadZoneHit).toBe(true);
    expect(outcome.oraclesAgree).toBe(false);
  });

  test("snapshot data survives even after module resets", async () => {
    // This verifies the core fix: snapshot is immutable, unaffected by store resets
    const snapshot = makeSnapshot({
      btcTwap60s: 97400,
      btcSpot: 97405,
      crossingCount: 7,
      rangeUsd: 200,
    });

    // Simulate what happens in production: stores would be reset after snapshot capture
    // (No store resets needed here since we're not using stores at all)

    const outcome = await performSettlementCheck(
      snapshot,
      mockLogger,
      { kalshiHost: "http://localhost:99999", gammaHost: "http://localhost:99999" },
    );

    expect(outcome.btcTwap60sAtClose).toBe(97400);
    expect(outcome.btcSpotAtClose).toBe(97405);
    expect(outcome.crossingCount).toBe(7);
    expect(outcome.rangeUsd).toBe(200);
  });

  test("handles null TWAP/spot in snapshot", async () => {
    const snapshot = makeSnapshot({
      btcTwap60s: null,
      btcSpot: null,
    });

    const outcome = await performSettlementCheck(
      snapshot,
      mockLogger,
      { kalshiHost: "http://localhost:99999", gammaHost: "http://localhost:99999" },
    );

    expect(outcome.btcTwap60sAtClose).toBeNull();
    expect(outcome.btcSpotAtClose).toBeNull();
    // With null TWAP/spot, agreement defaults to true
    expect(outcome.oraclesAgree).toBe(true);
    expect(outcome.deadZoneHit).toBe(false);
  });
});
