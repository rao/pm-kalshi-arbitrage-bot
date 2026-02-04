/**
 * Main execution engine for two-phase commit arbitrage.
 *
 * Implements the following flow:
 * 1. Validate guards (edge, size, notional, cooldown, kill switch, busy)
 * 2. Plan leg order (A vs B)
 * 3. Execute Leg A as FOK
 *    - If not filled: exit (no harm)
 *    - If filled: proceed to Leg B
 * 4. Execute Leg B as FOK (within maxLegDelayMs)
 *    - If filled: SUCCESS
 *    - If not filled: ABORT -> unwind Leg A
 * 5. Record PnL and update state
 */

import type {
  ExecutionContext,
  ExecutionResult,
  ExecutionRecord,
  LegExecution,
  OrderResult,
  VenueClients,
} from "./types";
import { generateExecutionId } from "./types";
import { RISK_PARAMS } from "../config/riskParams";
import {
  planLegOrder,
  buildOrderParams,
  validateOpportunityMapping,
} from "./orderPlanner";
import { unwindLeg, simulateUnwind } from "./unwind";
import {
  acquireBusyLock,
  releaseBusyLock,
  setCurrentExecution,
  isKillSwitchTriggered,
  isInCooldown,
  getDailyLoss,
  getTotalNotional,
  recordPnl,
  enterCooldown,
  addNotional,
  removeNotional,
  getLastFailureTs,
} from "./executionState";
import { runAllGuards } from "../strategy/guards";
import type { GuardContext } from "../strategy/types";
import {
  logExecutionStart,
  logLegSubmit,
  logLegResult,
  logUnwindStart,
  logUnwindResult,
  logExecutionComplete,
  logDryRunExecution,
  logGuardFailed,
  logBusyLockFailed,
  logExecutionError,
} from "../logging/executionLogger";

/**
 * Create initial leg execution structure.
 */
function createLegExecution(
  leg: ReturnType<typeof planLegOrder>["legA"],
  params: ReturnType<typeof buildOrderParams>
): LegExecution {
  return {
    leg,
    params,
    result: null,
    submitTs: null,
    fillTs: null,
  };
}

/**
 * Create initial execution record.
 */
function createExecutionRecord(
  context: ExecutionContext,
  legA: LegExecution,
  legB: LegExecution
): ExecutionRecord {
  return {
    id: generateExecutionId(),
    opportunity: context.opportunity,
    status: "pending",
    legA,
    legB,
    unwind: null,
    startTs: Date.now(),
    endTs: null,
    expectedEdgeNet: context.opportunity.edgeNet,
    realizedPnl: null,
    polyQuoteSnapshot: context.polyQuote,
    kalshiQuoteSnapshot: context.kalshiQuote,
  };
}

/**
 * Simulate a FOK order fill for dry run mode.
 */
function simulateFokFill(
  params: ReturnType<typeof buildOrderParams>
): OrderResult {
  const now = Date.now();
  return {
    success: true,
    orderId: `sim_${params.clientOrderId}`,
    fillQty: params.qty,
    fillPrice: params.price,
    venue: params.venue,
    status: "filled",
    submittedAt: now,
    filledAt: now + 50, // Simulate 50ms latency
    error: null,
  };
}

/**
 * Execute the arbitrage opportunity.
 *
 * This is the main entry point for execution.
 *
 * @param context - Execution context with opportunity and quotes
 * @param venueClients - Venue client interfaces (null for dry run)
 * @returns ExecutionResult with outcome
 */
export async function executeOpportunity(
  context: ExecutionContext,
  venueClients: VenueClients | null
): Promise<ExecutionResult> {
  // === Pre-flight checks ===

  // 1. Validate mapping
  const mappingValidation = validateOpportunityMapping(
    context.opportunity,
    context.mapping
  );
  if (!mappingValidation.valid) {
    return {
      success: false,
      record: createEmptyRecord(context, "aborted"),
      shouldEnterCooldown: false,
      shouldTriggerKillSwitch: false,
      error: mappingValidation.error ?? "Invalid mapping",
    };
  }

  // 2. Check kill switch
  if (isKillSwitchTriggered()) {
    logGuardFailed("KillSwitch", "Kill switch is triggered");
    return {
      success: false,
      record: createEmptyRecord(context, "aborted"),
      shouldEnterCooldown: false,
      shouldTriggerKillSwitch: false,
      error: "Kill switch triggered - trading halted",
    };
  }

  // 3. Check cooldown
  if (isInCooldown()) {
    logGuardFailed("Cooldown", "Still in cooldown from previous failure");
    return {
      success: false,
      record: createEmptyRecord(context, "aborted"),
      shouldEnterCooldown: false,
      shouldTriggerKillSwitch: false,
      error: "In cooldown",
    };
  }

  // 4. Acquire busy lock
  if (!acquireBusyLock()) {
    logBusyLockFailed();
    return {
      success: false,
      record: createEmptyRecord(context, "aborted"),
      shouldEnterCooldown: false,
      shouldTriggerKillSwitch: false,
      error: "Execution already in progress",
    };
  }

  try {
    // 5. Run all guards
    const guardContext: GuardContext = {
      edgeNet: context.opportunity.edgeNet,
      minEdge: RISK_PARAMS.minEdgeNet,
      yesSizeAvailable: context.opportunity.legs[0].size,
      noSizeAvailable: context.opportunity.legs[1].size,
      minSizePerLeg: RISK_PARAMS.qtyPerTrade,
      lastFailureTs: getLastFailureTs(),
      cooldownMs: RISK_PARAMS.cooldownMsAfterFailure,
      dailyLoss: getDailyLoss(),
      maxDailyLoss: RISK_PARAMS.maxDailyLoss,
      currentNotional: getTotalNotional(),
      maxNotional: RISK_PARAMS.maxNotional,
      estimatedCost: context.opportunity.cost,
    };

    const guardResult = runAllGuards(guardContext);
    if (!guardResult.pass) {
      logGuardFailed("Guards", guardResult.reason);
      return {
        success: false,
        record: createEmptyRecord(context, "aborted"),
        shouldEnterCooldown: false,
        shouldTriggerKillSwitch: guardResult.reason.includes("KILL SWITCH"),
        error: guardResult.reason,
      };
    }

    // === Plan execution ===
    const legPlan = planLegOrder(
      context.opportunity,
      context.polyQuote,
      context.kalshiQuote
    );

    const legAParams = buildOrderParams(
      legPlan.legA,
      context.mapping,
      RISK_PARAMS.qtyPerTrade,
      "A"
    );

    const legBParams = buildOrderParams(
      legPlan.legB,
      context.mapping,
      RISK_PARAMS.qtyPerTrade,
      "B"
    );

    const legA = createLegExecution(legPlan.legA, legAParams);
    const legB = createLegExecution(legPlan.legB, legBParams);
    const record = createExecutionRecord(context, legA, legB);

    setCurrentExecution(record);

    // === DRY RUN MODE ===
    if (context.dryRun) {
      logDryRunExecution(context.opportunity, record);

      // Simulate successful execution
      record.status = "success";
      record.endTs = Date.now();
      record.realizedPnl = context.opportunity.edgeNet;

      return {
        success: true,
        record,
        shouldEnterCooldown: false,
        shouldTriggerKillSwitch: false,
        error: null,
      };
    }

    // === LIVE EXECUTION ===
    if (!venueClients) {
      throw new Error("venueClients required for live execution");
    }

    logExecutionStart(record);

    // === Execute Leg A ===
    record.status = "leg_a_submitting";
    legA.submitTs = Date.now();
    logLegSubmit(record.id, "A", legAParams);

    let legAResult: OrderResult;
    try {
      legAResult = await venueClients.placeOrder(legAParams);
    } catch (error) {
      legAResult = {
        success: false,
        orderId: null,
        fillQty: 0,
        fillPrice: 0,
        venue: legAParams.venue,
        status: "rejected",
        submittedAt: legA.submitTs,
        filledAt: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    legA.result = legAResult;
    const legALatency = Date.now() - legA.submitTs;
    logLegResult(record.id, "A", legAResult, legALatency);

    // Leg A failed - exit cleanly (no harm done)
    if (!legAResult.success) {
      record.status = "leg_a_failed";
      record.endTs = Date.now();
      record.realizedPnl = 0; // No loss, no fill
      logExecutionComplete(record);

      return {
        success: false,
        record,
        shouldEnterCooldown: false, // Don't cooldown for Leg A failure
        shouldTriggerKillSwitch: false,
        error: `Leg A failed: ${legAResult.error ?? legAResult.status}`,
      };
    }

    // Leg A filled
    record.status = "leg_a_filled";
    legA.fillTs = legAResult.filledAt ?? Date.now();
    addNotional(legAResult.fillPrice * legAResult.fillQty);

    // === Execute Leg B (within maxLegDelayMs) ===
    const legBStartTime = Date.now();
    const legBDeadline = legA.fillTs + RISK_PARAMS.maxLegDelayMs;

    // Check if we're already past deadline
    if (legBStartTime > legBDeadline) {
      logExecutionError(
        record.id,
        "Leg B deadline exceeded before submission",
        { legBStartTime, legBDeadline }
      );
      // Proceed to unwind
      return await handleUnwind(
        record,
        context,
        venueClients,
        "Leg B deadline exceeded"
      );
    }

    record.status = "leg_b_submitting";
    legB.submitTs = Date.now();
    logLegSubmit(record.id, "B", legBParams);

    // Calculate remaining time for Leg B
    const remainingTime = legBDeadline - legB.submitTs;

    let legBResult: OrderResult;
    try {
      // Execute with timeout
      legBResult = await Promise.race([
        venueClients.placeOrder(legBParams),
        createTimeoutPromise(remainingTime, legBParams),
      ]);
    } catch (error) {
      legBResult = {
        success: false,
        orderId: null,
        fillQty: 0,
        fillPrice: 0,
        venue: legBParams.venue,
        status: "rejected",
        submittedAt: legB.submitTs,
        filledAt: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    legB.result = legBResult;
    const legBLatency = Date.now() - legB.submitTs;
    logLegResult(record.id, "B", legBResult, legBLatency);

    // Leg B failed - need to unwind Leg A
    if (!legBResult.success) {
      return await handleUnwind(
        record,
        context,
        venueClients,
        `Leg B failed: ${legBResult.error ?? legBResult.status}`
      );
    }

    // === SUCCESS - Both legs filled ===
    record.status = "leg_b_filled";
    legB.fillTs = legBResult.filledAt ?? Date.now();
    addNotional(legBResult.fillPrice * legBResult.fillQty);

    // Calculate realized PnL
    // Box settled at $1.00, we paid legA + legB
    const totalCost =
      legAResult.fillPrice * legAResult.fillQty +
      legBResult.fillPrice * legBResult.fillQty;
    const settledValue = 1.0 * Math.min(legAResult.fillQty, legBResult.fillQty);
    const realizedPnl = settledValue - totalCost;

    record.status = "success";
    record.endTs = Date.now();
    record.realizedPnl = realizedPnl;

    // Record PnL
    recordPnl(realizedPnl);

    logExecutionComplete(record);

    return {
      success: true,
      record,
      shouldEnterCooldown: false,
      shouldTriggerKillSwitch: false,
      error: null,
    };
  } catch (error) {
    logExecutionError("Executor", error instanceof Error ? error : String(error));
    return {
      success: false,
      record: createEmptyRecord(context, "aborted"),
      shouldEnterCooldown: true,
      shouldTriggerKillSwitch: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    releaseBusyLock();
  }
}

/**
 * Handle unwind after Leg B failure.
 */
async function handleUnwind(
  record: ExecutionRecord,
  context: ExecutionContext,
  venueClients: VenueClients,
  reason: string
): Promise<ExecutionResult> {
  record.status = "unwinding";

  logUnwindStart(record.id, reason, {
    venue: record.legA.leg.venue,
    side: record.legA.leg.side,
    fillPrice: record.legA.result?.fillPrice ?? record.legA.leg.price,
  });

  // Get current quote for the venue
  const currentQuote =
    record.legA.leg.venue === "polymarket"
      ? context.polyQuote
      : context.kalshiQuote;

  // Perform unwind
  const unwindRecord = await unwindLeg(
    record.legA,
    currentQuote,
    context.mapping,
    venueClients,
    reason
  );

  record.unwind = unwindRecord;
  logUnwindResult(record.id, unwindRecord);

  // Calculate total loss
  const realizedLoss = -unwindRecord.realizedLoss;
  record.status = "unwound";
  record.endTs = Date.now();
  record.realizedPnl = realizedLoss;

  // Remove notional from Leg A (position closed via unwind)
  removeNotional(
    (record.legA.result?.fillPrice ?? 0) *
      (record.legA.result?.fillQty ?? 0)
  );

  // Record negative PnL
  recordPnl(realizedLoss);

  logExecutionComplete(record);

  // Check if this loss triggers kill switch
  const shouldTriggerKillSwitch =
    getDailyLoss() >= RISK_PARAMS.maxDailyLoss;

  return {
    success: false,
    record,
    shouldEnterCooldown: true,
    shouldTriggerKillSwitch,
    error: reason,
  };
}

/**
 * Create an empty/aborted execution record.
 */
function createEmptyRecord(
  context: ExecutionContext,
  status: "aborted"
): ExecutionRecord {
  const emptyLeg: LegExecution = {
    leg: context.opportunity.legs[0],
    params: {
      venue: context.opportunity.legs[0].venue,
      side: context.opportunity.legs[0].side,
      action: "buy",
      price: 0,
      qty: 0,
      timeInForce: "FOK",
      marketId: "",
      clientOrderId: "",
    },
    result: null,
    submitTs: null,
    fillTs: null,
  };

  return {
    id: generateExecutionId(),
    opportunity: context.opportunity,
    status,
    legA: emptyLeg,
    legB: { ...emptyLeg, leg: context.opportunity.legs[1] },
    unwind: null,
    startTs: Date.now(),
    endTs: Date.now(),
    expectedEdgeNet: context.opportunity.edgeNet,
    realizedPnl: 0,
    polyQuoteSnapshot: context.polyQuote,
    kalshiQuoteSnapshot: context.kalshiQuote,
  };
}

/**
 * Create a timeout promise that rejects after specified ms.
 */
function createTimeoutPromise(
  ms: number,
  params: ReturnType<typeof buildOrderParams>
): Promise<OrderResult> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Leg B timeout after ${ms}ms`));
    }, Math.max(0, ms));
  });
}
