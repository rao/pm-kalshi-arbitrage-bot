#!/usr/bin/env bun
/**
 * Test script to verify the Polymarket owner/POLY_ADDRESS fix.
 *
 * Uses the PolymarketClient directly to place a GTC order and cancel it.
 * This verifies that the fix (using funderAddress for both owner and POLY_ADDRESS) works.
 *
 * Usage: bun scripts/test-order-fix.ts
 */

import { PolymarketClient, Side } from "../src/venues/polymarket/client";
import { GammaClient } from "../src/venues/polymarket/gamma";
import { SignatureType } from "@polymarket/order-utils";

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

async function main() {
  log("=== Polymarket Order Fix Test ===");
  log("Testing PolymarketClient order placement\n");

  // Validate environment
  if (!PRIVATE_KEY) {
    console.error("ERROR: POLYMARKET_PRIVATE_KEY not set");
    process.exit(1);
  }
  if (!FUNDER_ADDRESS) {
    console.error("ERROR: POLYMARKET_FUNDER_ADDRESS not set");
    process.exit(1);
  }

  log("Configuration:", {
    host: HOST,
    signatureType: SIGNATURE_TYPE,
    signatureTypeName: SIGNATURE_TYPE === 0 ? "EOA" : SIGNATURE_TYPE === 1 ? "POLY_PROXY" : "POLY_GNOSIS_SAFE",
    funderAddress: FUNDER_ADDRESS,
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
    upTokenId: market.tokenIds.up.substring(0, 30) + "...",
    upPrice: market.prices.up,
    downPrice: market.prices.down,
  });

  // Use a price that's very unlikely to fill (far from market)
  // We'll bid at 0.01 (1 cent) for a position worth ~27 cents
  const testPrice = 0.01;
  const testSize = 5; // Minimum order size is 5
  const testTokenId = market.tokenIds.up;

  // Step 2: Initialize PolymarketClient
  log("\n--- Step 2: Initialize PolymarketClient ---");
  const client = new PolymarketClient({
    host: HOST,
    privateKey: PRIVATE_KEY,
    funderAddress: FUNDER_ADDRESS,
    signatureType: SIGNATURE_TYPE,
  });

  await client.init();

  log("Client initialized:", {
    funderAddress: client.getFunderAddress(),
    signerAddress: client.getSignerAddress(),
    credsPrefix: client.getCredentials()?.key.substring(0, 10) + "...",
  });

  // Step 3: Place a GTC order
  log("\n--- Step 3: Place GTC Test Order ---");
  log(`Placing BUY order: ${testSize} contracts @ $${testPrice} (very low bid, unlikely to fill)`);

  const orderResult = await client.placeGtcOrder({
    tokenId: testTokenId,
    price: testPrice,
    size: testSize,
    side: Side.BUY,
  });

  log("Order result:", orderResult);

  if (!orderResult.success) {
    console.error("\n=== TEST FAILED ===");
    console.error("Order placement failed:", orderResult.errorMsg);

    if (orderResult.errorMsg?.includes("owner has to be the owner of the API KEY")) {
      console.error("\nThe fix did NOT work - still getting owner mismatch error.");
      console.error("Check that funderAddress is being used correctly.");
    }

    process.exit(1);
  }

  log("\n=== ORDER PLACED SUCCESSFULLY ===");
  log(`Order ID: ${orderResult.orderId}`);

  // Step 4: Cancel the order
  log("\n--- Step 4: Cancel Test Order ---");
  if (orderResult.orderId) {
    const cancelResult = await client.cancelOrder(orderResult.orderId);
    log("Cancel result:", cancelResult);

    if (cancelResult.canceled.includes(orderResult.orderId)) {
      log("\n=== TEST PASSED ===");
      log("Order was placed and canceled successfully!");
      log("The owner=API_KEY fix is working correctly.");
    } else {
      log("\nOrder may have filled or cancel failed.");
      log("Check open orders manually.");
    }
  }

  // Step 5: Verify no open orders remain
  log("\n--- Step 5: Verify Clean State ---");
  const openOrders = await client.getOpenOrders();
  log(`Open orders: ${openOrders.length}`);

  if (openOrders.length > 0) {
    log("Warning: There are still open orders:", openOrders.map(o => ({
      id: o.id,
      price: o.price,
      side: o.side,
    })));
  }

  log("\n=== TEST COMPLETE ===");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
