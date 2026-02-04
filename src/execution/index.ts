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
  LegExecution,
  ExecutionRecord,
  UnwindRecord,
  ExecutionState,
  ExecutionResult,
  ExecutionContext,
  VenueClients,
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
} from "./executionState";

// Order planning
export {
  planLegOrder,
  buildOrderParams,
  buildUnwindOrderParams,
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
