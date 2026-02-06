#!/usr/bin/env bun
/**
 * Sells the existing position from the failed test.
 */

import { Wallet } from "@ethersproject/wallet";
import { ClobClient, Side, OrderType, Chain } from "@polymarket/clob-client";
import { SignatureType } from "@polymarket/order-utils";
import { GammaClient } from "../src/venues/polymarket/gamma";

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

async function getOrderBook(tokenId: string) {
  const response = await fetch(`${HOST}/book?token_id=${tokenId}`);
  return response.json();
}

async function main() {
  log("=== Sell Existing Position ===\n");

  if (!PRIVATE_KEY || !FUNDER_ADDRESS) {
    console.error("ERROR: Missing env vars");
    process.exit(1);
  }

  const pk = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  const wallet = new Wallet(pk);

  // Get current market
  const gamma = new GammaClient();
  const market = await gamma.getCurrentMarket("BTC");

  if (!market) {
    console.error("ERROR: No active market");
    process.exit(1);
  }

  const tokenId = market.tokenIds.up;
  log("Market:", { slug: market.slug });

  // Get orderbook
  const book = await getOrderBook(tokenId);
  const bestBid = parseFloat(book.bids?.[0]?.price || "0");
  log("Best bid:", bestBid);

  if (bestBid === 0) {
    console.error("ERROR: No bids available");
    process.exit(1);
  }

  // Initialize client
  const tempClient = new ClobClient(HOST, Chain.POLYGON, wallet, undefined, SIGNATURE_TYPE, FUNDER_ADDRESS);
  const creds = await tempClient.createOrDeriveApiKey();
  const client = new ClobClient(HOST, Chain.POLYGON, wallet, creds, SIGNATURE_TYPE, FUNDER_ADDRESS);

  // Try to sell
  log("\nPlacing SELL order for 5 contracts @ $" + bestBid);

  const sellResult = await client.createAndPostOrder(
    {
      tokenID: tokenId,
      price: bestBid,
      size: 5,
      side: Side.SELL,
    },
    { tickSize: "0.01", negRisk: false },
    OrderType.GTC
  );

  log("Sell result:", sellResult);

  if (sellResult.success) {
    log("\n=== SELL ORDER PLACED ===");
    if (sellResult.status === "matched") {
      log("Order filled immediately!");
    } else {
      log("Order is live - may need to wait for fill or adjust price");
      log("Order ID:", sellResult.orderID);
    }
  } else {
    log("\n=== SELL FAILED ===");
    log("Error:", sellResult.errorMsg || sellResult);
  }
}

main().catch(console.error);
