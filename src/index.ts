/**
 * Main entry point for the arbitrage bot.
 *
 * Composes all modules:
 * - Config loading
 * - Market discovery
 * - Market data coordination (WebSocket subscriptions)
 * - Quote caching
 * - Arbitrage scanning
 * - Execution engine (two-phase commit)
 * - Periodic status logging
 */

import {
  loadConfig,
  hasKalshiCredentials,
  hasPolymarketCredentials,
  type Config,
} from "./config/config";
import { RISK_PARAMS } from "./config/riskParams";
import { MarketDiscovery, type DiscoveryEvent } from "./markets/discovery";
import {
  MarketDataCoordinator,
  type CoordinatorEvent,
  type OrderCancellationCallbacks,
} from "./data/marketDataCoordinator";
import type { QuoteUpdateEvent, NormalizedQuote } from "./normalization/types";
import type { IntervalKey } from "./time/interval";
import { formatIntervalKey, getIntervalKey } from "./time/interval";
import { getFeeBuffer } from "./fees/feeEngine";
import { scanForArbitrage } from "./strategy/arbScanner";
import type { Opportunity } from "./strategy/types";
import { createLogger, type Logger } from "./logging/logger";
import {
  executeOpportunity,
  isKillSwitchTriggered,
  isInCooldown,
  enterCooldown,
  triggerKillSwitch,
  getDailyLoss,
  settlePending,
  initializeVenueClients,
  createLiveVenueClients,
  cancelKalshiOrdersForMarket,
  forceLiquidateAll,
  startBalanceMonitor,
  stopBalanceMonitor,
  type ExecutionContext,
  type VenueClients,
  type InitializedClients,
} from "./execution";
import {
  logOpportunityDetected,
  logKillSwitch,
  logCooldownEntry,
  logExecutionError,
} from "./logging/executionLogger";
import { getPositions, clearPositionsForInterval, setCurrentInterval } from "./state";
import { incrementOpportunities, getMetricsSummary } from "./logging/metrics";

/**
 * Quote cache - maintains latest quote per venue.
 */
interface QuoteCache {
  polymarket: NormalizedQuote | null;
  kalshi: NormalizedQuote | null;
  intervalKey: IntervalKey | null;
}

/**
 * Main application state.
 */
interface AppState {
  logger: Logger;
  config: Config | null;
  discovery: MarketDiscovery | null;
  coordinator: MarketDataCoordinator | null;
  quoteCache: QuoteCache;
  running: boolean;
  statusIntervalMs: number;
  /** Initialized venue clients for live trading (null in dry run) */
  venueClients: InitializedClients | null;
}

const state: AppState = {
  logger: createLogger("info"),
  config: null,
  discovery: null,
  coordinator: null,
  quoteCache: {
    polymarket: null,
    kalshi: null,
    intervalKey: null,
  },
  running: false,
  statusIntervalMs: 60000, // 60 second status updates
  venueClients: null,
};

/**
 * Attempt to execute an arbitrage opportunity.
 *
 * Handles all pre-flight checks, execution, and post-execution state updates.
 */
async function attemptExecution(opportunity: Opportunity): Promise<void> {
  const config = state.config;
  if (!config) return;

  // 1. Kill switch check
  if (isKillSwitchTriggered()) {
    return;
  }

  // 2. Cooldown check
  if (isInCooldown()) {
    return;
  }

  // 3. Need quotes from both venues
  if (!state.quoteCache.polymarket || !state.quoteCache.kalshi) {
    state.logger.debug("Missing quotes from one or both venues, skipping execution");
    return;
  }

  // 4. Need a valid mapping
  const mapping = state.discovery?.getStore().getCurrentMapping();
  if (!mapping) {
    state.logger.debug("No current mapping available, skipping execution");
    return;
  }

  // 5. Build execution context
  const context: ExecutionContext = {
    opportunity,
    mapping,
    polyQuote: state.quoteCache.polymarket,
    kalshiQuote: state.quoteCache.kalshi,
    dryRun: config.dryRun,
  };

  // 6. Log opportunity detection and increment counter
  incrementOpportunities();

  // Only show opportunity alert in dry run mode
  // In live mode, execution logs are more relevant
  if (config.dryRun) {
    logOpportunityDetected(opportunity, {
      polyQuote: state.quoteCache.polymarket,
      kalshiQuote: state.quoteCache.kalshi,
    });
  }

  // 7. Execute (with null venueClients for dry run)
  // In production, venueClients are initialized at startup with proper auth
  const venueClients: VenueClients | null = config.dryRun
    ? null
    : state.venueClients
      ? createLiveVenueClients(state.venueClients, (venue) => {
          return venue === "polymarket"
            ? state.quoteCache.polymarket
            : state.quoteCache.kalshi;
        })
      : null;

  try {
    const result = await executeOpportunity(context, venueClients);

    // 8. Handle result
    if (result.shouldEnterCooldown) {
      enterCooldown();
      logCooldownEntry(
        result.error ?? "Execution failed",
        RISK_PARAMS.cooldownMsAfterFailure
      );
    }

    if (result.shouldTriggerKillSwitch) {
      triggerKillSwitch();
      logKillSwitch(
        getDailyLoss(),
        RISK_PARAMS.maxDailyLoss,
        result.error ?? "Daily loss limit exceeded"
      );

      // Fire-and-forget: actively liquidate remaining positions
      if (state.venueClients) {
        forceLiquidateAll(state.venueClients, state.logger).then((liqResult) => {
          if (liqResult.allClosed) {
            state.logger.info("[KILLSWITCH] All positions liquidated successfully");
          } else {
            state.logger.error("[KILLSWITCH] Some positions could NOT be liquidated — manual intervention needed");
          }
        }).catch((err) => {
          state.logger.error(`[KILLSWITCH] Liquidation error: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }
  } catch (error) {
    logExecutionError(
      "attemptExecution",
      error instanceof Error ? error : String(error)
    );
  }
}


/**
 * Create order cancellation callbacks for rollover safety.
 *
 * These callbacks are called by the coordinator during interval rollover
 * to ensure no stale orders remain from the previous interval.
 */
function createOrderCancellationCallbacks(): OrderCancellationCallbacks {
  return {
    cancelKalshiOrders: async (ticker: string): Promise<number> => {
      if (!state.venueClients?.kalshi) {
        state.logger.debug(`[ROLLOVER] No Kalshi auth, skipping cancel for ${ticker}`);
        return 0;
      }
      try {
        const count = await cancelKalshiOrdersForMarket(
          state.venueClients.kalshi.auth,
          ticker
        );
        if (count > 0) {
          state.logger.info(`[ROLLOVER] Canceled ${count} Kalshi orders for ${ticker}`);
        }
        return count;
      } catch (error) {
        state.logger.error(
          `[ROLLOVER] Failed to cancel Kalshi orders: ${error instanceof Error ? error.message : String(error)}`
        );
        return 0;
      }
    },
    cancelPolymarketOrders: async (upToken: string, downToken: string): Promise<void> => {
      if (!state.venueClients?.polymarket) {
        state.logger.debug(`[ROLLOVER] No Polymarket auth, skipping cancel`);
        return;
      }
      try {
        await state.venueClients.polymarket.cancelMarketOrders({
          assetId: upToken,
        });
        await state.venueClients.polymarket.cancelMarketOrders({
          assetId: downToken,
        });
        state.logger.info(`[ROLLOVER] Canceled Polymarket orders for tokens`);
      } catch (error) {
        state.logger.error(
          `[ROLLOVER] Failed to cancel Polymarket orders: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  };
}

/**
 * Handle quote update from WebSocket.
 */
async function handleQuoteUpdate(event: QuoteUpdateEvent): Promise<void> {
  // Track quote for stats
  state.logger.trackQuote(event);

  // Update cache
  if (event.venue === "polymarket") {
    state.quoteCache.polymarket = event.quote;
  } else if (event.venue === "kalshi") {
    state.quoteCache.kalshi = event.quote;
  }
  state.quoteCache.intervalKey = event.intervalKey;

  // Scan for arbitrage (silent unless opportunity found)
  const scanResult = scanForArbitrage({
    polyQuote: state.quoteCache.polymarket,
    kalshiQuote: state.quoteCache.kalshi,
    intervalKey: event.intervalKey,
    feeBuffer: getFeeBuffer(),
    slippageBuffer: RISK_PARAMS.slippageBufferPerLeg * 2, // 2 legs
    minEdgeNet: RISK_PARAMS.minEdgeNet,
  });

  // Update computed edge for status logging (doesn't print)
  state.logger.updateEdge(scanResult.computedEdge);

  // Attempt execution if opportunity found
  if (scanResult.opportunity) {
    // Old behavior: just log the opportunity
    // state.logger.logOpportunity(scanResult.opportunity);

    // New behavior: attempt execution (handles DRY_RUN internally)
    await attemptExecution(scanResult.opportunity);
  }
}

/**
 * Handle coordinator events.
 */
function handleCoordinatorEvent(event: CoordinatorEvent): void {
  switch (event.type) {
    case "ROLLOVER_STARTED":
      state.logger.info(
        `Rollover started: ${formatIntervalKey(event.oldInterval)} -> ${formatIntervalKey(event.newInterval)}`
      );
      // Clear quote cache on rollover
      state.quoteCache.polymarket = null;
      state.quoteCache.kalshi = null;

      // Settle pending PnL for the old interval (contracts settle at interval end)
      const settlementResult = settlePending(event.oldInterval);
      if (settlementResult.settled.length > 0) {
        state.logger.info(
          `Settled ${settlementResult.settled.length} positions for ${formatIntervalKey(event.oldInterval)}, ` +
            `realized PnL: $${settlementResult.realized.toFixed(4)}`
        );
      }

      // Clear position tracker for old interval (prevents stale positions carrying over)
      clearPositionsForInterval(event.oldInterval);
      state.logger.info(`Cleared positions for interval ${formatIntervalKey(event.oldInterval)}`);
      break;

    case "ROLLOVER_COMPLETED":
      setCurrentInterval(event.newInterval);
      state.logger.info(
        `Rollover completed: now in ${formatIntervalKey(event.newInterval)}`
      );
      break;

    case "CONNECTION_STATE":
      // Only log when connected or disconnected, skip "connecting" state
      if (event.state === "connected") {
        state.logger.info(`[${event.venue.toUpperCase()}] Connected`);
      } else if (event.state === "disconnected") {
        state.logger.info(`[${event.venue.toUpperCase()}] Disconnected`);
      }
      break;

    case "SUBSCRIPTION_ACTIVE":
      state.logger.info(
        `[${event.venue.toUpperCase()}] Subscribed to ${formatIntervalKey(event.intervalKey)}`
      );
      break;

    case "ERROR":
      state.logger.error(
        `[${event.venue.toUpperCase()}] Error in ${event.context}: ${event.error.message}`
      );
      break;
  }
}

/**
 * Handle discovery events.
 */
function handleDiscoveryEvent(event: DiscoveryEvent): void {
  switch (event.type) {
    case "MARKET_DISCOVERED":
      state.logger.debug(
        `[${event.venue.toUpperCase()}] Market discovered for ${formatIntervalKey(event.intervalKey)}`
      );
      break;

    case "PREFETCH_COMPLETED":
      if (event.success) {
        state.logger.debug(
          `[${event.venue.toUpperCase()}] Prefetch completed for ${formatIntervalKey(event.intervalKey)}`
        );
      } else {
        state.logger.warn(
          `[${event.venue.toUpperCase()}] Prefetch FAILED for ${formatIntervalKey(event.intervalKey)}`
        );
      }
      break;

    case "ROLLOVER":
      // Coordinator handles this
      break;

    case "ERROR":
      state.logger.warn(
        `[${event.venue.toUpperCase()}] Discovery error in ${event.context}: ${event.error.message}`
      );
      break;
  }
}

/**
 * Graceful shutdown.
 *
 * Cancels all open orders on both venues, logs final position snapshot,
 * and warns if positions are unbalanced.
 */
async function shutdown(): Promise<void> {
  if (!state.running) return;
  state.running = false;

  state.logger.info("Shutting down...");
  state.logger.stopStatusInterval();
  state.logger.stopMetricsInterval();
  stopBalanceMonitor();

  // Cancel all open orders on both venues
  if (state.venueClients) {
    state.logger.info("[SHUTDOWN] Cancelling all open orders...");

    // Cancel Polymarket orders
    if (state.venueClients.polymarket) {
      try {
        const result = await state.venueClients.polymarket.cancelAllOrders();
        const canceledCount = result.canceled?.length ?? 0;
        if (canceledCount > 0) {
          state.logger.info(`[SHUTDOWN] Cancelled ${canceledCount} Polymarket orders`);
        }
      } catch (error) {
        state.logger.error(
          `[SHUTDOWN] Failed to cancel Polymarket orders: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Cancel Kalshi orders (cancel all resting orders)
    if (state.venueClients.kalshi) {
      try {
        const { getOpenOrders, batchCancelOrders } = await import("./venues/kalshi/orders");
        const { orders } = await getOpenOrders(state.venueClients.kalshi.auth);
        if (orders.length > 0) {
          const orderIds = orders.map((o) => o.order_id);
          await batchCancelOrders(state.venueClients.kalshi.auth, orderIds);
          state.logger.info(`[SHUTDOWN] Cancelled ${orders.length} Kalshi orders`);
        }
      } catch (error) {
        state.logger.error(
          `[SHUTDOWN] Failed to cancel Kalshi orders: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // Log final position snapshot
  const finalPositions = getPositions();
  state.logger.info(
    `[SHUTDOWN] Final positions: ` +
    `poly(yes=${finalPositions.polymarket.yes}, no=${finalPositions.polymarket.no}) ` +
    `kalshi(yes=${finalPositions.kalshi.yes}, no=${finalPositions.kalshi.no})`
  );

  // Warn if positions are unbalanced
  const totalYes = finalPositions.polymarket.yes + finalPositions.kalshi.yes;
  const totalNo = finalPositions.polymarket.no + finalPositions.kalshi.no;
  if (totalYes !== totalNo) {
    state.logger.warn(
      `[SHUTDOWN] WARNING: Positions are UNBALANCED at shutdown! ` +
      `totalYes=${totalYes}, totalNo=${totalNo}. Manual intervention may be needed.`
    );
  }

  if (state.coordinator) {
    await state.coordinator.stop();
  }

  if (state.discovery) {
    state.discovery.stop();
  }

  state.logger.info("Shutdown complete");
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  // Load config
  const config = loadConfig();
  state.config = config;
  state.logger = createLogger(config.logLevel);

  state.logger.info("Starting arb bot...");
  state.logger.info(`Mode: ${config.dryRun ? "DRY RUN" : "LIVE"}`);
  if (!config.dryRun) {
    state.logger.warn("!!! LIVE TRADING MODE - Real orders will be placed !!!");
  }
  state.logger.info(
    `Risk params: max=$${RISK_PARAMS.maxNotional}, minEdge=$${RISK_PARAMS.minEdgeNet}`
  );

  // Credential validation for live trading
  if (!config.dryRun) {
    if (!hasPolymarketCredentials(config)) {
      state.logger.error("FATAL: Polymarket credentials required for live trading");
      state.logger.error("  Set: POLYMARKET_PRIVATE_KEY, POLYMARKET_FUNDER_ADDRESS");
      process.exit(1);
    }
    if (!hasKalshiCredentials(config)) {
      state.logger.error("FATAL: Kalshi credentials required for live trading");
      state.logger.error("  Set: KALSHI_API_KEY, KALSHI_PRIVATE_KEY");
      process.exit(1);
    }

    // Initialize venue clients for live trading
    state.logger.info("Initializing venue clients for live trading...");
    try {
      state.venueClients = await initializeVenueClients(config);
      state.logger.info("Venue clients initialized successfully");

      // Verify venue clients are actually initialized (not null)
      if (!state.venueClients.polymarket) {
        state.logger.error("FATAL: Polymarket client failed to initialize");
        state.logger.error("  Ensure POLYMARKET_PRIVATE_KEY is set (API creds alone are insufficient)");
        process.exit(1);
      }
      if (!state.venueClients.kalshi) {
        state.logger.error("FATAL: Kalshi client failed to initialize");
        state.logger.error("  Ensure KALSHI_API_KEY and KALSHI_PRIVATE_KEY are set");
        process.exit(1);
      }

      // Test connectivity
      state.logger.info("Testing venue connectivity...");

      // Test Polymarket
      if (state.venueClients.polymarket) {
        const orders = await state.venueClients.polymarket.getOpenOrders();
        state.logger.info(`  Polymarket: OK (${orders.length} open orders)`);
      }

      // Test Kalshi
      if (state.venueClients.kalshi) {
        const headers = await state.venueClients.kalshi.auth.getHeaders(
          "GET",
          "/trade-api/v2/portfolio/balance"
        );
        const res = await fetch(
          `${config.kalshiApiHost}/trade-api/v2/portfolio/balance`,
          { headers: headers as unknown as Record<string, string> }
        );
        if (!res.ok) {
          throw new Error(`Kalshi auth failed: ${res.status}`);
        }
        state.logger.info("  Kalshi: OK");
      }
    } catch (error) {
      state.logger.error(
        `Failed to initialize venue clients: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  }

  // Start balance monitor for live trading
  if (!config.dryRun && state.venueClients) {
    startBalanceMonitor({
      venueClients: state.venueClients,
      logger: state.logger,
      minBalanceDollars: RISK_PARAMS.minVenueBalance,
      intervalMs: 60000,
      onLowBalance: (venue, balance) => {
        if (!isKillSwitchTriggered()) {
          state.logger.error(
            `[BALANCE] ${venue} balance $${balance.toFixed(2)} below minimum $${RISK_PARAMS.minVenueBalance} — triggering kill switch`
          );
          triggerKillSwitch();
          logKillSwitch(balance, RISK_PARAMS.minVenueBalance, `${venue} low balance: $${balance.toFixed(2)}`);
        }
      },
    });
  }

  // Create discovery (determines venues based on available API keys)
  const kalshiApiKeyId = process.env.KALSHI_API_KEY;
  const kalshiPrivateKey = process.env.KALSHI_PRIVATE_KEY;
  const hasKalshiCreds = !!(kalshiApiKeyId && kalshiPrivateKey);

  // Determine which venues to use
  const venues: ("polymarket" | "kalshi")[] = [];
  venues.push("polymarket"); // Polymarket doesn't require auth for market data
  if (hasKalshiCreds) {
    venues.push("kalshi");
  } else {
    state.logger.warn("Kalshi credentials not found, running Polymarket only");
    state.logger.info(`  KALSHI_API_KEY: ${process.env.KALSHI_API_KEY ? "set" : "NOT SET"}`);
    state.logger.info(`  KALSHI_PRIVATE_KEY: ${process.env.KALSHI_PRIVATE_KEY ? "set" : "NOT SET"}`);
  }

  state.logger.info(`Venues configured: ${venues.join(", ")}`);
  if (hasKalshiCreds) {
    state.logger.info(`  Kalshi mode: ${config.kalshiApiHost.includes("demo") ? "DEMO" : "LIVE"}`);
  }

  state.discovery = new MarketDiscovery({
    coin: "BTC",
    venues,
    gammaOptions: { host: config.gammaApiHost },
    kalshiOptions: hasKalshiCreds
      ? { host: config.kalshiApiHost }
      : undefined,
  });

  // Set up discovery event handler
  state.discovery.onEvent(handleDiscoveryEvent);

  // Create coordinator with order cancellation callbacks for safe rollover
  state.coordinator = new MarketDataCoordinator({
    discovery: state.discovery,
    kalshiWsOptions: hasKalshiCreds
      ? {
          apiKeyId: kalshiApiKeyId!,
          privateKey: kalshiPrivateKey!,
          demo: config.kalshiApiHost.includes("demo"),
        }
      : undefined,
    debug: config.logLevel === "debug",
    orderCancellation: createOrderCancellationCallbacks(),
  });

  // Set up event handlers
  state.coordinator.onQuote(handleQuoteUpdate);
  state.coordinator.onEvent(handleCoordinatorEvent);

  // Set up signal handlers
  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });

  // Start
  state.running = true;
  state.logger.startStatusInterval(state.statusIntervalMs);
  state.logger.startMetricsInterval(180000); // 3-minute execution metrics

  const currentInterval = getIntervalKey();
  state.logger.info(`Current interval: ${formatIntervalKey(currentInterval)}`);

  try {
    await state.coordinator.start();
    state.logger.info("Bot is running. Press Ctrl+C to stop.");

    // Keep process alive
    await new Promise<void>((resolve) => {
      const checkRunning = setInterval(() => {
        if (!state.running) {
          clearInterval(checkRunning);
          resolve();
        }
      }, 1000);
    });
  } catch (error) {
    state.logger.error(`Startup failed: ${error}`);
    await shutdown();
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
