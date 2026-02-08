/**
 * State management exports.
 *
 * Provides position tracking, reconciliation, and related functionality.
 */

// Position tracking
export {
  recordFill,
  recordUnwind,
  getPositions,
  getNetPosition,
  hasAnyPosition,
  clearPositionsForInterval,
  setVenuePositions,
  recordOpenOrder,
  removeOpenOrder,
  getOpenOrderCount,
  getOpenOrders,
  getOpenOrdersForVenue,
  clearOpenOrders,
  setCurrentInterval,
  getCurrentInterval,
  getFillHistory,
  getMarketIdForPosition,
  getEntryVwap,
  resetPositionTracker,
  type PositionSnapshot,
  type VenuePosition,
  type OpenOrder,
  type FillRecord,
} from "./positionTracker";

// Position reconciler (background venue API reconciliation)
export {
  startPositionReconciler,
  stopPositionReconciler,
} from "./positionReconciler";
