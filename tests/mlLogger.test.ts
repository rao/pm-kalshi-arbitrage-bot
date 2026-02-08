import { test, expect, describe, afterAll } from "bun:test";
import { buildCsvRow, initMlLogger, _test } from "../src/logging/mlLogger";
import type { ExecutionRecord, ExecutionContext, LegExecution, OrderParams } from "../src/execution/types";
import type { NormalizedQuote } from "../src/normalization/types";
import type { Opportunity, ArbLeg } from "../src/strategy/types";
import type { IntervalKey } from "../src/time/interval";
import type { IntervalMapping } from "../src/markets/mappingStore";
import { join } from "path";
import { rm } from "node:fs/promises";

const { COLUMNS, spread, imbalance, sanitize } = _test;

// ── Test fixtures ──

function makeQuote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
  return {
    yes_bid: 0.45,
    yes_ask: 0.48,
    yes_bid_size: 100,
    yes_ask_size: 50,
    no_bid: 0.50,
    no_ask: 0.53,
    no_bid_size: 80,
    no_ask_size: 60,
    ts_exchange: 1700000000000,
    ts_local: 1700000000050,
    ...overrides,
  };
}

function makeIntervalKey(): IntervalKey {
  return { startTs: 1700000000, endTs: 1700000900 };
}

function makeLeg(venue: "polymarket" | "kalshi", side: "yes" | "no"): ArbLeg {
  return { venue, side, price: 0.48, size: 10 };
}

function makeOrderParams(venue: "polymarket" | "kalshi", side: "yes" | "no"): OrderParams {
  return {
    venue,
    side,
    action: "buy",
    price: 0.48,
    qty: 5,
    timeInForce: "FOK",
    marketId: `${venue}-mkt-123`,
    clientOrderId: `${venue}_A_test`,
  };
}

function makeLegExecution(venue: "polymarket" | "kalshi", side: "yes" | "no", filled: boolean): LegExecution {
  const params = makeOrderParams(venue, side);
  return {
    leg: makeLeg(venue, side),
    params,
    result: filled
      ? {
          success: true,
          orderId: "order-123",
          fillQty: 5,
          fillPrice: 0.47,
          venue,
          status: "filled",
          submittedAt: 1700000001000,
          filledAt: 1700000001100,
          error: null,
        }
      : null,
    submitTs: filled ? 1700000001000 : null,
    fillTs: filled ? 1700000001100 : null,
  };
}

function makeRecord(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  const intervalKey = makeIntervalKey();
  return {
    id: "exec_test_abc123",
    opportunity: {
      intervalKey,
      timestamp: 1700000000500,
      legs: [makeLeg("polymarket", "yes"), makeLeg("kalshi", "no")],
      cost: 0.96,
      edgeGross: 0.04,
      edgeNet: 0.03,
      reason: "box arb",
      qty: 5,
    },
    status: "success",
    legA: makeLegExecution("polymarket", "yes", true),
    legB: makeLegExecution("kalshi", "no", true),
    unwind: null,
    startTs: 1700000000900,
    endTs: 1700000001200,
    expectedEdgeNet: 0.03,
    realizedPnl: 0.025,
    polyQuoteSnapshot: makeQuote(),
    kalshiQuoteSnapshot: makeQuote({ yes_bid: 0.44, yes_ask: 0.47 }),
    ...overrides,
  };
}

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    opportunity: makeRecord().opportunity,
    mapping: {
      intervalKey: makeIntervalKey(),
      polymarket: { upTokenId: "up-tok", downTokenId: "down-tok", conditionId: "cond-1" },
      kalshi: { ticker: "KXBTC-123", yesMapping: "yes" as const },
    } as IntervalMapping,
    polyQuote: makeQuote(),
    kalshiQuote: makeQuote({ yes_bid: 0.44, yes_ask: 0.47 }),
    dryRun: false,
    ...overrides,
  };
}

// ── Tests ──

describe("mlLogger", () => {
  describe("COLUMNS", () => {
    test("has exactly 83 columns", () => {
      expect(COLUMNS.length).toBe(83);
    });

    test("all column names are unique", () => {
      const unique = new Set(COLUMNS);
      expect(unique.size).toBe(COLUMNS.length);
    });
  });

  describe("buildCsvRow", () => {
    test("returns string with exactly 82 commas (83 columns)", () => {
      const record = makeRecord();
      const context = makeContext();
      const row = buildCsvRow(record, context);
      const commaCount = (row.match(/,/g) || []).length;
      expect(commaCount).toBe(82);
    });

    test("handles null leg B result (leg A fail path)", () => {
      const record = makeRecord({
        status: "leg_a_failed",
        legB: makeLegExecution("kalshi", "no", false),
        realizedPnl: 0,
      });
      const context = makeContext();
      const row = buildCsvRow(record, context);
      const commaCount = (row.match(/,/g) || []).length;
      expect(commaCount).toBe(82);

      // Leg B columns should have empty fill fields
      const cols = row.split(",");
      // leg_b_filled index = 74 (0-based)
      const legBFilledIdx = COLUMNS.indexOf("leg_b_filled");
      expect(cols[legBFilledIdx]).toBe("0");
      // leg_b_fill_price should be empty
      const legBFillPriceIdx = COLUMNS.indexOf("leg_b_fill_price");
      expect(cols[legBFillPriceIdx]).toBe("");
    });

    test("metadata columns are correct", () => {
      const record = makeRecord();
      const context = makeContext({ dryRun: true });
      const row = buildCsvRow(record, context);
      const cols = row.split(",");

      expect(cols[COLUMNS.indexOf("decision_ts")]).toBe("1700000000500");
      expect(cols[COLUMNS.indexOf("execution_id")]).toBe("exec_test_abc123");
      expect(cols[COLUMNS.indexOf("status")]).toBe("success");
      expect(cols[COLUMNS.indexOf("dry_run")]).toBe("1");
      expect(cols[COLUMNS.indexOf("interval_start_ts")]).toBe("1700000000");
      expect(cols[COLUMNS.indexOf("interval_end_ts")]).toBe("1700000900");
    });

    test("dry_run = 0 when not dry run", () => {
      const record = makeRecord();
      const context = makeContext({ dryRun: false });
      const row = buildCsvRow(record, context);
      const cols = row.split(",");
      expect(cols[COLUMNS.indexOf("dry_run")]).toBe("0");
    });

    test("time_to_expiry_ms is computed correctly", () => {
      const record = makeRecord();
      const context = makeContext();
      const row = buildCsvRow(record, context);
      const cols = row.split(",");
      // endTs=1700000900 (epoch s) * 1000 - startTs=1700000000900 (epoch ms)
      const expected = (1700000900 * 1000) - 1700000000900;
      expect(cols[COLUMNS.indexOf("time_to_expiry_ms")]).toBe(String(expected));
    });

    test("quote snapshot columns match input", () => {
      const record = makeRecord();
      const context = makeContext();
      const row = buildCsvRow(record, context);
      const cols = row.split(",");

      expect(cols[COLUMNS.indexOf("poly_yes_bid")]).toBe("0.45");
      expect(cols[COLUMNS.indexOf("poly_yes_ask")]).toBe("0.48");
      expect(cols[COLUMNS.indexOf("kalshi_yes_bid")]).toBe("0.44");
      expect(cols[COLUMNS.indexOf("kalshi_yes_ask")]).toBe("0.47");
    });

    test("opportunity columns match input", () => {
      const record = makeRecord();
      const context = makeContext();
      const row = buildCsvRow(record, context);
      const cols = row.split(",");

      expect(cols[COLUMNS.indexOf("opp_cost")]).toBe("0.96");
      expect(cols[COLUMNS.indexOf("opp_edge_gross")]).toBe("0.04");
      expect(cols[COLUMNS.indexOf("opp_edge_net")]).toBe("0.03");
      expect(cols[COLUMNS.indexOf("opp_qty")]).toBe("5");
      expect(cols[COLUMNS.indexOf("opp_leg0_venue")]).toBe("polymarket");
      expect(cols[COLUMNS.indexOf("opp_leg1_venue")]).toBe("kalshi");
    });

    test("leg A execution columns when filled", () => {
      const record = makeRecord();
      const context = makeContext();
      const row = buildCsvRow(record, context);
      const cols = row.split(",");

      expect(cols[COLUMNS.indexOf("leg_a_venue")]).toBe("polymarket");
      expect(cols[COLUMNS.indexOf("leg_a_filled")]).toBe("1");
      expect(cols[COLUMNS.indexOf("leg_a_fill_price")]).toBe("0.47");
      expect(cols[COLUMNS.indexOf("leg_a_fill_qty")]).toBe("5");
      expect(cols[COLUMNS.indexOf("leg_a_market_id")]).toBe("polymarket-mkt-123");
    });

    test("leg A latency computed from submitTs and filledAt", () => {
      const record = makeRecord();
      const context = makeContext();
      const row = buildCsvRow(record, context);
      const cols = row.split(",");
      // filledAt=1700000001100 - submitTs=1700000001000 = 100
      expect(cols[COLUMNS.indexOf("leg_a_latency_ms")]).toBe("100");
    });

    test("outcome columns correct for both-filled", () => {
      const record = makeRecord();
      const context = makeContext();
      const row = buildCsvRow(record, context);
      const cols = row.split(",");

      expect(cols[COLUMNS.indexOf("both_filled")]).toBe("1");
      expect(cols[COLUMNS.indexOf("had_unwind")]).toBe("0");
      expect(cols[COLUMNS.indexOf("unwind_realized_loss")]).toBe("");
      expect(cols[COLUMNS.indexOf("unwind_reason")]).toBe("");
      expect(cols[COLUMNS.indexOf("realized_pnl")]).toBe("0.025");
      expect(cols[COLUMNS.indexOf("expected_edge_net")]).toBe("0.03");
    });

    test("total_execution_ms and inter_leg_ms computed correctly", () => {
      const record = makeRecord();
      const context = makeContext();
      const row = buildCsvRow(record, context);
      const cols = row.split(",");

      // endTs=1700000001200 - startTs=1700000000900 = 300
      expect(cols[COLUMNS.indexOf("total_execution_ms")]).toBe("300");
      // legB.submitTs=1700000001000 - legA.fillTs=1700000001100 = -100
      expect(cols[COLUMNS.indexOf("inter_leg_ms")]).toBe("-100");
    });

    test("handles unwind record", () => {
      const record = makeRecord({
        status: "unwound",
        unwind: {
          legToUnwind: makeLegExecution("polymarket", "yes", true),
          unwindParams: makeOrderParams("polymarket", "yes"),
          result: {
            success: true,
            orderId: "unwind-order",
            fillQty: 5,
            fillPrice: 0.44,
            venue: "polymarket",
            status: "filled",
            submittedAt: 1700000002000,
            filledAt: 1700000002100,
            error: null,
          },
          startTs: 1700000002000,
          endTs: 1700000002100,
          realizedLoss: 0.015,
          reason: "Kalshi FOK failed: timeout",
        },
        realizedPnl: -0.015,
      });
      const context = makeContext();
      const row = buildCsvRow(record, context);
      const cols = row.split(",");

      expect(cols[COLUMNS.indexOf("had_unwind")]).toBe("1");
      expect(cols[COLUMNS.indexOf("unwind_realized_loss")]).toBe("0.015");
      expect(cols[COLUMNS.indexOf("unwind_reason")]).toBe("Kalshi FOK failed: timeout");
      expect(cols[COLUMNS.indexOf("realized_pnl")]).toBe("-0.015");
    });
  });

  describe("derived features", () => {
    test("spread computed correctly", () => {
      expect(spread(0.48, 0.45)).toBeCloseTo(0.03);
      expect(spread(1.0, 0.0)).toBeCloseTo(1.0);
    });

    test("imbalance computed correctly", () => {
      // bidSize=100, askSize=50 -> 100/150 = 0.6667
      expect(imbalance(100, 50)).toBeCloseTo(0.6667, 3);
      // bidSize=50, askSize=50 -> 50/100 = 0.5
      expect(imbalance(50, 50)).toBeCloseTo(0.5);
    });

    test("imbalance returns 0 when both sizes are 0 (div-by-zero)", () => {
      expect(imbalance(0, 0)).toBe(0);
    });

    test("cross-venue spreads in CSV row", () => {
      const polyQuote = makeQuote({ yes_ask: 0.48, no_ask: 0.53 });
      const kalshiQuote = makeQuote({ yes_ask: 0.47, no_ask: 0.54 });
      const record = makeRecord({
        polyQuoteSnapshot: polyQuote,
        kalshiQuoteSnapshot: kalshiQuote,
      });
      const context = makeContext({ polyQuote, kalshiQuote });
      const row = buildCsvRow(record, context);
      const cols = row.split(",");

      // abs(0.48 - 0.47) = 0.01
      expect(parseFloat(cols[COLUMNS.indexOf("cross_venue_yes_spread")])).toBeCloseTo(0.01);
      // abs(0.53 - 0.54) = 0.01
      expect(parseFloat(cols[COLUMNS.indexOf("cross_venue_no_spread")])).toBeCloseTo(0.01);
    });

    test("quote age computed as ts_local - ts_exchange", () => {
      const record = makeRecord();
      const context = makeContext();
      const row = buildCsvRow(record, context);
      const cols = row.split(",");

      // poly: ts_local=1700000000050 - ts_exchange=1700000000000 = 50
      expect(cols[COLUMNS.indexOf("poly_quote_age_ms")]).toBe("50");
    });
  });

  describe("sanitize", () => {
    test("replaces commas with semicolons", () => {
      expect(sanitize("one,two,three")).toBe("one;two;three");
    });

    test("strips newlines", () => {
      expect(sanitize("line1\nline2\rline3")).toBe("line1 line2 line3");
    });

    test("handles null/undefined", () => {
      expect(sanitize(null)).toBe("");
      expect(sanitize(undefined)).toBe("");
    });

    test("unwind reason with commas is sanitized in CSV row", () => {
      const record = makeRecord({
        status: "unwound",
        unwind: {
          legToUnwind: makeLegExecution("polymarket", "yes", true),
          unwindParams: makeOrderParams("polymarket", "yes"),
          result: null,
          startTs: 1700000002000,
          endTs: 1700000002100,
          realizedLoss: 0.02,
          reason: "Failed: timeout, retry exhausted, giving up",
        },
        realizedPnl: -0.02,
      });
      const context = makeContext();
      const row = buildCsvRow(record, context);
      const cols = row.split(",");

      // The reason had 2 commas which become semicolons, so total column count stays 83
      const commaCount = (row.match(/,/g) || []).length;
      expect(commaCount).toBe(82);

      // The unwind reason should have semicolons instead of commas
      expect(cols[COLUMNS.indexOf("unwind_reason")]).toBe("Failed: timeout; retry exhausted; giving up");
    });
  });

  describe("initMlLogger", () => {
    const testDir = join(process.cwd(), "logs_v2");
    const testPath = join(testDir, "arb_executions.csv");

    afterAll(async () => {
      // Clean up test artifacts
      try {
        await rm(testPath, { force: true });
      } catch {}
    });

    test("creates file with correct header", async () => {
      await initMlLogger();

      const file = Bun.file(testPath);
      const exists = await file.exists();
      expect(exists).toBe(true);

      const content = await file.text();
      const headerLine = content.split("\n")[0];
      const headerCols = headerLine.split(",");
      expect(headerCols.length).toBe(83);
      expect(headerCols).toEqual(COLUMNS);
    });
  });
});
