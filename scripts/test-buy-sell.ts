#!/usr/bin/env bun
/**
 * Test script that:
 * 1. Places a BUY order at the ask price (to ensure fill)
 * 2. Waits for fill confirmation
 * 3. Immediately sells the position
 */

import { Wallet } from "@ethersproject/wallet";
import { ClobClient, Side, OrderType, Chain } from "@polymarket/clob-client";
import { SignatureType } from "@polymarket/order-utils";
import { GammaClient } from "../src/venues/polymarket/gamma";

// Configuration from environment
const HOST = process.env.POLYMARKET_CLOB_HOST || "https://clob.polymarket.com";
const PRIVATE_KEY = process.env.POLYMARKET_WALLET_PRIVATE_KEY || process.env.POLYMARKET_PRIVATE_KEY;
const FUNDER_ADDRESS = process.env.POLYMARKET_FUNDER_ADDRESS;
const SIGNATURE_TYPE = parseInt(process.env.POLYMARKET_SIGNATURE_TYPE || "2", 10) as SignatureType;

function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data !== undefined) {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getOrderBook(tokenId: string): Promise<{ bids: Array<{price: string, size: string}>, asks: Array<{price: string, size: string}> }> {
  const response = await fetch(`${HOST}/book?token_id=${tokenId}`);
  return response.json();
}

async function main() {
  log("=== Buy & Sell Test ===");
  log("Will buy at ask (market take), then immediately sell at bid\n");

  // Validate environment
  if (!PRIVATE_KEY) {
    console.error("ERROR: POLYMARKET_WALLET_PRIVATE_KEY not set");
    process.exit(1);
  }
  if (!FUNDER_ADDRESS) {
    console.error("ERROR: POLYMARKET_FUNDER_ADDRESS not set");
    process.exit(1);
  }

  const pk = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  const wallet = new Wallet(pk);

  log("Configuration:", {
    host: HOST,
    signatureType: SIGNATURE_TYPE,
    funderAddress: FUNDER_ADDRESS,
    signerAddress: wallet.address,
  });

  // Step 1: Discover current market
  log("\n--- Step 1: Discover Current Market ---");
  const gamma = new GammaClient();
  const market = await gamma.getCurrentMarket("BTC");

  if (!market) {
    console.error("ERROR: No active BTC market found");
    process.exit(1);
  }

  log("Found market:", {
    slug: market.slug,
    question: market.question,
  });

  // Get orderbook to find best prices
  const tokenId = market.tokenIds.up; // Trading the "Up" outcome
  log("\n--- Step 2: Get Order Book ---");
  const book = await getOrderBook(tokenId);

  if (!book.asks || book.asks.length === 0) {
    console.error("ERROR: No asks in orderbook");
    process.exit(1);
  }
  if (!book.bids || book.bids.length === 0) {
    console.error("ERROR: No bids in orderbook");
    process.exit(1);
  }

  const bestAsk = parseFloat(book.asks[0].price);
  const bestBid = parseFloat(book.bids[0].price);
  const askSize = parseFloat(book.asks[0].size);
  const bidSize = parseFloat(book.bids[0].size);

  log("Order book:", {
    bestBid: bestBid,
    bestAsk: bestAsk,
    bidSize: bidSize,
    askSize: askSize,
    spread: (bestAsk - bestBid).toFixed(4),
  });

  // Calculate order size (minimum 5, max available)
  const orderSize = Math.min(5, Math.floor(askSize), Math.floor(bidSize));
  if (orderSize < 5) {
    console.error(`ERROR: Insufficient liquidity. Need at least 5 contracts, but ask has ${askSize}, bid has ${bidSize}`);
    process.exit(1);
  }

  const buyCost = bestAsk * orderSize;
  const sellProceeds = bestBid * orderSize;
  const expectedLoss = buyCost - sellProceeds;

  log("\nTrade plan:", {
    tokenId: tokenId.substring(0, 30) + "...",
    orderSize: orderSize,
    buyPrice: bestAsk,
    sellPrice: bestBid,
    buyCost: `$${buyCost.toFixed(2)}`,
    sellProceeds: `$${sellProceeds.toFixed(2)}`,
    expectedLoss: `$${expectedLoss.toFixed(2)} (spread cost)`,
  });

  // Step 3: Initialize client
  log("\n--- Step 3: Initialize Client ---");
  const tempClient = new ClobClient(
    HOST,
    Chain.POLYGON,
    wallet,
    undefined,
    SIGNATURE_TYPE,
    FUNDER_ADDRESS
  );

  const creds = await tempClient.createOrDeriveApiKey();
  log("Credentials obtained");

  const client = new ClobClient(
    HOST,
    Chain.POLYGON,
    wallet,
    creds,
    SIGNATURE_TYPE,
    FUNDER_ADDRESS
  );

  // Step 4: Place BUY order at ask price (market take)
  log("\n--- Step 4: Place BUY Order (Market Take) ---");
  log(`Buying ${orderSize} contracts @ $${bestAsk} (taking the ask)`);

  const buyResult = await client.createAndPostOrder(
    {
      tokenID: tokenId,
      price: bestAsk,
      size: orderSize,
      side: Side.BUY,
    },
    { tickSize: "0.01", negRisk: false },
    OrderType.FOK // Fill-or-Kill to ensure immediate fill
  );

  log("Buy order result:", buyResult);

  if (!buyResult.success) {
    console.error("ERROR: Buy order failed:", buyResult.errorMsg || buyResult);
    process.exit(1);
  }

  log("\n=== BUY ORDER FILLED ===");
  log(`Order ID: ${buyResult.orderID}`);
  log(`Transaction: ${buyResult.transactionsHashes?.[0] || 'N/A'}`);

  // Wait for on-chain settlement
  log("\nWaiting 10 seconds for on-chain settlement...");
  await sleep(10000);

  // Refresh the orderbook for current prices
  log("\n--- Refreshing Order Book ---");
  const updatedBook = await getOrderBook(tokenId);
  const currentBid = parseFloat(updatedBook.bids[0]?.price || "0");
  log(`Current best bid: $${currentBid}`);

  // Step 5: Check balance before selling
  log("\n--- Step 5: Check Balance ---");
  try {
    const balanceResult = await fetch(`${HOST}/balance?asset_type=CONDITIONAL&asset_id=${tokenId}`, {
      headers: {
        "POLY_ADDRESS": wallet.address,
        "POLY_API_KEY": creds.key,
        "POLY_PASSPHRASE": creds.passphrase,
        "POLY_TIMESTAMP": `${Math.floor(Date.now() / 1000)}`,
        "POLY_SIGNATURE": "dummy", // Will use proper signing if needed
      }
    });
    const balance = await balanceResult.json();
    log("Balance check:", balance);
  } catch (e) {
    log("Balance check failed (continuing anyway):", e);
  }

  // Step 6: Place SELL order at bid price (market take)
  log("\n--- Step 6: Place SELL Order (Market Take) ---");
  const sellPrice = currentBid > 0 ? currentBid : bestBid;
  log(`Selling ${orderSize} contracts @ $${sellPrice} (hitting the bid)`);

  const sellResult = await client.createAndPostOrder(
    {
      tokenID: tokenId,
      price: sellPrice,
      size: orderSize,
      side: Side.SELL,
    },
    { tickSize: "0.01", negRisk: false },
    OrderType.GTC // Use GTC in case FOK has timing issues
  );

  log("Sell order result:", sellResult);

  if (!sellResult.success) {
    console.error("ERROR: Sell order failed:", sellResult.errorMsg || sellResult);
    console.error("You may have an open position that needs manual closing!");
    process.exit(1);
  }

  log("\n=== SELL ORDER FILLED ===");
  log(`Order ID: ${sellResult.orderID}`);

  // Summary
  log("\n" + "=".repeat(50));
  log("=== ROUND TRIP COMPLETE ===");
  log("=".repeat(50));
  log(`Bought ${orderSize} @ $${bestAsk} = $${buyCost.toFixed(2)}`);
  log(`Sold ${orderSize} @ $${bestBid} = $${sellProceeds.toFixed(2)}`);
  log(`Net cost (spread): $${expectedLoss.toFixed(2)}`);
  log("\nCheck your Polymarket positions to confirm!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
