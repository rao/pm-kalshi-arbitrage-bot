#!/usr/bin/env bun
/**
 * Check current positions and recent trades
 */

import { Wallet } from "@ethersproject/wallet";
import { ClobClient, Chain } from "@polymarket/clob-client";
import { SignatureType } from "@polymarket/order-utils";

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
  log("=== Check Positions ===\n");

  if (!PRIVATE_KEY || !FUNDER_ADDRESS) {
    console.error("ERROR: Missing env vars");
    process.exit(1);
  }

  const pk = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  const wallet = new Wallet(pk);

  log("Addresses:", {
    funder: FUNDER_ADDRESS,
    signer: wallet.address,
  });

  // Initialize client
  const tempClient = new ClobClient(HOST, Chain.POLYGON, wallet, undefined, SIGNATURE_TYPE, FUNDER_ADDRESS);
  const creds = await tempClient.createOrDeriveApiKey();
  const client = new ClobClient(HOST, Chain.POLYGON, wallet, creds, SIGNATURE_TYPE, FUNDER_ADDRESS);

  // Check open orders
  log("\n--- Open Orders ---");
  try {
    const openOrders = await client.getOpenOrders();
    if (openOrders.length === 0) {
      log("No open orders");
    } else {
      log("Open orders:", openOrders);
    }
  } catch (e) {
    log("Error getting open orders:", e);
  }

  // Check trades (recent fills)
  log("\n--- Recent Trades ---");
  try {
    const trades = await client.getTrades();
    if (!trades || trades.length === 0) {
      log("No recent trades found");
    } else {
      log(`Found ${trades.length} recent trades:`);
      for (const trade of trades.slice(0, 5)) {
        log("Trade:", {
          id: trade.id,
          side: trade.side,
          size: trade.size,
          price: trade.price,
          status: trade.status,
          createdAt: trade.created_at,
          matchTime: trade.match_time,
        });
      }
    }
  } catch (e) {
    log("Error getting trades:", e);
  }

  // Check balances using REST API
  log("\n--- Checking via REST API ---");

  // Get user's trade history from data API
  const dataApiUrl = `https://data-api.polymarket.com/trades?maker=${FUNDER_ADDRESS}&limit=10`;
  log(`Fetching: ${dataApiUrl}`);
  try {
    const response = await fetch(dataApiUrl);
    const trades = await response.json();
    if (trades && trades.length > 0) {
      log(`Found ${trades.length} trades from data API:`);
      for (const trade of trades) {
        log("Trade:", {
          market: trade.market,
          outcome: trade.outcome,
          side: trade.side,
          size: trade.size,
          price: trade.price,
          timestamp: trade.timestamp,
        });
      }
    } else {
      log("No trades from data API");
    }
  } catch (e) {
    log("Error from data API:", e);
  }

  // Check gamma API for user activity
  log("\n--- User Positions (Gamma API) ---");
  const gammaUrl = `https://gamma-api.polymarket.com/positions?user=${FUNDER_ADDRESS}`;
  log(`Fetching: ${gammaUrl}`);
  try {
    const response = await fetch(gammaUrl);
    const positions = await response.json();
    if (positions && positions.length > 0) {
      log(`Found ${positions.length} positions:`);
      for (const pos of positions.slice(0, 10)) {
        log("Position:", pos);
      }
    } else {
      log("No positions found");
    }
  } catch (e) {
    log("Error from gamma API:", e);
  }
}

main().catch(console.error);
