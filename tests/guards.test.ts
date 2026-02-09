import { test, expect, describe } from "bun:test";
import {
  isValidVenuePrice,
  checkValidPrice,
  checkMinEdge,
  checkSufficientSize,
  checkNotInCooldown,
  checkDailyLoss,
  checkNotional,
  checkOpenOrderLimit,
  checkPositionBalance,
  checkTimeToRollover,
  runAllGuards,
} from "../src/strategy/guards";
import {
  calculateMinQuantityForPolymarket,
  POLYMARKET_MIN_ORDER_VALUE,
  POLYMARKET_MIN_SHARES,
  RISK_PARAMS,
} from "../src/config/riskParams";
import type { GuardContext } from "../src/strategy/types";

describe("price validation", () => {
  describe("isValidVenuePrice", () => {
    test("accepts valid prices for polymarket", () => {
      expect(isValidVenuePrice(0.01, "polymarket")).toBe(true);
      expect(isValidVenuePrice(0.50, "polymarket")).toBe(true);
      expect(isValidVenuePrice(0.99, "polymarket")).toBe(true);
    });

    test("accepts valid prices for kalshi", () => {
      expect(isValidVenuePrice(0.01, "kalshi")).toBe(true);
      expect(isValidVenuePrice(0.50, "kalshi")).toBe(true);
      expect(isValidVenuePrice(0.99, "kalshi")).toBe(true);
    });

    test("rejects prices below minimum", () => {
      expect(isValidVenuePrice(0.001, "polymarket")).toBe(false);
      expect(isValidVenuePrice(0.009, "polymarket")).toBe(false);
      expect(isValidVenuePrice(0, "polymarket")).toBe(false);
      expect(isValidVenuePrice(-0.01, "polymarket")).toBe(false);
      expect(isValidVenuePrice(0.001, "kalshi")).toBe(false);
    });

    test("rejects prices above maximum", () => {
      expect(isValidVenuePrice(1.0, "polymarket")).toBe(false);
      expect(isValidVenuePrice(0.991, "polymarket")).toBe(false);
      expect(isValidVenuePrice(1.5, "polymarket")).toBe(false);
      expect(isValidVenuePrice(1.0, "kalshi")).toBe(false);
    });
  });

  describe("checkValidPrice", () => {
    test("passes for valid prices", () => {
      expect(checkValidPrice(0.50, "polymarket")).toEqual({ pass: true });
      expect(checkValidPrice(0.01, "kalshi")).toEqual({ pass: true });
      expect(checkValidPrice(0.99, "polymarket")).toEqual({ pass: true });
    });

    test("fails for invalid prices with descriptive reason", () => {
      const result = checkValidPrice(0.001, "polymarket");
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("Invalid polymarket price");
      expect(result.reason).toContain("0.0010");
      expect(result.reason).toContain("0.01-0.99");
    });

    test("fails for prices above max", () => {
      const result = checkValidPrice(1.0, "kalshi");
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("Invalid kalshi price");
    });
  });
});

describe("edge guards", () => {
  describe("checkMinEdge", () => {
    test("passes when edge meets threshold", () => {
      expect(checkMinEdge(0.05, 0.04)).toEqual({ pass: true });
      expect(checkMinEdge(0.04, 0.04)).toEqual({ pass: true });
    });

    test("fails when edge below threshold", () => {
      const result = checkMinEdge(0.03, 0.04);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("Edge");
    });
  });
});

describe("size guards", () => {
  describe("checkSufficientSize", () => {
    test("passes when size is sufficient", () => {
      expect(checkSufficientSize(10, 5)).toEqual({ pass: true });
      expect(checkSufficientSize(5, 5)).toEqual({ pass: true });
    });

    test("fails when size is insufficient", () => {
      const result = checkSufficientSize(3, 5);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("Size");
    });
  });
});

describe("cooldown guards", () => {
  describe("checkNotInCooldown", () => {
    test("passes when no previous failure", () => {
      expect(checkNotInCooldown(null, 3000)).toEqual({ pass: true });
    });

    test("passes when cooldown has elapsed", () => {
      const now = Date.now();
      const lastFailure = now - 5000; // 5s ago
      expect(checkNotInCooldown(lastFailure, 3000, now)).toEqual({ pass: true });
    });

    test("fails when still in cooldown", () => {
      const now = Date.now();
      const lastFailure = now - 1000; // 1s ago
      const result = checkNotInCooldown(lastFailure, 3000, now);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("cooldown");
    });
  });
});

describe("loss guards", () => {
  describe("checkDailyLoss", () => {
    test("passes when under limit", () => {
      expect(checkDailyLoss(0.25, 0.50)).toEqual({ pass: true });
    });

    test("fails when at or over limit", () => {
      const result1 = checkDailyLoss(0.50, 0.50);
      expect(result1.pass).toBe(false);
      expect(result1.reason).toContain("KILL SWITCH");

      const result2 = checkDailyLoss(0.75, 0.50);
      expect(result2.pass).toBe(false);
    });
  });
});

describe("notional guards", () => {
  describe("checkNotional", () => {
    test("passes when under limit", () => {
      expect(checkNotional(5.0, 10.0, 2.0)).toEqual({ pass: true });
    });

    test("passes when exactly at limit", () => {
      expect(checkNotional(8.0, 10.0, 2.0)).toEqual({ pass: true });
    });

    test("fails when would exceed limit", () => {
      const result = checkNotional(9.0, 10.0, 2.0);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("Notional");
    });
  });
});

describe("open order guards", () => {
  describe("checkOpenOrderLimit", () => {
    test("passes when under limit", () => {
      expect(checkOpenOrderLimit("Polymarket", 1, 2)).toEqual({ pass: true });
    });

    test("fails when at limit", () => {
      const result = checkOpenOrderLimit("Kalshi", 2, 2);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("Kalshi");
      expect(result.reason).toContain("max open orders");
    });
  });
});

describe("position balance guards", () => {
  describe("checkPositionBalance", () => {
    test("passes when all positions are zero", () => {
      const positions = {
        polymarket: { yes: 0, no: 0 },
        kalshi: { yes: 0, no: 0 },
        timestamp: Date.now(),
      };
      expect(checkPositionBalance(positions)).toEqual({ pass: true });
    });

    test("passes when total yes equals total no (balanced box)", () => {
      const positions = {
        polymarket: { yes: 5, no: 0 },
        kalshi: { yes: 0, no: 5 },
        timestamp: Date.now(),
      };
      expect(checkPositionBalance(positions)).toEqual({ pass: true });
    });

    test("passes when balanced across both venues", () => {
      const positions = {
        polymarket: { yes: 3, no: 2 },
        kalshi: { yes: 2, no: 3 },
        timestamp: Date.now(),
      };
      expect(checkPositionBalance(positions)).toEqual({ pass: true });
    });

    test("passes when fractional fill difference is within tolerance", () => {
      const positions = {
        polymarket: { yes: 16.695651, no: 0 },
        kalshi: { yes: 0, no: 16 },
        timestamp: Date.now(),
      };
      expect(checkPositionBalance(positions)).toEqual({ pass: true });
    });

    test("passes when imbalance is exactly at tolerance (2 shares)", () => {
      const positions = {
        polymarket: { yes: 5, no: 0 },
        kalshi: { yes: 0, no: 3 },
        timestamp: Date.now(),
      };
      expect(checkPositionBalance(positions)).toEqual({ pass: true });
    });

    test("fails when yes > no beyond tolerance (unhedged long yes exposure)", () => {
      const positions = {
        polymarket: { yes: 5, no: 0 },
        kalshi: { yes: 0, no: 0 },
        timestamp: Date.now(),
      };
      const result = checkPositionBalance(positions);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("Position imbalance");
      expect(result.reason).toContain("totalYes=5");
      expect(result.reason).toContain("totalNo=0");
    });

    test("fails when no > yes beyond tolerance (unhedged long no exposure)", () => {
      const positions = {
        polymarket: { yes: 0, no: 0 },
        kalshi: { yes: 0, no: 5 },
        timestamp: Date.now(),
      };
      const result = checkPositionBalance(positions);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("Position imbalance");
      expect(result.reason).toContain("totalYes=0");
      expect(result.reason).toContain("totalNo=5");
    });

    test("fails with large partial unwind (imbalance > 2)", () => {
      const positions = {
        polymarket: { yes: 8, no: 0 },
        kalshi: { yes: 0, no: 3 },
        timestamp: Date.now(),
      };
      const result = checkPositionBalance(positions);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("totalYes=8");
      expect(result.reason).toContain("totalNo=3");
    });
  });
});

describe("quantity calculation", () => {
  describe("calculateMinQuantityForPolymarket", () => {
    test("returns 5 shares minimum for high prices", () => {
      // At $0.50, $1 min requires ceil(1/0.50) = 2 shares
      // But 5 share min is higher, so returns 5
      expect(calculateMinQuantityForPolymarket(0.50)).toBe(5);

      // At $0.30, $1 min requires ceil(1/0.30) = 4 shares
      // But 5 share min is higher, so returns 5
      expect(calculateMinQuantityForPolymarket(0.30)).toBe(5);

      // At $0.99, $1 min requires ceil(1/0.99) = 2 shares
      // But 5 share min is higher, so returns 5
      expect(calculateMinQuantityForPolymarket(0.99)).toBe(5);
    });

    test("returns higher qty for low prices to meet $1 minimum", () => {
      // At $0.10, $1 min requires ceil(1/0.10) = 10 shares
      // 10 > 5, so returns 10
      expect(calculateMinQuantityForPolymarket(0.10)).toBe(10);

      // At $0.05, $1 min requires ceil(1/0.05) = 20 shares
      // 20 > 5, so returns 20
      expect(calculateMinQuantityForPolymarket(0.05)).toBe(20);

      // At $0.15, $1 min requires ceil(1/0.15) = 7 shares
      // 7 > 5, so returns 7
      expect(calculateMinQuantityForPolymarket(0.15)).toBe(7);
    });

    test("handles edge case at exactly $0.20 (boundary)", () => {
      // At $0.20, $1 min requires ceil(1/0.20) = 5 shares
      // This equals the 5 share minimum, so returns 5
      expect(calculateMinQuantityForPolymarket(0.20)).toBe(5);
    });

    test("handles minimum valid price $0.01", () => {
      // At $0.01, $1 min requires ceil(1/0.01) = 100 shares
      expect(calculateMinQuantityForPolymarket(0.01)).toBe(100);
    });

    test("calculated qty always meets $1 order value", () => {
      const testPrices = [0.01, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50, 0.75, 0.99];

      for (const price of testPrices) {
        const qty = calculateMinQuantityForPolymarket(price);
        const orderValue = qty * price;

        // Order value must be >= $1
        expect(orderValue).toBeGreaterThanOrEqual(POLYMARKET_MIN_ORDER_VALUE);

        // Qty must be >= 5 shares
        expect(qty).toBeGreaterThanOrEqual(POLYMARKET_MIN_SHARES);
      }
    });
  });
});

describe("time to rollover guards", () => {
  describe("checkTimeToRollover", () => {
    test("passes when msUntilRollover > cutoff", () => {
      expect(checkTimeToRollover(80000, 75000)).toEqual({ pass: true });
    });

    test("blocks when msUntilRollover < cutoff", () => {
      const result = checkTimeToRollover(60000, 75000);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("Too close to rollover");
      expect(result.reason).toContain("60s remaining");
      expect(result.reason).toContain("cutoff=75s");
    });

    test("blocks at exactly cutoff boundary", () => {
      const result = checkTimeToRollover(75000, 75000);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("Too close to rollover");
    });

    test("passes well above cutoff", () => {
      expect(checkTimeToRollover(900000, 75000)).toEqual({ pass: true });
    });
  });

  describe("runAllGuards with msUntilRollover", () => {
    const baseContext: GuardContext = {
      edgeNet: 0.05,
      minEdge: 0.04,
      yesSizeAvailable: 10,
      noSizeAvailable: 10,
      minSizePerLeg: 5,
      lastFailureTs: null,
      cooldownMs: 3000,
      dailyLoss: 0,
      maxDailyLoss: 20,
      currentNotional: 0,
      maxNotional: 592,
      estimatedCost: 1,
    };

    test("blocks when msUntilRollover is below cutoff", () => {
      const result = runAllGuards({
        ...baseContext,
        msUntilRollover: 60000,
      });
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("Too close to rollover");
    });

    test("passes when msUntilRollover is above cutoff", () => {
      const result = runAllGuards({
        ...baseContext,
        msUntilRollover: 200000,
      });
      expect(result.pass).toBe(true);
    });

    test("passes when msUntilRollover is not provided", () => {
      const result = runAllGuards(baseContext);
      expect(result.pass).toBe(true);
    });
  });
});
