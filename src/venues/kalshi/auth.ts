/**
 * Kalshi API authentication module.
 *
 * Implements RSA-PSS signature generation for both REST and WebSocket APIs.
 * Based on Kalshi API documentation.
 */

/**
 * Headers required for authenticated Kalshi requests.
 */
export interface KalshiAuthHeaders {
  "KALSHI-ACCESS-KEY": string;
  "KALSHI-ACCESS-SIGNATURE": string;
  "KALSHI-ACCESS-TIMESTAMP": string;
}

/**
 * Load a private key from PEM string or file path.
 *
 * Supports both PKCS#8 (-----BEGIN PRIVATE KEY-----) and
 * PKCS#1 (-----BEGIN RSA PRIVATE KEY-----) formats.
 * PKCS#1 keys are automatically converted to PKCS#8.
 *
 * @param keyPathOrPem - Path to .key file or PEM string
 * @returns CryptoKey for signing
 */
export async function loadPrivateKey(keyPathOrPem: string): Promise<CryptoKey> {
  let pemContent: string;

  // Check if it's a file path or PEM content
  if (
    keyPathOrPem.includes("-----BEGIN") ||
    keyPathOrPem.includes("-----BEGIN PRIVATE KEY-----")
  ) {
    pemContent = keyPathOrPem;
  } else {
    // Load from file using Bun.file
    const file = Bun.file(keyPathOrPem);
    pemContent = await file.text();
  }

  // Detect key format
  const isPkcs1 = pemContent.includes("-----BEGIN RSA PRIVATE KEY-----");

  // Parse PEM to binary
  const pemLines = pemContent.split("\n");
  const base64Content = pemLines
    .filter(
      (line) =>
        !line.startsWith("-----BEGIN") &&
        !line.startsWith("-----END") &&
        line.trim() !== ""
    )
    .join("");

  let binaryKey = Uint8Array.from(atob(base64Content), (c) => c.charCodeAt(0));

  // Convert PKCS#1 to PKCS#8 if needed
  if (isPkcs1) {
    binaryKey = convertPkcs1ToPkcs8(binaryKey);
  }

  // Import as CryptoKey for RSA-PSS
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    {
      name: "RSA-PSS",
      hash: "SHA-256",
    },
    false, // not extractable
    ["sign"]
  );

  return privateKey;
}

/**
 * Convert PKCS#1 RSA private key to PKCS#8 format.
 *
 * PKCS#8 PrivateKeyInfo structure (RFC 5208):
 *   SEQUENCE {
 *     INTEGER 0 (version)
 *     SEQUENCE { OID rsaEncryption, NULL } (algorithm)
 *     OCTET STRING { pkcs1Key } (privateKey)
 *   }
 *
 * @param pkcs1Key - Raw PKCS#1 key bytes
 * @returns PKCS#8 formatted key bytes
 */
function convertPkcs1ToPkcs8(pkcs1Key: Uint8Array): Uint8Array {
  // Version: INTEGER 0
  const version = new Uint8Array([0x02, 0x01, 0x00]);

  // AlgorithmIdentifier: SEQUENCE { OID rsaEncryption, NULL }
  // OID 1.2.840.113549.1.1.1 = rsaEncryption
  const algorithmId = new Uint8Array([
    0x30, 0x0d,                         // SEQUENCE (13 bytes)
    0x06, 0x09,                         // OID (9 bytes)
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, // 1.2.840.113549
    0x01, 0x01, 0x01,                   // .1.1.1 (rsaEncryption)
    0x05, 0x00                          // NULL
  ]);

  // Build the OCTET STRING wrapping the PKCS#1 key
  const octetStringHeader = encodeAsn1Length(0x04, pkcs1Key.length);

  // Calculate total inner length (version + algorithmId + octetString)
  const innerLength = version.length + algorithmId.length + octetStringHeader.length + pkcs1Key.length;

  // Build outer SEQUENCE
  const sequenceHeader = encodeAsn1Length(0x30, innerLength);

  // Combine all parts
  const pkcs8Key = new Uint8Array(
    sequenceHeader.length + version.length + algorithmId.length + octetStringHeader.length + pkcs1Key.length
  );

  let offset = 0;
  pkcs8Key.set(sequenceHeader, offset); offset += sequenceHeader.length;
  pkcs8Key.set(version, offset); offset += version.length;
  pkcs8Key.set(algorithmId, offset); offset += algorithmId.length;
  pkcs8Key.set(octetStringHeader, offset); offset += octetStringHeader.length;
  pkcs8Key.set(pkcs1Key, offset);

  return pkcs8Key;
}

/**
 * Encode ASN.1 DER tag and length.
 *
 * Handles short form (length < 128) and long form (length >= 128).
 *
 * @param tag - ASN.1 tag byte
 * @param length - Content length
 * @returns Tag + length bytes
 */
function encodeAsn1Length(tag: number, length: number): Uint8Array {
  if (length < 128) {
    // Short form: single length byte
    return new Uint8Array([tag, length]);
  } else if (length < 256) {
    // Long form: 0x81 + 1 length byte
    return new Uint8Array([tag, 0x81, length]);
  } else if (length < 65536) {
    // Long form: 0x82 + 2 length bytes
    return new Uint8Array([tag, 0x82, (length >> 8) & 0xff, length & 0xff]);
  } else {
    // Long form: 0x83 + 3 length bytes
    return new Uint8Array([
      tag, 0x83,
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff
    ]);
  }
}

/**
 * Sign a request using RSA-PSS with SHA-256.
 *
 * The message format is: timestamp + method + path
 * Example: "1703123456789GET/trade-api/v2/portfolio/balance"
 *
 * @param privateKey - CryptoKey loaded via loadPrivateKey
 * @param timestamp - Timestamp in milliseconds (string)
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - Request path without query parameters
 * @returns Base64-encoded signature
 */
export async function signRequest(
  privateKey: CryptoKey,
  timestamp: string,
  method: string,
  path: string
): Promise<string> {
  // Strip query parameters from path
  const pathWithoutQuery = path.split("?")[0];

  // Create the message to sign
  const message = `${timestamp}${method}${pathWithoutQuery}`;
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(message);

  // Sign with RSA-PSS
  const signature = await crypto.subtle.sign(
    {
      name: "RSA-PSS",
      saltLength: 32, // SHA-256 digest length
    },
    privateKey,
    messageBytes
  );

  // Convert to base64
  const signatureBytes = new Uint8Array(signature);
  return btoa(String.fromCharCode(...signatureBytes));
}

/**
 * Generate authentication headers for a Kalshi request.
 *
 * @param apiKeyId - Kalshi API key ID
 * @param privateKey - CryptoKey loaded via loadPrivateKey
 * @param method - HTTP method
 * @param path - Request path
 * @param timestamp - Optional timestamp (defaults to now)
 * @returns Headers object
 */
export async function generateAuthHeaders(
  apiKeyId: string,
  privateKey: CryptoKey,
  method: string,
  path: string,
  timestamp?: string
): Promise<KalshiAuthHeaders> {
  const ts = timestamp || Date.now().toString();
  const signature = await signRequest(privateKey, ts, method, path);

  return {
    "KALSHI-ACCESS-KEY": apiKeyId,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": ts,
  };
}

/**
 * Generate authentication headers for WebSocket connection.
 *
 * WebSocket auth uses GET method and the WS path.
 *
 * @param apiKeyId - Kalshi API key ID
 * @param privateKey - CryptoKey loaded via loadPrivateKey
 * @returns Headers object for WebSocket connection
 */
export async function generateWsAuthHeaders(
  apiKeyId: string,
  privateKey: CryptoKey
): Promise<KalshiAuthHeaders> {
  return generateAuthHeaders(apiKeyId, privateKey, "GET", "/trade-api/ws/v2");
}

/**
 * Convenience class for managing Kalshi authentication.
 */
export class KalshiAuth {
  private apiKeyId: string;
  private privateKey: CryptoKey | null = null;
  private keySource: string;
  private cachedHeaders: { key: string; promise: Promise<KalshiAuthHeaders>; ts: number } | null = null;

  /**
   * Create a KalshiAuth instance.
   *
   * @param apiKeyId - Kalshi API key ID
   * @param privateKeyPathOrPem - Path to private key file or PEM string
   */
  constructor(apiKeyId: string, privateKeyPathOrPem: string) {
    this.apiKeyId = apiKeyId;
    this.keySource = privateKeyPathOrPem;
  }

  /**
   * Initialize by loading the private key.
   *
   * Must be called before using other methods.
   */
  async init(): Promise<void> {
    this.privateKey = await loadPrivateKey(this.keySource);
  }

  /**
   * Check if initialized.
   */
  isInitialized(): boolean {
    return this.privateKey !== null;
  }

  /**
   * Get headers for a REST API request.
   *
   * @param method - HTTP method
   * @param path - Request path
   * @returns Headers object
   */
  async getHeaders(method: string, path: string): Promise<KalshiAuthHeaders> {
    if (!this.privateKey) {
      throw new Error("KalshiAuth not initialized. Call init() first.");
    }
    return generateAuthHeaders(this.apiKeyId, this.privateKey, method, path);
  }

  /**
   * Pre-compute and cache auth headers for an upcoming request.
   * Starts the RSA-PSS signing in the background so it's ready when needed.
   *
   * @param method - HTTP method
   * @param path - Request path
   */
  precomputeHeaders(method: string, path: string): void {
    this.cachedHeaders = {
      key: `${method}:${path}`,
      promise: this.getHeaders(method, path),
      ts: Date.now(),
    };
  }

  /**
   * Get headers, using pre-computed cache if available and fresh (< 2s).
   * Falls back to computing fresh headers if no cache hit.
   *
   * @param method - HTTP method
   * @param path - Request path
   * @returns Headers object
   */
  async getHeadersCached(method: string, path: string): Promise<KalshiAuthHeaders> {
    const key = `${method}:${path}`;
    if (this.cachedHeaders?.key === key && Date.now() - this.cachedHeaders.ts < 2000) {
      const cached = this.cachedHeaders;
      this.cachedHeaders = null;
      return cached.promise;
    }
    return this.getHeaders(method, path);
  }

  /**
   * Get headers for WebSocket connection.
   *
   * @returns Headers object
   */
  async getWsHeaders(): Promise<KalshiAuthHeaders> {
    if (!this.privateKey) {
      throw new Error("KalshiAuth not initialized. Call init() first.");
    }
    return generateWsAuthHeaders(this.apiKeyId, this.privateKey);
  }

  /**
   * Get the API key ID.
   */
  getApiKeyId(): string {
    return this.apiKeyId;
  }
}

/**
 * Create and initialize a KalshiAuth instance.
 *
 * Convenience function that handles async initialization.
 *
 * @param apiKeyId - Kalshi API key ID
 * @param privateKeyPathOrPem - Path to private key file or PEM string
 * @returns Initialized KalshiAuth instance
 */
export async function createKalshiAuth(
  apiKeyId: string,
  privateKeyPathOrPem: string
): Promise<KalshiAuth> {
  const auth = new KalshiAuth(apiKeyId, privateKeyPathOrPem);
  await auth.init();
  return auth;
}
