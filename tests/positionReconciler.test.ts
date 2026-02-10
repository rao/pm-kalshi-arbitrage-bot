import { test, expect, describe, beforeEach } from "bun:test";
import {
  reconcileTick,
  resetReconcilerState,
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
  markExecutionEnd,
  startLiquidation,
  stopLiquidation,
  isInCooldown,
  resetLastExecutionEndTs,
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
  resetReconcilerState();
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

  describe("stability-based confirmation for large divergences", () => {
    test("does NOT override when API shows massive divergence on first read", async () => {
      // Local tracker: poly yes=425, kalshi no=425 (balanced box)
      setVenuePositions("polymarket", { yes: 425, no: 0 });
      setVenuePositions("kalshi", { yes: 0, no: 425 });
      resetLastExecutionEndTs();

      // Venue API returns kalshi no=0 (stale!) — massive divergence (425)
      const options = buildOptions({
        polyYes: 425,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0, // stale!
      });

      await reconcileTick(options);

      // Kalshi positions should NOT be overridden — first read, awaiting confirmation
      const pos = getPositions();
      expect(pos.kalshi.no).toBe(425); // local preserved
      expect(placedOrders.length).toBe(0);
    });

    test("does NOT override when API keeps changing (0 → 144 — still settling)", async () => {
      setVenuePositions("polymarket", { yes: 425, no: 0 });
      setVenuePositions("kalshi", { yes: 0, no: 425 });
      resetLastExecutionEndTs();

      // First tick: API returns kalshi no=0
      let options = buildOptions({
        polyYes: 425,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0,
      });
      await reconcileTick(options);

      // Second tick: API returns kalshi no=144 (catching up but still wrong)
      options = buildOptions({
        polyYes: 425,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 144,
      });
      await reconcileTick(options);

      // Still should NOT override — API changed from 0→144, not stable
      const pos = getPositions();
      expect(pos.kalshi.no).toBe(425); // local preserved
      expect(placedOrders.length).toBe(0);
    });

    test("overrides after two consecutive stable divergent reads", async () => {
      setVenuePositions("polymarket", { yes: 425, no: 0 });
      setVenuePositions("kalshi", { yes: 0, no: 425 });
      resetLastExecutionEndTs();

      // First tick: API returns kalshi no=420 (real but slightly different)
      let options = buildOptions({
        polyYes: 425,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 420,
      });
      await reconcileTick(options);

      // Second tick: API returns kalshi no=420 again (stable)
      options = buildOptions({
        polyYes: 425,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 420,
      });
      await reconcileTick(options);

      // NOW should override — two consecutive reads agree
      // After override to 420, reconciler sees imbalance (425 vs 420) and buys 5 NO on Kalshi.
      // Mock fills 1 contract, local position updated: 420 + 1 = 421
      const pos = getPositions();
      expect(pos.kalshi.no).toBe(421);
    });

    test("stable reads within tolerance (2 contracts) also confirm", async () => {
      setVenuePositions("polymarket", { yes: 425, no: 0 });
      setVenuePositions("kalshi", { yes: 0, no: 425 });
      resetLastExecutionEndTs();

      // First tick: API returns kalshi no=420
      let options = buildOptions({
        polyYes: 425,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 420,
      });
      await reconcileTick(options);

      // Second tick: API returns kalshi no=421 (within 2-contract tolerance)
      options = buildOptions({
        polyYes: 425,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 421,
      });
      await reconcileTick(options);

      // Should override to 421, then reconciler sees imbalance (425 vs 421) and buys 4 NO.
      // Mock fills 1 contract, local position updated: 421 + 1 = 422
      const pos = getPositions();
      expect(pos.kalshi.no).toBe(422);
    });

    test("small divergences (< 5) override immediately without confirmation", async () => {
      setVenuePositions("polymarket", { yes: 10, no: 0 });
      setVenuePositions("kalshi", { yes: 0, no: 10 });
      resetLastExecutionEndTs();

      // API shows kalshi no=7 (diff=3, below threshold of 5)
      const options = buildOptions({
        polyYes: 10,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 7,
      });

      await reconcileTick(options);

      // Should override to 7, then reconciler sees imbalance (10 vs 7) and buys 3 NO.
      // Mock fills 1 contract, local position updated: 7 + 1 = 8
      const pos = getPositions();
      expect(pos.kalshi.no).toBe(8);
    });
  });

  describe("corrective action qty cap", () => {
    test("caps corrective action at maxReconcilerActionQty (50)", async () => {
      // Create a 200-contract imbalance
      setVenuePositions("polymarket", { yes: 200, no: 0 });
      setVenuePositions("kalshi", { yes: 0, no: 0 });
      resetLastExecutionEndTs();

      // API confirms the imbalance (small divergence for kalshi=0 → instant override)
      orderResults = [makeSuccessResult("kalshi")];
      const options = buildOptions({
        polyYes: 200,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0,
      });

      await reconcileTick(options);

      // Corrective order should be placed, but capped at 50
      expect(placedOrders.length).toBe(1);
      expect(placedOrders[0].qty).toBe(50);
    });
  });

  describe("local position update after corrective fill", () => {
    test("updates local positions after corrective complete on Kalshi (auto-netting)", async () => {
      // Poly YES=10, Kalshi NO=10 (balanced box)
      // Then Kalshi reports NO=8 → override makes totalYes=10, totalNo=8 → imbalance of 2
      // Reconciler buys 2 Kalshi NO to complete (since Kalshi preferred for completion)
      // But wait — the missing side is NO, so it buys NO on Kalshi.
      // Kalshi auto-netting: buying NO when holding NO just adds to NO position.
      // Actually, let's set up: Poly YES=10, Kalshi NO=0 → missing NO, buy 10 NO on Kalshi
      setVenuePositions("polymarket", { yes: 10, no: 0 });
      setVenuePositions("kalshi", { yes: 0, no: 0 });
      resetLastExecutionEndTs();

      const fillResult: OrderResult = {
        success: true,
        orderId: "order-test",
        fillQty: 10,
        fillPrice: 0.50,
        venue: "kalshi",
        status: "filled",
        submittedAt: Date.now(),
        filledAt: Date.now(),
        error: null,
      };

      const options = buildOptions({
        polyYes: 10,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0,
        venueClientsResult: fillResult,
      });

      await reconcileTick(options);

      // After corrective buy of 10 NO on Kalshi, local should be updated
      const pos = getPositions();
      expect(pos.kalshi.no).toBe(10);
      expect(pos.kalshi.yes).toBe(0);
      expect(placedOrders.length).toBe(1);
    });

    test("handles Kalshi auto-netting when buying YES against existing NO position", async () => {
      // Poly YES=0, Kalshi NO=20 → totalYes=0, totalNo=20 → excess NO
      // Reconciler decides to complete by buying YES on Kalshi
      // Kalshi auto-nets: buy 20 YES against 20 NO → NO reduced by 20, YES stays 0
      setVenuePositions("polymarket", { yes: 0, no: 0 });
      setVenuePositions("kalshi", { yes: 0, no: 20 });
      resetLastExecutionEndTs();

      const fillResult: OrderResult = {
        success: true,
        orderId: "order-test",
        fillQty: 20,
        fillPrice: 0.50,
        venue: "kalshi",
        status: "filled",
        submittedAt: Date.now(),
        filledAt: Date.now(),
        error: null,
      };

      const options = buildOptions({
        polyYes: 0,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 20,
        venueClientsResult: fillResult,
      });

      await reconcileTick(options);

      // Buy 20 YES on Kalshi with 20 NO held → auto-net: NO=20-20=0, YES=0
      const pos = getPositions();
      expect(pos.kalshi.no).toBe(0);
      expect(pos.kalshi.yes).toBe(0);
    });

    test("updates local positions after unwind sell", async () => {
      // Poly YES=10, Kalshi NO=0 → excess YES on Poly
      // Make completing expensive so unwind is chosen
      setVenuePositions("polymarket", { yes: 10, no: 0 });
      setVenuePositions("kalshi", { yes: 0, no: 0 });
      resetLastExecutionEndTs();

      const expensiveQuote = makeQuote({
        no_ask: 0.99,
        yes_bid: 0.45,
      });

      const fillResult: OrderResult = {
        success: true,
        orderId: "order-test",
        fillQty: 10,
        fillPrice: 0.44,
        venue: "polymarket",
        status: "filled",
        submittedAt: Date.now(),
        filledAt: Date.now(),
        error: null,
      };

      const options = buildOptions({
        polyYes: 10,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0,
        quote: expensiveQuote,
        venueClientsResult: fillResult,
      });

      await reconcileTick(options);

      // After unwinding 10 YES on Polymarket, local should reflect the sell
      const pos = getPositions();
      expect(pos.polymarket.yes).toBe(0);
      expect(placedOrders.length).toBe(1);
      expect(placedOrders[0].action).toBe("sell");
    });
  });

  describe("corrective action cooldown", () => {
    test("second tick within 120s skips corrective action", async () => {
      // First tick: corrective action fires
      setVenuePositions("polymarket", { yes: 10, no: 0 });
      setVenuePositions("kalshi", { yes: 0, no: 0 });
      resetLastExecutionEndTs();

      const fillResult: OrderResult = {
        success: true,
        orderId: "order-test",
        fillQty: 10,
        fillPrice: 0.50,
        venue: "kalshi",
        status: "filled",
        submittedAt: Date.now(),
        filledAt: Date.now(),
        error: null,
      };

      const options = buildOptions({
        polyYes: 10,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0,
        venueClientsResult: fillResult,
      });

      await reconcileTick(options);
      expect(placedOrders.length).toBe(1);

      // Second tick immediately: should be blocked by cooldown
      // Reset local to create another imbalance (simulating the bug scenario)
      placedOrders = [];
      setVenuePositions("polymarket", { yes: 10, no: 0 });
      setVenuePositions("kalshi", { yes: 0, no: 0 });

      await reconcileTick(options);

      // No additional orders should be placed — cooldown active
      expect(placedOrders.length).toBe(0);
    });

    test("corrective action allowed after cooldown expires", async () => {
      // Simulate expired cooldown by resetting state
      setVenuePositions("polymarket", { yes: 10, no: 0 });
      setVenuePositions("kalshi", { yes: 0, no: 0 });
      resetLastExecutionEndTs();
      resetReconcilerState(); // resets lastCorrectiveActionTs to 0

      const fillResult: OrderResult = {
        success: true,
        orderId: "order-test",
        fillQty: 10,
        fillPrice: 0.50,
        venue: "kalshi",
        status: "filled",
        submittedAt: Date.now(),
        filledAt: Date.now(),
        error: null,
      };

      const options = buildOptions({
        polyYes: 10,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 0,
        venueClientsResult: fillResult,
      });

      await reconcileTick(options);

      // Should execute since cooldown is expired (ts=0 means never)
      expect(placedOrders.length).toBe(1);
    });
  });

  describe("post-execution grace period", () => {
    test("skips tick within post-execution grace period", async () => {
      // Simulate a recent real execution
      acquireBusyLock();
      releaseBusyLock();
      markExecutionEnd();

      // Set local positions as if we just executed an arb
      recordFill("polymarket", "yes", "buy", 25, 0.89, TEST_INTERVAL);
      recordFill("kalshi", "no", "buy", 25, 0.04, TEST_INTERVAL);

      // Venue reports polymarket yes=0 (not settled on-chain yet)
      const options = buildOptions({
        polyYes: 0,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 25,
      });

      await reconcileTick(options);

      // Positions should NOT be overridden — grace period protects local tracker
      const pos = getPositions();
      expect(pos.polymarket.yes).toBe(25);
      expect(pos.kalshi.no).toBe(25);
      expect(placedOrders.length).toBe(0);
    });

    test("runs normally when grace period has elapsed", async () => {
      // Reset so lastExecutionEndTs = 0 (effectively infinite time ago)
      resetLastExecutionEndTs();

      // Local tracker: poly yes=1
      recordFill("polymarket", "yes", "buy", 1, 0.50, TEST_INTERVAL);

      // Venue says positions are different (poly yes=0, kalshi no=1)
      const options = buildOptions({
        polyYes: 0,
        polyNo: 0,
        kalshiYes: 0,
        kalshiNo: 1,
      });

      await reconcileTick(options);

      // Should override since grace period is not active
      const pos = getPositions();
      expect(pos.polymarket.yes).toBe(0);
    });
  });
});
