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

function makeCurrentIntervalKey(): IntervalKey {
  const now = new Date();
  const minute = Math.floor(now.getUTCMinutes() / 15) * 15;
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), minute, 0)
  );
  const startTs = Math.floor(start.getTime() / 1000);
  return { startTs, endTs: startTs + 900 };
}

function makeUpdate(price: number): BtcPriceUpdate {
  return {
    symbol: "btcusdt",
    price,
    ts_exchange: Date.now(),
    ts_local: Date.now(),
  };
}

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
    dryRun: true,
    ...overrides,
  };
}

describe("VolatilityExitManager - dynamic second-sell zones", () => {
  let currentMsLeft: number;

  beforeEach(() => {
    resetStore();
    resetPositionTracker();
    resetAllState();
    currentMsLeft = 300000;
  });

  /**
   * Helper: set up manager already in SELLING_SECOND state with a pending target.
   * Uses `getMsUntilRollover` dep override to control the zone.
   */
  function setupInSellingSecond(opts: {
    entryVwap: number;
    currentBid: number;
    msLeft: number;
  }) {
    const intervalKey = makeCurrentIntervalKey();
    const mapping = makeMapping(intervalKey);

    recordFill("kalshi", "yes", "buy", 5, opts.entryVwap, intervalKey, "fill1", "KXBTC-100000");

    setReferencePrice(100000);
    recordPrice(100060, Date.now());
    recordPrice(99940, Date.now() + 1);
    recordPrice(100050, Date.now() + 2);
    recordPrice(99950, Date.now() + 3);

    currentMsLeft = opts.msLeft;

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
      getQuote: () => makeQuote(opts.currentBid, 0.50),
      getMsUntilRollover: () => currentMsLeft,
    });

    const manager = new VolatilityExitManager(deps);

    // Force into SELLING_SECOND state
    (manager as any).state = "SELLING_SECOND";
    (manager as any).referenceSet = true;
    (manager as any).secondSellStartTs = Date.now() - 5000;
    (manager as any).firstSoldQty = 5;
    (manager as any).pendingSecondTarget = {
      venue: "kalshi" as const,
      side: "yes" as const,
      qty: 5,
      marketId: "KXBTC-100000",
      entryVwap: opts.entryVwap,
      currentBid: opts.currentBid,
      profitability: opts.currentBid - opts.entryVwap,
    };

    return { manager, logs };
  }

  test("patient zone: waits when not profitable enough", async () => {
    const { manager, logs } = setupInSellingSecond({
      entryVwap: 0.50,
      currentBid: 0.51, // profit = $0.01 < $0.02 threshold
      msLeft: 300000,    // 5 min left (patient zone)
    });

    await manager.onBtcPriceUpdate(makeUpdate(100050));

    expect(manager.getState()).toBe("SELLING_SECOND");
    expect(logs.some((l) => l.includes("Second sell complete"))).toBe(false);
  });

  test("patient zone: sells when profitable ($0.02+)", async () => {
    const { manager, logs } = setupInSellingSecond({
      entryVwap: 0.50,
      currentBid: 0.53, // profit = $0.03 >= $0.02 threshold
      msLeft: 300000,
    });

    await manager.onBtcPriceUpdate(makeUpdate(100050));

    expect(manager.getState()).toBe("DONE");
    expect(logs.some((l) => l.includes("Patient zone sell"))).toBe(true);
    expect(logs.some((l) => l.includes("Second sell complete"))).toBe(true);
  });

  test("breakeven zone: sells at zero profit", async () => {
    const { manager, logs } = setupInSellingSecond({
      entryVwap: 0.50,
      currentBid: 0.50, // profit = $0.00 (breakeven)
      msLeft: 90000,     // 90s left (breakeven zone)
    });

    await manager.onBtcPriceUpdate(makeUpdate(100050));

    expect(manager.getState()).toBe("DONE");
    expect(logs.some((l) => l.includes("Breakeven zone sell"))).toBe(true);
    expect(logs.some((l) => l.includes("Second sell complete"))).toBe(true);
  });

  test("breakeven zone: waits when at loss", async () => {
    const { manager, logs } = setupInSellingSecond({
      entryVwap: 0.50,
      currentBid: 0.48, // profit = -$0.02 (loss)
      msLeft: 90000,
    });

    await manager.onBtcPriceUpdate(makeUpdate(100050));

    expect(manager.getState()).toBe("SELLING_SECOND");
    expect(logs.some((l) => l.includes("Second sell complete"))).toBe(false);
  });

  test("emergency zone: force sells at a loss", async () => {
    const { manager, logs } = setupInSellingSecond({
      entryVwap: 0.50,
      currentBid: 0.45, // profit = -$0.05 (deep loss)
      msLeft: 30000,     // 30s left (emergency zone)
    });

    await manager.onBtcPriceUpdate(makeUpdate(100050));

    expect(manager.getState()).toBe("DONE");
    expect(logs.some((l) => l.includes("EMERGENCY sell"))).toBe(true);
    expect(logs.some((l) => l.includes("Second sell complete"))).toBe(true);
  });

  test("transitions patient → breakeven → emergency as time passes", async () => {
    const { manager, logs } = setupInSellingSecond({
      entryVwap: 0.50,
      currentBid: 0.49, // loss
      msLeft: 300000,
    });

    await manager.onBtcPriceUpdate(makeUpdate(100050));
    expect(manager.getState()).toBe("SELLING_SECOND"); // waits in patient

    // Move to breakeven zone — still at loss → waits
    currentMsLeft = 90000;
    await manager.onBtcPriceUpdate(makeUpdate(100050));
    expect(manager.getState()).toBe("SELLING_SECOND");

    // Move to emergency zone → force sells
    currentMsLeft = 30000;
    await manager.onBtcPriceUpdate(makeUpdate(100050));
    expect(manager.getState()).toBe("DONE");
    expect(logs.some((l) => l.includes("EMERGENCY sell"))).toBe(true);
  });
});
