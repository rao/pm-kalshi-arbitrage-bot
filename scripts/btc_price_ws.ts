#!/usr/bin/env bun
/**
 * BTC Price WebSocket Script.
 *
 * Connects to Polymarket RTDS and prints real-time BTC/USDT prices
 * from the Binance source.
 *
 * Usage:
 *   bun scripts/btc_price_ws.ts [--duration=60]
 */

import {
  PolymarketRtdsClient,
  type BtcPriceUpdate,
} from "../src/venues/polymarket/rtds";

// Parse command line arguments
const args = process.argv.slice(2);
const durationArg = args.find((a) => a.startsWith("--duration="));
const durationSeconds = durationArg ? parseInt(durationArg.split("=")[1], 10) : 60;

console.log("=== BTC Price WebSocket (Polymarket RTDS) ===\n");
console.log(`Duration: ${durationSeconds} seconds`);
console.log(`Source: Binance (crypto_prices / btcusdt)`);
console.log("");

// Stats tracking
let updateCount = 0;
let minPrice = Infinity;
let maxPrice = -Infinity;
let lastUpdate: BtcPriceUpdate | null = null;
const startTime = Date.now();

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function run(): Promise<void> {
  const client = new PolymarketRtdsClient({ debug: true });

  // Handle price updates
  client.onPriceUpdate((update) => {
    updateCount++;
    lastUpdate = update;

    if (update.price < minPrice) minPrice = update.price;
    if (update.price > maxPrice) maxPrice = update.price;

    const latency = update.ts_local - update.ts_exchange;
    console.log(`[BTC] ${formatPrice(update.price)} | latency=${latency}ms`);
  });

  // Handle state changes
  client.onStateChange((state) => {
    console.log(`[RTDS] Connection state: ${state}`);
  });

  // Connect
  console.log("Connecting...\n");
  try {
    await client.connect();
    console.log("Connected. Waiting for price updates...\n");
  } catch (error) {
    console.error("Failed to connect:", error);
    process.exit(1);
  }

  // Print periodic stats
  const statsInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const remaining = Math.max(0, durationSeconds - elapsed);
    console.log(`\n--- Stats (${elapsed}s elapsed, ${remaining}s remaining) ---`);
    console.log(`Updates: ${updateCount}`);
    if (updateCount > 0) {
      console.log(`Min: ${formatPrice(minPrice)}`);
      console.log(`Max: ${formatPrice(maxPrice)}`);
      console.log(`Last: ${formatPrice(lastUpdate!.price)}`);
    }
    console.log("");
  }, 15000);

  // Clean shutdown handler
  const cleanup = async () => {
    clearInterval(statsInterval);
    console.log("\n\nDisconnecting...");
    await client.disconnect();

    // Print final stats
    console.log("\n=== Final Statistics ===");
    console.log(`Duration: ${durationSeconds} seconds`);
    console.log(`Updates received: ${updateCount}`);
    if (updateCount > 0) {
      console.log(`Min price: ${formatPrice(minPrice)}`);
      console.log(`Max price: ${formatPrice(maxPrice)}`);
      console.log(`Last price: ${formatPrice(lastUpdate!.price)}`);
      const avgRate = (updateCount / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(`Avg update rate: ${avgRate}/s`);
    }
    console.log("\n=== Done ===");
  };

  // Handle SIGINT
  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });

  // Wait for duration
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationSeconds * 1000);
  });

  await cleanup();
}

// Run
run().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
