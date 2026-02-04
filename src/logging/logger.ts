/**
 * Structured logger for arbitrage bot.
 *
 * Provides:
 * - Leveled logging (debug, info, warn, error)
 * - Quote tracking without per-quote spam
 * - Periodic status updates
 * - Opportunity alerts
 */

import type { NormalizedQuote, QuoteUpdateEvent } from "../normalization/types";
import type { Opportunity } from "../strategy/types";
import type { EdgeResult } from "../fees/edge";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Quote statistics for periodic reporting.
 */
export interface QuoteStats {
  polymarketCount: number;
  kalshiCount: number;
  lastPolyQuote: NormalizedQuote | null;
  lastKalshiQuote: NormalizedQuote | null;
  periodStart: number;
}

/**
 * Logger interface.
 */
export interface Logger {
  debug(msg: string, data?: object): void;
  info(msg: string, data?: object): void;
  warn(msg: string, data?: object): void;
  error(msg: string, data?: object): void;

  /** Log an opportunity detection */
  logOpportunity(opp: Opportunity): void;

  /** Track a quote update (internal, not logged per-quote) */
  trackQuote(event: QuoteUpdateEvent): void;

  /** Update the last computed edge (internal, not logged) */
  updateEdge(computedEdge: EdgeResult | null): void;

  /** Log periodic status report */
  logQuoteStatus(): void;

  /** Start periodic status logging */
  startStatusInterval(intervalMs?: number): void;

  /** Stop periodic status logging */
  stopStatusInterval(): void;

  /** Get current quote stats */
  getQuoteStats(): QuoteStats;

  /** Reset quote stats for new period */
  resetQuoteStats(): void;
}

/**
 * Format a timestamp for logging.
 */
function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Format a quote for display.
 */
function formatQuote(venue: string, quote: NormalizedQuote | null): string {
  if (!quote) return `${venue}: no data`;
  return (
    `${venue}: YES ${quote.yes_bid.toFixed(3)}/${quote.yes_ask.toFixed(3)}, ` +
    `NO ${quote.no_bid.toFixed(3)}/${quote.no_ask.toFixed(3)}`
  );
}

/**
 * Create a logger instance.
 */
export function createLogger(level: LogLevel = "info"): Logger {
  const minLevel = LOG_LEVEL_VALUES[level];
  let statusIntervalId: ReturnType<typeof setInterval> | null = null;
  let lastComputedEdge: EdgeResult | null = null;

  const stats: QuoteStats = {
    polymarketCount: 0,
    kalshiCount: 0,
    lastPolyQuote: null,
    lastKalshiQuote: null,
    periodStart: Date.now(),
  };

  function shouldLog(msgLevel: LogLevel): boolean {
    return LOG_LEVEL_VALUES[msgLevel] >= minLevel;
  }

  function formatData(data?: object): string {
    if (!data) return "";
    try {
      return " " + JSON.stringify(data);
    } catch {
      return "";
    }
  }

  function log(msgLevel: LogLevel, prefix: string, msg: string, data?: object): void {
    if (!shouldLog(msgLevel)) return;
    console.log(`[${formatTimestamp()}] ${prefix} ${msg}${formatData(data)}`);
  }

  const logger: Logger = {
    debug(msg: string, data?: object) {
      log("debug", "[DEBUG]", msg, data);
    },

    info(msg: string, data?: object) {
      log("info", "[INFO]", msg, data);
    },

    warn(msg: string, data?: object) {
      log("warn", "[WARN]", msg, data);
    },

    error(msg: string, data?: object) {
      log("error", "[ERROR]", msg, data);
    },

    logOpportunity(opp: Opportunity) {
      console.log("");
      console.log("=".repeat(60));
      console.log(`[${formatTimestamp()}] [OPPORTUNITY] ARBITRAGE FOUND`);
      console.log(`  ${opp.reason}`);
      console.log(
        `  Cost: $${opp.cost.toFixed(3)} | ` +
          `Gross: $${opp.edgeGross.toFixed(3)} | ` +
          `Net: $${opp.edgeNet.toFixed(3)}`
      );
      console.log(`  YES leg: ${opp.legs[0].venue} @ ${opp.legs[0].price.toFixed(3)}`);
      console.log(`  NO leg:  ${opp.legs[1].venue} @ ${opp.legs[1].price.toFixed(3)}`);
      console.log("=".repeat(60));
      console.log("");
    },

    trackQuote(event: QuoteUpdateEvent) {
      if (event.venue === "polymarket") {
        stats.polymarketCount++;
        stats.lastPolyQuote = event.quote;
      } else if (event.venue === "kalshi") {
        stats.kalshiCount++;
        stats.lastKalshiQuote = event.quote;
      }
    },

    updateEdge(computedEdge: EdgeResult | null) {
      lastComputedEdge = computedEdge;
    },

    logQuoteStatus() {
      const elapsed = Math.round((Date.now() - stats.periodStart) / 1000);
      console.log("");
      console.log(
        `[${formatTimestamp()}] [STATUS] ${elapsed}s stats: ` +
          `Polymarket=${stats.polymarketCount} quotes, ` +
          `Kalshi=${stats.kalshiCount} quotes`
      );
      console.log(`  ${formatQuote("POLY", stats.lastPolyQuote)}`);
      console.log(`  ${formatQuote("KALSHI", stats.lastKalshiQuote)}`);

      if (lastComputedEdge) {
        const bestCost =
          stats.lastPolyQuote && stats.lastKalshiQuote
            ? Math.min(
                stats.lastPolyQuote.yes_ask + stats.lastKalshiQuote.no_ask,
                stats.lastKalshiQuote.yes_ask + stats.lastPolyQuote.no_ask
              )
            : null;

        console.log(
          `  Best box: ${bestCost?.toFixed(3) ?? "N/A"} | ` +
            `Edge: gross=${lastComputedEdge.edgeGross.toFixed(3)}, ` +
            `net=${lastComputedEdge.edgeNet.toFixed(3)}`
        );
      } else if (stats.lastPolyQuote && stats.lastKalshiQuote) {
        const cost1 = stats.lastPolyQuote.yes_ask + stats.lastKalshiQuote.no_ask;
        const cost2 = stats.lastKalshiQuote.yes_ask + stats.lastPolyQuote.no_ask;
        const bestCost = Math.min(cost1, cost2);
        console.log(`  Best box cost: ${bestCost.toFixed(3)} (edge not computed)`);
      }
      console.log("");

      // Reset stats for next period
      logger.resetQuoteStats();
    },

    startStatusInterval(intervalMs: number = 60000) {
      if (statusIntervalId) return;
      statusIntervalId = setInterval(() => {
        logger.logQuoteStatus();
      }, intervalMs);
    },

    stopStatusInterval() {
      if (statusIntervalId) {
        clearInterval(statusIntervalId);
        statusIntervalId = null;
      }
    },

    getQuoteStats(): QuoteStats {
      return { ...stats };
    },

    resetQuoteStats() {
      stats.polymarketCount = 0;
      stats.kalshiCount = 0;
      stats.periodStart = Date.now();
      // Keep last quotes for reference
    },
  };

  return logger;
}
