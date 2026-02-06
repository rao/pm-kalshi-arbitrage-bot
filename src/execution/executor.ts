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
import { RISK_PARAMS, calculateMinQuantityForPolymarket } from "../config/riskParams";
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
  recordUnwindLoss,
  enterCooldown,
  addNotional,
  removeNotional,
  getLastFailureTs,
  addPendingSettlement,
} from "./executionState";
import { runAllGuards, checkPositionBalance } from "../strategy/guards";
import type { GuardContext } from "../strategy/types";
import {
  logExecutionStart,
  logLegSubmit,
  logLegResult,
  logUnwindStart,
  logUnwindResult,
  logExecutionComplete,
  logDryRunExecution,
  logGuardFailedThrottled,
  logBusyLockFailedThrottled,
  logExecutionError,
} from "../logging/executionLogger";
import {
  recordDecisionToSubmit,
  recordSubmitToFill,
  recordTotalExecution,
  recordLegAToLegB,
  incrementExecutions,
  incrementUnwinds,
} from "../logging/metrics";
import {
  recordFill,
  recordUnwind as recordUnwindPosition,
  getOpenOrderCount,
  getPositions,
} from "../state";


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
    logGuardFailedThrottled("KillSwitch", "Kill switch is triggered");
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
    logGuardFailedThrottled("Cooldown", "Still in cooldown from previous failure");
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
    logBusyLockFailedThrottled();
    return {
      success: false,
      record: createEmptyRecord(context, "aborted"),
      shouldEnterCooldown: false,
      shouldTriggerKillSwitch: false,
      error: "Execution already in progress",
    };
  }

  try {
    // 5. Cap qty by remaining notional headroom before guards
    let qty = context.opportunity.qty;
    const remainingNotional = RISK_PARAMS.maxNotional - getTotalNotional();
    const costPerContract = context.opportunity.cost;
    const maxQtyFromNotional = Math.floor(remainingNotional / costPerContract);

    if (maxQtyFromNotional < qty) {
      console.log(`[EXECUTOR] Capped qty from ${qty} to ${maxQtyFromNotional} due to notional limit (remaining=$${remainingNotional.toFixed(2)}, cost/contract=$${costPerContract.toFixed(3)})`);
      qty = maxQtyFromNotional;
    }

    // Verify Polymarket minimum is still met after capping
    const polyLeg = context.opportunity.legs.find(l => l.venue === "polymarket");
    const polyPrice = polyLeg ? polyLeg.price : context.opportunity.legs[0].price;
    const polyMinQty = calculateMinQuantityForPolymarket(polyPrice);

    if (qty < polyMinQty) {
      return {
        success: false,
        record: createEmptyRecord(context, "aborted"),
        shouldEnterCooldown: false,
        shouldTriggerKillSwitch: false,
        error: `Insufficient notional headroom for Polymarket minimum: maxQty=${qty}, required=${polyMinQty} (remaining=$${remainingNotional.toFixed(2)})`,
      };
    }

    // 6. Run all guards with capped qty
    const guardContext: GuardContext = {
      edgeNet: context.opportunity.edgeNet,
      minEdge: RISK_PARAMS.minEdgeNet,
      yesSizeAvailable: context.opportunity.legs[0].size,
      noSizeAvailable: context.opportunity.legs[1].size,
      minSizePerLeg: qty,
      lastFailureTs: getLastFailureTs(),
      cooldownMs: RISK_PARAMS.cooldownMsAfterFailure,
      dailyLoss: getDailyLoss(),
      maxDailyLoss: RISK_PARAMS.maxDailyLoss,
      currentNotional: getTotalNotional(),
      maxNotional: RISK_PARAMS.maxNotional,
      estimatedCost: costPerContract * qty,
      polymarketOpenOrders: getOpenOrderCount("polymarket"),
      kalshiOpenOrders: getOpenOrderCount("kalshi"),
      maxOpenOrdersPerVenue: RISK_PARAMS.maxOpenOrdersPerVenue,
    };

    const guardResult = runAllGuards(guardContext);
    if (!guardResult.pass) {
      logGuardFailedThrottled("Guards", guardResult.reason);
      return {
        success: false,
        record: createEmptyRecord(context, "aborted"),
        shouldEnterCooldown: false,
        shouldTriggerKillSwitch: guardResult.reason.includes("KILL SWITCH"),
        error: guardResult.reason,
      };
    }

    // 7. Pre-execution position balance check
    const positions = getPositions();
    const positionCheck = checkPositionBalance(positions);
    if (!positionCheck.pass) {
      logGuardFailedThrottled("PositionBalance", positionCheck.reason);
      return {
        success: false,
        record: createEmptyRecord(context, "aborted"),
        shouldEnterCooldown: false,
        shouldTriggerKillSwitch: false,
        error: `Position imbalance prevents new execution: ${positionCheck.reason}`,
      };
    }

    // === Plan execution ===
    const legPlan = planLegOrder(
      context.opportunity,
      context.polyQuote,
      context.kalshiQuote
    );

    // qty was already computed and capped above (step 5)

    const legAParams = buildOrderParams(
      legPlan.legA,
      context.mapping,
      qty,
      "A"
    );

    const legBParams = buildOrderParams(
      legPlan.legB,
      context.mapping,
      qty,
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

    // === LIVE EXECUTION (PARALLEL) ===
    if (!venueClients) {
      throw new Error("venueClients required for live execution");
    }

    logExecutionStart(record);
    const executionStartTs = Date.now();

    // === Submit both legs simultaneously ===
    record.status = "legs_submitting";
    legA.submitTs = Date.now();
    legB.submitTs = Date.now();

    // Record decision-to-submit latency
    recordDecisionToSubmit(legA.submitTs - executionStartTs);

    logLegSubmit(record.id, "A", legAParams);
    logLegSubmit(record.id, "B", legBParams);

    // Execute both in parallel with individual timeouts
    const [legASettled, legBSettled] = await Promise.allSettled([
      placeOrderWithTimeout(venueClients, legAParams, RISK_PARAMS.legOrderTimeoutMs),
      placeOrderWithTimeout(venueClients, legBParams, RISK_PARAMS.legOrderTimeoutMs),
    ]);

    // Extract initial results
    let legAResult = legASettled.status === "fulfilled"
      ? legASettled.value
      : createTimeoutResult(legAParams, legA.submitTs, legASettled.reason);
    let legBResult = legBSettled.status === "fulfilled"
      ? legBSettled.value
      : createTimeoutResult(legBParams, legB.submitTs, legBSettled.reason);

    // === Cancel-then-verify for timed-out orders ===
    // If one leg filled and the other timed out, the timed-out order may have
    // actually filled on the venue. We must cancel-then-verify before unwinding.
    const legATimedOut = legAResult.status === "timeout";
    const legBTimedOut = legBResult.status === "timeout";
    const legAFilled = legAResult.success || legAResult.status === "filled";
    const legBFilled = legBResult.success || legBResult.status === "filled";

    if (legATimedOut && legBFilled && legAResult.orderId) {
      // Leg A timed out but Leg B filled - cancel and verify Leg A
      console.log(`[EXECUTOR] Leg A timed out but Leg B filled - cancel-then-verify Leg A (${legAParams.venue})`);
      legAResult = await cancelAndVerifyOrder(
        venueClients, legAParams.venue, legAResult.orderId, legAResult
      );
    } else if (legBTimedOut && legAFilled && legBResult.orderId) {
      // Leg B timed out but Leg A filled - cancel and verify Leg B
      console.log(`[EXECUTOR] Leg B timed out but Leg A filled - cancel-then-verify Leg B (${legBParams.venue})`);
      legBResult = await cancelAndVerifyOrder(
        venueClients, legBParams.venue, legBResult.orderId, legBResult
      );
    } else if (legATimedOut && legBTimedOut) {
      // Both timed out - try to cancel both (no urgency since neither is confirmed filled)
      if (legAResult.orderId) {
        console.log(`[EXECUTOR] Both legs timed out - cancelling Leg A (${legAParams.venue})`);
        await venueClients.cancelOrder(legAParams.venue, legAResult.orderId).catch(() => {});
      }
      if (legBResult.orderId) {
        console.log(`[EXECUTOR] Both legs timed out - cancelling Leg B (${legBParams.venue})`);
        await venueClients.cancelOrder(legBParams.venue, legBResult.orderId).catch(() => {});
      }
    }

    legA.result = legAResult;
    legB.result = legBResult;

    // Log results
    const legALatency = Date.now() - legA.submitTs!;
    const legBLatency = Date.now() - legB.submitTs!;
    logLegResult(record.id, "A", legAResult, legALatency);
    logLegResult(record.id, "B", legBResult, legBLatency);

    // Record submit-to-fill latency for successful legs
    if (legAResult.success) {
      recordSubmitToFill(legAParams.venue, legALatency);
    }
    if (legBResult.success) {
      recordSubmitToFill(legBParams.venue, legBLatency);
    }

    // === Handle outcomes ===
    const legASuccess = legAResult.success || legAResult.status === "filled";
    const legBSuccess = legBResult.success || legBResult.status === "filled";

    // Handle paradox states (status=filled but success=false)
    if (legAResult.status === "filled" && !legAResult.success) {
      console.warn(`[EXECUTOR] PARADOX: Leg A status=filled but success=false - treating as filled`);
    }
    if (legBResult.status === "filled" && !legBResult.success) {
      console.warn(`[EXECUTOR] PARADOX: Leg B status=filled but success=false - treating as filled`);
    }

    if (legASuccess && legBSuccess) {
      // BOTH FILLED - arb complete
      return handleBothFilled(record, context, legA, legB, legAResult, legBResult, executionStartTs);
    }

    if (legASuccess && !legBSuccess) {
      // Only Leg A filled - record position and unwind Leg A
      legA.fillTs = legAResult.filledAt ?? Date.now();
      addNotional(legAResult.fillPrice * legAResult.fillQty);

      recordFill(
        legAParams.venue,
        legAParams.side,
        "buy",
        legAResult.fillQty,
        legAResult.fillPrice,
        context.opportunity.intervalKey,
        legAResult.orderId ?? undefined
      );

      return await handleParallelUnwind(
        record,
        context,
        venueClients,
        "A",
        `Leg B failed: ${legBResult.error ?? legBResult.status}`
      );
    }

    if (!legASuccess && legBSuccess) {
      // Only Leg B filled - record position and unwind Leg B
      legB.fillTs = legBResult.filledAt ?? Date.now();
      addNotional(legBResult.fillPrice * legBResult.fillQty);

      recordFill(
        legBParams.venue,
        legBParams.side,
        "buy",
        legBResult.fillQty,
        legBResult.fillPrice,
        context.opportunity.intervalKey,
        legBResult.orderId ?? undefined
      );

      return await handleParallelUnwind(
        record,
        context,
        venueClients,
        "B",
        `Leg A failed: ${legAResult.error ?? legAResult.status}`
      );
    }

    // BOTH FAILED - clean exit (no risk)
    record.status = "both_legs_failed";
    record.endTs = Date.now();
    record.realizedPnl = 0;
    incrementExecutions(false);
    logExecutionComplete(record);

    return {
      success: false,
      record,
      shouldEnterCooldown: false,
      shouldTriggerKillSwitch: false,
      error: `Both legs failed: A=${legAResult.error}, B=${legBResult.error}`,
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
 * Place an order with a timeout.
 */
async function placeOrderWithTimeout(
  venueClients: VenueClients,
  params: ReturnType<typeof buildOrderParams>,
  timeoutMs: number
): Promise<OrderResult> {
  return Promise.race([
    venueClients.placeOrder(params),
    new Promise<OrderResult>((_, reject) =>
      setTimeout(() => reject(new Error(`Order timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Create an OrderResult for a timeout/rejection.
 */
function createTimeoutResult(
  params: ReturnType<typeof buildOrderParams>,
  submitTs: number,
  error: unknown
): OrderResult {
  return {
    success: false,
    orderId: null,
    fillQty: 0,
    fillPrice: 0,
    venue: params.venue,
    status: "timeout",
    submittedAt: submitTs,
    filledAt: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Cancel an order and verify its actual status.
 *
 * When an order times out locally but the venue may have already matched it,
 * we attempt to cancel and then check the actual status. If the order was
 * already filled (cancel fails because it's already executed), we update
 * the result to reflect the actual fill.
 *
 * @param venueClients - Venue client interfaces
 * @param venue - Which venue the order is on
 * @param orderId - The order ID to cancel and verify
 * @param originalResult - The original timeout result
 * @returns Updated OrderResult reflecting actual status
 */
async function cancelAndVerifyOrder(
  venueClients: VenueClients,
  venue: "polymarket" | "kalshi",
  orderId: string,
  originalResult: OrderResult
): Promise<OrderResult> {
  try {
    // Step 1: Attempt to cancel
    const cancelled = await venueClients.cancelOrder(venue, orderId);

    // Step 2: Verify the actual order status regardless of cancel result
    const status = await venueClients.getOrderStatus(venue, orderId);

    if (status.filled) {
      // The order was actually filled (cancel came too late)
      console.log(`[EXECUTOR] Cancel-verify: ${venue} order ${orderId.substring(0, 20)}... was ALREADY FILLED at $${status.fillPrice?.toFixed(4) ?? "?"}`);
      return {
        success: true,
        orderId,
        fillQty: status.fillQty ?? (originalResult.fillQty || 1),
        fillPrice: status.fillPrice ?? 0,
        venue,
        status: "filled",
        submittedAt: originalResult.submittedAt,
        filledAt: Date.now(),
        error: null,
      };
    }

    if (cancelled) {
      console.log(`[EXECUTOR] Cancel-verify: ${venue} order ${orderId.substring(0, 20)}... successfully cancelled`);
    } else {
      console.warn(`[EXECUTOR] Cancel-verify: ${venue} order ${orderId.substring(0, 20)}... cancel returned false, status=${status.status}`);
    }

    // Order was not filled - return original timeout result
    return originalResult;
  } catch (error) {
    console.error(`[EXECUTOR] Cancel-verify failed for ${venue}/${orderId}: ${error instanceof Error ? error.message : String(error)}`);
    // On error, return the original result (conservative - treat as timeout)
    return originalResult;
  }
}

/**
 * Handle both legs filled successfully (arb complete).
 */
function handleBothFilled(
  record: ExecutionRecord,
  context: ExecutionContext,
  legA: LegExecution,
  legB: LegExecution,
  legAResult: OrderResult,
  legBResult: OrderResult,
  executionStartTs: number
): ExecutionResult {
  // Record positions
  legA.fillTs = legAResult.filledAt ?? Date.now();
  legB.fillTs = legBResult.filledAt ?? Date.now();

  addNotional(legAResult.fillPrice * legAResult.fillQty);
  addNotional(legBResult.fillPrice * legBResult.fillQty);

  recordFill(
    legA.params.venue,
    legA.params.side,
    "buy",
    legAResult.fillQty,
    legAResult.fillPrice,
    context.opportunity.intervalKey,
    legAResult.orderId ?? undefined
  );

  recordFill(
    legB.params.venue,
    legB.params.side,
    "buy",
    legBResult.fillQty,
    legBResult.fillPrice,
    context.opportunity.intervalKey,
    legBResult.orderId ?? undefined
  );

  // Record leg A to leg B latency (using fill times)
  if (legA.fillTs && legB.fillTs) {
    recordLegAToLegB(Math.abs(legB.fillTs - legA.fillTs));
  }

  // Calculate expected PnL at settlement
  // Box settles at $1.00 at interval END, we paid legA + legB now
  const totalCost =
    legAResult.fillPrice * legAResult.fillQty +
    legBResult.fillPrice * legBResult.fillQty;
  const filledQty = Math.min(legAResult.fillQty, legBResult.fillQty);
  const settledValue = 1.0 * filledQty;
  const expectedPnl = settledValue - totalCost;

  record.status = "success";
  record.endTs = Date.now();
  record.realizedPnl = expectedPnl;

  // Record metrics
  recordTotalExecution(record.endTs - executionStartTs);
  incrementExecutions(true);

  // Add to pending settlements - PnL is realized when interval ends
  addPendingSettlement({
    executionId: record.id,
    intervalKey: context.opportunity.intervalKey,
    settlesAt: context.opportunity.intervalKey.endTs,
    expectedPnl,
    actualCost: totalCost,
    qty: filledQty,
    completedAt: record.endTs,
  });

  logExecutionComplete(record);

  // Post-execution position verification
  const postPositions = getPositions();
  const postCheck = checkPositionBalance(postPositions);
  if (!postCheck.pass) {
    console.warn(`[EXECUTOR] WARNING: Positions unbalanced after successful execution: ${postCheck.reason}`);
  }

  return {
    success: true,
    record,
    shouldEnterCooldown: false,
    shouldTriggerKillSwitch: false,
    error: null,
  };
}

/**
 * Handle unwind for parallel execution (can unwind either leg).
 */
async function handleParallelUnwind(
  record: ExecutionRecord,
  context: ExecutionContext,
  venueClients: VenueClients,
  legToUnwind: "A" | "B",
  reason: string
): Promise<ExecutionResult> {
  record.status = "unwinding";

  const filledLeg = legToUnwind === "A" ? record.legA : record.legB;

  logUnwindStart(record.id, reason, {
    venue: filledLeg.leg.venue,
    side: filledLeg.leg.side,
    fillPrice: filledLeg.result?.fillPrice ?? filledLeg.leg.price,
  });

  // Get current quote for the venue
  const currentQuote =
    filledLeg.leg.venue === "polymarket"
      ? context.polyQuote
      : context.kalshiQuote;

  // Perform unwind
  const unwindRecord = await unwindLeg(
    filledLeg,
    currentQuote,
    context.mapping,
    venueClients,
    reason
  );

  record.unwind = unwindRecord;
  logUnwindResult(record.id, unwindRecord);

  // Record unwind metrics
  incrementUnwinds(unwindRecord.result?.success ?? false);
  incrementExecutions(false);

  // Record position change from unwind
  if (unwindRecord.result?.success) {
    recordUnwindPosition(
      filledLeg.leg.venue,
      filledLeg.leg.side,
      unwindRecord.result.fillQty,
      unwindRecord.result.fillPrice,
      context.opportunity.intervalKey
    );
  }

  // Calculate total loss
  const realizedLoss = -unwindRecord.realizedLoss;
  record.status = "unwound";
  record.endTs = Date.now();
  record.realizedPnl = realizedLoss;

  // Remove notional from the filled leg (position closed via unwind)
  removeNotional(
    (filledLeg.result?.fillPrice ?? 0) *
      (filledLeg.result?.fillQty ?? 0)
  );

  // Record negative PnL
  recordPnl(realizedLoss);
  recordUnwindLoss(Math.abs(realizedLoss));

  logExecutionComplete(record);

  // If unwind failed (all retries exhausted), trigger kill switch - we have unhedged exposure
  const unwindFailed = !(unwindRecord.result?.success);
  if (unwindFailed) {
    console.error(`[EXECUTOR] CRITICAL: Unwind FAILED - unhedged ${filledLeg.leg.venue} ${filledLeg.leg.side} position remains!`);
    console.error(`[EXECUTOR] Triggering kill switch to prevent further trading until manual intervention.`);
    const posSnapshot = getPositions();
    console.error(`[EXECUTOR] Position snapshot: poly(yes=${posSnapshot.polymarket.yes}, no=${posSnapshot.polymarket.no}) kalshi(yes=${posSnapshot.kalshi.yes}, no=${posSnapshot.kalshi.no})`);
  }

  // Check if this loss triggers kill switch (either from daily loss OR unwind failure)
  const shouldTriggerKillSwitch =
    getDailyLoss() >= RISK_PARAMS.maxDailyLoss || unwindFailed;

  // Post-execution position verification
  const postPositions = getPositions();
  const postCheck = checkPositionBalance(postPositions);
  if (!postCheck.pass) {
    console.warn(`[EXECUTOR] WARNING: Positions unbalanced after execution: ${postCheck.reason}`);
  }

  return {
    success: false,
    record,
    shouldEnterCooldown: true,
    shouldTriggerKillSwitch,
    error: reason,
  };
}

/**
 * Handle unwind after Leg B failure (legacy sequential - kept for compatibility).
 */
async function handleUnwind(
  record: ExecutionRecord,
  context: ExecutionContext,
  venueClients: VenueClients,
  reason: string
): Promise<ExecutionResult> {
  // Delegate to the parallel unwind handler for Leg A
  return handleParallelUnwind(record, context, venueClients, "A", reason);
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

