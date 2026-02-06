#!/usr/bin/env bun
/**
 * Kalshi Signature Generator Script
 *
 * Generates KALSHI-ACCESS-SIGNATURE using RSA-PSS signing with SHA-256.
 * Loads the private key from environment variables (KALSHI_PRIVATE_KEY_PATH or KALSHI_PRIVATE_KEY).
 *
 * Usage:
 *   bun scripts/generate_kalshi_signature.ts <METHOD> <PATH>
 *
 * Examples:
 *   bun scripts/generate_kalshi_signature.ts GET /trade-api/v2/portfolio/balance
 *   bun scripts/generate_kalshi_signature.ts POST /trade-api/v2/portfolio/orders
 *
 * Environment Variables:
 *   KALSHI_API_KEY_ID or KALSHI_API_KEY - API key ID
 *   KALSHI_PRIVATE_KEY_PATH or KALSHI_PRIVATE_KEY - Path to .key file or inline PEM
 */

import { loadPrivateKey, signRequest } from "../src/venues/kalshi/auth";

/**
 * Result from signature generation
 */
export interface KalshiSignatureResult {
  /** Millisecond timestamp used for signing */
  timestamp: string;
  /** Base64-encoded RSA-PSS signature */
  signature: string;
  /** API key ID from environment */
  apiKeyId: string;
  /** HTTP method used */
  method: string;
  /** Path used (without query params) */
  path: string;
  /** The message that was signed: timestamp + method + path */
  signedMessage: string;
}

/**
 * Generate Kalshi authentication signature and timestamp.
 *
 * Uses RSA-PSS with SHA-256 and salt length 32.
 * Message format: timestamp + method + path (no query params)
 *
 * @param method - HTTP method (GET, POST, PUT, DELETE)
 * @param path - API path (e.g., /trade-api/v2/portfolio/balance)
 * @param customTimestamp - Optional custom timestamp (ms). Defaults to Date.now()
 * @returns Promise with signature result including timestamp
 *
 * @example
 * ```ts
 * import { generateKalshiSignature } from "./scripts/generate_kalshi_signature";
 *
 * const result = await generateKalshiSignature("GET", "/trade-api/v2/portfolio/balance");
 * console.log(result.signature);  // Base64 signature
 * console.log(result.timestamp);  // Millisecond timestamp
 * ```
 */
export async function generateKalshiSignature(
  method: string,
  path: string,
  customTimestamp?: number | string
): Promise<KalshiSignatureResult> {
  // Get API key ID from environment
  const apiKeyId = process.env.KALSHI_API_KEY_ID || process.env.KALSHI_API_KEY;
  if (!apiKeyId) {
    throw new Error(
      "Missing Kalshi API key ID. Set KALSHI_API_KEY_ID or KALSHI_API_KEY environment variable."
    );
  }

  // Get private key path/content from environment
  const privateKeySource =
    process.env.KALSHI_PRIVATE_KEY_PATH || process.env.KALSHI_PRIVATE_KEY;
  if (!privateKeySource) {
    throw new Error(
      "Missing Kalshi private key. Set KALSHI_PRIVATE_KEY_PATH (file path) or KALSHI_PRIVATE_KEY (inline PEM) environment variable."
    );
  }

  // Generate timestamp
  const timestamp =
    customTimestamp !== undefined ? String(customTimestamp) : Date.now().toString();

  // Normalize method to uppercase
  const normalizedMethod = method.toUpperCase();

  // Strip query parameters from path
  const pathWithoutQuery = path.split("?")[0];

  // Load the private key (supports PKCS#1 and PKCS#8 formats)
  const privateKey = await loadPrivateKey(privateKeySource);

  // Generate signature
  const signature = await signRequest(
    privateKey,
    timestamp,
    normalizedMethod,
    pathWithoutQuery
  );

  // Build the signed message for reference
  const signedMessage = `${timestamp}${normalizedMethod}${pathWithoutQuery}`;

  return {
    timestamp,
    signature,
    apiKeyId,
    method: normalizedMethod,
    path: pathWithoutQuery,
    signedMessage,
  };
}

/**
 * Generate full Kalshi authentication headers.
 *
 * Convenience wrapper that returns headers ready for fetch().
 *
 * @param method - HTTP method
 * @param path - API path
 * @param customTimestamp - Optional custom timestamp
 * @returns Headers object with all three Kalshi auth headers
 *
 * @example
 * ```ts
 * import { generateKalshiAuthHeaders } from "./scripts/generate_kalshi_signature";
 *
 * const headers = await generateKalshiAuthHeaders("GET", "/trade-api/v2/markets");
 * const response = await fetch(url, { headers });
 * ```
 */
export async function generateKalshiAuthHeaders(
  method: string,
  path: string,
  customTimestamp?: number | string
): Promise<{
  "KALSHI-ACCESS-KEY": string;
  "KALSHI-ACCESS-SIGNATURE": string;
  "KALSHI-ACCESS-TIMESTAMP": string;
}> {
  const result = await generateKalshiSignature(method, path, customTimestamp);

  return {
    "KALSHI-ACCESS-KEY": result.apiKeyId,
    "KALSHI-ACCESS-SIGNATURE": result.signature,
    "KALSHI-ACCESS-TIMESTAMP": result.timestamp,
  };
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: bun scripts/generate_kalshi_signature.ts <METHOD> <PATH>");
    console.error("");
    console.error("Examples:");
    console.error("  bun scripts/generate_kalshi_signature.ts GET /trade-api/v2/portfolio/balance");
    console.error("  bun scripts/generate_kalshi_signature.ts POST /trade-api/v2/portfolio/orders");
    console.error("");
    console.error("Environment Variables:");
    console.error("  KALSHI_API_KEY_ID or KALSHI_API_KEY - API key ID");
    console.error("  KALSHI_PRIVATE_KEY_PATH - Path to .key file");
    console.error("  KALSHI_PRIVATE_KEY - Inline PEM content");
    process.exit(1);
  }

  const [method, path] = args;

  try {
    const result = await generateKalshiSignature(method, path);

    console.log("=== Kalshi Signature Generated ===\n");
    console.log(`API Key ID:    ${result.apiKeyId}`);
    console.log(`Method:        ${result.method}`);
    console.log(`Path:          ${result.path}`);
    console.log(`Timestamp:     ${result.timestamp}`);
    console.log(`Signed Msg:    ${result.signedMessage}`);
    console.log(`\nSignature:`);
    console.log(result.signature);
    console.log("\n=== Headers for cURL/fetch ===\n");
    console.log(`KALSHI-ACCESS-KEY: ${result.apiKeyId}`);
    console.log(`KALSHI-ACCESS-TIMESTAMP: ${result.timestamp}`);
    console.log(`KALSHI-ACCESS-SIGNATURE: ${result.signature}`);
  } catch (error) {
    console.error("Error generating signature:", error);
    process.exit(1);
  }
}

// Run CLI if executed directly
if (import.meta.main) {
  main();
}
