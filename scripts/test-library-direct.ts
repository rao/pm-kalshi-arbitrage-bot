#!/usr/bin/env bun
/**
 * Test script using the library's createAndPostOrder directly.
 * This helps isolate whether the issue is in our bypass code or elsewhere.
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

async function main() {
  log("=== Library Direct Test ===");
  log("Testing the library's createAndPostOrder directly\n");

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
    signatureTypeName: SIGNATURE_TYPE === 0 ? "EOA" : SIGNATURE_TYPE === 1 ? "POLY_PROXY" : "POLY_GNOSIS_SAFE",
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
    upTokenId: market.tokenIds.up.substring(0, 30) + "...",
    upPrice: market.prices.up,
  });

  const testTokenId = market.tokenIds.up;
  const testPrice = 0.01; // Very low price, unlikely to fill
  const testSize = 5; // Minimum order size is 5

  // Step 2: Initialize client WITHOUT creds first (to derive them)
  log("\n--- Step 2: Derive API Credentials ---");
  const tempClient = new ClobClient(
    HOST,
    Chain.POLYGON,
    wallet,
    undefined, // no creds yet
    SIGNATURE_TYPE,
    FUNDER_ADDRESS
  );

  log("Calling createOrDeriveApiKey...");
  const creds = await tempClient.createOrDeriveApiKey();
  log("Credentials obtained:", {
    apiKeyPrefix: creds.key.substring(0, 15) + "...",
    hasSecret: !!creds.secret,
    hasPassphrase: !!creds.passphrase,
  });

  // Step 3: Create client with creds
  log("\n--- Step 3: Create Client with Credentials ---");
  const client = new ClobClient(
    HOST,
    Chain.POLYGON,
    wallet,
    creds,
    SIGNATURE_TYPE,
    FUNDER_ADDRESS
  );

  // Step 4: Test using library's createAndPostOrder
  log("\n--- Step 4: Place Order Using Library ---");
  log(`Placing GTC BUY order: ${testSize} contracts @ $${testPrice}`);

  try {
    const result = await client.createAndPostOrder(
      {
        tokenID: testTokenId,
        price: testPrice,
        size: testSize,
        side: Side.BUY,
      },
      { tickSize: "0.01", negRisk: false },
      OrderType.GTC
    );

    log("Order result:", result);

    if (result.success) {
      log("\n=== SUCCESS ===");
      log("Order placed successfully using the library directly!");

      // Cancel the order
      if (result.orderID) {
        log("\nCancelling order...");
        const cancelResult = await client.cancelOrder({ orderID: result.orderID });
        log("Cancel result:", cancelResult);
      }
    } else {
      log("\n=== ORDER FAILED ===");
      log("Error:", result.errorMsg);
    }
  } catch (error) {
    console.error("\n=== EXCEPTION ===");
    console.error("Error:", error);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
