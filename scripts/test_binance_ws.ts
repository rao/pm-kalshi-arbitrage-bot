#!/usr/bin/env bun
/**
 * Test script for the Binance WebSocket client.
 *
 * Streams:
 * 1. btcusdt@aggTrade (Futures) — real-time trade prices
 * 2. btcusdt@depth@100ms (Spot) — diff depth + REST sync local order book
 * 3. btcusdt@bookTicker (Spot) — real-time BBO
 * 4. btcusdt@depth5@100ms (Spot) — top 5 depth levels
 * 5. usdcusdt@bookTicker (Spot) — USDT/USD basis estimation
 *
 * Usage:
 *   bun scripts/test_binance_ws.ts
 */

import {
  BinanceWsClient,
  type BtcPriceUpdate,
  type TopOfBook,
  type BookTickerUpdate,
  type PartialDepthUpdate,
} from "../src/data/binanceWs";

const DURATION_SECONDS = 30;

console.log("=== Binance WebSocket Test (5 streams) ===\n");
console.log(`Duration: ${DURATION_SECONDS} seconds`);
console.log(`Streams: aggTrade + depth + bookTicker + depth5 + usdcusdt@bookTicker\n`);

let priceUpdateCount = 0;
let bookUpdateCount = 0;
let bookTickerCount = 0;
let depth5Count = 0;
let usdcBookTickerCount = 0;
const startTime = Date.now();

let lastBookLogTs = 0;
let lastBboLogTs = 0;
let lastDepth5LogTs = 0;
let lastUsdcLogTs = 0;
const BOOK_LOG_THROTTLE_MS = 200;

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function run(): Promise<void> {
  const client = new BinanceWsClient({
    debug: true,
    enableOrderBook: true,
    enableBookTicker: true,
    enableDepth5: true,
    enableUsdcBookTicker: true,
    printIntervalMs: -1,
  });

  client.onPriceUpdate((update: BtcPriceUpdate) => {
    priceUpdateCount++;
    const latency = update.ts_local - update.ts_exchange;
    console.log(
      `[PRICE #${priceUpdateCount}] ${formatPrice(update.price)} | exchange_ts=${update.ts_exchange} | latency=${latency}ms`
    );
  });

  client.onOrderBookUpdate((tob: TopOfBook) => {
    bookUpdateCount++;

    const now = Date.now();
    if (now - lastBookLogTs < BOOK_LOG_THROTTLE_MS) return;
    lastBookLogTs = now;

    const bid = formatPrice(tob.bestBid);
    const ask = formatPrice(tob.bestAsk);
    const spread = tob.spread.toFixed(2);
    const syncState = client.getOrderBookSyncState();

    console.log(
      `[BOOK ] ${bid} / ${ask} | spread: $${spread} | depth: ${tob.bidDepth}b/${tob.askDepth}a | sync: ${syncState}`
    );
  });

  client.onBookTicker((update: BookTickerUpdate) => {
    bookTickerCount++;

    const now = Date.now();
    if (now - lastBboLogTs < BOOK_LOG_THROTTLE_MS) return;
    lastBboLogTs = now;

    const bid = formatPrice(update.bestBid);
    const ask = formatPrice(update.bestAsk);
    const spread = (update.bestAsk - update.bestBid).toFixed(2);

    console.log(`[BBO  ] ${bid} / ${ask} (spread: $${spread})`);
  });

  client.onDepth5((update: PartialDepthUpdate) => {
    depth5Count++;

    const now = Date.now();
    if (now - lastDepth5LogTs < BOOK_LOG_THROTTLE_MS) return;
    lastDepth5LogTs = now;

    const bids = update.bids.map((l) => l.price.toFixed(2)).join(", ");
    const asks = update.asks.map((l) => l.price.toFixed(2)).join(", ");

    console.log(`[DEP5 ] bids: [${bids}] | asks: [${asks}]`);
  });

  client.onUsdcBookTicker((update: BookTickerUpdate) => {
    usdcBookTickerCount++;

    const now = Date.now();
    if (now - lastUsdcLogTs < BOOK_LOG_THROTTLE_MS) return;
    lastUsdcLogTs = now;

    const bid = update.bestBid.toFixed(4);
    const ask = update.bestAsk.toFixed(4);
    const spread = (update.bestAsk - update.bestBid).toFixed(4);

    console.log(`[USDC ] $${bid} / $${ask} (spread: $${spread})`);
  });

  client.onStateChange((state) => {
    console.log(`[STATE] ${state}`);
  });

  console.log("Connecting...\n");
  try {
    await client.connect();
    console.log("Connected! Streaming all 5 feeds...\n");
  } catch (error) {
    console.error("Failed to connect:", error);
    process.exit(1);
  }

  // Handle SIGINT for early exit
  process.on("SIGINT", async () => {
    console.log("\n\nInterrupted — disconnecting...");
    printStats(client);
    await client.disconnect();
    process.exit(0);
  });

  // Wait for duration
  await new Promise<void>((resolve) => setTimeout(resolve, DURATION_SECONDS * 1000));

  console.log("\n\nDuration reached — disconnecting...");
  printStats(client);
  await client.disconnect();
}

function printStats(client: BinanceWsClient): void {
  const elapsedMs = Date.now() - startTime;
  const elapsedS = elapsedMs / 1000;
  const elapsed = elapsedS.toFixed(1);

  const priceRate = (priceUpdateCount / elapsedS).toFixed(1);
  const bookRate = (bookUpdateCount / elapsedS).toFixed(1);
  const bboRate = (bookTickerCount / elapsedS).toFixed(1);
  const dep5Rate = (depth5Count / elapsedS).toFixed(1);
  const usdcRate = (usdcBookTickerCount / elapsedS).toFixed(1);

  console.log("\n=== Results ===");
  console.log(`Elapsed: ${elapsed}s`);
  console.log(`Price updates:       ${priceUpdateCount} (${priceRate}/s)`);
  console.log(`Book updates:        ${bookUpdateCount} (${bookRate}/s)`);
  console.log(`BookTicker updates:  ${bookTickerCount} (${bboRate}/s)`);
  console.log(`Depth5 updates:      ${depth5Count} (${dep5Rate}/s)`);
  console.log(`USDC BT updates:     ${usdcBookTickerCount} (${usdcRate}/s)`);

  // Order book final state
  const syncState = client.getOrderBookSyncState();
  const tob = client.getTopOfBook();
  console.log(`\nOrder book sync state: ${syncState}`);
  if (tob) {
    console.log(`Final top-of-book:`);
    console.log(`  Best bid: ${formatPrice(tob.bestBid)} (${tob.bestBidQty} BTC)`);
    console.log(`  Best ask: ${formatPrice(tob.bestAsk)} (${tob.bestAskQty} BTC)`);
    console.log(`  Spread:   $${tob.spread.toFixed(2)}`);
    console.log(`  Depth:    ${tob.bidDepth} bids, ${tob.askDepth} asks`);
  } else {
    console.log(`Final top-of-book: N/A (book not synced)`);
  }

  // Aux stream final state
  const bbo = client.getLatestBookTicker();
  if (bbo) {
    console.log(`\nFinal BBO: ${formatPrice(bbo.bestBid)} / ${formatPrice(bbo.bestAsk)}`);
  }
  const dep5 = client.getLatestDepth5();
  if (dep5) {
    console.log(`Final Depth5: ${dep5.bids.length} bid levels, ${dep5.asks.length} ask levels`);
  }
  const usdc = client.getLatestUsdcBookTicker();
  if (usdc) {
    console.log(`Final USDC BBO: $${usdc.bestBid.toFixed(4)} / $${usdc.bestAsk.toFixed(4)}`);
  }

  console.log("=== Done ===");
}

run().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
