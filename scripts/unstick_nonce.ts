#!/usr/bin/env bun
/**
 * Script to unstick pending transactions by replacing nonce 0 with high gas.
 */

import { ethers } from "ethers";

async function main() {
  const privateKey = process.env.POLYMARKET_WALLET_PRIVATE_KEY;
  const rpcUrl = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";

  if (!privateKey) {
    console.error("POLYMARKET_WALLET_PRIVATE_KEY required");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`Wallet: ${wallet.address}`);

  // Check nonces
  const confirmedNonce = await provider.getTransactionCount(wallet.address, "latest");
  const pendingNonce = await provider.getTransactionCount(wallet.address, "pending");

  console.log(`Confirmed nonce: ${confirmedNonce}`);
  console.log(`Pending nonce: ${pendingNonce}`);
  console.log(`Stuck transactions: ${pendingNonce - confirmedNonce}`);

  if (pendingNonce === confirmedNonce) {
    console.log("No stuck transactions!");
    return;
  }

  // Replace each stuck nonce with a simple self-transfer at high gas
  for (let nonce = confirmedNonce; nonce < pendingNonce; nonce++) {
    console.log(`\nReplacing nonce ${nonce}...`);

    const tx = await wallet.sendTransaction({
      to: wallet.address,
      value: 0n,
      nonce: nonce,
      gasLimit: 21000n,
      gasPrice: 500_000_000_000n, // 500 gwei
    });

    console.log(`  Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt?.blockNumber}`);
  }

  console.log("\nAll stuck transactions replaced!");
}

main().catch(console.error);
