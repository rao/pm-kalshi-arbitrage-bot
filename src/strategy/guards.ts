/**
 * Guard conditions for trading.
 *
 * Pure functions that check whether trading conditions are met.
 * All guards return { pass: true } or { pass: false, reason: string }.
 */

import type { GuardResult, GuardContext } from "./types";

/**
 * Check if net edge meets minimum threshold.
 */
export function checkMinEdge(edgeNet: number, minEdge: number): GuardResult {
  if (edgeNet >= minEdge) {
    return { pass: true };
  }
  return {
    pass: false,
    reason: `Edge ${edgeNet.toFixed(4)} < min ${minEdge.toFixed(4)}`,
  };
}

/**
 * Check if sufficient size is available.
 */
export function checkSufficientSize(
  availableSize: number,
  requiredSize: number
): GuardResult {
  if (availableSize >= requiredSize) {
    return { pass: true };
  }
  return {
    pass: false,
    reason: `Size ${availableSize} < required ${requiredSize}`,
  };
}

/**
 * Check if we're not in cooldown after a failure.
 */
export function checkNotInCooldown(
  lastFailureTs: number | null,
  cooldownMs: number,
  now: number = Date.now()
): GuardResult {
  if (lastFailureTs === null) {
    return { pass: true };
  }

  const elapsed = now - lastFailureTs;
  if (elapsed >= cooldownMs) {
    return { pass: true };
  }

  const remaining = cooldownMs - elapsed;
  return {
    pass: false,
    reason: `In cooldown, ${remaining}ms remaining`,
  };
}

/**
 * Check if daily loss is within limits.
 */
export function checkDailyLoss(
  dailyLoss: number,
  maxDailyLoss: number
): GuardResult {
  if (dailyLoss < maxDailyLoss) {
    return { pass: true };
  }
  return {
    pass: false,
    reason: `Daily loss $${dailyLoss.toFixed(2)} >= max $${maxDailyLoss.toFixed(2)} - KILL SWITCH`,
  };
}

/**
 * Check if adding this trade stays within notional limits.
 */
export function checkNotional(
  currentNotional: number,
  maxNotional: number,
  estimatedCost: number
): GuardResult {
  const newTotal = currentNotional + estimatedCost;
  if (newTotal <= maxNotional) {
    return { pass: true };
  }
  return {
    pass: false,
    reason: `Notional ${currentNotional.toFixed(2)} + ${estimatedCost.toFixed(2)} = ${newTotal.toFixed(2)} > max ${maxNotional.toFixed(2)}`,
  };
}

/**
 * Run all guard checks.
 *
 * Returns the first failing guard result, or { pass: true } if all pass.
 */
export function runAllGuards(context: GuardContext): GuardResult {
  // Check daily loss first (kill switch takes priority)
  const dailyLossResult = checkDailyLoss(context.dailyLoss, context.maxDailyLoss);
  if (!dailyLossResult.pass) return dailyLossResult;

  // Check cooldown
  const cooldownResult = checkNotInCooldown(
    context.lastFailureTs,
    context.cooldownMs
  );
  if (!cooldownResult.pass) return cooldownResult;

  // Check minimum edge
  const edgeResult = checkMinEdge(context.edgeNet, context.minEdge);
  if (!edgeResult.pass) return edgeResult;

  // Check sizes
  const yesSizeResult = checkSufficientSize(
    context.yesSizeAvailable,
    context.minSizePerLeg
  );
  if (!yesSizeResult.pass) {
    return { pass: false, reason: `YES leg: ${yesSizeResult.reason}` };
  }

  const noSizeResult = checkSufficientSize(
    context.noSizeAvailable,
    context.minSizePerLeg
  );
  if (!noSizeResult.pass) {
    return { pass: false, reason: `NO leg: ${noSizeResult.reason}` };
  }

  // Check notional limits
  const notionalResult = checkNotional(
    context.currentNotional,
    context.maxNotional,
    context.estimatedCost
  );
  if (!notionalResult.pass) return notionalResult;

  return { pass: true };
}
