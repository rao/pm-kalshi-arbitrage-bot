/**
 * Periodic balance monitor.
 *
 * Checks cash balances on both venues at regular intervals.
 * If either venue drops below a minimum threshold, triggers the
 * onLowBalance callback (typically kill switch).
 */

import type { Logger } from "../logging/logger";
import type { InitializedClients } from "./venueClientFactory";

const KALSHI_API_BASE = "https://api.elections.kalshi.com";

export interface BalanceMonitorOptions {
  /** Initialized venue clients */
  venueClients: InitializedClients;
  /** Logger instance */
  logger: Logger;
  /** Minimum balance in dollars before triggering low balance */
  minBalanceDollars: number;
  /** How often to check balances in ms (default: 60000) */
  intervalMs?: number;
  /** Callback when a venue has low balance */
  onLowBalance: (venue: "polymarket" | "kalshi", balance: number) => void;
  /** Callback when both venues have healthy balances (>= min) */
  onBalancesHealthy?: (kalshiBalance: number, polyBalance: number) => void;
}

let monitorInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic balance monitor.
 *
 * Checks both venues every intervalMs and calls onLowBalance if either
 * venue's cash balance drops below minBalanceDollars.
 */
export function startBalanceMonitor(options: BalanceMonitorOptions): void {
  const {
    venueClients,
    logger,
    minBalanceDollars,
    intervalMs = 60000,
    onLowBalance,
    onBalancesHealthy,
  } = options;

  if (monitorInterval) {
    logger.warn("[BALANCE] Monitor already running, stopping old one");
    stopBalanceMonitor();
  }

  logger.info(`[BALANCE] Starting balance monitor (interval=${intervalMs}ms, min=$${minBalanceDollars})`);

  // Run first check after a short delay (don't block startup)
  setTimeout(() => checkBalances(venueClients, logger, minBalanceDollars, onLowBalance, onBalancesHealthy), 5000);

  monitorInterval = setInterval(
    () => checkBalances(venueClients, logger, minBalanceDollars, onLowBalance, onBalancesHealthy),
    intervalMs
  );
}

/**
 * Stop the balance monitor.
 */
export function stopBalanceMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

/**
 * Check balances on both venues in parallel.
 */
async function checkBalances(
  venueClients: InitializedClients,
  logger: Logger,
  minBalanceDollars: number,
  onLowBalance: (venue: "polymarket" | "kalshi", balance: number) => void,
  onBalancesHealthy?: (kalshiBalance: number, polyBalance: number) => void
): Promise<void> {
  const [kalshiResult, polyResult] = await Promise.allSettled([
    venueClients.kalshi ? getKalshiBalance(venueClients) : Promise.resolve(null),
    venueClients.polymarket ? venueClients.polymarket.getCollateralBalance() : Promise.resolve(null),
  ]);

  let kalshiBalance: number | null = null;
  let polyBalance: number | null = null;

  // Process Kalshi result
  if (kalshiResult.status === "fulfilled" && kalshiResult.value !== null) {
    kalshiBalance = kalshiResult.value;
    logger.debug(`[BALANCE] Kalshi: $${kalshiBalance.toFixed(2)}`);
    if (kalshiBalance < minBalanceDollars) {
      logger.warn(`[BALANCE] Kalshi balance LOW: $${kalshiBalance.toFixed(2)} < $${minBalanceDollars}`);
      onLowBalance("kalshi", kalshiBalance);
    }
  } else if (kalshiResult.status === "rejected") {
    const err = kalshiResult.reason;
    logger.warn(`[BALANCE] Failed to check Kalshi balance: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Process Polymarket result
  if (polyResult.status === "fulfilled" && polyResult.value !== null) {
    polyBalance = polyResult.value;
    logger.debug(`[BALANCE] Polymarket: $${polyBalance.toFixed(2)}`);
    if (polyBalance < minBalanceDollars) {
      logger.warn(`[BALANCE] Polymarket balance LOW: $${polyBalance.toFixed(2)} < $${minBalanceDollars}`);
      onLowBalance("polymarket", polyBalance);
    }
  } else if (polyResult.status === "rejected") {
    const err = polyResult.reason;
    logger.warn(`[BALANCE] Failed to check Polymarket balance: ${err instanceof Error ? err.message : String(err)}`);
  }

  // If both balances are healthy, call the healthy callback
  if (
    onBalancesHealthy &&
    kalshiBalance !== null &&
    polyBalance !== null &&
    kalshiBalance >= minBalanceDollars &&
    polyBalance >= minBalanceDollars
  ) {
    onBalancesHealthy(kalshiBalance, polyBalance);
  }
}

/**
 * Get Kalshi portfolio balance in dollars.
 *
 * Kalshi returns balance in cents, so we divide by 100.
 */
async function getKalshiBalance(venueClients: InitializedClients): Promise<number> {
  if (!venueClients.kalshi) return 0;

  const path = "/trade-api/v2/portfolio/balance";
  const headers = await venueClients.kalshi.auth.getHeaders("GET", path);

  const res = await fetch(`${KALSHI_API_BASE}${path}`, {
    headers: headers as unknown as Record<string, string>,
  });

  if (!res.ok) {
    throw new Error(`Kalshi balance check failed: ${res.status}`);
  }

  const data = (await res.json()) as { balance?: number };
  // Kalshi balance is in cents
  return (data.balance ?? 0) / 100;
}
