/**
 * Test script for Polymarket order placement.
 *
 * Places a small $1 buy order and immediately sells it back.
 * Uses detailed logging to diagnose any issues.
 *
 * Usage: bun run scripts/test-polymarket-order.ts
 */

import { Wallet } from "@ethersproject/wallet";
import { ClobClient, Side, Chain } from "@polymarket/clob-client";
import type { ApiKeyCreds } from "@polymarket/clob-client";
import { SignatureType } from "@polymarket/order-utils";

// Configuration from environment
const HOST = process.env.POLYMARKET_CLOB_HOST || "https://clob.polymarket.com";
const PRIVATE_KEY = process.env.POLYMARKET_PRIVATE_KEY;
const FUNDER_ADDRESS = process.env.POLYMARKET_FUNDER_ADDRESS;
const SIGNATURE_TYPE = parseInt(process.env.POLYMARKET_SIGNATURE_TYPE || "2", 10) as SignatureType;

// Test token - use a liquid market (BTC up/down typically)
// You can override this with POLYMARKET_TEST_TOKEN env var
const TEST_TOKEN_ID = process.env.POLYMARKET_TEST_TOKEN || "";

// Test parameters
const TEST_SIZE = 1; // 1 contract (~$0.50 or less typically)
const TEST_PRICE = 0.50; // Mid-price, adjust based on actual market

interface TestResult {
  step: string;
  success: boolean;
  details: Record<string, unknown>;
  error?: string;
}

const results: TestResult[] = [];

function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data !== undefined) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function logResult(step: string, success: boolean, details: Record<string, unknown>, error?: string) {
  const result: TestResult = { step, success, details, error };
  results.push(result);
  log(`${success ? "✓" : "✗"} ${step}`, details);
  if (error) {
    console.error(`  Error: ${error}`);
  }
}

async function buildHmacSignature(secret: string, message: string): Promise<string> {
  // Convert base64url to base64
  const sanitizedSecret = secret
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/=]/g, "");

  // Decode base64 to ArrayBuffer
  const binaryString = atob(sanitizedSecret);
  const keyBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    keyBytes[i] = binaryString.charCodeAt(i);
  }

  // Import key for HMAC
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Sign the message
  const messageBuffer = new TextEncoder().encode(message);
  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageBuffer);

  // Convert to base64
  const signatureBytes = new Uint8Array(signatureBuffer);
  let binary = "";
  for (let i = 0; i < signatureBytes.byteLength; i++) {
    binary += String.fromCharCode(signatureBytes[i]);
  }
  const sig = btoa(binary);

  // Convert to URL-safe base64
  return sig.replace(/\+/g, "-").replace(/\//g, "_");
}

async function postOrderDirect(
  host: string,
  creds: ApiKeyCreds,
  ownerAddress: string,
  polyAddress: string,
  orderPayload: object
): Promise<{ success?: boolean; orderID?: string; errorMsg?: string; status?: string; error?: string }> {
  const endpoint = "/order";
  const body = JSON.stringify(orderPayload);
  const timestamp = Math.floor(Date.now() / 1000);

  const message = `${timestamp}POST${endpoint}${body}`;
  const signature = await buildHmacSignature(creds.secret, message);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "POLY_ADDRESS": polyAddress,
    "POLY_SIGNATURE": signature,
    "POLY_TIMESTAMP": `${timestamp}`,
    "POLY_API_KEY": creds.key,
    "POLY_PASSPHRASE": creds.passphrase,
  };

  log(`POST ${host}${endpoint}`, {
    headers: {
      ...headers,
      "POLY_SIGNATURE": "[REDACTED]",
      "POLY_PASSPHRASE": "[REDACTED]",
    },
    body: JSON.parse(body),
  });

  const response = await fetch(`${host}${endpoint}`, {
    method: "POST",
    headers,
    body,
  });

  const data = await response.json();
  return data;
}

async function main() {
  log("=== Polymarket Order Test Script ===");
  log("Testing order placement with detailed logging\n");

  // Validate environment
  if (!PRIVATE_KEY) {
    console.error("ERROR: POLYMARKET_PRIVATE_KEY not set");
    process.exit(1);
  }
  if (!FUNDER_ADDRESS) {
    console.error("ERROR: POLYMARKET_FUNDER_ADDRESS not set");
    process.exit(1);
  }
  if (!TEST_TOKEN_ID) {
    console.error("ERROR: POLYMARKET_TEST_TOKEN not set - provide a token ID to test with");
    console.error("You can find token IDs from market discovery or the Polymarket API");
    process.exit(1);
  }

  // Create wallet
  const pk = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  const wallet = new Wallet(pk);

  log("Configuration:", {
    host: HOST,
    signatureType: SIGNATURE_TYPE,
    signatureTypeName: SIGNATURE_TYPE === 0 ? "EOA" : SIGNATURE_TYPE === 1 ? "POLY_PROXY" : "POLY_GNOSIS_SAFE",
    funderAddress: FUNDER_ADDRESS,
    signerAddress: wallet.address,
    testTokenId: TEST_TOKEN_ID.substring(0, 30) + "...",
    testSize: TEST_SIZE,
    testPrice: TEST_PRICE,
  });

  logResult("Environment validation", true, {
    privateKeySet: !!PRIVATE_KEY,
    funderAddressSet: !!FUNDER_ADDRESS,
    tokenIdSet: !!TEST_TOKEN_ID,
  });

  // Step 1: Initialize client and derive API keys
  log("\n--- Step 1: Initialize Client & Derive API Keys ---");

  const tempClient = new ClobClient(
    HOST,
    Chain.POLYGON,
    wallet,
    undefined,
    SIGNATURE_TYPE,
    FUNDER_ADDRESS
  );

  log("Deriving API credentials...");
  let creds: ApiKeyCreds;
  try {
    creds = await tempClient.createOrDeriveApiKey();
    logResult("API key derivation", true, {
      apiKeyPrefix: creds.key.substring(0, 10) + "...",
      hasSecret: !!creds.secret,
      hasPassphrase: !!creds.passphrase,
    });
  } catch (error) {
    logResult("API key derivation", false, {}, error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Create client with credentials
  const client = new ClobClient(
    HOST,
    Chain.POLYGON,
    wallet,
    creds,
    SIGNATURE_TYPE,
    FUNDER_ADDRESS
  );

  // Step 2: Test different owner/POLY_ADDRESS combinations
  log("\n--- Step 2: Test Order Placement ---");
  log("Testing which address combination works...\n");

  const testCombinations = [
    { name: "funder/funder", owner: FUNDER_ADDRESS, polyAddress: FUNDER_ADDRESS },
    { name: "wallet/wallet", owner: wallet.address, polyAddress: wallet.address },
    { name: "funder/wallet", owner: FUNDER_ADDRESS, polyAddress: wallet.address },
    { name: "wallet/funder", owner: wallet.address, polyAddress: FUNDER_ADDRESS },
  ];

  for (const combo of testCombinations) {
    log(`\n--- Testing: owner=${combo.name.split("/")[0]}, POLY_ADDRESS=${combo.name.split("/")[1]} ---`);

    try {
      // Create signed order
      const signedOrder = await client.createOrder(
        {
          tokenID: TEST_TOKEN_ID,
          price: TEST_PRICE,
          size: TEST_SIZE,
          side: Side.BUY,
        },
        { tickSize: "0.01", negRisk: false }
      );

      log("Signed order created:", {
        maker: signedOrder.maker,
        signer: signedOrder.signer,
        salt: signedOrder.salt,
      });

      // Build order payload
      const orderPayload = {
        deferExec: false,
        order: {
          salt: parseInt(signedOrder.salt, 10),
          maker: signedOrder.maker,
          signer: signedOrder.signer,
          taker: signedOrder.taker,
          tokenId: signedOrder.tokenId,
          makerAmount: signedOrder.makerAmount,
          takerAmount: signedOrder.takerAmount,
          side: "BUY",
          expiration: signedOrder.expiration,
          nonce: signedOrder.nonce,
          feeRateBps: signedOrder.feeRateBps,
          signatureType: signedOrder.signatureType,
          signature: signedOrder.signature,
        },
        owner: combo.owner,
        orderType: "GTC", // Use GTC for testing (easier to cancel if needed)
      };

      const response = await postOrderDirect(HOST, creds, combo.owner, combo.polyAddress, orderPayload);

      if (response.success) {
        logResult(`Order placement (${combo.name})`, true, {
          orderId: response.orderID,
          status: response.status,
        });

        // If successful, try to cancel the order
        if (response.orderID) {
          log("Order succeeded! Attempting to cancel...");
          try {
            const cancelResult = await client.cancelOrder({ orderID: response.orderID });
            logResult("Order cancellation", true, { canceled: cancelResult.canceled });
          } catch (cancelError) {
            logResult("Order cancellation", false, {},
              cancelError instanceof Error ? cancelError.message : String(cancelError));
          }
        }

        // Found working combination!
        log("\n=== SUCCESS ===");
        log(`Working configuration: owner=${combo.owner}, POLY_ADDRESS=${combo.polyAddress}`);
        log(`Combination name: ${combo.name}`);
        break;
      } else {
        logResult(`Order placement (${combo.name})`, false, {
          error: response.error || response.errorMsg,
        });
      }
    } catch (error) {
      logResult(`Order placement (${combo.name})`, false, {},
        error instanceof Error ? error.message : String(error));
    }
  }

  // Summary
  log("\n=== Test Summary ===");
  for (const result of results) {
    console.log(`${result.success ? "✓" : "✗"} ${result.step}`);
  }

  const successfulOrder = results.find(r => r.step.startsWith("Order placement") && r.success);
  if (successfulOrder) {
    log("\n=== RECOMMENDATION ===");
    log("Update client.ts postOrderDirect() to use the working combination above.");
  } else {
    log("\n=== TROUBLESHOOTING ===");
    log("No combination worked. Check:");
    log("1. API credentials are valid");
    log("2. Token ID exists and market is active");
    log("3. Account has sufficient balance");
    log("4. signatureType matches wallet setup (EOA=0, PROXY=1, SAFE=2)");
  }
}

main().catch(console.error);
