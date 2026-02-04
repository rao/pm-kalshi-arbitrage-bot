/**
 * Configuration module for the arbitrage bot.
 *
 * Loads configuration from environment variables (Bun auto-loads .env).
 */

export interface Config {
  /** Gamma API host URL (Polymarket) */
  gammaApiHost: string;
  /** Polymarket CLOB API host URL */
  polymarketClobHost: string;
  /** Kalshi API host URL */
  kalshiApiHost: string;
  /** Logging level */
  logLevel: "debug" | "info" | "warn" | "error";
  /** Dry run mode - log only, no real trades */
  dryRun: boolean;

  // Kalshi credentials
  /** Kalshi API key ID */
  kalshiApiKeyId?: string;
  /** Path to Kalshi private key file */
  kalshiPrivateKeyPath?: string;

  // Polymarket credentials
  /** Polymarket signer private key (0x-prefixed hex) */
  polymarketPrivateKey?: string;
  /** Polymarket funder/proxy wallet address */
  polymarketFunderAddress?: string;
  /** Polymarket API key (derived from L1 auth) */
  polymarketApiKey?: string;
  /** Polymarket API secret (derived from L1 auth) */
  polymarketApiSecret?: string;
  /** Polymarket API passphrase (derived from L1 auth) */
  polymarketApiPassphrase?: string;
}

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

function isLogLevel(value: string): value is LogLevel {
  return LOG_LEVELS.includes(value as LogLevel);
}

/**
 * Load configuration from environment variables.
 *
 * Environment variables:
 * - GAMMA_API_HOST: Gamma API host URL (default: https://gamma-api.polymarket.com)
 * - POLYMARKET_CLOB_HOST: Polymarket CLOB API host (default: https://clob.polymarket.com)
 * - KALSHI_API_HOST: Kalshi API host URL (default: https://api.elections.kalshi.com)
 * - LOG_LEVEL: Logging level (default: info)
 * - DRY_RUN: Dry run mode (default: true)
 *
 * Kalshi credentials:
 * - KALSHI_API_KEY_ID or KALSHI_API_KEY: Kalshi API key ID
 * - KALSHI_PRIVATE_KEY_PATH or KALSHI_PRIVATE_KEY: Path to key file or inline PEM key
 *
 * Polymarket credentials:
 * - POLYMARKET_PRIVATE_KEY: Signer private key (0x-prefixed hex) - for order signing
 * - POLYMARKET_FUNDER_ADDRESS or POLY_WALLET_ADDRESS: Funder/proxy wallet address
 * - POLYMARKET_API_KEY or POLY_API_KEY: API key
 * - POLYMARKET_API_SECRET or POLY_SECRET: API secret
 * - POLYMARKET_API_PASSPHRASE or POLY_PASSPHRASE: API passphrase
 */
export function loadConfig(): Config {
  const gammaApiHost =
    process.env.GAMMA_API_HOST || "https://gamma-api.polymarket.com";

  const polymarketClobHost =
    process.env.POLYMARKET_CLOB_HOST || "https://clob.polymarket.com";

  const kalshiApiHost =
    process.env.KALSHI_API_HOST || "https://api.elections.kalshi.com";

  const logLevelRaw = (process.env.LOG_LEVEL || "info").toLowerCase();
  const logLevel: LogLevel = isLogLevel(logLevelRaw) ? logLevelRaw : "info";

  // Default to true for safety - must explicitly set to "false" to disable
  const dryRunRaw = process.env.DRY_RUN?.toLowerCase();
  const dryRun = dryRunRaw !== "false";

  return {
    gammaApiHost: gammaApiHost.replace(/\/$/, ""), // Remove trailing slash
    polymarketClobHost: polymarketClobHost.replace(/\/$/, ""),
    kalshiApiHost: kalshiApiHost.replace(/\/$/, ""),
    logLevel,
    dryRun,

    // Kalshi credentials
    // Accepts either KALSHI_API_KEY_ID or KALSHI_API_KEY
    kalshiApiKeyId: process.env.KALSHI_API_KEY_ID || process.env.KALSHI_API_KEY,
    // Accepts either path to key file or inline PEM key
    kalshiPrivateKeyPath:
      process.env.KALSHI_PRIVATE_KEY_PATH || process.env.KALSHI_PRIVATE_KEY,

    // Polymarket credentials
    polymarketPrivateKey: process.env.POLYMARKET_PRIVATE_KEY,
    // Accepts either POLYMARKET_FUNDER_ADDRESS or POLY_WALLET_ADDRESS
    polymarketFunderAddress:
      process.env.POLYMARKET_FUNDER_ADDRESS || process.env.POLY_WALLET_ADDRESS,
    // Accepts either POLYMARKET_API_KEY or POLY_API_KEY
    polymarketApiKey: process.env.POLYMARKET_API_KEY || process.env.POLY_API_KEY,
    polymarketApiSecret:
      process.env.POLYMARKET_API_SECRET || process.env.POLY_SECRET,
    polymarketApiPassphrase:
      process.env.POLYMARKET_API_PASSPHRASE || process.env.POLY_PASSPHRASE,
  };
}

/**
 * Check if Kalshi credentials are configured.
 */
export function hasKalshiCredentials(config: Config): boolean {
  return !!(config.kalshiApiKeyId && config.kalshiPrivateKeyPath);
}

/**
 * Check if Polymarket credentials are configured.
 *
 * Returns true if either:
 * 1. Full API credentials are provided (apiKey, secret, passphrase)
 * 2. Private key is provided (can derive credentials)
 */
export function hasPolymarketCredentials(config: Config): boolean {
  // Check for full API credentials
  if (
    config.polymarketApiKey &&
    config.polymarketApiSecret &&
    config.polymarketApiPassphrase &&
    config.polymarketFunderAddress
  ) {
    return true;
  }

  // Check for derivable credentials
  if (config.polymarketPrivateKey && config.polymarketFunderAddress) {
    return true;
  }

  return false;
}
