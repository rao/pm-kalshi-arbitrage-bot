/**
 * Execution module exports.
 *
 * Provides all components for two-phase commit arbitrage execution.
 */

// Types
export type {
  LegStatus,
  ExecutionStatus,
  OrderParams,
  OrderResult,
  OrderStatusResult,
  LegExecution,
  ExecutionRecord,
  UnwindRecord,
  ExecutionState,
  ExecutionResult,
  ExecutionContext,
  VenueClients,
  PendingSettlement,
} from "./types";

export { generateExecutionId, generateClientOrderId } from "./types";

// Execution state management
export {
  acquireBusyLock,
  releaseBusyLock,
  isExecutionBusy,
  setCurrentExecution,
  getCurrentExecution,
  isInCooldown,
  getCooldownRemaining,
  enterCooldown,
  clearCooldown,
  recordPnl,
  getDailyPnl,
  getDailyLoss,
  triggerKillSwitch,
  isKillSwitchTriggered,
  resetKillSwitch,
  resetDailyTracking,
  getTotalNotional,
  addNotional,
  removeNotional,
  resetNotional,
  getLastFailureTs,
  getExecutionState,
  resetAllState,
  recordUnwindLoss,
  getDailyUnwindLoss,
  // Pending settlement management
  addPendingSettlement,
  getUnrealizedPnl,
  getPendingSettlements,
  getPendingSettlementsForInterval,
  settlePending,
  getSettlementStats,
} from "./executionState";

// Order planning
export {
  planLegOrder,
  buildOrderParams,
  buildUnwindOrderParams,
  buildLadderUnwindParams,
  getCurrentBid,
  getCurrentAsk,
  validateOpportunityMapping,
  type LegPlan,
} from "./orderPlanner";

// Unwind logic
export {
  unwindLeg,
  simulateUnwind,
  calculateUnwindLoss,
  estimateMaxUnwindLoss,
  shouldAttemptUnwind,
} from "./unwind";

// Main executor
export { executeOpportunity } from "./executor";

// Venue client factory for live trading
export {
  initializeVenueClients,
  createLiveVenueClients,
  getKalshiAuth,
  getPolymarketClient,
  cancelKalshiOrdersForMarket,
  type InitializedClients,
  type GetQuoteFn,
} from "./venueClientFactory";
