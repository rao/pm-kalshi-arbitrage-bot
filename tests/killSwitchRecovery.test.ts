/**
 * Tests for kill switch reason tracking and auto-recovery.
 */

import { test, expect, beforeEach } from "bun:test";
import {
  triggerKillSwitch,
  isKillSwitchTriggered,
  getKillSwitchReason,
  resetKillSwitch,
  attemptKillSwitchRecovery,
  resetAllState,
  recordPnl,
  startLiquidation,
  stopLiquidation,
} from "../src/execution/executionState";

beforeEach(() => {
  resetAllState();
});

test("attemptKillSwitchRecovery recovers from low_balance_kalshi", () => {
  triggerKillSwitch("low_balance_kalshi");
  expect(isKillSwitchTriggered()).toBe(true);
  expect(getKillSwitchReason()).toBe("low_balance_kalshi");

  const recovered = attemptKillSwitchRecovery();
  expect(recovered).toBe(true);
  expect(isKillSwitchTriggered()).toBe(false);
  expect(getKillSwitchReason()).toBeNull();
});

test("attemptKillSwitchRecovery blocks recovery from daily_loss", () => {
  triggerKillSwitch("daily_loss");
  expect(isKillSwitchTriggered()).toBe(true);

  const recovered = attemptKillSwitchRecovery();
  expect(recovered).toBe(false);
  expect(isKillSwitchTriggered()).toBe(true);
  expect(getKillSwitchReason()).toBe("daily_loss");
});

test("attemptKillSwitchRecovery blocks when daily loss >= max", () => {
  // Record enough loss to hit the max
  recordPnl(-100); // Well above any maxDailyLoss threshold

  triggerKillSwitch("low_balance_polymarket");
  expect(isKillSwitchTriggered()).toBe(true);

  const recovered = attemptKillSwitchRecovery();
  expect(recovered).toBe(false);
  expect(isKillSwitchTriggered()).toBe(true);
});

test("attemptKillSwitchRecovery blocks during active liquidation", () => {
  triggerKillSwitch("execution_failure: insufficient_balance");
  startLiquidation();

  const recovered = attemptKillSwitchRecovery();
  expect(recovered).toBe(false);
  expect(isKillSwitchTriggered()).toBe(true);

  // Recovery works after liquidation completes
  stopLiquidation();
  const recoveredAfter = attemptKillSwitchRecovery();
  expect(recoveredAfter).toBe(true);
  expect(isKillSwitchTriggered()).toBe(false);
});

test("attemptKillSwitchRecovery returns false when kill switch not active", () => {
  expect(isKillSwitchTriggered()).toBe(false);

  const recovered = attemptKillSwitchRecovery();
  expect(recovered).toBe(false);
});

test("getKillSwitchReason returns correct reason and null after reset", () => {
  expect(getKillSwitchReason()).toBeNull();

  triggerKillSwitch("low_balance_kalshi");
  expect(getKillSwitchReason()).toBe("low_balance_kalshi");

  resetKillSwitch();
  expect(getKillSwitchReason()).toBeNull();
  expect(isKillSwitchTriggered()).toBe(false);
});

test("triggerKillSwitch with no arg defaults to 'unknown'", () => {
  triggerKillSwitch();
  expect(getKillSwitchReason()).toBe("unknown");
  expect(isKillSwitchTriggered()).toBe(true);
});

test("attemptKillSwitchRecovery recovers from execution_failure reasons", () => {
  triggerKillSwitch("execution_failure: insufficient_balance");
  expect(isKillSwitchTriggered()).toBe(true);

  const recovered = attemptKillSwitchRecovery();
  expect(recovered).toBe(true);
  expect(isKillSwitchTriggered()).toBe(false);
});

test("resetAllState clears kill switch reason", () => {
  triggerKillSwitch("low_balance_polymarket");
  expect(getKillSwitchReason()).toBe("low_balance_polymarket");

  resetAllState();
  expect(getKillSwitchReason()).toBeNull();
  expect(isKillSwitchTriggered()).toBe(false);
});
