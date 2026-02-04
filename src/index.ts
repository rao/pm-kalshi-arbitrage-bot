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

import { loadConfig, type Config } from "./config/config";
import { RISK_PARAMS } from "./config/riskParams";
import { MarketDiscovery, type DiscoveryEvent } from "./markets/discovery";
import {
  MarketDataCoordinator,
  type CoordinatorEvent,
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
  acquireBusyLock,
  releaseBusyLock,
  enterCooldown,
  triggerKillSwitch,
  getDailyLoss,
  type ExecutionContext,
  type VenueClients,
  type OrderParams,
  type OrderResult,
} from "./execution";
import {
  logOpportunityDetected,
  logKillSwitch,
  logCooldownEntry,
  logExecutionError,
} from "./logging/executionLogger";

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

  // 6. Log opportunity detection
  logOpportunityDetected(opportunity, {
    polyQuote: state.quoteCache.polymarket,
    kalshiQuote: state.quoteCache.kalshi,
  });

  // 7. Execute (with null venueClients for dry run)
  // In production, venueClients would be initialized with real order placement functions
  const venueClients: VenueClients | null = config.dryRun
    ? null
    : createVenueClients();

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
    }
  } catch (error) {
    logExecutionError(
      "attemptExecution",
      error instanceof Error ? error : String(error)
    );
  }
}

/**
 * Create venue clients for live trading.
 *
 * TODO: Implement actual order placement for Polymarket and Kalshi.
 * This is a placeholder that will be filled in when we're ready for live trading.
 */
function createVenueClients(): VenueClients {
  return {
    placeOrder: async (params: OrderParams): Promise<OrderResult> => {
      // TODO: Implement actual order placement
      // For now, throw to prevent accidental live trading
      throw new Error(
        `Live trading not implemented. Would place ${params.action} ${params.side} on ${params.venue} @ ${params.price}`
      );
    },
    cancelOrder: async (venue, orderId): Promise<boolean> => {
      // TODO: Implement actual order cancellation
      throw new Error(
        `Live trading not implemented. Would cancel ${orderId} on ${venue}`
      );
    },
    getQuote: (venue) => {
      if (venue === "polymarket") {
        return state.quoteCache.polymarket;
      } else {
        return state.quoteCache.kalshi;
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
      break;

    case "ROLLOVER_COMPLETED":
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
 */
async function shutdown(): Promise<void> {
  if (!state.running) return;
  state.running = false;

  state.logger.info("Shutting down...");
  state.logger.stopStatusInterval();

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

  // Create coordinator
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
