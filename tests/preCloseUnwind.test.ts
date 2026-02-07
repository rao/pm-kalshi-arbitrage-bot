import { test, expect, describe, beforeEach, mock } from "bun:test";

// Mock kalshi createOrder BEFORE importing preCloseUnwind
const mockKalshiCreateOrder = mock(async () => ({
  order: { count: 10, remaining_count: 0 },
}));

mock.module("../src/venues/kalshi/orders", () => ({
  createOrder: mockKalshiCreateOrder,
}));

import {
  startPreCloseTimer,
  stopPreCloseTimer,
  reschedulePreCloseTimer,
  isPreCloseUnwindActive,
  executePreCloseUnwind,
  resetPreCloseState,
  type PreCloseOptions,
} from "../src/execution/preCloseUnwind";
import {
  resetPositionTracker,
  getPositions,
  recordFill,
} from "../src/state/positionTracker";
import {
  resetAllState,
  acquireBusyLock,
  releaseBusyLock,
  startLiquidation,
  stopLiquidation,
} from "../src/execution/executionState";
import type { IntervalMapping } from "../src/markets/mappingStore";
import type { IntervalKey } from "../src/time/interval";
import type { InitializedClients } from "../src/execution/venueClientFactory";
import type { Logger } from "../src/logging/logger";

// --- Test helpers ---

const TEST_INTERVAL: IntervalKey = {
  startTs: 1700000000,
  endTs: 1700000900,
};

const TEST_MAPPING: IntervalMapping = {
  intervalKey: TEST_INTERVAL,
  polymarket: {
    upToken: "poly-up-token-123",
    downToken: "poly-down-token-456",
    slug: "btc-up-down",
    endTs: 1700000900,
  },
  kalshi: {
    eventTicker: "KXBTC15M-26FEB031730",
    marketTicker: "KXBTC15M-26FEB031730-30",
    seriesTicker: "KXBTC15M",
    closeTs: 1700000900,
  },
  discoveredAt: Date.now(),
};

function makeLogger(): Logger {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    trackQuote: mock(() => {}),
    updateEdge: mock(() => {}),
    startStatusInterval: mock(() => {}),
    stopStatusInterval: mock(() => {}),
    startMetricsInterval: mock(() => {}),
    stopMetricsInterval: mock(() => {}),
    logOpportunity: mock(() => {}),
  } as unknown as Logger;
}

function makeMockClients(overrides?: {
  polyFillQty?: number;
  kalshiFillQty?: number;
  polyBalance?: number;
  polyThrow?: boolean;
  kalshiThrow?: boolean;
}): InitializedClients {
  const {
    polyFillQty = 10,
    polyBalance = 100,
    polyThrow = false,
  } = overrides ?? {};

  return {
    polymarket: {
      placeFakOrder: mock(async () => {
        if (polyThrow) throw new Error("poly sell failed");
        return {
          success: true,
          orderId: "poly-order-1",
          takingAmount: String(polyFillQty * 0.5),
          makingAmount: String(polyFillQty),
        };
      }),
      getConditionalTokenBalance: mock(async () => polyBalance),
      cancelAllOrders: mock(async () => ({ canceled: [], notCanceled: {} })),
      cancelMarketOrders: mock(async () => ({})),
      getOpenOrders: mock(async () => []),
      init: mock(async () => {}),
    } as unknown as InitializedClients["polymarket"],
    kalshi: {
      auth: {
        getHeaders: mock(async () => ({})),
      },
    } as unknown as InitializedClients["kalshi"],
  };
}

function makeOptions(overrides?: Partial<PreCloseOptions>): PreCloseOptions {
  return {
    venueClients: makeMockClients(),
    logger: makeLogger(),
    getCurrentMapping: () => TEST_MAPPING,
    dryRun: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetPositionTracker();
  resetAllState();
  resetPreCloseState();
  mockKalshiCreateOrder.mockClear();
  mockKalshiCreateOrder.mockImplementation(async () => ({
    order: { count: 10, remaining_count: 0 },
  }));
});

// --- State flag tests ---

describe("pre-close state flag", () => {
  test("isPreCloseUnwindActive returns false initially", () => {
    expect(isPreCloseUnwindActive()).toBe(false);
  });

  test("isPreCloseUnwindActive returns true after executePreCloseUnwind starts", async () => {
    recordFill("polymarket", "yes", "buy", 10, 0.45, TEST_INTERVAL, "order1", "poly-up-token-123");

    const options = makeOptions();
    await executePreCloseUnwind(options);

    expect(isPreCloseUnwindActive()).toBe(true);
  });

  test("isPreCloseUnwindActive returns false after stopPreCloseTimer", async () => {
    recordFill("polymarket", "yes", "buy", 10, 0.45, TEST_INTERVAL, "order1", "poly-up-token-123");

    const options = makeOptions();
    await executePreCloseUnwind(options);
    expect(isPreCloseUnwindActive()).toBe(true);

    stopPreCloseTimer();
    expect(isPreCloseUnwindActive()).toBe(false);
  });

  test("flag stays active even when no positions held", async () => {
    const options = makeOptions();
    await executePreCloseUnwind(options);

    expect(isPreCloseUnwindActive()).toBe(true);
  });
});

// --- Timer tests ---

describe("pre-close timer", () => {
  test("stopPreCloseTimer clears timer and resets flag", () => {
    const options = makeOptions();
    startPreCloseTimer(options);

    stopPreCloseTimer();
    expect(isPreCloseUnwindActive()).toBe(false);
  });

  test("reschedule clears old and sets new", () => {
    const options = makeOptions();
    startPreCloseTimer(options);
    reschedulePreCloseTimer(options);

    expect(isPreCloseUnwindActive()).toBe(false); // not active until timer fires
  });
});

// --- Sell logic tests ---

describe("pre-close sell execution", () => {
  test("sells 95% of each venue+side position", async () => {
    recordFill("polymarket", "yes", "buy", 10, 0.45, TEST_INTERVAL, "o1", "poly-up-token-123");
    recordFill("kalshi", "no", "buy", 10, 0.45, TEST_INTERVAL, "o2", "KXBTC15M-26FEB031730-30");

    const clients = makeMockClients({ polyFillQty: 9 });
    mockKalshiCreateOrder.mockImplementation(async () => ({
      order: { count: 9, remaining_count: 0 },
    }));

    const options = makeOptions({ venueClients: clients });
    await executePreCloseUnwind(options);

    const positions = getPositions();
    expect(positions.polymarket.yes).toBe(1);
    expect(positions.kalshi.no).toBe(1);
  });

  test("correctly computes floor(qty * 0.95)", async () => {
    // Position of 7: floor(7 * 0.95) = floor(6.65) = 6
    recordFill("polymarket", "yes", "buy", 7, 0.45, TEST_INTERVAL, "o1", "poly-up-token-123");

    const clients = makeMockClients({ polyFillQty: 6 });
    const options = makeOptions({ venueClients: clients });
    await executePreCloseUnwind(options);

    const positions = getPositions();
    expect(positions.polymarket.yes).toBe(1);
  });

  test("skips venues with zero positions", async () => {
    recordFill("polymarket", "yes", "buy", 10, 0.45, TEST_INTERVAL, "o1", "poly-up-token-123");

    const clients = makeMockClients({ polyFillQty: 9 });
    const options = makeOptions({ venueClients: clients });
    await executePreCloseUnwind(options);

    expect(mockKalshiCreateOrder).not.toHaveBeenCalled();
  });

  test("caps Polymarket sell to on-chain balance", async () => {
    recordFill("polymarket", "yes", "buy", 20, 0.45, TEST_INTERVAL, "o1", "poly-up-token-123");

    // floor(5 * 0.95) = 4
    const clients = makeMockClients({ polyBalance: 5, polyFillQty: 4 });
    const options = makeOptions({ venueClients: clients });
    await executePreCloseUnwind(options);

    const positions = getPositions();
    expect(positions.polymarket.yes).toBe(16); // 20 - 4
  });

  test("uses getMarketIdForPosition when no mapping available", async () => {
    recordFill("polymarket", "yes", "buy", 10, 0.45, TEST_INTERVAL, "o1", "poly-up-token-123");

    const clients = makeMockClients({ polyFillQty: 9 });
    const options = makeOptions({
      venueClients: clients,
      getCurrentMapping: () => null,
    });
    await executePreCloseUnwind(options);

    const positions = getPositions();
    expect(positions.polymarket.yes).toBe(1);
  });

  test("records fills in position tracker", async () => {
    recordFill("polymarket", "yes", "buy", 10, 0.45, TEST_INTERVAL, "o1", "poly-up-token-123");

    const clients = makeMockClients({ polyFillQty: 9 });
    const options = makeOptions({ venueClients: clients });
    await executePreCloseUnwind(options);

    const positions = getPositions();
    expect(positions.polymarket.yes).toBe(1);
  });

  test("retries once on failure", async () => {
    recordFill("kalshi", "yes", "buy", 10, 0.45, TEST_INTERVAL, "o1", "KXBTC15M-26FEB031730-30");

    let callCount = 0;
    mockKalshiCreateOrder.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("temporary failure");
      }
      return { order: { count: 9, remaining_count: 0 } };
    });

    const options = makeOptions();
    await executePreCloseUnwind(options);

    expect(callCount).toBe(2);
  });

  test("dry run logs but does not execute sells", async () => {
    recordFill("polymarket", "yes", "buy", 10, 0.45, TEST_INTERVAL, "o1", "poly-up-token-123");

    const logger = makeLogger();
    const options = makeOptions({ dryRun: true, logger });
    await executePreCloseUnwind(options);

    const positions = getPositions();
    expect(positions.polymarket.yes).toBe(10);
    expect(logger.info).toHaveBeenCalled();
  });
});

// --- Edge case tests ---

describe("pre-close edge cases", () => {
  test("skips when liquidation in progress", async () => {
    recordFill("polymarket", "yes", "buy", 10, 0.45, TEST_INTERVAL, "o1", "poly-up-token-123");

    startLiquidation();
    const logger = makeLogger();
    const options = makeOptions({ logger });
    await executePreCloseUnwind(options);

    const positions = getPositions();
    expect(positions.polymarket.yes).toBe(10);
    expect(isPreCloseUnwindActive()).toBe(true);

    stopLiquidation();
  });

  test("waits then proceeds when execution busy", async () => {
    recordFill("polymarket", "yes", "buy", 10, 0.45, TEST_INTERVAL, "o1", "poly-up-token-123");

    acquireBusyLock();
    setTimeout(() => releaseBusyLock(), 500);

    const clients = makeMockClients({ polyFillQty: 9 });
    const options = makeOptions({ venueClients: clients });
    await executePreCloseUnwind(options);

    const positions = getPositions();
    expect(positions.polymarket.yes).toBe(1);
  });

  test("skips position with no market ID from any source", async () => {
    recordFill("polymarket", "yes", "buy", 10, 0.45, TEST_INTERVAL, "o1");

    const logger = makeLogger();
    const options = makeOptions({
      logger,
      getCurrentMapping: () => null,
    });
    await executePreCloseUnwind(options);

    const positions = getPositions();
    expect(positions.polymarket.yes).toBe(10);
    expect(logger.error).toHaveBeenCalled();
  });

  test("handles zero on-chain balance gracefully", async () => {
    recordFill("polymarket", "yes", "buy", 10, 0.45, TEST_INTERVAL, "o1", "poly-up-token-123");

    const clients = makeMockClients({ polyBalance: 0 });
    const options = makeOptions({ venueClients: clients });
    await executePreCloseUnwind(options);

    const positions = getPositions();
    expect(positions.polymarket.yes).toBe(10);
  });

  test("handles positions on all 4 venue+side combos", async () => {
    recordFill("polymarket", "yes", "buy", 10, 0.45, TEST_INTERVAL, "o1", "poly-up-token-123");
    recordFill("polymarket", "no", "buy", 8, 0.45, TEST_INTERVAL, "o2", "poly-down-token-456");
    recordFill("kalshi", "yes", "buy", 6, 0.45, TEST_INTERVAL, "o3", "KXBTC15M-26FEB031730-30");
    recordFill("kalshi", "no", "buy", 4, 0.45, TEST_INTERVAL, "o4", "KXBTC15M-26FEB031730-30");

    const clients = makeMockClients({ polyBalance: 100 });

    // Kalshi sells: track per call
    let kalshiCallCount = 0;
    mockKalshiCreateOrder.mockImplementation(async () => {
      kalshiCallCount++;
      if (kalshiCallCount === 1) {
        return { order: { count: 5, remaining_count: 0 } };
      }
      return { order: { count: 3, remaining_count: 0 } };
    });

    // Poly FAK: track per call
    let polyCallCount = 0;
    (clients.polymarket as any).placeFakOrder = mock(async () => {
      polyCallCount++;
      if (polyCallCount === 1) {
        return { success: true, takingAmount: "4.5", makingAmount: "9" };
      }
      return { success: true, takingAmount: "3.5", makingAmount: "7" };
    });

    const options = makeOptions({ venueClients: clients });
    await executePreCloseUnwind(options);

    const positions = getPositions();
    expect(positions.polymarket.yes).toBe(1);  // 10 - 9
    expect(positions.polymarket.no).toBe(1);   // 8 - 7
    expect(positions.kalshi.yes).toBe(1);      // 6 - 5
    expect(positions.kalshi.no).toBe(1);       // 4 - 3
  });
});
