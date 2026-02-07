#!/usr/bin/env bun
/**
 * Test script for the Binance aggTrade WebSocket client.
 *
 * Connects to Binance Futures, prints live BTC/USDT trade prices
 * for ~30 seconds, then cleanly disconnects.
 *
 * Usage:
 *   bun scripts/test_binance_ws.ts
 */

import { BinanceWsClient, type BtcPriceUpdate } from "../src/data/binanceWs";

const DURATION_SECONDS = 30;

console.log("=== Binance aggTrade WebSocket Test ===\n");
console.log(`Duration: ${DURATION_SECONDS} seconds`);
console.log(`Stream: btcusdt@aggTrade (Binance Futures)\n`);

let updateCount = 0;
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
  const client = new BinanceWsClient({ debug: true });

  client.onPriceUpdate((update: BtcPriceUpdate) => {
    updateCount++;
    const latency = update.ts_local - update.ts_exchange;
    console.log(
      `[${updateCount}] ${formatPrice(update.price)} | exchange_ts=${update.ts_exchange} | latency=${latency}ms`
    );
  });

  client.onStateChange((state) => {
    console.log(`[STATE] ${state}`);
  });

  console.log("Connecting...\n");
  try {
    await client.connect();
    console.log("Connected! Streaming prices...\n");
  } catch (error) {
    console.error("Failed to connect:", error);
    process.exit(1);
  }

  // Handle SIGINT for early exit
  process.on("SIGINT", async () => {
    console.log("\n\nInterrupted — disconnecting...");
    await client.disconnect();
    printStats();
    process.exit(0);
  });

  // Wait for duration
  await new Promise<void>((resolve) => setTimeout(resolve, DURATION_SECONDS * 1000));

  console.log("\n\nDuration reached — disconnecting...");
  await client.disconnect();
  printStats();
}

function printStats(): void {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = (updateCount / ((Date.now() - startTime) / 1000)).toFixed(1);
  console.log("\n=== Results ===");
  console.log(`Total updates: ${updateCount}`);
  console.log(`Elapsed: ${elapsed}s`);
  console.log(`Avg rate: ${rate} updates/s`);
  console.log("=== Done ===");
}

run().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
