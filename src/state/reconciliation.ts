/**
 * Position reconciliation module.
 *
 * Detects unhedged exposure and enforces risk limits.
 */

import type { Venue } from "../strategy/types";
import { getPositions, getOpenOrders, type PositionSnapshot, type OpenOrder } from "./positionTracker";
import { RISK_PARAMS } from "../config/riskParams";

/**
 * Details of unhedged exposure.
 */
export interface UnhedgedDetails {
  /** Venue with unhedged position */
  venue: Venue;
  /** Side of unhedged position */
  side: "yes" | "no";
  /** Net unhedged quantity */
  qty: number;
  /** Time since position was opened (ms) */
  durationMs: number;
  /** Reason for unhedged state */
  reason: string;
}

/**
 * Result of unhedged exposure check.
 */
export interface UnhedgedCheckResult {
  /** Whether there is unhedged exposure */
  unhedged: boolean;
  /** Details if unhedged */
  details: UnhedgedDetails | null;
}

/**
 * Timestamp when unhedged position was first detected.
 */
let unhedgedSince: number | null = null;

/**
 * Check for unhedged exposure.
 *
 * A position is hedged if:
 * - For each YES bought on one venue, there's a corresponding NO bought on another
 * - Net exposure across both venues is zero
 *
 * For v0.1 "buy-both" strategy: we're hedged if:
 * - Total YES across venues = Total NO across venues
 */
export function checkUnhedgedExposure(): UnhedgedCheckResult {
  const positions = getPositions();

  // Calculate total positions across venues
  const totalYes = positions.polymarket.yes + positions.kalshi.yes;
  const totalNo = positions.polymarket.no + positions.kalshi.no;

  // For buy-both arbitrage: we expect equal YES and NO
  const netExposure = totalYes - totalNo;

  if (netExposure === 0) {
    // Reset unhedged timer
    unhedgedSince = null;
    return { unhedged: false, details: null };
  }

  // Track when unhedged started
  const now = Date.now();
  if (unhedgedSince === null) {
    unhedgedSince = now;
  }

  const durationMs = now - unhedgedSince;

  // Determine which side is unhedged
  if (netExposure > 0) {
    // More YES than NO - we're long YES
    // Find which venue has excess YES
    const venue: Venue =
      positions.polymarket.yes > positions.kalshi.yes ? "polymarket" : "kalshi";

    return {
      unhedged: true,
      details: {
        venue,
        side: "yes",
        qty: netExposure,
        durationMs,
        reason: `Net long ${netExposure} YES contracts`,
      },
    };
  } else {
    // More NO than YES - we're long NO
    const venue: Venue =
      positions.polymarket.no > positions.kalshi.no ? "polymarket" : "kalshi";

    return {
      unhedged: true,
      details: {
        venue,
        side: "no",
        qty: -netExposure,
        durationMs,
        reason: `Net long ${-netExposure} NO contracts`,
      },
    };
  }
}

/**
 * Check if unhedged time has exceeded the maximum allowed.
 */
export function isUnhedgedTimeExceeded(
  maxMs: number = RISK_PARAMS.maxUnhedgedTimeMs
): boolean {
  const result = checkUnhedgedExposure();
  if (!result.unhedged || !result.details) {
    return false;
  }

  return result.details.durationMs > maxMs;
}

/**
 * Get the time since the position became unhedged.
 */
export function getUnhedgedDuration(): number | null {
  if (unhedgedSince === null) {
    return null;
  }
  return Date.now() - unhedgedSince;
}

/**
 * Reset unhedged tracking (e.g., after manual intervention).
 */
export function resetUnhedgedTracking(): void {
  unhedgedSince = null;
}

/**
 * Check if open order count exceeds limit.
 */
export function checkMaxOpenOrders(
  venue: Venue,
  max: number = RISK_PARAMS.maxOpenOrdersPerVenue
): { exceeded: boolean; current: number; max: number } {
  const orders = getOpenOrders().filter((o) => o.venue === venue);
  return {
    exceeded: orders.length >= max,
    current: orders.length,
    max,
  };
}

/**
 * Get a reconciliation status summary.
 */
export function getReconciliationStatus(): {
  positions: PositionSnapshot;
  unhedged: UnhedgedCheckResult;
  openOrders: { polymarket: number; kalshi: number };
  alerts: string[];
} {
  const positions = getPositions();
  const unhedged = checkUnhedgedExposure();
  const orders = getOpenOrders();

  const polyOrders = orders.filter((o) => o.venue === "polymarket").length;
  const kalshiOrders = orders.filter((o) => o.venue === "kalshi").length;

  const alerts: string[] = [];

  // Check for unhedged exposure
  if (unhedged.unhedged && unhedged.details) {
    alerts.push(
      `UNHEDGED: ${unhedged.details.reason} for ${unhedged.details.durationMs}ms`
    );

    if (unhedged.details.durationMs > RISK_PARAMS.maxUnhedgedTimeMs) {
      alerts.push(`CRITICAL: Unhedged time exceeds ${RISK_PARAMS.maxUnhedgedTimeMs}ms limit!`);
    }
  }

  // Check open order limits
  if (polyOrders >= RISK_PARAMS.maxOpenOrdersPerVenue) {
    alerts.push(`Polymarket at max open orders (${polyOrders})`);
  }
  if (kalshiOrders >= RISK_PARAMS.maxOpenOrdersPerVenue) {
    alerts.push(`Kalshi at max open orders (${kalshiOrders})`);
  }

  return {
    positions,
    unhedged,
    openOrders: { polymarket: polyOrders, kalshi: kalshiOrders },
    alerts,
  };
}
