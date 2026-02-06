#!/usr/bin/env bun
/**
 * View all Polymarket positions and sell them at market price.
 * Useful for cleaning up after bot runs, partial fills, or manual intervention.
 *
 * Usage: bun scripts/sell-all-positions.ts
 */

import { Wallet } from "@ethersproject/wallet";
import { ClobClient, Chain, Side, OrderType } from "@polymarket/clob-client";
import { SignatureType } from "@polymarket/order-utils";
import * as readline from "readline";

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

async function getOrderBook(tokenId: string): Promise<any> {
  const response = await fetch(`${HOST}/book?token_id=${tokenId}`);
  return response.json();
}

function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

interface Position {
  tokenId: string;
  outcome: string;
  size: number;
  balance: number;
  bestBid: number;
  bestBidSize: number;
  estimatedProceeds: number;
  conditionId?: string;
  marketSlug?: string;
}

async function main() {
  log("=== View & Sell All Polymarket Positions ===\n");

  if (!PRIVATE_KEY || !FUNDER_ADDRESS) {
    console.error("ERROR: Missing env vars (POLYMARKET_WALLET_PRIVATE_KEY / POLYMARKET_FUNDER_ADDRESS)");
    process.exit(1);
  }

  const pk = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  const wallet = new Wallet(pk);

  log("Addresses:", { funder: FUNDER_ADDRESS, signer: wallet.address });

  // Initialize CLOB client
  const tempClient = new ClobClient(HOST, Chain.POLYGON, wallet, undefined, SIGNATURE_TYPE, FUNDER_ADDRESS);
  const creds = await tempClient.createOrDeriveApiKey();
  const client = new ClobClient(HOST, Chain.POLYGON, wallet, creds, SIGNATURE_TYPE, FUNDER_ADDRESS);

  // Fetch positions from Gamma API
  log("\nFetching positions from Gamma API...");
  const gammaUrl = `https://gamma-api.polymarket.com/positions?user=${FUNDER_ADDRESS}`;
  const gammaResponse = await fetch(gammaUrl);
  const gammaPositions: any[] = await gammaResponse.json();

  if (!gammaPositions || gammaPositions.length === 0) {
    log("No positions found. Nothing to sell.");
    return;
  }

  // Filter to positions with nonzero size
  const nonzero = gammaPositions.filter((p) => parseFloat(p.size || "0") > 0);

  if (nonzero.length === 0) {
    log(`Found ${gammaPositions.length} position(s), but all have zero size. Nothing to sell.`);
    return;
  }

  log(`Found ${nonzero.length} position(s) with nonzero size.\n`);

  // Build position details with on-chain balance and orderbook data
  const positions: Position[] = [];

  for (const pos of nonzero) {
    const tokenId = pos.asset || pos.token_id || pos.tokenId;
    if (!tokenId) {
      log(`Skipping position with no token ID:`, pos);
      continue;
    }

    // Get on-chain balance
    let balance: number;
    try {
      const balResp = await client.getBalanceAllowance({
        asset_type: "CONDITIONAL" as any,
        token_id: tokenId,
      });
      balance = parseFloat(balResp.balance || "0");
    } catch (e) {
      log(`Warning: Could not fetch on-chain balance for ${tokenId.substring(0, 20)}..., using Gamma size`);
      balance = parseFloat(pos.size || "0");
    }

    if (balance <= 0) {
      log(`Skipping ${tokenId.substring(0, 20)}... — on-chain balance is 0`);
      continue;
    }

    // Get orderbook for best bid
    let bestBid = 0;
    let bestBidSize = 0;
    try {
      const book = await getOrderBook(tokenId);
      if (book.bids && book.bids.length > 0) {
        bestBid = parseFloat(book.bids[0].price);
        bestBidSize = parseFloat(book.bids[0].size);
      }
    } catch (e) {
      log(`Warning: Could not fetch orderbook for ${tokenId.substring(0, 20)}...`);
    }

    positions.push({
      tokenId,
      outcome: pos.outcome || pos.title || "Unknown",
      size: parseFloat(pos.size || "0"),
      balance,
      bestBid,
      bestBidSize,
      estimatedProceeds: balance * bestBid,
      conditionId: pos.conditionId || pos.condition_id,
      marketSlug: pos.market_slug || pos.marketSlug || pos.slug,
    });
  }

  if (positions.length === 0) {
    log("No positions with nonzero on-chain balance. Nothing to sell.");
    return;
  }

  // Display summary
  console.log("\n" + "=".repeat(80));
  console.log("  POSITIONS SUMMARY");
  console.log("=".repeat(80));

  let totalEstimatedProceeds = 0;

  for (const p of positions) {
    const truncId = p.tokenId.substring(0, 16) + "...";
    console.log(`\n  Token:      ${truncId}`);
    if (p.marketSlug) console.log(`  Market:     ${p.marketSlug}`);
    console.log(`  Outcome:    ${p.outcome}`);
    console.log(`  Balance:    ${p.balance.toFixed(4)} shares`);
    console.log(`  Best Bid:   $${p.bestBid.toFixed(4)}${p.bestBidSize > 0 ? ` (size: ${p.bestBidSize})` : ""}`);
    console.log(`  Est. Value: $${p.estimatedProceeds.toFixed(4)}`);
    if (p.bestBid === 0) {
      console.log(`  ⚠  NO BIDS — cannot sell this position`);
    }
    totalEstimatedProceeds += p.estimatedProceeds;
  }

  console.log("\n" + "-".repeat(80));
  console.log(`  Total estimated proceeds: $${totalEstimatedProceeds.toFixed(4)}`);
  console.log("-".repeat(80));

  const sellable = positions.filter((p) => p.bestBid > 0);
  if (sellable.length === 0) {
    log("\nNo positions have available bids. Cannot sell anything.");
    return;
  }

  // Ask for confirmation
  const confirmed = await askConfirmation(
    `\nSell ${sellable.length} position(s) at market price? (y/n): `
  );

  if (!confirmed) {
    log("Aborted. No orders placed.");
    return;
  }

  // Sell each position
  console.log("\n" + "=".repeat(80));
  console.log("  EXECUTING SELLS");
  console.log("=".repeat(80));

  let totalReceived = 0;
  let successCount = 0;
  let failCount = 0;

  for (const p of sellable) {
    const truncId = p.tokenId.substring(0, 16) + "...";
    log(`\nSelling ${p.balance.toFixed(4)} shares of ${truncId} @ $${p.bestBid}`);

    try {
      const response = await client.createAndPostMarketOrder(
        {
          tokenID: p.tokenId,
          price: p.bestBid,
          amount: p.balance,
          side: Side.SELL,
        },
        { tickSize: "0.01", negRisk: false },
        OrderType.FAK
      );

      if (response.success) {
        successCount++;
        const taking = parseFloat(response.takingAmount || "0");
        const making = parseFloat(response.makingAmount || "0");
        // For sells: takingAmount = USDC received, makingAmount = shares given
        const received = taking > 0 ? taking / 1e6 : p.estimatedProceeds; // USDC has 6 decimals on-chain
        totalReceived += received;

        log(`  FILLED — status: ${response.status}`, {
          orderId: response.orderID,
          takingAmount: response.takingAmount,
          makingAmount: response.makingAmount,
        });
      } else {
        failCount++;
        log(`  FAILED — ${response.errorMsg || "unknown error"}`, response);
      }
    } catch (error) {
      failCount++;
      log(`  ERROR selling ${truncId}:`, error instanceof Error ? error.message : error);
    }
  }

  // Final report
  console.log("\n" + "=".repeat(80));
  console.log("  RESULTS");
  console.log("=".repeat(80));
  console.log(`  Succeeded: ${successCount}`);
  console.log(`  Failed:    ${failCount}`);
  console.log(`  Est. received: $${totalReceived.toFixed(4)}`);
  console.log("=".repeat(80));
}

main().catch(console.error);
