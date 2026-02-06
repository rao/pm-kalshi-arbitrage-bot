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
  resetPositionTracker,
  type PositionSnapshot,
  type VenuePosition,
  type OpenOrder,
  type FillRecord,
} from "./positionTracker";

// Reconciliation
export {
  checkUnhedgedExposure,
  isUnhedgedTimeExceeded,
  getUnhedgedDuration,
  resetUnhedgedTracking,
  checkMaxOpenOrders,
  getReconciliationStatus,
  type UnhedgedDetails,
  type UnhedgedCheckResult,
} from "./reconciliation";

// Position reconciler (background venue API reconciliation)
export {
  startPositionReconciler,
  stopPositionReconciler,
} from "./positionReconciler";
