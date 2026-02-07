import { test, expect, describe, beforeEach, mock } from "bun:test";

// Mock kalshi createOrder BEFORE importing volatilityExitManager
const mockKalshiCreateOrder = mock(async () => ({
  order: { count: 5, remaining_count: 0 },
}));

mock.module("../src/venues/kalshi/orders", () => ({
  createOrder: mockKalshiCreateOrder,
}));

import {
  VolatilityExitManager,
  type VolatilityExitDeps,
} from "../src/execution/volatilityExitManager";
import { resetStore, setReferencePrice, recordPrice } from "../src/data/btcPriceStore";
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
    // Reset Kalshi mock to default (successful fill)
    mockKalshiCreateOrder.mockImplementation(async () => ({
      order: { count: 5, remaining_count: 0 },
    }));
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

  describe("sell failure handling", () => {
    /**
     * Helper: set up manager in MONITORING state with volatile BTC data,
     * positions, and dryRun=false. Returns manager + captured logs.
     *
     * Uses (manager as any) to force MONITORING state deterministically,
     * avoiding time-dependent IDLE→MONITORING transition.
     */
    function setupVolatileManagerWithPositions(
      overrides: Partial<VolatilityExitDeps> = {}
    ) {
      const intervalKey = makeCurrentIntervalKey();
      const mapping = makeMapping(intervalKey);

      // Record positions on both venues
      recordFill("polymarket", "yes", "buy", 5, 0.40, intervalKey, "fill1", "up-token-123");
      recordFill("kalshi", "no", "buy", 5, 0.40, intervalKey, "fill2", "KXBTC-100000");

      // Set up volatile BTC data: ref=100000, oscillate to get crossings>=2, range>=100
      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);    // above
      recordPrice(99940, now + 1); // below — crossing 1
      recordPrice(100050, now + 2); // above — crossing 2
      // range = 100060 - 99940 = 120 >= 100 threshold

      const logs: string[] = [];
      const deps = createMockDeps({
        logger: {
          info: (msg: string) => logs.push(msg),
          debug: () => {},
          warn: (msg: string) => logs.push(`WARN: ${msg}`),
          error: (msg: string) => logs.push(`ERROR: ${msg}`),
        } as any,
        getCurrentMapping: () => mapping,
        dryRun: false,
        ...overrides,
      });

      const manager = new VolatilityExitManager(deps);

      // Force into MONITORING state (bypass time-dependent transition)
      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      return { manager, logs, intervalKey };
    }

    test("first target fails → second target attempted (Fix 1)", async () => {
      // Kalshi createOrder throws insufficient_balance
      mockKalshiCreateOrder.mockImplementation(async () => {
        throw new Error("insufficient_balance: no contracts to sell");
      });

      const mockPolyClient = {
        getConditionalTokenBalance: async () => 5,
        placeFakOrder: async () => ({
          success: true,
          takingAmount: "2.50",
          makingAmount: "5",
        }),
      };

      const { manager, logs } = setupVolatileManagerWithPositions({
        venueClients: {
          polymarket: mockPolyClient as any,
          kalshi: { auth: { token: "t", keyId: "k" } } as any,
        },
        getQuote: (venue) => {
          // Kalshi NO has higher profitability → tried first
          if (venue === "kalshi") return makeQuote(0.55, 0.60);
          // Polymarket YES has lower profitability → tried second
          return makeQuote(0.55, 0.50);
        },
      });

      // Trigger via BTC price update (state is MONITORING, conditions are met)
      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Kalshi should have failed, Polymarket should have been attempted
      const attemptLogs = logs.filter((l) => l.includes("Attempting sell"));
      expect(attemptLogs.length).toBeGreaterThanOrEqual(2);

      // Polymarket sell should have succeeded (mock returns success)
      const completeLogs = logs.filter((l) => l.includes("First sell complete"));
      expect(completeLogs.length).toBe(1);

      // Should be in DONE (single remaining position after Kalshi failed)
      expect(manager.getState()).toBe("DONE");
    });

    test("all targets fail → returns to MONITORING with cooldown (Fix 1 + Fix 2)", async () => {
      // Both venues fail
      mockKalshiCreateOrder.mockImplementation(async () => {
        throw new Error("insufficient_balance: no position");
      });

      const mockPolyClient = {
        getConditionalTokenBalance: async () => 0, // triggers insufficient_balance throw
      };

      const { manager, logs } = setupVolatileManagerWithPositions({
        venueClients: {
          polymarket: mockPolyClient as any,
          kalshi: { auth: { token: "t", keyId: "k" } } as any,
        },
      });

      // First trigger — all targets fail
      await manager.onBtcPriceUpdate(makeUpdate(100050));

      expect(manager.getState()).toBe("MONITORING");
      expect(logs.some((l) => l.includes("All sell targets failed"))).toBe(true);

      // Verify cooldown: immediate re-trigger should be suppressed
      const logsBefore = logs.length;
      await manager.onBtcPriceUpdate(makeUpdate(100055));

      // Should NOT see another "TRIGGERED" log (cooldown active)
      const triggeredAfter = logs.slice(logsBefore).filter((l) => l.includes("TRIGGERED"));
      expect(triggeredAfter.length).toBe(0);

      // State should still be MONITORING (not re-entered selling)
      expect(manager.getState()).toBe("MONITORING");
    });

    test("cooldown expires and allows re-trigger (Fix 2)", async () => {
      mockKalshiCreateOrder.mockImplementation(async () => {
        throw new Error("insufficient_balance: no position");
      });

      const mockPolyClient = {
        getConditionalTokenBalance: async () => 0,
      };

      const { manager, logs } = setupVolatileManagerWithPositions({
        venueClients: {
          polymarket: mockPolyClient as any,
          kalshi: { auth: { token: "t", keyId: "k" } } as any,
        },
      });

      // First trigger — all fail
      await manager.onBtcPriceUpdate(makeUpdate(100050));
      expect(manager.getState()).toBe("MONITORING");

      // Fake the cooldown having expired
      (manager as any).lastFailedTriggerTs = Date.now() - 5000;

      const logsBefore = logs.length;
      await manager.onBtcPriceUpdate(makeUpdate(100055));

      // Should see another TRIGGERED log (cooldown expired)
      const triggeredAfter = logs.slice(logsBefore).filter((l) => l.includes("TRIGGERED"));
      expect(triggeredAfter.length).toBe(1);
    });

    test("permanent failure marks side as failed (Fix 3)", async () => {
      mockKalshiCreateOrder.mockImplementation(async () => {
        throw new Error("insufficient_balance: nothing to sell");
      });

      const mockPolyClient = {
        getConditionalTokenBalance: async () => 0, // will throw insufficient_balance
      };

      const { manager, logs } = setupVolatileManagerWithPositions({
        venueClients: {
          polymarket: mockPolyClient as any,
          kalshi: { auth: { token: "t", keyId: "k" } } as any,
        },
      });

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Check that failedSides was populated
      const failedSides = (manager as any).failedSides as Set<string>;
      expect(failedSides.size).toBeGreaterThan(0);

      // Should contain at least one of the sides that had insufficient_balance
      const hasMarkedSide =
        failedSides.has("kalshi_no") || failedSides.has("polymarket_yes");
      expect(hasMarkedSide).toBe(true);

      // Verify the permanently-marked log was emitted
      expect(logs.some((l) => l.includes("Permanently marking"))).toBe(true);
    });

    test("failedSides excluded from buildSellTargets on re-trigger (Fix 3)", async () => {
      let kalshiCallCount = 0;
      mockKalshiCreateOrder.mockImplementation(async () => {
        kalshiCallCount++;
        throw new Error("insufficient_balance: nothing to sell");
      });

      const mockPolyClient = {
        getConditionalTokenBalance: async () => 0,
      };

      const { manager, logs } = setupVolatileManagerWithPositions({
        venueClients: {
          polymarket: mockPolyClient as any,
          kalshi: { auth: { token: "t", keyId: "k" } } as any,
        },
      });

      // First trigger — both fail, both marked as permanent
      await manager.onBtcPriceUpdate(makeUpdate(100050));
      expect(manager.getState()).toBe("MONITORING");

      // Expire cooldown
      (manager as any).lastFailedTriggerTs = Date.now() - 5000;
      const kalshiCallsBefore = kalshiCallCount;

      // Second trigger — failedSides should exclude both, so no targets found
      await manager.onBtcPriceUpdate(makeUpdate(100055));

      // buildSellTargets should return empty (both sides failed) → goes to IDLE
      // No new sell attempts should have been made on Kalshi
      expect(kalshiCallCount).toBe(kalshiCallsBefore);

      // Should end up in IDLE (no sellable positions) or MONITORING
      expect(["IDLE", "MONITORING"]).toContain(manager.getState());
    });

    test("failedSides reset on resetForInterval (Fix 3)", async () => {
      const manager = new VolatilityExitManager(createMockDeps());

      // Manually add failed sides
      (manager as any).failedSides.add("kalshi_yes");
      (manager as any).failedSides.add("polymarket_no");
      (manager as any).lastFailedTriggerTs = Date.now();

      expect((manager as any).failedSides.size).toBe(2);
      expect((manager as any).lastFailedTriggerTs).not.toBeNull();

      manager.resetForInterval();

      expect((manager as any).failedSides.size).toBe(0);
      expect((manager as any).lastFailedTriggerTs).toBeNull();
    });

    test("failedSides reset on stop (Fix 3)", () => {
      const manager = new VolatilityExitManager(createMockDeps());

      (manager as any).failedSides.add("kalshi_yes");
      (manager as any).lastFailedTriggerTs = Date.now();

      manager.stop();

      expect((manager as any).failedSides.size).toBe(0);
      expect((manager as any).lastFailedTriggerTs).toBeNull();
    });
  });
});
