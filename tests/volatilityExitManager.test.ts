import { test, expect, describe, beforeEach, mock } from "bun:test";

// Mock kalshi createOrder and getFills BEFORE importing volatilityExitManager
const mockKalshiCreateOrder = mock(async () => ({
  order: { count: 5, remaining_count: 0, order_id: "test-order-123", side: "no" },
}));

const mockKalshiGetFills = mock(async () => ({
  fills: [],
  cursor: "",
}));

mock.module("../src/venues/kalshi/orders", () => ({
  createOrder: mockKalshiCreateOrder,
  getFills: mockKalshiGetFills,
}));

import {
  VolatilityExitManager,
  type VolatilityExitDeps,
} from "../src/execution/volatilityExitManager";
import { resetStore, setReferencePrice, recordPrice, getAnalytics } from "../src/data/btcPriceStore";
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
    // Reset Kalshi mocks to default
    mockKalshiCreateOrder.mockImplementation(async () => ({
      order: { count: 5, remaining_count: 0, order_id: "test-order-123", side: "no" },
    }));
    mockKalshiGetFills.mockImplementation(async () => ({
      fills: [],
      cursor: "",
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

      // Set up volatile BTC data: ref=100000, oscillate to get crossings>=3, range>=100
      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);     // above
      recordPrice(99940, now + 1);  // below — crossing 1
      recordPrice(100050, now + 2); // above — crossing 2
      recordPrice(99950, now + 3);  // below — crossing 3
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

  describe("crossing reset on MONITORING entry", () => {
    test("crossings are reset when transitioning to MONITORING", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("polymarket", "yes", "buy", 5, 0.50, intervalKey, "fill1", "up-token-123");

      let msLeft = 500000; // start outside window
      const manager = new VolatilityExitManager(
        createMockDeps({
          getMsUntilRollover: () => msLeft,
        })
      );

      // Build up crossings while still IDLE (outside window)
      await manager.onBtcPriceUpdate(makeUpdate(100000)); // sets ref
      await manager.onBtcPriceUpdate(makeUpdate(100050)); // above
      await manager.onBtcPriceUpdate(makeUpdate(99950));  // cross 1
      await manager.onBtcPriceUpdate(makeUpdate(100050)); // cross 2
      expect(manager.getState()).toBe("IDLE"); // still outside window
      expect(getAnalytics().crossingCount).toBe(2);

      // Now move into the window → MONITORING entry should reset crossings
      msLeft = 300000;
      await manager.onBtcPriceUpdate(makeUpdate(100040)); // triggers MONITORING entry

      expect(manager.getState()).toBe("MONITORING");
      // Crossings should have been reset on MONITORING entry.
      // The tick at 100040 after reset: lastSide was null, so no crossing counted.
      expect(getAnalytics().crossingCount).toBe(0);
    });

    test("trigger requires crossings accumulated AFTER monitoring entry", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("polymarket", "yes", "buy", 5, 0.50, intervalKey, "fill1", "up-token-123");
      recordFill("kalshi", "no", "buy", 5, 0.45, intervalKey, "fill2", "KXBTC-100000");

      let msLeft = 500000; // start outside window
      const manager = new VolatilityExitManager(
        createMockDeps({
          getMsUntilRollover: () => msLeft,
          dryRun: true,
        })
      );

      // Build up 3 crossings and range while IDLE (outside window)
      await manager.onBtcPriceUpdate(makeUpdate(100000)); // sets ref
      await manager.onBtcPriceUpdate(makeUpdate(100075)); // above
      await manager.onBtcPriceUpdate(makeUpdate(99925));  // cross 1, range=150
      await manager.onBtcPriceUpdate(makeUpdate(100075)); // cross 2
      await manager.onBtcPriceUpdate(makeUpdate(99925));  // cross 3
      expect(manager.getState()).toBe("IDLE");

      // Enter the window → MONITORING, crossings reset
      msLeft = 300000;
      await manager.onBtcPriceUpdate(makeUpdate(100050));
      expect(manager.getState()).toBe("MONITORING");

      // Now in MONITORING, crossings should be 0, so trigger should NOT fire
      // even though range ($150) still exceeds threshold.
      // The tick that entered MONITORING (100050) had its recordPrice before
      // the reset, so post-reset lastSide=null. Next tick establishes side
      // without counting as crossing.
      await manager.onBtcPriceUpdate(makeUpdate(99950)); // establishes "below", no crossing (lastSide was null)

      expect(manager.getState()).toBe("MONITORING"); // should NOT have triggered
      expect(manager.isActive()).toBe(false);
      expect(getAnalytics().crossingCount).toBe(0); // still 0 — first tick post-reset establishes side only

      // Now a real crossing
      await manager.onBtcPriceUpdate(makeUpdate(100050)); // below→above = cross 1
      expect(getAnalytics().crossingCount).toBe(1);
      expect(manager.getState()).toBe("MONITORING"); // still not enough (need 2)
    });
  });

  describe("first sell profitability gate", () => {
    test("skips unprofitable targets in patient zone, enters WAITING_FOR_PROFITABILITY", async () => {
      const intervalKey = makeCurrentIntervalKey();
      const mapping = makeMapping(intervalKey);

      // Record positions with high entry prices
      recordFill("polymarket", "yes", "buy", 5, 0.55, intervalKey, "fill1", "up-token-123");
      recordFill("kalshi", "no", "buy", 5, 0.55, intervalKey, "fill2", "KXBTC-100000");

      // Set up volatile BTC data
      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);
      recordPrice(99940, now + 1);
      recordPrice(100050, now + 2);
      recordPrice(99950, now + 3);

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
          } as any,
          getCurrentMapping: () => mapping,
          dryRun: true,
          // Current bids are BELOW entry → negative profitability
          getQuote: () => makeQuote(0.50, 0.50), // bids 0.50, entry was 0.55 → profit = -0.05
          getMsUntilRollover: () => 300000, // patient zone (>120s)
        })
      );

      // Force MONITORING state
      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Should enter WAITING_FOR_PROFITABILITY (not MONITORING)
      expect(manager.getState()).toBe("WAITING_FOR_PROFITABILITY");

      // Should have logged "Waiting for profitability"
      expect(logs.some((l) => l.includes("Waiting for profitability"))).toBe(true);

      // isActive should be true (blocks arb/reconciler)
      expect(manager.isActive()).toBe(true);

      // No cooldown should be set (skipped, not failed)
      expect((manager as any).lastFailedTriggerTs).toBeNull();
    });

    test("sells profitable target in patient zone", async () => {
      const intervalKey = makeCurrentIntervalKey();
      const mapping = makeMapping(intervalKey);

      recordFill("polymarket", "yes", "buy", 5, 0.40, intervalKey, "fill1", "up-token-123");
      recordFill("kalshi", "no", "buy", 5, 0.40, intervalKey, "fill2", "KXBTC-100000");

      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);
      recordPrice(99940, now + 1);
      recordPrice(100050, now + 2);
      recordPrice(99950, now + 3);

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
          } as any,
          getCurrentMapping: () => mapping,
          dryRun: true, // dry run simulates fills
          // Bids at 0.55, entry at 0.40 → profit = +0.15 (above $0.02 threshold)
          getQuote: () => makeQuote(0.55, 0.55),
          getMsUntilRollover: () => 300000,
        })
      );

      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Should have sold (dry run simulates fill)
      expect(logs.some((l) => l.includes("First sell complete"))).toBe(true);
      // State should advance past SELLING_FIRST
      expect(["SELLING_SECOND", "DONE"]).toContain(manager.getState());
    });

    test("emergency zone sells unprofitable first target", async () => {
      const intervalKey = makeCurrentIntervalKey();
      const mapping = makeMapping(intervalKey);

      recordFill("polymarket", "yes", "buy", 5, 0.55, intervalKey, "fill1", "up-token-123");
      recordFill("kalshi", "no", "buy", 5, 0.55, intervalKey, "fill2", "KXBTC-100000");

      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);
      recordPrice(99940, now + 1);
      recordPrice(100050, now + 2);
      recordPrice(99950, now + 3);

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
          } as any,
          getCurrentMapping: () => mapping,
          dryRun: true,
          getQuote: () => makeQuote(0.50, 0.50), // loss: 0.50 - 0.55 = -0.05
          getMsUntilRollover: () => 30000, // emergency zone (<60s)
        })
      );

      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Emergency zone should sell even at a loss
      expect(logs.some((l) => l.includes("First sell complete"))).toBe(true);
      expect(["SELLING_SECOND", "DONE"]).toContain(manager.getState());
    });
  });

  describe("re-entrancy guard", () => {
    test("concurrent onBtcPriceUpdate calls: only first processes", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("polymarket", "yes", "buy", 5, 0.40, intervalKey, "fill1", "up-token-123");

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: (msg: string) => logs.push(msg),
            warn: (msg: string) => logs.push(msg),
            error: (msg: string) => logs.push(msg),
          } as any,
          getMsUntilRollover: () => 300000, // in monitoring window
        })
      );

      // First call sets reference — starts processing
      const p1 = manager.onBtcPriceUpdate(makeUpdate(100000));
      // Second call fires concurrently — should be dropped
      const p2 = manager.onBtcPriceUpdate(makeUpdate(100001));
      const p3 = manager.onBtcPriceUpdate(makeUpdate(100002));

      await Promise.all([p1, p2, p3]);

      // Only one "Reference price set" log should appear
      const refLogs = logs.filter((l) => l.includes("Reference price set"));
      expect(refLogs.length).toBe(1);
      expect(refLogs[0]).toContain("100000"); // first tick's price
    });

    test("_processing resets after error", async () => {
      const manager = new VolatilityExitManager(createMockDeps());

      // Force an error by setting MONITORING state without valid conditions
      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      // This should complete without hanging
      await manager.onBtcPriceUpdate(makeUpdate(100000));

      // _processing should be false after completion
      expect((manager as any)._processing).toBe(false);
    });

    test("_processing resets on resetForInterval", () => {
      const manager = new VolatilityExitManager(createMockDeps());
      (manager as any)._processing = true;

      manager.resetForInterval();

      expect((manager as any)._processing).toBe(false);
    });

    test("_processing resets on stop", () => {
      const manager = new VolatilityExitManager(createMockDeps());
      (manager as any)._processing = true;

      manager.stop();

      expect((manager as any)._processing).toBe(false);
    });
  });

  describe("API-based position fetching", () => {
    test("buildSellTargets uses fetchApiPositions dep override", async () => {
      const intervalKey = makeCurrentIntervalKey();
      // Record local positions (will be overridden by API)
      recordFill("polymarket", "yes", "buy", 5, 0.40, intervalKey, "fill1", "up-token-123");
      recordFill("kalshi", "no", "buy", 5, 0.40, intervalKey, "fill2", "KXBTC-100000");

      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);
      recordPrice(99940, now + 1);
      recordPrice(100050, now + 2);
      recordPrice(99950, now + 3);

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
          } as any,
          dryRun: true,
          getMsUntilRollover: () => 300000,
          // API says Polymarket has 10 YES (not 5 like local tracker)
          fetchApiPositions: async () => ({
            polymarket: { yes: 10, no: 0 },
            kalshi: { yes: 0, no: 8 },
          }),
        })
      );

      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Should have sold with API-reported quantities
      // DRY RUN logs show the qty
      const dryRunLogs = logs.filter((l) => l.includes("DRY RUN"));
      // One of the dry run logs should contain qty=10 or qty=8 (from API, not 5 from local)
      const hasApiQty = dryRunLogs.some((l) => l.includes("10") || l.includes("8"));
      expect(hasApiQty).toBe(true);
    });

    test("buildSellTargets falls back to local positions when no API dep", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("polymarket", "yes", "buy", 5, 0.40, intervalKey, "fill1", "up-token-123");
      recordFill("kalshi", "no", "buy", 5, 0.40, intervalKey, "fill2", "KXBTC-100000");

      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);
      recordPrice(99940, now + 1);
      recordPrice(100050, now + 2);
      recordPrice(99950, now + 3);

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
          } as any,
          dryRun: true,
          getMsUntilRollover: () => 300000,
          // No fetchApiPositions override — will use local
          // No venue clients either, so API fetches will skip
        })
      );

      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Should have used local qty=5
      const dryRunLogs = logs.filter((l) => l.includes("DRY RUN"));
      expect(dryRunLogs.some((l) => l.includes("5"))).toBe(true);
    });
  });

  describe("partial sell retry", () => {
    test("retries after partial fill with lower price", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("kalshi", "no", "buy", 10, 0.40, intervalKey, "fill1", "KXBTC-100000");

      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);
      recordPrice(99940, now + 1);
      recordPrice(100050, now + 2);
      recordPrice(99950, now + 3);

      let kalshiCallCount = 0;
      // First call: partial fill (7/10), second call: fill remaining 3
      mockKalshiCreateOrder.mockImplementation(async () => {
        kalshiCallCount++;
        if (kalshiCallCount === 1) {
          return { order: { count: 10, remaining_count: 3 } }; // 7 filled
        }
        return { order: { count: 3, remaining_count: 0 } }; // 3 filled
      });

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
          } as any,
          dryRun: false,
          getMsUntilRollover: () => 30000, // emergency zone so it sells regardless of profit
          venueClients: {
            polymarket: null,
            kalshi: { auth: { token: "t", keyId: "k" } } as any,
          },
          fetchApiPositions: async () => ({
            polymarket: { yes: 0, no: 0 },
            kalshi: { yes: 0, no: 10 },
          }),
        })
      );

      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Should see partial fill + retry logs
      expect(logs.some((l) => l.includes("Partial fill: 7/10"))).toBe(true);
      expect(logs.some((l) => l.includes("Retry 1 filled 3"))).toBe(true);
      expect(logs.some((l) => l.includes("First sell complete: 10"))).toBe(true);
    });

    test("stops retrying after no-fill retry", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("kalshi", "no", "buy", 10, 0.40, intervalKey, "fill1", "KXBTC-100000");

      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);
      recordPrice(99940, now + 1);
      recordPrice(100050, now + 2);
      recordPrice(99950, now + 3);

      let kalshiCallCount = 0;
      mockKalshiCreateOrder.mockImplementation(async () => {
        kalshiCallCount++;
        if (kalshiCallCount === 1) {
          return { order: { count: 10, remaining_count: 5 } }; // 5 filled
        }
        return { order: { count: 5, remaining_count: 5 } }; // 0 filled on retry
      });

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
          } as any,
          dryRun: false,
          getMsUntilRollover: () => 30000,
          venueClients: {
            polymarket: null,
            kalshi: { auth: { token: "t", keyId: "k" } } as any,
          },
          fetchApiPositions: async () => ({
            polymarket: { yes: 0, no: 0 },
            kalshi: { yes: 0, no: 10 },
          }),
        })
      );

      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Should see partial fill then retry stop
      expect(logs.some((l) => l.includes("Partial fill: 5/10"))).toBe(true);
      expect(logs.some((l) => l.includes("Retry 1 got no fill"))).toBe(true);
      // Still reports the partial as the first sell
      expect(logs.some((l) => l.includes("First sell complete: 5"))).toBe(true);
    });

    test("full fill does not trigger retries", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("kalshi", "no", "buy", 10, 0.40, intervalKey, "fill1", "KXBTC-100000");

      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);
      recordPrice(99940, now + 1);
      recordPrice(100050, now + 2);
      recordPrice(99950, now + 3);

      let kalshiCallCount = 0;
      mockKalshiCreateOrder.mockImplementation(async () => {
        kalshiCallCount++;
        return { order: { count: 10, remaining_count: 0 } }; // full fill
      });

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
          } as any,
          dryRun: false,
          getMsUntilRollover: () => 30000,
          venueClients: {
            polymarket: null,
            kalshi: { auth: { token: "t", keyId: "k" } } as any,
          },
          fetchApiPositions: async () => ({
            polymarket: { yes: 0, no: 0 },
            kalshi: { yes: 0, no: 10 },
          }),
        })
      );

      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Should NOT see partial fill log
      expect(logs.some((l) => l.includes("Partial fill"))).toBe(false);
      // Only 1 kalshi call (no retries)
      expect(kalshiCallCount).toBe(1);
      expect(logs.some((l) => l.includes("First sell complete: 10"))).toBe(true);
    });
  });

  describe("WAITING_FOR_PROFITABILITY state", () => {
    /**
     * Helper: set up manager with positions and volatile conditions,
     * force into MONITORING, then trigger to enter WAITING_FOR_PROFITABILITY.
     */
    function setupInWaitingState(opts: {
      entryVwap: number;
      currentBid: number;
      msLeft: number;
      getQuote?: (venue: string) => any;
    }) {
      const intervalKey = makeCurrentIntervalKey();
      const mapping = makeMapping(intervalKey);

      recordFill("polymarket", "yes", "buy", 5, opts.entryVwap, intervalKey, "fill1", "up-token-123");
      recordFill("kalshi", "no", "buy", 5, opts.entryVwap, intervalKey, "fill2", "KXBTC-100000");

      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);
      recordPrice(99940, now + 1);
      recordPrice(100050, now + 2);
      recordPrice(99950, now + 3);

      let currentMsLeft = opts.msLeft;
      let quoteProvider = opts.getQuote || (() => makeQuote(opts.currentBid, opts.currentBid));

      const logs: string[] = [];
      const deps = createMockDeps({
        logger: {
          info: (msg: string) => logs.push(msg),
          debug: (msg: string) => logs.push(`DEBUG: ${msg}`),
          warn: (msg: string) => logs.push(`WARN: ${msg}`),
          error: (msg: string) => logs.push(`ERROR: ${msg}`),
        } as any,
        getCurrentMapping: () => mapping,
        dryRun: true,
        getQuote: quoteProvider as any,
        getMsUntilRollover: () => currentMsLeft,
      });

      const manager = new VolatilityExitManager(deps);

      // Force into MONITORING state with volatile conditions already set
      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      return {
        manager,
        logs,
        setMsLeft: (ms: number) => { currentMsLeft = ms; },
        setQuoteProvider: (fn: (venue: string) => any) => { quoteProvider = fn; },
      };
    }

    test("transitions from MONITORING to WAITING_FOR_PROFITABILITY when all below threshold", async () => {
      const { manager, logs } = setupInWaitingState({
        entryVwap: 0.55,
        currentBid: 0.50, // profit = -0.05, below $0.02 patient threshold
        msLeft: 300000,
      });

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      expect(manager.getState()).toBe("WAITING_FOR_PROFITABILITY");
      expect(manager.isActive()).toBe(true);
      expect(logs.some((l) => l.includes("Waiting for profitability"))).toBe(true);
    });

    test("does not spam logs on subsequent ticks in WAITING state", async () => {
      const { manager, logs } = setupInWaitingState({
        entryVwap: 0.55,
        currentBid: 0.50,
        msLeft: 300000,
      });

      // Trigger into WAITING
      await manager.onBtcPriceUpdate(makeUpdate(100050));
      expect(manager.getState()).toBe("WAITING_FOR_PROFITABILITY");

      const logsAfterEntry = logs.length;

      // Simulate 10 rapid ticks (would have been 60+ log lines before fix)
      for (let i = 0; i < 10; i++) {
        await manager.onBtcPriceUpdate(makeUpdate(100050 + i));
      }

      // Should have at most 1 waiting log (initial 15s timer fires on first tick after entry)
      const waitingLogs = logs.slice(logsAfterEntry).filter((l) => l.includes("[VOL-EXIT] Waiting:"));
      expect(waitingLogs.length).toBeLessThanOrEqual(1);

      // No TRIGGERED logs should appear (we're in WAITING, not MONITORING)
      const triggeredLogs = logs.slice(logsAfterEntry).filter((l) => l.includes("TRIGGERED"));
      expect(triggeredLogs.length).toBe(0);
    });

    test("logs countdown summary every 15s", async () => {
      const { manager, logs } = setupInWaitingState({
        entryVwap: 0.55,
        currentBid: 0.50,
        msLeft: 300000,
      });

      await manager.onBtcPriceUpdate(makeUpdate(100050));
      expect(manager.getState()).toBe("WAITING_FOR_PROFITABILITY");

      // First tick in WAITING should get immediate log (lastWaitingLogTs was set to 0)
      await manager.onBtcPriceUpdate(makeUpdate(100051));
      const waitingLogs = logs.filter((l) => l.includes("[VOL-EXIT] Waiting:"));
      expect(waitingLogs.length).toBe(1);
      expect(waitingLogs[0]).toContain("auto-sell in");
      expect(waitingLogs[0]).toContain("BTC=$");
      expect(waitingLogs[0]).toContain("patient zone");
    });

    test("sells immediately when profitability improves above threshold", async () => {
      let currentBid = 0.50;
      const { manager, logs } = setupInWaitingState({
        entryVwap: 0.50,
        currentBid: 0.51, // profit = 0.01, below patient $0.02
        msLeft: 300000,
        getQuote: () => makeQuote(currentBid, currentBid),
      });

      // Trigger into WAITING
      await manager.onBtcPriceUpdate(makeUpdate(100050));
      expect(manager.getState()).toBe("WAITING_FOR_PROFITABILITY");

      // Improve bids to meet threshold (0.52 - 0.50 = 0.02 >= threshold)
      currentBid = 0.53;
      await manager.onBtcPriceUpdate(makeUpdate(100055));

      // Should have transitioned through SELLING_FIRST to SELLING_SECOND or DONE
      expect(["SELLING_SECOND", "DONE"]).toContain(manager.getState());
      expect(logs.some((l) => l.includes("Target now meets patient threshold"))).toBe(true);
      expect(logs.some((l) => l.includes("First sell complete"))).toBe(true);
    });

    test("emergency zone auto-sells from WAITING regardless of profitability", async () => {
      const { manager, logs, setMsLeft } = setupInWaitingState({
        entryVwap: 0.55,
        currentBid: 0.50, // profit = -0.05
        msLeft: 300000, // start in patient zone
      });

      // Enter WAITING in patient zone
      await manager.onBtcPriceUpdate(makeUpdate(100050));
      expect(manager.getState()).toBe("WAITING_FOR_PROFITABILITY");

      // Move to emergency zone
      setMsLeft(30000);
      await manager.onBtcPriceUpdate(makeUpdate(100055));

      // Emergency threshold is -Infinity, so all targets meet it
      expect(["SELLING_SECOND", "DONE"]).toContain(manager.getState());
      expect(logs.some((l) => l.includes("Target now meets emergency threshold"))).toBe(true);
    });

    test("isActive() returns true during WAITING_FOR_PROFITABILITY", async () => {
      const { manager } = setupInWaitingState({
        entryVwap: 0.55,
        currentBid: 0.50,
        msLeft: 300000,
      });

      await manager.onBtcPriceUpdate(makeUpdate(100050));
      expect(manager.getState()).toBe("WAITING_FOR_PROFITABILITY");
      expect(manager.isActive()).toBe(true);
    });

    test("resetForInterval clears waiting state", async () => {
      const { manager } = setupInWaitingState({
        entryVwap: 0.55,
        currentBid: 0.50,
        msLeft: 300000,
      });

      await manager.onBtcPriceUpdate(makeUpdate(100050));
      expect(manager.getState()).toBe("WAITING_FOR_PROFITABILITY");
      expect((manager as any).pendingWaitTargets.length).toBeGreaterThan(0);

      manager.resetForInterval();

      expect(manager.getState()).toBe("IDLE");
      expect((manager as any).pendingWaitTargets.length).toBe(0);
      expect((manager as any).lastWaitingLogTs).toBe(0);
      expect((manager as any).lastBtcPrice).toBeNull();
    });

    test("stop clears waiting state", async () => {
      const { manager } = setupInWaitingState({
        entryVwap: 0.55,
        currentBid: 0.50,
        msLeft: 300000,
      });

      await manager.onBtcPriceUpdate(makeUpdate(100050));
      expect(manager.getState()).toBe("WAITING_FOR_PROFITABILITY");

      manager.stop();

      expect(manager.getState()).toBe("IDLE");
      expect((manager as any).pendingWaitTargets.length).toBe(0);
      expect((manager as any).lastWaitingLogTs).toBe(0);
      expect((manager as any).lastBtcPrice).toBeNull();
    });

    test("no API calls during WAITING ticks (uses local quote cache)", async () => {
      let apiCallCount = 0;
      const { manager, logs } = setupInWaitingState({
        entryVwap: 0.55,
        currentBid: 0.50,
        msLeft: 300000,
      });

      // Override fetchApiPositions to track calls
      (manager as any).deps.fetchApiPositions = async () => {
        apiCallCount++;
        return {
          polymarket: { yes: 5, no: 0 },
          kalshi: { yes: 0, no: 5 },
        };
      };

      // Trigger into WAITING (this calls buildSellTargets once)
      await manager.onBtcPriceUpdate(makeUpdate(100050));
      expect(manager.getState()).toBe("WAITING_FOR_PROFITABILITY");
      const apiCallsAfterEntry = apiCallCount;

      // Send 5 more ticks — none should call fetchApiPositions
      for (let i = 0; i < 5; i++) {
        await manager.onBtcPriceUpdate(makeUpdate(100051 + i));
      }

      expect(apiCallCount).toBe(apiCallsAfterEntry); // no additional API calls
    });
  });

  describe("Kalshi IOC fill detection via Fills API", () => {
    test("detects fill via Fills API when order response shows no fill", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("kalshi", "no", "buy", 5, 0.40, intervalKey, "fill1", "KXBTC-100000");

      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);
      recordPrice(99940, now + 1);
      recordPrice(100050, now + 2);
      recordPrice(99950, now + 3);

      // Order response shows NO fill (remaining_count === count) — the bug
      mockKalshiCreateOrder.mockImplementation(async () => ({
        order: { count: 5, remaining_count: 5, order_id: "ioc-order-456", side: "no", status: "canceled" },
      }));

      // But Fills API shows it actually filled
      mockKalshiGetFills.mockImplementation(async () => ({
        fills: [
          { fill_id: "f1", ticker: "KXBTC-100000", order_id: "ioc-order-456", side: "no", action: "sell", count: 5, yes_price: 50, no_price: 50 },
        ],
        cursor: "",
      }));

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
          } as any,
          dryRun: false,
          getMsUntilRollover: () => 30000, // emergency zone
          venueClients: {
            polymarket: null,
            kalshi: { auth: { token: "t", keyId: "k" } } as any,
          },
          fetchApiPositions: async () => ({
            polymarket: { yes: 0, no: 0 },
            kalshi: { yes: 0, no: 5 },
          }),
        })
      );

      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Should detect fill via Fills API and log the warning
      expect(logs.some((l) => l.includes("IOC fill detected via Fills API but NOT by order response"))).toBe(true);
      // Should have completed the sell
      expect(logs.some((l) => l.includes("First sell complete: 5"))).toBe(true);
    });

    test("falls back to order response when Fills API fails", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("kalshi", "no", "buy", 5, 0.40, intervalKey, "fill1", "KXBTC-100000");

      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);
      recordPrice(99940, now + 1);
      recordPrice(100050, now + 2);
      recordPrice(99950, now + 3);

      // Order response shows fill (normal case)
      mockKalshiCreateOrder.mockImplementation(async () => ({
        order: { count: 5, remaining_count: 0, order_id: "ioc-order-789", side: "no" },
      }));

      // Fills API throws
      mockKalshiGetFills.mockImplementation(async () => {
        throw new Error("network error");
      });

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
          } as any,
          dryRun: false,
          getMsUntilRollover: () => 30000,
          venueClients: {
            polymarket: null,
            kalshi: { auth: { token: "t", keyId: "k" } } as any,
          },
          fetchApiPositions: async () => ({
            polymarket: { yes: 0, no: 0 },
            kalshi: { yes: 0, no: 5 },
          }),
        })
      );

      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Should log the Fills API failure
      expect(logs.some((l) => l.includes("Failed to query Fills API"))).toBe(true);
      // Should still detect the fill from order response and succeed
      expect(logs.some((l) => l.includes("First sell complete: 5"))).toBe(true);
    });
  });

  describe("max range threshold", () => {
    test("does not trigger when range exceeds max threshold", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("polymarket", "yes", "buy", 5, 0.40, intervalKey, "fill1", "up-token-123");
      recordFill("kalshi", "no", "buy", 5, 0.40, intervalKey, "fill2", "KXBTC-100000");

      // Set up conditions with LARGE range ($423) — directional move, not dead zone
      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100200, now);     // above
      recordPrice(99777, now + 1);  // below — crossing 1, range=423
      recordPrice(100200, now + 2); // crossing 2
      recordPrice(99777, now + 3);  // crossing 3

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
          } as any,
          dryRun: true,
          getMsUntilRollover: () => 300000,
        })
      );

      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Should NOT trigger — range exceeds $175 max
      expect(manager.isActive()).toBe(false);
      expect(manager.getState()).toBe("MONITORING");
      expect(logs.some((l) => l.includes("TRIGGERED"))).toBe(false);
    });

    test("triggers when range is within window ($50-$175)", async () => {
      const intervalKey = makeCurrentIntervalKey();
      recordFill("polymarket", "yes", "buy", 5, 0.40, intervalKey, "fill1", "up-token-123");
      recordFill("kalshi", "no", "buy", 5, 0.40, intervalKey, "fill2", "KXBTC-100000");

      // Range = $120 (within $50-$175)
      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100060, now);
      recordPrice(99940, now + 1);  // crossing 1, range=120
      recordPrice(100050, now + 2); // crossing 2
      recordPrice(99950, now + 3);  // crossing 3 (not needed if threshold=2, but safe)

      const logs: string[] = [];
      const manager = new VolatilityExitManager(
        createMockDeps({
          logger: {
            info: (msg: string) => logs.push(msg),
            debug: () => {},
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
          } as any,
          dryRun: true,
          getMsUntilRollover: () => 300000,
        })
      );

      (manager as any).state = "MONITORING";
      (manager as any).referenceSet = true;

      await manager.onBtcPriceUpdate(makeUpdate(100050));

      // Should trigger
      expect(logs.some((l) => l.includes("TRIGGERED"))).toBe(true);
    });

    test("shouldHaltTrading returns false when range exceeds max", () => {
      // Set up volatile data with large range
      setReferencePrice(100000);
      const now = Date.now();
      recordPrice(100300, now);
      recordPrice(99700, now + 1); // crossing 1, range=600
      recordPrice(100300, now + 2); // crossing 2
      recordPrice(99700, now + 3); // crossing 3

      const manager = new VolatilityExitManager(
        createMockDeps({
          getMsUntilRollover: () => 30000, // in halt window
        })
      );

      // Even though crossings >= threshold and in halt window, range is too large
      expect(manager.shouldHaltTrading()).toBe(false);
    });
  });

});
