/**
 * Position tracking module.
 *
 * Tracks:
 * - Net positions per venue and side (YES/NO)
 * - Open orders with timestamps
 * - Fill history for reconciliation
 */

import type { Venue, Side } from "../strategy/types";
import type { IntervalKey } from "../time/interval";
import { intervalKeyToString } from "../time/interval";

/**
 * Position snapshot per venue.
 */
export interface VenuePosition {
  /** Net YES contracts held */
  yes: number;
  /** Net NO contracts held */
  no: number;
}

/**
 * Full position snapshot across all venues.
 */
export interface PositionSnapshot {
  polymarket: VenuePosition;
  kalshi: VenuePosition;
  timestamp: number;
}

/**
 * Open order record for tracking.
 */
export interface OpenOrder {
  orderId: string;
  clientOrderId: string;
  venue: Venue;
  side: Side;
  action: "buy" | "sell";
  price: number;
  qty: number;
  submitTs: number;
  intervalKey: string;
}

/**
 * Fill record for history tracking.
 */
export interface FillRecord {
  orderId: string;
  venue: Venue;
  side: Side;
  action: "buy" | "sell";
  qty: number;
  price: number;
  fillTs: number;
  intervalKey: string;
}

/**
 * Position tracker state.
 */
interface PositionState {
  positions: {
    polymarket: VenuePosition;
    kalshi: VenuePosition;
  };
  openOrders: Map<string, OpenOrder>;
  fillHistory: FillRecord[];
  currentIntervalKey: string | null;
}

const state: PositionState = {
  positions: {
    polymarket: { yes: 0, no: 0 },
    kalshi: { yes: 0, no: 0 },
  },
  openOrders: new Map(),
  fillHistory: [],
  currentIntervalKey: null,
};

/** Maximum fills to keep in history */
const MAX_FILL_HISTORY = 1000;

// === Position tracking ===

/**
 * Record a fill (buy or sell).
 */
export function recordFill(
  venue: Venue,
  side: Side,
  action: "buy" | "sell",
  qty: number,
  price: number,
  intervalKey: IntervalKey,
  orderId?: string
): void {
  const venuePos = state.positions[venue];

  // Update position based on action
  const delta = action === "buy" ? qty : -qty;
  if (side === "yes") {
    venuePos.yes += delta;
  } else {
    venuePos.no += delta;
  }

  // Record fill in history
  const fill: FillRecord = {
    orderId: orderId ?? `fill_${Date.now()}`,
    venue,
    side,
    action,
    qty,
    price,
    fillTs: Date.now(),
    intervalKey: intervalKeyToString(intervalKey),
  };

  state.fillHistory.push(fill);

  // Trim history if needed
  if (state.fillHistory.length > MAX_FILL_HISTORY) {
    state.fillHistory = state.fillHistory.slice(-MAX_FILL_HISTORY);
  }
}

/**
 * Record an unwind (selling a previously bought position).
 */
export function recordUnwind(
  venue: Venue,
  side: Side,
  qty: number,
  price: number,
  intervalKey: IntervalKey
): void {
  // Unwind is selling a bought position
  recordFill(venue, side, "sell", qty, price, intervalKey, `unwind_${Date.now()}`);
}

/**
 * Get current position snapshot.
 */
export function getPositions(): PositionSnapshot {
  return {
    polymarket: { ...state.positions.polymarket },
    kalshi: { ...state.positions.kalshi },
    timestamp: Date.now(),
  };
}

/**
 * Get net position for a specific venue and side.
 */
export function getNetPosition(venue: Venue, side: Side): number {
  return state.positions[venue][side];
}

/**
 * Check if there's any net position on either venue.
 */
export function hasAnyPosition(): boolean {
  const poly = state.positions.polymarket;
  const kalshi = state.positions.kalshi;
  return poly.yes !== 0 || poly.no !== 0 || kalshi.yes !== 0 || kalshi.no !== 0;
}

/**
 * Clear positions for a specific interval (on settlement).
 */
export function clearPositionsForInterval(intervalKey: IntervalKey): void {
  const key = intervalKeyToString(intervalKey);

  // Only clear if this is the current interval
  if (state.currentIntervalKey === key || state.currentIntervalKey === null) {
    state.positions.polymarket = { yes: 0, no: 0 };
    state.positions.kalshi = { yes: 0, no: 0 };
    state.currentIntervalKey = null;
  }
}

// === Open order tracking ===

/**
 * Record an open order.
 */
export function recordOpenOrder(order: OpenOrder): void {
  state.openOrders.set(order.clientOrderId, order);
}

/**
 * Remove an order from open orders (filled, canceled, or expired).
 */
export function removeOpenOrder(clientOrderId: string): OpenOrder | undefined {
  const order = state.openOrders.get(clientOrderId);
  state.openOrders.delete(clientOrderId);
  return order;
}

/**
 * Get open order count for a venue.
 */
export function getOpenOrderCount(venue: Venue): number {
  let count = 0;
  for (const order of state.openOrders.values()) {
    if (order.venue === venue) {
      count++;
    }
  }
  return count;
}

/**
 * Get all open orders.
 */
export function getOpenOrders(): OpenOrder[] {
  return Array.from(state.openOrders.values());
}

/**
 * Get open orders for a specific venue.
 */
export function getOpenOrdersForVenue(venue: Venue): OpenOrder[] {
  return getOpenOrders().filter((o) => o.venue === venue);
}

/**
 * Clear all open orders (e.g., on rollover after cancel-all).
 */
export function clearOpenOrders(): void {
  state.openOrders.clear();
}

// === Interval tracking ===

/**
 * Set the current interval key.
 */
export function setCurrentInterval(intervalKey: IntervalKey): void {
  state.currentIntervalKey = intervalKeyToString(intervalKey);
}

/**
 * Get the current interval key.
 */
export function getCurrentInterval(): string | null {
  return state.currentIntervalKey;
}

// === Fill history ===

/**
 * Get fill history, optionally filtered by interval.
 */
export function getFillHistory(intervalKey?: IntervalKey): FillRecord[] {
  if (!intervalKey) {
    return [...state.fillHistory];
  }

  const key = intervalKeyToString(intervalKey);
  return state.fillHistory.filter((f) => f.intervalKey === key);
}

// === Reset (for testing) ===

/**
 * Reset all position tracking state.
 */
export function resetPositionTracker(): void {
  state.positions.polymarket = { yes: 0, no: 0 };
  state.positions.kalshi = { yes: 0, no: 0 };
  state.openOrders.clear();
  state.fillHistory = [];
  state.currentIntervalKey = null;
}
