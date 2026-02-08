import { test, expect, beforeEach, describe, mock } from "bun:test";
import {
  performSettlementCheck,
  getOutcome,
  resetStore,
  _test,
} from "../src/data/settlementTracker";
import {
  recordTick,
  freezeAtClose,
  resetStore as resetTwapStore,
} from "../src/data/twapStore";
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

beforeEach(() => {
  resetStore();
  resetTwapStore();
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
  test("produces outcome with frozen TWAP and spot", async () => {
    // Populate TWAP store with ticks
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      recordTick(97350 + i, now - (20 - i) * 1000);
    }
    freezeAtClose();

    // Use non-existent hosts so API calls fail gracefully
    const outcome = await performSettlementCheck(
      testInterval,
      testMapping,
      mockLogger,
      { kalshiHost: "http://localhost:99999", gammaHost: "http://localhost:99999" },
    );

    expect(outcome.intervalKey).toEqual(testInterval);
    expect(outcome.btcTwap60sAtClose).not.toBeNull();
    expect(outcome.btcSpotAtClose).not.toBeNull();
    expect(outcome.kalshiRefPrice).toBe(97330);
    expect(outcome.polyRefPrice).toBe(97300);
    // API calls will fail, so resolutions should be unknown
    expect(outcome.kalshiResolution).toBe("unknown");
    expect(outcome.polyResolution).toBe("unknown");
    expect(outcome.checkedAt).toBeGreaterThan(0);
  });

  test("stores outcome retrievable via getOutcome", async () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      recordTick(97400, now - (10 - i) * 1000);
    }
    freezeAtClose();

    await performSettlementCheck(
      testInterval,
      testMapping,
      mockLogger,
      { kalshiHost: "http://localhost:99999", gammaHost: "http://localhost:99999" },
    );

    const stored = getOutcome(testInterval);
    expect(stored).not.toBeNull();
    expect(stored!.intervalKey).toEqual(testInterval);
  });

  test("handles null mapping gracefully", async () => {
    const outcome = await performSettlementCheck(
      testInterval,
      null,
      mockLogger,
      { kalshiHost: "http://localhost:99999", gammaHost: "http://localhost:99999" },
    );

    expect(outcome.kalshiRefPrice).toBeNull();
    expect(outcome.polyRefPrice).toBeNull();
    expect(outcome.kalshiResolution).toBe("unknown");
    expect(outcome.polyResolution).toBe("unknown");
  });

  test("detects dead zone from local TWAP/spot data", async () => {
    const now = Date.now();
    // TWAP ~97315 (between the two ref prices)
    for (let i = 0; i < 10; i++) {
      recordTick(97315, now - (10 - i) * 1000);
    }
    freezeAtClose();

    const outcome = await performSettlementCheck(
      testInterval,
      testMapping,
      mockLogger,
      { kalshiHost: "http://localhost:99999", gammaHost: "http://localhost:99999" },
    );

    // TWAP 97315 < 97330 (Kalshi ref) -> Kalshi says DOWN
    // Spot 97315 > 97300 (Poly ref) -> Poly says UP
    expect(outcome.deadZoneHit).toBe(true);
    expect(outcome.oraclesAgree).toBe(false);
  });
});
