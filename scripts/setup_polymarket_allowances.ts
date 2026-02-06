#!/usr/bin/env bun
/**
 * One-time setup script to approve Polymarket token allowances.
 * Based on clob-client/examples/approveAllowances.ts pattern.
 *
 * Polymarket requires two types of approvals before you can trade:
 * 1. USDC.e (ERC20) - Allow exchange contracts to pull collateral for trades
 * 2. Conditional Tokens (CTF) (ERC1155) - Allow exchange contracts to manage outcome tokens
 *
 * Usage: bun scripts/setup_polymarket_allowances.ts
 *
 * Required env vars:
 *   POLYMARKET_WALLET_PRIVATE_KEY - 0x-prefixed Ethereum private key
 *   POLYGON_RPC_URL - Polygon mainnet RPC URL (optional, defaults to public RPC)
 */

import { ethers } from "ethers";
import { usdcAbi } from "../clob-client/examples/abi/usdcAbi";
import { ctfAbi } from "../clob-client/examples/abi/ctfAbi";

// Contract addresses (Polygon mainnet, chainId 137)
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";

// Exchange addresses that need approval
const EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";

// Gas settings (high to replace stuck pending txs)
const GAS_PRICE = 300_000_000_000; // 300 gwei (high to replace pending)
const GAS_LIMIT = 200_000;

async function main() {
  // Load config from env (Bun auto-loads .env)
  const privateKey = process.env.POLYMARKET_WALLET_PRIVATE_KEY;
  const rpcUrl = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";

  if (!privateKey) {
    console.error("Error: POLYMARKET_WALLET_PRIVATE_KEY env var required");
    console.error("Add it to your .env file:");
    console.error("  POLYMARKET_WALLET_PRIVATE_KEY=0x...");
    process.exit(1);
  }

  // Connect to Polygon
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`\n${"=".repeat(60)}`);
  console.log("Polymarket Allowance Setup");
  console.log(`${"=".repeat(60)}`);
  console.log(`Wallet:  ${wallet.address}`);
  console.log(`RPC:     ${rpcUrl}`);

  // Create contract instances
  const usdc = new ethers.Contract(USDC_ADDRESS, usdcAbi, wallet);
  const ctf = new ethers.Contract(CTF_ADDRESS, ctfAbi, wallet);

  console.log(`\nUSDC: ${USDC_ADDRESS}`);
  console.log(`CTF:  ${CTF_ADDRESS}`);

  // Check current allowances
  console.log(`\n${"─".repeat(60)}`);
  console.log("Checking current allowances...");
  console.log(`${"─".repeat(60)}`);

  // USDC allowances
  const usdcAllowanceCtf = await usdc.allowance(wallet.address, CTF_ADDRESS);
  const usdcAllowanceExchange = await usdc.allowance(wallet.address, EXCHANGE);
  const usdcAllowanceNegRiskExchange = await usdc.allowance(wallet.address, NEG_RISK_EXCHANGE);
  const usdcAllowanceNegRiskAdapter = await usdc.allowance(wallet.address, NEG_RISK_ADAPTER);

  // CTF allowances
  const ctfAllowanceExchange = await ctf.isApprovedForAll(wallet.address, EXCHANGE);
  const ctfAllowanceNegRiskExchange = await ctf.isApprovedForAll(wallet.address, NEG_RISK_EXCHANGE);
  const ctfAllowanceNegRiskAdapter = await ctf.isApprovedForAll(wallet.address, NEG_RISK_ADAPTER);

  console.log(`\nUSDC Allowances:`);
  console.log(`  CTF:              ${usdcAllowanceCtf > 0n ? "OK" : "NOT SET"}`);
  console.log(`  Exchange:         ${usdcAllowanceExchange > 0n ? "OK" : "NOT SET"}`);
  console.log(`  NegRisk Exchange: ${usdcAllowanceNegRiskExchange > 0n ? "OK" : "NOT SET"}`);
  console.log(`  NegRisk Adapter:  ${usdcAllowanceNegRiskAdapter > 0n ? "OK" : "NOT SET"}`);

  console.log(`\nCTF Allowances:`);
  console.log(`  Exchange:         ${ctfAllowanceExchange ? "OK" : "NOT SET"}`);
  console.log(`  NegRisk Exchange: ${ctfAllowanceNegRiskExchange ? "OK" : "NOT SET"}`);
  console.log(`  NegRisk Adapter:  ${ctfAllowanceNegRiskAdapter ? "OK" : "NOT SET"}`);

  // Set missing allowances
  console.log(`\n${"─".repeat(60)}`);
  console.log("Setting missing allowances...");
  console.log(`${"─".repeat(60)}\n`);

  let txn;
  let txCount = 0;

  // USDC approvals
  if (!(usdcAllowanceCtf > 0n)) {
    txn = await usdc.approve(CTF_ADDRESS, ethers.MaxUint256, {
      gasPrice: GAS_PRICE,
      gasLimit: GAS_LIMIT,
    });
    console.log(`Setting USDC allowance for CTF: ${txn.hash}`);
    await txn.wait();
    console.log(`  Confirmed!`);
    txCount++;
  }

  if (!(usdcAllowanceExchange > 0n)) {
    txn = await usdc.approve(EXCHANGE, ethers.MaxUint256, {
      gasPrice: GAS_PRICE,
      gasLimit: GAS_LIMIT,
    });
    console.log(`Setting USDC allowance for Exchange: ${txn.hash}`);
    await txn.wait();
    console.log(`  Confirmed!`);
    txCount++;
  }

  if (!(usdcAllowanceNegRiskExchange > 0n)) {
    txn = await usdc.approve(NEG_RISK_EXCHANGE, ethers.MaxUint256, {
      gasPrice: GAS_PRICE,
      gasLimit: GAS_LIMIT,
    });
    console.log(`Setting USDC allowance for NegRisk Exchange: ${txn.hash}`);
    await txn.wait();
    console.log(`  Confirmed!`);
    txCount++;
  }

  if (!(usdcAllowanceNegRiskAdapter > 0n)) {
    txn = await usdc.approve(NEG_RISK_ADAPTER, ethers.MaxUint256, {
      gasPrice: GAS_PRICE,
      gasLimit: GAS_LIMIT,
    });
    console.log(`Setting USDC allowance for NegRisk Adapter: ${txn.hash}`);
    await txn.wait();
    console.log(`  Confirmed!`);
    txCount++;
  }

  // CTF approvals
  if (!ctfAllowanceExchange) {
    txn = await ctf.setApprovalForAll(EXCHANGE, true, {
      gasPrice: GAS_PRICE,
      gasLimit: GAS_LIMIT,
    });
    console.log(`Setting CTF allowance for Exchange: ${txn.hash}`);
    await txn.wait();
    console.log(`  Confirmed!`);
    txCount++;
  }

  if (!ctfAllowanceNegRiskExchange) {
    txn = await ctf.setApprovalForAll(NEG_RISK_EXCHANGE, true, {
      gasPrice: GAS_PRICE,
      gasLimit: GAS_LIMIT,
    });
    console.log(`Setting CTF allowance for NegRisk Exchange: ${txn.hash}`);
    await txn.wait();
    console.log(`  Confirmed!`);
    txCount++;
  }

  if (!ctfAllowanceNegRiskAdapter) {
    txn = await ctf.setApprovalForAll(NEG_RISK_ADAPTER, true, {
      gasPrice: GAS_PRICE,
      gasLimit: GAS_LIMIT,
    });
    console.log(`Setting CTF allowance for NegRisk Adapter: ${txn.hash}`);
    await txn.wait();
    console.log(`  Confirmed!`);
    txCount++;
  }

  console.log(`\n${"=".repeat(60)}`);
  if (txCount > 0) {
    console.log(`All allowances set! (${txCount} transactions)`);
  } else {
    console.log("All allowances were already set. No transactions needed.");
  }
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
