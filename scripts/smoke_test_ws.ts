#!/usr/bin/env bun
/**
 * WebSocket Smoke Test Script.
 *
 * Tests WebSocket connections to both Polymarket and Kalshi,
 * displaying real-time orderbook data.
 *
 * Usage:
 *   bun scripts/smoke_test_ws.ts [--polymarket-only] [--kalshi-only] [--duration=60]
 *
 * Environment variables:
 *   KALSHI_API_KEY - Kalshi API key ID
 *   KALSHI_PRIVATE_KEY - Kalshi private key (PEM string)
 *   KALSHI_DEMO - Set to "true" to use demo environment
 */

import { PolymarketWsClient } from "../src/venues/polymarket/ws";
import { KalshiWsClient } from "../src/venues/kalshi/ws";
import { MarketDiscovery } from "../src/markets/discovery";
import { MarketDataCoordinator } from "../src/data/marketDataCoordinator";
import { formatIntervalKey } from "../src/time/interval";
import type { QuoteUpdateEvent } from "../src/normalization/types";

// Parse command line arguments
const args = process.argv.slice(2);
const polymarketOnly = args.includes("--polymarket-only");
const kalshiOnly = args.includes("--kalshi-only");
const durationArg = args.find((a) => a.startsWith("--duration="));
const durationSeconds = durationArg ? parseInt(durationArg.split("=")[1], 10) : 60;

// Kalshi credentials from environment
const kalshiApiKey = process.env.KALSHI_API_KEY || "";
const kalshiPrivateKey = process.env.KALSHI_PRIVATE_KEY || "";
const kalshiDemo = process.env.KALSHI_DEMO === "true";

console.log("=== WebSocket Smoke Test ===\n");
console.log(`Duration: ${durationSeconds} seconds`);
console.log(`Polymarket: ${polymarketOnly ? "ONLY" : kalshiOnly ? "SKIP" : "ENABLED"}`);
console.log(`Kalshi: ${kalshiOnly ? "ONLY" : polymarketOnly ? "SKIP" : "ENABLED"}`);
console.log(`Kalshi Demo: ${kalshiDemo}`);
console.log("");

// Validate Kalshi credentials if needed
if (!polymarketOnly && (!kalshiApiKey || !kalshiPrivateKey)) {
  console.warn("WARNING: KALSHI_API_KEY or KALSHI_PRIVATE_KEY not set.");
  console.warn("Kalshi WebSocket will not be tested.\n");
}

// Counters for statistics
let polyQuoteCount = 0;
let kalshiQuoteCount = 0;
let lastPolyQuote: QuoteUpdateEvent | null = null;
let lastKalshiQuote: QuoteUpdateEvent | null = null;

function formatQuote(event: QuoteUpdateEvent): string {
  const { quote, venue, intervalKey } = event;
  const interval = formatIntervalKey(intervalKey);

  const yesBidStr = quote.yes_bid.toFixed(3);
  const yesAskStr = quote.yes_ask.toFixed(3);
  const noBidStr = quote.no_bid.toFixed(3);
  const noAskStr = quote.no_ask.toFixed(3);

  const spread = ((quote.yes_ask + quote.no_ask - 1) * 100).toFixed(1);
  const latency = quote.ts_local - quote.ts_exchange;

  return (
    `[${venue.toUpperCase()}] ${interval}\n` +
    `  YES: ${yesBidStr} / ${yesAskStr} (${quote.yes_bid_size}/${quote.yes_ask_size})\n` +
    `  NO:  ${noBidStr} / ${noAskStr} (${quote.no_bid_size}/${quote.no_ask_size})\n` +
    `  Spread: ${spread}%  Latency: ${latency}ms`
  );
}

async function runSmokeTest(): Promise<void> {
  // Determine which venues to use
  const venues: ("polymarket" | "kalshi")[] = [];
  if (!kalshiOnly) venues.push("polymarket");
  if (!polymarketOnly && kalshiApiKey && kalshiPrivateKey) venues.push("kalshi");

  if (venues.length === 0) {
    console.error("No venues configured. Exiting.");
    process.exit(1);
  }

  console.log(`Testing venues: ${venues.join(", ")}\n`);

  // Create market discovery
  const discovery = new MarketDiscovery({
    coin: "BTC",
    venues,
  });

  // Create coordinator options
  const coordinatorOptions: Parameters<typeof MarketDataCoordinator>[0] = {
    discovery,
    debug: true,
  };

  // Add Kalshi options if available
  if (venues.includes("kalshi")) {
    coordinatorOptions.kalshiWsOptions = {
      apiKeyId: kalshiApiKey,
      privateKey: kalshiPrivateKey,
      demo: kalshiDemo,
      debug: true,
    };
  }

  // Create coordinator
  const coordinator = new MarketDataCoordinator(coordinatorOptions);

  // Handle quote updates
  coordinator.onQuote((event) => {
    if (event.venue === "polymarket") {
      polyQuoteCount++;
      lastPolyQuote = event;
    } else {
      kalshiQuoteCount++;
      lastKalshiQuote = event;
    }

    console.log("\n" + formatQuote(event));
  });

  // Handle coordinator events
  coordinator.onEvent((event) => {
    switch (event.type) {
      case "CONNECTION_STATE":
        console.log(`[${event.venue.toUpperCase()}] Connection state: ${event.state}`);
        break;
      case "SUBSCRIPTION_ACTIVE":
        console.log(
          `[${event.venue.toUpperCase()}] Subscribed to ${formatIntervalKey(event.intervalKey)}`
        );
        break;
      case "ROLLOVER_STARTED":
        console.log(
          `\n=== ROLLOVER: ${formatIntervalKey(event.oldInterval)} -> ${formatIntervalKey(event.newInterval)} ===`
        );
        break;
      case "ROLLOVER_COMPLETED":
        console.log(`=== ROLLOVER COMPLETE ===\n`);
        break;
      case "ERROR":
        console.error(`[${event.venue.toUpperCase()}] Error (${event.context}):`, event.error.message);
        break;
    }
  });

  // Start coordinator
  console.log("Starting coordinator...\n");

  try {
    await coordinator.start();
    console.log("Coordinator started. Waiting for quotes...\n");
  } catch (error) {
    console.error("Failed to start coordinator:", error);
    process.exit(1);
  }

  // Run for specified duration
  const startTime = Date.now();
  const endTime = startTime + durationSeconds * 1000;

  // Print periodic stats
  const statsInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const remaining = Math.max(0, durationSeconds - elapsed);
    console.log(`\n--- Stats (${elapsed}s elapsed, ${remaining}s remaining) ---`);
    console.log(`Polymarket quotes: ${polyQuoteCount}`);
    console.log(`Kalshi quotes: ${kalshiQuoteCount}`);
  }, 15000);

  // Wait for duration
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationSeconds * 1000);
  });

  clearInterval(statsInterval);

  // Stop coordinator
  console.log("\n\nStopping coordinator...");
  await coordinator.stop();
  discovery.stop();

  // Print final stats
  console.log("\n=== Final Statistics ===");
  console.log(`Duration: ${durationSeconds} seconds`);
  console.log(`Polymarket quotes received: ${polyQuoteCount}`);
  console.log(`Kalshi quotes received: ${kalshiQuoteCount}`);

  if (lastPolyQuote) {
    console.log("\nLast Polymarket quote:");
    console.log(formatQuote(lastPolyQuote));
  }

  if (lastKalshiQuote) {
    console.log("\nLast Kalshi quote:");
    console.log(formatQuote(lastKalshiQuote));
  }

  console.log("\n=== Smoke Test Complete ===");
}

// Run the test
runSmokeTest().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
