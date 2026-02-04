/**
 * Polymarket authentication module.
 *
 * Handles both L1 (EIP-712) and L2 (HMAC-SHA256) authentication
 * for the Polymarket CLOB API.
 */

import { createHmac } from "crypto";
import {
  createWalletClient,
  http,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

/**
 * API credentials for L2 authentication.
 */
export interface PolymarketApiCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

/**
 * L1 authentication headers.
 */
export interface PolymarketL1Headers {
  POLY_ADDRESS: string;
  POLY_SIGNATURE: string;
  POLY_TIMESTAMP: string;
  POLY_NONCE: string;
}

/**
 * L2 authentication headers.
 */
export interface PolymarketL2Headers {
  POLY_ADDRESS: string;
  POLY_SIGNATURE: string;
  POLY_TIMESTAMP: string;
  POLY_API_KEY: string;
  POLY_PASSPHRASE: string;
}

/**
 * EIP-712 domain for CLOB authentication.
 */
const CLOB_AUTH_DOMAIN = {
  name: "ClobAuthDomain",
  version: "1",
  chainId: 137, // Polygon mainnet
} as const;

/**
 * EIP-712 types for CLOB authentication.
 */
const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "message", type: "string" },
  ],
} as const;

/**
 * Standard message for CLOB authentication.
 */
const CLOB_AUTH_MESSAGE = "This message attests that I control the given wallet";

/**
 * Build HMAC-SHA256 signature for L2 authentication.
 *
 * The message format is: timestamp + method + requestPath + body
 *
 * @param secret - Base64-encoded API secret
 * @param timestamp - Unix timestamp string
 * @param method - HTTP method (GET, POST, DELETE)
 * @param requestPath - Request path (e.g., /order)
 * @param body - Request body string (empty string for GET/DELETE)
 * @returns Base64-encoded HMAC signature
 */
export function buildHmacSignature(
  secret: string,
  timestamp: string,
  method: string,
  requestPath: string,
  body: string = ""
): string {
  const message = timestamp + method + requestPath + body;
  const secretBuffer = Buffer.from(secret, "base64");
  const hmac = createHmac("sha256", secretBuffer);
  hmac.update(message);
  return hmac.digest("base64");
}

/**
 * Build L2 authentication headers for a request.
 *
 * @param creds - API credentials (apiKey, secret, passphrase)
 * @param address - Polygon wallet address
 * @param method - HTTP method
 * @param requestPath - Request path
 * @param body - Request body (optional)
 * @returns Headers object for L2 authenticated request
 *
 * @example
 * ```ts
 * const headers = buildL2Headers(
 *   creds,
 *   "0x1234...",
 *   "POST",
 *   "/order",
 *   JSON.stringify(orderPayload)
 * );
 * ```
 */
export function buildL2Headers(
  creds: PolymarketApiCredentials,
  address: string,
  method: string,
  requestPath: string,
  body: string = ""
): PolymarketL2Headers {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = buildHmacSignature(
    creds.secret,
    timestamp,
    method,
    requestPath,
    body
  );

  return {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: timestamp,
    POLY_API_KEY: creds.apiKey,
    POLY_PASSPHRASE: creds.passphrase,
  };
}

/**
 * Sign an EIP-712 message for L1 authentication.
 *
 * @param account - Viem private key account
 * @param address - Wallet address
 * @param timestamp - Unix timestamp string
 * @param nonce - Nonce (default 0)
 * @returns Hex-encoded signature
 */
export async function signL1Message(
  account: PrivateKeyAccount,
  address: string,
  timestamp: string,
  nonce: bigint = BigInt(0)
): Promise<string> {
  const client = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  const signature = await client.signTypedData({
    account,
    domain: CLOB_AUTH_DOMAIN,
    types: CLOB_AUTH_TYPES,
    primaryType: "ClobAuth",
    message: {
      address: address as `0x${string}`,
      timestamp,
      nonce,
      message: CLOB_AUTH_MESSAGE,
    },
  });

  return signature;
}

/**
 * Build L1 authentication headers for a request.
 *
 * Used for creating/deriving API keys.
 *
 * @param privateKey - Private key (0x-prefixed hex string)
 * @param nonce - Nonce for the request (default 0)
 * @returns Headers object for L1 authenticated request
 *
 * @example
 * ```ts
 * const headers = await buildL1Headers("0xabc123...", BigInt(0));
 * ```
 */
export async function buildL1Headers(
  privateKey: string,
  nonce: bigint = BigInt(0)
): Promise<PolymarketL1Headers> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const address = account.address;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const signature = await signL1Message(account, address, timestamp, nonce);

  return {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: timestamp,
    POLY_NONCE: nonce.toString(),
  };
}

/**
 * Derive or create API credentials using L1 authentication.
 *
 * @param host - CLOB API host (e.g., https://clob.polymarket.com)
 * @param privateKey - Private key (0x-prefixed hex string)
 * @param nonce - Nonce for derivation (default 0)
 * @returns API credentials
 */
export async function deriveApiCredentials(
  host: string,
  privateKey: string,
  nonce: bigint = BigInt(0)
): Promise<PolymarketApiCredentials> {
  const headers = await buildL1Headers(privateKey, nonce);

  const response = await fetch(`${host}/auth/derive-api-key`, {
    method: "GET",
    headers: headers as unknown as HeadersInit,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to derive API credentials (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  return {
    apiKey: data.apiKey,
    secret: data.secret,
    passphrase: data.passphrase,
  };
}

/**
 * Create new API credentials using L1 authentication.
 *
 * @param host - CLOB API host (e.g., https://clob.polymarket.com)
 * @param privateKey - Private key (0x-prefixed hex string)
 * @param nonce - Nonce for creation (default 0)
 * @returns API credentials
 */
export async function createApiCredentials(
  host: string,
  privateKey: string,
  nonce: bigint = BigInt(0)
): Promise<PolymarketApiCredentials> {
  const headers = await buildL1Headers(privateKey, nonce);

  const response = await fetch(`${host}/auth/api-key`, {
    method: "POST",
    headers: headers as unknown as HeadersInit,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to create API credentials (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  return {
    apiKey: data.apiKey,
    secret: data.secret,
    passphrase: data.passphrase,
  };
}

/**
 * Create or derive API credentials.
 *
 * First tries to derive existing credentials, then creates new ones if needed.
 *
 * @param host - CLOB API host
 * @param privateKey - Private key
 * @param nonce - Nonce (default 0)
 * @returns API credentials
 */
export async function createOrDeriveApiCredentials(
  host: string,
  privateKey: string,
  nonce: bigint = BigInt(0)
): Promise<PolymarketApiCredentials> {
  try {
    return await deriveApiCredentials(host, privateKey, nonce);
  } catch {
    return await createApiCredentials(host, privateKey, nonce);
  }
}

/**
 * Polymarket authentication client.
 *
 * Manages both L1 and L2 authentication for a wallet.
 */
export class PolymarketAuth {
  private privateKey: string;
  private account: PrivateKeyAccount;
  private creds: PolymarketApiCredentials | null = null;
  private funderAddress: string;

  /**
   * Create a PolymarketAuth instance.
   *
   * @param privateKey - Signer private key (0x-prefixed hex)
   * @param funderAddress - Funder/proxy wallet address (displayed on Polymarket)
   */
  constructor(privateKey: string, funderAddress: string) {
    this.privateKey = privateKey;
    this.account = privateKeyToAccount(privateKey as `0x${string}`);
    this.funderAddress = funderAddress;
  }

  /**
   * Get the signer address.
   */
  getSignerAddress(): string {
    return this.account.address;
  }

  /**
   * Get the funder/maker address.
   */
  getFunderAddress(): string {
    return this.funderAddress;
  }

  /**
   * Get the viem account for signing.
   */
  getAccount(): PrivateKeyAccount {
    return this.account;
  }

  /**
   * Set API credentials directly.
   */
  setCredentials(creds: PolymarketApiCredentials): void {
    this.creds = creds;
  }

  /**
   * Get current API credentials.
   */
  getCredentials(): PolymarketApiCredentials | null {
    return this.creds;
  }

  /**
   * Initialize by deriving or creating API credentials.
   *
   * @param host - CLOB API host
   * @param nonce - Nonce for credential derivation
   */
  async init(host: string, nonce: bigint = BigInt(0)): Promise<void> {
    this.creds = await createOrDeriveApiCredentials(host, this.privateKey, nonce);
  }

  /**
   * Check if initialized with API credentials.
   */
  isInitialized(): boolean {
    return this.creds !== null;
  }

  /**
   * Get L1 headers for authentication.
   *
   * @param nonce - Nonce for the request
   */
  async getL1Headers(nonce: bigint = BigInt(0)): Promise<PolymarketL1Headers> {
    return buildL1Headers(this.privateKey, nonce);
  }

  /**
   * Get L2 headers for a request.
   *
   * @param method - HTTP method
   * @param requestPath - Request path
   * @param body - Request body (optional)
   */
  getL2Headers(
    method: string,
    requestPath: string,
    body: string = ""
  ): PolymarketL2Headers {
    if (!this.creds) {
      throw new Error("PolymarketAuth not initialized. Call init() first.");
    }
    return buildL2Headers(this.creds, this.funderAddress, method, requestPath, body);
  }
}

/**
 * Create and initialize a PolymarketAuth instance.
 *
 * @param privateKey - Signer private key
 * @param funderAddress - Funder/proxy wallet address
 * @param host - CLOB API host
 * @param nonce - Nonce for credential derivation
 * @returns Initialized PolymarketAuth instance
 */
export async function createPolymarketAuth(
  privateKey: string,
  funderAddress: string,
  host: string,
  nonce: bigint = BigInt(0)
): Promise<PolymarketAuth> {
  const auth = new PolymarketAuth(privateKey, funderAddress);
  await auth.init(host, nonce);
  return auth;
}
