#!/usr/bin/env bun
/**
 * Complete round-trip test:
 * 1. Buy at the ask (market take)
 * 2. Immediately sell at the bid (market take)
 * All on the same market before it expires
 */

import { Wallet } from "@ethersproject/wallet";
import { ClobClient, Side, OrderType, Chain } from "@polymarket/clob-client";
import { SignatureType } from "@polymarket/order-utils";
import { GammaClient } from "../src/venues/polymarket/gamma";
import { msUntilRollover } from "../src/time/interval";

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

async function getOrderBook(tokenId: string) {
  const response = await fetch(`${HOST}/book?token_id=${tokenId}`);
  return response.json();
}

async function main() {
  log("=== Round-Trip Test ===");
  log("Buy at ask, then immediately sell at bid\n");

  if (!PRIVATE_KEY || !FUNDER_ADDRESS) {
    console.error("ERROR: Missing env vars");
    process.exit(1);
  }

  const pk = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  const wallet = new Wallet(pk);

  // Check time until rollover
  const msLeft = msUntilRollover();
  const secondsLeft = Math.floor(msLeft / 1000);
  log(`Time until market rollover: ${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s`);

  if (secondsLeft < 30) {
    console.error("ERROR: Less than 30 seconds until rollover - too risky. Wait for next interval.");
    process.exit(1);
  }

  // Get current market
  log("\n--- Step 1: Get Current Market ---");
  const gamma = new GammaClient();
  const market = await gamma.getCurrentMarket("BTC");

  if (!market) {
    console.error("ERROR: No active market");
    process.exit(1);
  }

  log("Market:", {
    slug: market.slug,
    question: market.question,
  });

  // Get orderbook for both tokens, pick the one with tighter spread
  log("\n--- Step 2: Get Order Books ---");

  const upBook = await getOrderBook(market.tokenIds.up);
  const downBook = await getOrderBook(market.tokenIds.down);

  const upAsk = parseFloat(upBook.asks?.[0]?.price || "0");
  const upBid = parseFloat(upBook.bids?.[0]?.price || "0");
  const downAsk = parseFloat(downBook.asks?.[0]?.price || "0");
  const downBid = parseFloat(downBook.bids?.[0]?.price || "0");

  log("UP token:", { bid: upBid, ask: upAsk, spread: (upAsk - upBid).toFixed(4) });
  log("DOWN token:", { bid: downBid, ask: downAsk, spread: (downAsk - downBid).toFixed(4) });

  // Pick token with tighter spread (in absolute terms)
  const upSpread = upAsk - upBid;
  const downSpread = downAsk - downBid;

  const useUp = upSpread <= downSpread;
  const tokenId = useUp ? market.tokenIds.up : market.tokenIds.down;
  const tokenName = useUp ? "UP" : "DOWN";
  const book = useUp ? upBook : downBook;

  log(`\nUsing ${tokenName} token (tighter spread)`);

  const bestAsk = parseFloat(book.asks?.[0]?.price || "0");
  const askSize = parseFloat(book.asks?.[0]?.size || "0");
  const bestBid = parseFloat(book.bids?.[0]?.price || "0");
  const bidSize = parseFloat(book.bids?.[0]?.size || "0");

  log("Order book:", {
    bestBid,
    bidSize,
    bestAsk,
    askSize,
    spread: (bestAsk - bestBid).toFixed(4),
  });

  if (bestAsk === 0 || bestBid === 0) {
    console.error("ERROR: No liquidity");
    process.exit(1);
  }

  const orderSize = 5; // Minimum size
  const expectedCost = bestAsk * orderSize;
  const expectedProceeds = bestBid * orderSize;
  const expectedLoss = expectedCost - expectedProceeds;

  log("\nTrade plan:", {
    side: tokenName,
    orderSize,
    buyAt: bestAsk,
    sellAt: bestBid,
    expectedCost: `$${expectedCost.toFixed(2)}`,
    expectedProceeds: `$${expectedProceeds.toFixed(2)}`,
    expectedLoss: `$${expectedLoss.toFixed(2)} (spread)`,
  });

  if (expectedLoss > 5.00) {
    console.error(`ERROR: Spread too wide - would lose $${expectedLoss.toFixed(2)}`);
    process.exit(1);
  }

  log(`\n*** WARNING: This test will cost ~$${expectedLoss.toFixed(2)} in spread ***`);

  // Initialize client
  log("\n--- Step 3: Initialize Client ---");
  const tempClient = new ClobClient(HOST, Chain.POLYGON, wallet, undefined, SIGNATURE_TYPE, FUNDER_ADDRESS);
  const creds = await tempClient.createOrDeriveApiKey();
  const client = new ClobClient(HOST, Chain.POLYGON, wallet, creds, SIGNATURE_TYPE, FUNDER_ADDRESS);
  log("Client ready");

  // Step 4: BUY
  log("\n--- Step 4: BUY at Ask ---");
  log(`Buying ${orderSize} ${tokenName} @ $${bestAsk}`);

  const buyResult = await client.createAndPostOrder(
    { tokenID: tokenId, price: bestAsk, size: orderSize, side: Side.BUY },
    { tickSize: "0.01", negRisk: false },
    OrderType.FOK
  );

  log("Buy result:", buyResult);

  if (!buyResult.success) {
    console.error("ERROR: Buy failed:", buyResult.errorMsg || buyResult);
    process.exit(1);
  }

  log("\n*** BUY FILLED ***");
  log(`Order ID: ${buyResult.orderID}`);
  log(`Tx: ${buyResult.transactionsHashes?.[0]}`);

  // Wait for settlement
  log("\nWaiting 5 seconds for settlement...");
  await sleep(5000);

  // Refresh book
  const book2 = await getOrderBook(tokenId);
  const currentBid = parseFloat(book2.bids?.[0]?.price || "0");
  log(`Current bid: $${currentBid}`);

  // Step 5: SELL
  log("\n--- Step 5: SELL at Bid ---");
  const sellPrice = Math.max(currentBid, 0.01); // At least 1 cent
  log(`Selling ${orderSize} ${tokenName} @ $${sellPrice}`);

  const sellResult = await client.createAndPostOrder(
    { tokenID: tokenId, price: sellPrice, size: orderSize, side: Side.SELL },
    { tickSize: "0.01", negRisk: false },
    OrderType.FOK
  );

  log("Sell result:", sellResult);

  if (!sellResult.success) {
    // Try GTC if FOK fails
    log("\nFOK failed, trying GTC order...");
    const sellResult2 = await client.createAndPostOrder(
      { tokenID: tokenId, price: sellPrice, size: orderSize, side: Side.SELL },
      { tickSize: "0.01", negRisk: false },
      OrderType.GTC
    );
    log("GTC Sell result:", sellResult2);

    if (!sellResult2.success) {
      console.error("\n*** SELL FAILED - You have an open position! ***");
      console.error("Token ID:", tokenId);
      console.error("Size:", orderSize);
      console.error("Check Polymarket UI to close it manually.");
      process.exit(1);
    }

    log("\n*** SELL ORDER PLACED (GTC) ***");
    log(`Order ID: ${sellResult2.orderID}`);
    log(`Status: ${sellResult2.status}`);
  } else {
    log("\n*** SELL FILLED ***");
    log(`Order ID: ${sellResult.orderID}`);
    log(`Tx: ${sellResult.transactionsHashes?.[0]}`);
  }

  // Summary
  log("\n" + "=".repeat(50));
  log("ROUND TRIP COMPLETE");
  log("=".repeat(50));
  log("Check your Polymarket order history!");
}

main().catch(console.error);
