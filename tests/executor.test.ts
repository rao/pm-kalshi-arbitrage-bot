import { describe, test, expect } from "bun:test";
import { isPermanentVenueError } from "../src/execution/executor";

describe("isPermanentVenueError", () => {
  test("detects insufficient_balance (underscore)", () => {
    expect(isPermanentVenueError("insufficient_balance")).toBe(true);
  });

  test("detects insufficient balance (with space)", () => {
    expect(isPermanentVenueError("insufficient balance")).toBe(true);
  });

  test("detects market_closed", () => {
    expect(isPermanentVenueError("market_closed")).toBe(true);
  });

  test("detects trading_closed", () => {
    expect(isPermanentVenueError("trading_closed")).toBe(true);
  });

  test("detects event_expired", () => {
    expect(isPermanentVenueError("event_expired")).toBe(true);
  });

  test("handles prefixed error strings from executor", () => {
    expect(isPermanentVenueError("Kalshi FOK failed: insufficient balance (insufficient_balance)")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isPermanentVenueError("INSUFFICIENT_BALANCE")).toBe(true);
    expect(isPermanentVenueError("Market_Closed")).toBe(true);
  });

  test("does not flag transient errors", () => {
    expect(isPermanentVenueError("timeout")).toBe(false);
    expect(isPermanentVenueError("network error")).toBe(false);
    expect(isPermanentVenueError("Order timeout after 3000ms")).toBe(false);
    expect(isPermanentVenueError("no fills")).toBe(false);
  });

  test("does not flag empty string", () => {
    expect(isPermanentVenueError("")).toBe(false);
  });
});
