#!/usr/bin/env bun
/**
 * Check current Polymarket allowance status without making changes.
 *
 * Usage: bun scripts/check_polymarket_allowances.ts
 *
 * Required env vars:
 *   POLYMARKET_WALLET_PRIVATE_KEY or POLY_WALLET_ADDRESS - Wallet to check
 *   POLYGON_RPC_URL - Polygon mainnet RPC URL (optional, defaults to public RPC)
 */

import { ethers } from "ethers";

// Contract addresses (Polygon mainnet)
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";

// Spender addresses that need approval
const SPENDERS = {
  CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  NEG_RISK_CTF_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  NEG_RISK_ADAPTER: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
} as const;

// Minimal ABIs for read functions
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const ERC1155_ABI = [
  "function isApprovedForAll(address account, address operator) view returns (bool)",
];

async function main() {
  // Load config from env (Bun auto-loads .env)
  const privateKey = process.env.POLYMARKET_WALLET_PRIVATE_KEY;
  const walletAddressEnv = process.env.POLY_WALLET_ADDRESS;
  const rpcUrl = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";

  // Derive wallet address from private key or use env var
  let walletAddress: string;
  if (privateKey) {
    const wallet = new ethers.Wallet(privateKey);
    walletAddress = wallet.address;
  } else if (walletAddressEnv) {
    walletAddress = walletAddressEnv;
  } else {
    console.error("Error: Need either POLYMARKET_WALLET_PRIVATE_KEY or POLY_WALLET_ADDRESS");
    process.exit(1);
  }

  // Connect to Polygon
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  console.log(`\n${"=".repeat(60)}`);
  console.log("Polymarket Allowance Check");
  console.log(`${"=".repeat(60)}`);
  console.log(`Wallet:  ${walletAddress}`);
  console.log(`RPC:     ${rpcUrl}`);

  // Create contract instances (read-only)
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const ctf = new ethers.Contract(CTF_ADDRESS, ERC1155_ABI, provider);

  // Check balances
  const maticBalance = await provider.getBalance(walletAddress);
  const usdcBalance = await usdc.balanceOf(walletAddress);
  const decimals = await usdc.decimals();

  console.log(`\n${"─".repeat(60)}`);
  console.log("Balances");
  console.log(`${"─".repeat(60)}`);
  console.log(`MATIC:   ${parseFloat(ethers.formatEther(maticBalance)).toFixed(4)} MATIC`);
  console.log(`USDC:    ${parseFloat(ethers.formatUnits(usdcBalance, decimals)).toFixed(2)} USDC.e`);

  // Check USDC allowances
  console.log(`\n${"─".repeat(60)}`);
  console.log("USDC.e Allowances (ERC20)");
  console.log(`${"─".repeat(60)}`);

  let missingUsdc = 0;
  for (const [name, spender] of Object.entries(SPENDERS)) {
    const allowance = await usdc.allowance(walletAddress, spender);
    const status = allowance > 0n ? "APPROVED" : "NOT SET";
    const symbol = allowance > 0n ? "[OK]" : "[!!]";
    console.log(`${symbol} ${name.padEnd(25)} ${status}`);
    if (allowance === 0n) missingUsdc++;
  }

  // Check CTF allowances
  console.log(`\n${"─".repeat(60)}`);
  console.log("Conditional Token Allowances (ERC1155)");
  console.log(`${"─".repeat(60)}`);

  let missingCtf = 0;
  for (const [name, spender] of Object.entries(SPENDERS)) {
    const isApproved = await ctf.isApprovedForAll(walletAddress, spender);
    const status = isApproved ? "APPROVED" : "NOT SET";
    const symbol = isApproved ? "[OK]" : "[!!]";
    console.log(`${symbol} ${name.padEnd(25)} ${status}`);
    if (!isApproved) missingCtf++;
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  const totalMissing = missingUsdc + missingCtf;
  if (totalMissing === 0) {
    console.log("All allowances are set! Your wallet is ready to trade.");
  } else {
    console.log(`Missing ${totalMissing} allowance(s).`);
    console.log("Run: bun scripts/setup_polymarket_allowances.ts");
  }
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
