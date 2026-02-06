import { test, expect, describe, beforeEach } from "bun:test";
import {
  reconcileTick,
  type PositionReconcilerOptions,
  type VenuePositionReport,
} from "../src/state/positionReconciler";
import {
  resetPositionTracker,
  getPositions,
  recordFill,
  setVenuePositions,
} from "../src/state/positionTracker";
import {
  resetAllState,
  triggerKillSwitch,
  acquireBusyLock,
  releaseBusyLock,
  startLiquidation,
  stopLiquidation,
  isInCooldown,
} from "../src/execution/executionState";
import type { IntervalMapping } from "../src/markets/mappingStore";
import type { NormalizedQuote } from "../src/normalization/types";
import type { IntervalKey } from "../src/time/interval";
import type { VenueClients, OrderResult } from "../src/execution/types";
import type { Venue } from "../src/strategy/types";

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

function makeQuote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
  return {
    yes_bid: 0.45,
    yes_ask: 0.50,
    yes_bid_size: 10,
    yes_ask_size: 10,
    no_bid: 0.45,
    no_ask: 0.50,
    no_bid_size: 10,
    no_ask_size: 10,
    ts_exchange: Date.now(),
    ts_local: Date.now(),
    ...overrides,
  };
}

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as any;

/** Track order placements for assertions */
let placedOrders: any[] = [];
let orderResults: OrderResult[] = [];

function makeSuccessResult(venue: Venue): OrderResult {
  return {
    success: true,
    orderId: `order-${Date.now()}`,
    fillQty: 1,
    fillPrice: 0.50,
    venue,
    status: "filled",
    submittedAt: Date.now(),
    filledAt: Date.now(),
    error: null,
  };
}

function makeMockVenueClients(
  resultOverride?: OrderResult
): VenueClients {
  return {
    placeOrder: async (params) => {
      placedOrders.push(params);
      if (resultOverride) return resultOverride;
      return orderResults.length > 0
        ? orderResults.shift()!
        : makeSuccessResult(params.venue);
    },
    cancelOrder: async () => true,
    getQuote: () => makeQuote(),
    getOrderStatus: async () => ({ status: "unknown", filled: false }),
  };
}

/** Build options with injectable fetchPositions */
function buildOptions(overrides: {
  kalshiYes?: number;
  kalshiNo?: number;
  polyYes?: number;
  polyNo?: number;
  mapping?: IntervalMapping | null;
  quote?: NormalizedQuote | null;
  venueClientsResult?: OrderResult;
  noVenueClients?: boolean;
  skipKalshi?: boolean;
} = {}): PositionReconcilerOptions {
  const {
    kalshiYes = 0,
    kalshiNo = 0,
    polyYes = 0,
    polyNo = 0,
    mapping = TEST_MAPPING,
    quote = makeQuote(),
    venueClientsResult,
    noVenueClients = false,
    skipKalshi = false,
  } = overrides;

  const reports: VenuePositionReport[] = [];
  reports.push({ venue: "polymarket", yes: polyYes, no: polyNo });
  if (!skipKalshi) {
    reports.push({ venue: "kalshi", yes: kalshiYes, no: kalshiNo });
  }

  return {
    venueClients: {
      polymarket: null as any,
      kalshi: null as any,
    },
    logger: noopLogger,
    intervalMs: 60000,
    getCurrentMapping: () => mapping,
    getQuote: () => quote,
    getVenueClients: () =>
      noVenueClients ? null : makeMockVenueClients(venueClientsResult),
    fetchPositions: async () => reports,
  };
}

// --- Setup ---

beforeEach(() => {
  resetPositionTracker();
  resetAllState();
  placedOrders = [];
  orderResults = [];
});

// --- Tests ---

describe("positionReconciler", () => {
  describe("no mapping available", () => {
    test("skips gracefully when no mapping", async () => {
      const options = buildOptions({ mapping: null });
      await reconcileTick(options);

      const pos = getPositions();
      expect(pos.polymarket.yes).toBe(0);
      expect(pos.kalshi.yes).toBe(0);
    });
  });

  describe("positions match", () => {
    test("no corrective action when positions match and are balanced", async () => {
      // Local tracker: poly yes=1, kalshi no=1 (balanced box)
      recordFill("polymarket", "yes", "buy", 1, 0.50, TEST_INTERVAL);
      recordFill("kalshi", "no", "buy", 1, 0.50, TEST_INTERVAL);

      // Venue reports same
      const options = buildOptions({
        polyYes: 1,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 1,
      });

      await reconcileTick(options);

      expect(placedOrders.length).toBe(0);
    });
  });

  describe("mismatch detection and override", () => {
    test("overrides local tracker when venue reports different positions", async () => {
      // Local tracker thinks: poly yes=0, kalshi yes=0
      // Venue says: poly yes=1, kalshi no=1 (balanced, local was stale)
      const options = buildOptions({
        polyYes: 1,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 1,
      });

      await reconcileTick(options);

      const pos = getPositions();
      expect(pos.polymarket.yes).toBe(1);
      expect(pos.polymarket.no).toBe(0);
      expect(pos.kalshi.yes).toBe(0);
      expect(pos.kalshi.no).toBe(1);

      // Balanced, so no orders placed
      expect(placedOrders.length).toBe(0);
    });

    test("detects mismatch and logs override", async () => {
      // Local: poly yes=2
      recordFill("polymarket", "yes", "buy", 2, 0.50, TEST_INTERVAL);

      const logMessages: string[] = [];
      const trackingLogger = {
        ...noopLogger,
        warn: (msg: string) => logMessages.push(msg),
        info: (msg: string) => logMessages.push(msg),
      } as any;

      const options = {
        ...buildOptions({
          polyYes: 1,
          polyNo: 0,
          kalshiYes: 0,
          kalshiNo: 1,
        }),
        logger: trackingLogger,
      };

      await reconcileTick(options);

      const mismatchLog = logMessages.find((m) => m.includes("MISMATCH"));
      expect(mismatchLog).toBeTruthy();
      expect(mismatchLog).toContain("polymarket");

      const pos = getPositions();
      expect(pos.polymarket.yes).toBe(1);
    });
  });

  describe("unhedged exposure — completing arb", () => {
    test("places buy order for missing side when completing is cheaper", async () => {
      // Venue reports: poly yes=1, kalshi no=0 → unhedged (excess YES)
      // With default quote: no_ask=0.50, yes_bid=0.45
      // Complete: buy NO at $0.50 → net PnL ≈ $1 - $0.50 - fees ≈ $0.48
      // Unwind: sell YES at $0.45 → recovery ≈ $0.44
      // → completing is better
      orderResults = [makeSuccessResult("kalshi")];

      const options = buildOptions({
        polyYes: 1,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0,
      });

      await reconcileTick(options);

      expect(placedOrders.length).toBe(1);
      expect(placedOrders[0].action).toBe("buy");
      expect(placedOrders[0].side).toBe("no");
    });
  });

  describe("unhedged exposure — unwinding", () => {
    test("places sell order when unwind is cheaper than completing", async () => {
      // Make completing very expensive (ask for NO = 0.99)
      // Complete: buy NO at $0.99 → net PnL ≈ $1 - $0.99 - fees ≈ -$0.01
      // Unwind: sell YES at bid $0.45 → recovery ≈ $0.44
      // → unwinding is better (loses less)
      const expensiveQuote = makeQuote({
        no_ask: 0.99,
        yes_bid: 0.45,
      });

      orderResults = [makeSuccessResult("polymarket")];

      const options = buildOptions({
        polyYes: 1,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0,
        quote: expensiveQuote,
      });

      await reconcileTick(options);

      expect(placedOrders.length).toBe(1);
      expect(placedOrders[0].action).toBe("sell");
      expect(placedOrders[0].side).toBe("yes");
    });
  });

  describe("guard checks", () => {
    test("no orders placed when kill switch is active", async () => {
      triggerKillSwitch();

      const options = buildOptions({
        polyYes: 1,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0,
      });

      await reconcileTick(options);

      // Positions overridden but no orders placed
      const pos = getPositions();
      expect(pos.polymarket.yes).toBe(1);
      expect(placedOrders.length).toBe(0);
    });

    test("no orders placed when execution is busy", async () => {
      acquireBusyLock();

      const options = buildOptions({
        polyYes: 1,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0,
      });

      await reconcileTick(options);

      const pos = getPositions();
      expect(pos.polymarket.yes).toBe(1);
      expect(placedOrders.length).toBe(0);

      releaseBusyLock();
    });

    test("no orders placed when liquidation in progress", async () => {
      startLiquidation();

      const options = buildOptions({
        polyYes: 1,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0,
      });

      await reconcileTick(options);

      expect(placedOrders.length).toBe(0);

      stopLiquidation();
    });
  });

  describe("one venue query fails", () => {
    test("still reconciles the other venue when kalshi skipped", async () => {
      // Only Polymarket reports (Kalshi skipped)
      recordFill("polymarket", "yes", "buy", 2, 0.50, TEST_INTERVAL);

      const options = buildOptions({
        polyYes: 1,
        polyNo: 1,
        skipKalshi: true,
      });

      await reconcileTick(options);

      // Polymarket should be overridden
      const pos = getPositions();
      expect(pos.polymarket.yes).toBe(1);
      expect(pos.polymarket.no).toBe(1);
    });
  });

  describe("cooldown after corrective action", () => {
    test("enters cooldown after placing corrective order", async () => {
      orderResults = [makeSuccessResult("kalshi")];

      const options = buildOptions({
        polyYes: 1,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0,
      });

      await reconcileTick(options);

      expect(isInCooldown()).toBe(true);
    });
  });

  describe("setVenuePositions", () => {
    test("directly overrides venue positions", () => {
      recordFill("polymarket", "yes", "buy", 3, 0.50, TEST_INTERVAL);
      expect(getPositions().polymarket.yes).toBe(3);

      setVenuePositions("polymarket", { yes: 1, no: 2 });
      const pos = getPositions();
      expect(pos.polymarket.yes).toBe(1);
      expect(pos.polymarket.no).toBe(2);
    });
  });

  describe("empty fetch results", () => {
    test("skips when fetchPositions returns empty", async () => {
      const options = buildOptions();
      options.fetchPositions = async () => [];

      await reconcileTick(options);

      expect(placedOrders.length).toBe(0);
    });
  });
});
