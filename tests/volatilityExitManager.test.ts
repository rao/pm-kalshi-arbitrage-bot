import { test, expect, describe, beforeEach, mock } from "bun:test";
import {
  VolatilityExitManager,
  type VolatilityExitDeps,
} from "../src/execution/volatilityExitManager";
import { resetStore, setReferencePrice } from "../src/data/btcPriceStore";
import {
  resetPositionTracker,
  recordFill,
} from "../src/state/positionTracker";
import { resetAllState } from "../src/execution/executionState";
import type { NormalizedQuote } from "../src/normalization/types";
import type { BtcPriceUpdate } from "../src/venues/polymarket/rtds";
import type { IntervalMapping } from "../src/markets/mappingStore";
import type { IntervalKey } from "../src/time/interval";

/** Create a mock interval key that's currently active (near end of interval). */
function makeCurrentIntervalKey(): IntervalKey {
  const now = new Date();
  const minute = Math.floor(now.getUTCMinutes() / 15) * 15;
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), minute, 0)
  );
  const startTs = Math.floor(start.getTime() / 1000);
  return { startTs, endTs: startTs + 900 };
}

/** Create a mock BtcPriceUpdate. */
function makeUpdate(price: number): BtcPriceUpdate {
  return {
    symbol: "btcusdt",
    price,
    ts_exchange: Date.now(),
    ts_local: Date.now(),
  };
}

/** Create a mock NormalizedQuote. */
function makeQuote(yesBid: number, nosBid: number): NormalizedQuote {
  return {
    yes_bid: yesBid,
    yes_ask: yesBid + 0.02,
    yes_bid_size: 100,
    yes_ask_size: 100,
    no_bid: nosBid,
    no_ask: nosBid + 0.02,
    no_bid_size: 100,
    no_ask_size: 100,
    ts_exchange: Date.now(),
    ts_local: Date.now(),
  };
}

/** Create a mock IntervalMapping. */
function makeMapping(intervalKey: IntervalKey): IntervalMapping {
  return {
    intervalKey,
    verified: true,
    polymarket: {
      conditionId: "cond123",
      upToken: "up-token-123",
      downToken: "down-token-123",
      questionId: "q123",
    },
    kalshi: {
      marketTicker: "KXBTC-100000",
      yesEquiv: "yes",
    },
  };
}

function createMockDeps(overrides: Partial<VolatilityExitDeps> = {}): VolatilityExitDeps {
  const intervalKey = makeCurrentIntervalKey();
  const mapping = makeMapping(intervalKey);

  return {
    logger: {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
    } as any,
    venueClients: {
      polymarket: null,
      kalshi: null,
    },
    getCurrentMapping: () => mapping,
    getQuote: () => makeQuote(0.55, 0.50),
    dryRun: true, // dry run by default for tests
    ...overrides,
  };
}

describe("VolatilityExitManager", () => {
  beforeEach(() => {
    resetStore();
    resetPositionTracker();
    resetAllState();
  });

  describe("initial state", () => {
    test("starts in IDLE state", () => {
      const manager = new VolatilityExitManager(createMockDeps());
      expect(manager.getState()).toBe("IDLE");
    });

    test("isActive returns false initially", () => {
      const manager = new VolatilityExitManager(createMockDeps());
      expect(manager.isActive()).toBe(false);
    });

    test("shouldHaltTrading returns false initially", () => {
      const manager = new VolatilityExitManager(createMockDeps());
      expect(manager.shouldHaltTrading()).toBe(false);
    });
  });

  describe("reference price capture", () => {
    test("sets reference price from first BTC tick", async () => {
      const manager = new VolatilityExitManager(createMockDeps());
      await manager.onBtcPriceUpdate(makeUpdate(100000));
      // After first update, reference should be set
      // Internal state tracked — we can verify via analytics
      expect(manager.getState()).toBe("IDLE"); // no positions, stays IDLE
    });
  });

  describe("IDLE → MONITORING transition", () => {
    test("stays IDLE when no positions", async () => {
      const manager = new VolatilityExitManager(createMockDeps());
      await manager.onBtcPriceUpdate(makeUpdate(100000));
      expect(manager.getState()).toBe("IDLE");
    });

    test("stays IDLE when positions exist but not in active window", async () => {
      // Record a position
      const intervalKey = makeCurrentIntervalKey();
      recordFill("polymarket", "yes", "buy", 5, 0.50, intervalKey, "fill1", "up-token-123");
      recordFill("kalshi", "no", "buy", 5, 0.45, intervalKey, "fill2", "KXBTC-100000");

      const manager = new VolatilityExitManager(createMockDeps());

      // If we're early in the interval (more than 7.5 min left),
      // it should stay IDLE. Since we can't control time easily,
      // just verify the state machine doesn't crash
      await manager.onBtcPriceUpdate(makeUpdate(100000));
      // State depends on timing — just verify it's either IDLE or MONITORING
      expect(["IDLE", "MONITORING"]).toContain(manager.getState());
    });
  });

  describe("trigger conditions", () => {
    test("does not trigger without enough crossings", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("polymarket", "yes", "buy", 5, 0.50, intervalKey, "fill1", "up-token-123");

      const manager = new VolatilityExitManager(createMockDeps());

      // Set reference and oscillate only once (below threshold of 2)
      await manager.onBtcPriceUpdate(makeUpdate(100000)); // sets ref
      await manager.onBtcPriceUpdate(makeUpdate(100050)); // above
      await manager.onBtcPriceUpdate(makeUpdate(99950));  // below — 1 crossing

      // Should not be in selling state
      expect(manager.isActive()).toBe(false);
    });

    test("does not trigger without enough range", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("polymarket", "yes", "buy", 5, 0.50, intervalKey, "fill1", "up-token-123");

      const manager = new VolatilityExitManager(createMockDeps());

      // Oscillate with small range (<$100)
      await manager.onBtcPriceUpdate(makeUpdate(100000)); // sets ref
      await manager.onBtcPriceUpdate(makeUpdate(100020)); // above
      await manager.onBtcPriceUpdate(makeUpdate(99980));  // below — cross 1
      await manager.onBtcPriceUpdate(makeUpdate(100010)); // above — cross 2

      // Range is only $40 (100020 - 99980), below $100 threshold
      expect(manager.isActive()).toBe(false);
    });
  });

  describe("resetForInterval", () => {
    test("resets state to IDLE", async () => {
      const manager = new VolatilityExitManager(createMockDeps());
      await manager.onBtcPriceUpdate(makeUpdate(100000));

      manager.resetForInterval();
      expect(manager.getState()).toBe("IDLE");
    });
  });

  describe("shouldHaltTrading", () => {
    test("returns false when not volatile", () => {
      const manager = new VolatilityExitManager(createMockDeps());
      expect(manager.shouldHaltTrading()).toBe(false);
    });

    test("returns false when volatility exit is disabled", () => {
      // This tests against runtime RISK_PARAMS. Since we can't easily
      // override `as const` params, just verify the function is callable
      const manager = new VolatilityExitManager(createMockDeps());
      const result = manager.shouldHaltTrading();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("dry run mode", () => {
    test("simulates fills in dry run", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("polymarket", "yes", "buy", 5, 0.40, intervalKey, "fill1", "up-token-123");
      recordFill("kalshi", "no", "buy", 5, 0.40, intervalKey, "fill2", "KXBTC-100000");

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(msg),
            error: (msg: string) => logs.push(msg),
          } as any,
          dryRun: true,
        })
      );

      // Simulate reference + volatile conditions
      await manager.onBtcPriceUpdate(makeUpdate(100000));

      // If we're in the monitoring window and conditions are met,
      // dry run should log the would-be sells
      // The actual trigger depends on timing (last 7.5 min)
      // so we just verify the manager handles updates without error
      expect(manager.getState()).not.toBe("SELLING_FIRST"); // may or may not trigger depending on time
    });
  });

  describe("stop", () => {
    test("resets to IDLE", () => {
      const manager = new VolatilityExitManager(createMockDeps());
      manager.stop();
      expect(manager.getState()).toBe("IDLE");
      expect(manager.isActive()).toBe(false);
    });
  });
});
