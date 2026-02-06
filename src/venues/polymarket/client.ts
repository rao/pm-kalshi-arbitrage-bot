/**
 * Polymarket CLOB client wrapper.
 *
 * Thin wrapper around @polymarket/clob-client that provides
 * a bot-specific interface for order placement and cancellation.
 */

import { Wallet } from "@ethersproject/wallet";
import { ClobClient, Side, OrderType, Chain } from "@polymarket/clob-client";
import type { ApiKeyCreds, OpenOrder, OrderMarketCancelParams } from "@polymarket/clob-client";
import { SignatureType } from "@polymarket/order-utils";

export { Side, OrderType, SignatureType };
export type { ApiKeyCreds, OpenOrder };

/**
 * Options for creating a PolymarketClient.
 */
export interface PolymarketClientOptions {
  /** CLOB API host (e.g., https://clob.polymarket.com) */
  host: string;
  /** Signer private key (0x-prefixed hex string) */
  privateKey: string;
  /** Funder/proxy wallet address (displayed on Polymarket UI) */
  funderAddress: string;
  /** Signature type: 0=EOA, 1=POLY_PROXY, 2=GNOSIS_SAFE (default: EOA for browser wallets) */
  signatureType?: SignatureType;
}

/**
 * Result from placing an order.
 */
export interface OrderResult {
  success: boolean;
  orderId: string | null;
  errorMsg?: string;
  status?: string;
  takingAmount?: string;
  makingAmount?: string;
}

/**
 * Result from canceling orders.
 */
export interface CancelResult {
  canceled: string[];
  notCanceled: Record<string, string>;
}

/**
 * Polymarket CLOB client.
 *
 * Wraps ClobClient with a simpler interface for the arb bot's needs.
 */
export class PolymarketClient {
  private client: ClobClient | null = null;
  private wallet: Wallet;
  private options: PolymarketClientOptions;
  private creds: ApiKeyCreds | null = null;

  constructor(options: PolymarketClientOptions) {
    this.options = options;
    // Create ethers v5 wallet from private key
    const pk = options.privateKey.startsWith("0x")
      ? options.privateKey
      : `0x${options.privateKey}`;
    this.wallet = new Wallet(pk);
  }

  /**
   * Initialize the client.
   *
   * Must be called before using any other methods.
   * Always derives fresh L2 API credentials tied to the wallet address.
   * This ensures POLY_ADDRESS header always matches the credentials.
   */
  async init(): Promise<void> {
    const signatureType = this.options.signatureType ?? SignatureType.EOA;

    // First create client without creds to derive them
    const tempClient = new ClobClient(
      this.options.host,
      Chain.POLYGON,
      this.wallet,
      undefined,
      signatureType,
      this.options.funderAddress
    );

    // Derive credentials using L1 auth (always fresh, tied to wallet address)
    console.log("[POLYMARKET] Deriving L2 API credentials from private key...");
    this.creds = await tempClient.createOrDeriveApiKey();

    // Recreate client with credentials
    this.client = new ClobClient(
      this.options.host,
      Chain.POLYGON,
      this.wallet,
      this.creds,
      signatureType,
      this.options.funderAddress
    );

    console.log("[POLYMARKET] Address configuration:");
    console.log(`  Funder address: ${this.options.funderAddress}`);
    console.log(`  Signer address: ${this.wallet.address}`);
    console.log(`  Signature type: ${signatureType} (${this.getSignatureTypeName(signatureType)})`);

    // Warn if using EOA but signer != funder (likely misconfigured)
    if (
      signatureType === SignatureType.EOA &&
      this.wallet.address.toLowerCase() !== this.options.funderAddress.toLowerCase()
    ) {
      console.warn(
        "[POLYMARKET] WARNING: Using EOA signature type (0) but signer address differs from funder address. " +
        "This will likely fail with 'invalid signature' errors. " +
        "Set POLYMARKET_SIGNATURE_TYPE=2 (POLY_GNOSIS_SAFE) or =1 (POLY_PROXY) depending on your wallet type."
      );
    }
  }

  /**
   * Get the underlying ClobClient (for advanced use).
   */
  private getClient(): ClobClient {
    if (!this.client) {
      throw new Error("PolymarketClient not initialized. Call init() first.");
    }
    return this.client;
  }

  /**
   * Place a Fill-Or-Kill (FOK) order.
   *
   * The order must fill completely at the specified price or better,
   * or it will be rejected entirely.
   *
   * Uses the library's createAndPostOrder() which handles order creation
   * and posting correctly (matches working test-round-trip.ts).
   *
   * @param params - Order parameters
   * @returns Order result with success status and order ID
   */
  async placeFokOrder(params: {
    tokenId: string;
    price: number;
    size: number;
    side: Side;
  }): Promise<OrderResult> {
    const client = this.getClient();

    try {
      console.log(`[POLYMARKET] Submitting FOK order:`, JSON.stringify({
        tokenId: params.tokenId.substring(0, 20) + "...",
        price: params.price,
        size: params.size,
        side: params.side,
      }));

      // Use library's createAndPostOrder - matches working test-round-trip.ts
      const response = await client.createAndPostOrder(
        {
          tokenID: params.tokenId,
          price: params.price,
          size: params.size,
          side: params.side,
        },
        { tickSize: "0.01", negRisk: false },
        OrderType.FOK
      );

      console.log(`[POLYMARKET] Response:`, JSON.stringify(response));

      return {
        success: response.success === true,
        orderId: response.orderID || null,
        errorMsg: response.errorMsg,
        status: response.status,
        takingAmount: response.takingAmount,
        makingAmount: response.makingAmount,
      };
    } catch (error) {
      console.error(`[POLYMARKET] FOK order failed:`, error);
      return {
        success: false,
        orderId: null,
        errorMsg: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Place a Fill-And-Kill (FAK / IOC) order.
   *
   * Unlike FOK, FAK allows partial fills — any unfilled portion is canceled.
   * Uses createAndPostMarketOrder() which takes a UserMarketOrder with an
   * `amount` field instead of `size`:
   *   - BUY: amount = dollars to spend
   *   - SELL: amount = shares to sell
   *
   * @param params - Order parameters
   * @returns Order result with success status and order ID
   */
  async placeFakOrder(params: {
    tokenId: string;
    price: number;
    amount: number;
    side: Side;
  }): Promise<OrderResult> {
    const client = this.getClient();

    try {
      console.log(`[POLYMARKET] Submitting FAK order:`, JSON.stringify({
        tokenId: params.tokenId.substring(0, 20) + "...",
        price: params.price,
        amount: params.amount,
        side: params.side,
      }));

      const response = await client.createAndPostMarketOrder(
        {
          tokenID: params.tokenId,
          price: params.price,
          amount: params.amount,
          side: params.side,
        },
        { tickSize: "0.01", negRisk: false },
        OrderType.FAK
      );

      console.log(`[POLYMARKET] FAK Response:`, JSON.stringify(response));

      return {
        success: response.success === true,
        orderId: response.orderID || null,
        errorMsg: response.errorMsg,
        status: response.status,
        takingAmount: response.takingAmount,
        makingAmount: response.makingAmount,
      };
    } catch (error) {
      console.error(`[POLYMARKET] FAK order failed:`, error);
      return {
        success: false,
        orderId: null,
        errorMsg: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Place a Good-Till-Cancel (GTC) order.
   *
   * The order remains on the book until filled or canceled.
   *
   * Uses the library's createAndPostOrder() which handles order creation
   * and posting correctly.
   *
   * @param params - Order parameters
   * @returns Order result with success status and order ID
   */
  async placeGtcOrder(params: {
    tokenId: string;
    price: number;
    size: number;
    side: Side;
  }): Promise<OrderResult> {
    const client = this.getClient();

    try {
      // Use library's createAndPostOrder with GTC
      const response = await client.createAndPostOrder(
        {
          tokenID: params.tokenId,
          price: params.price,
          size: params.size,
          side: params.side,
        },
        { tickSize: "0.01", negRisk: false },
        OrderType.GTC
      );

      console.log(`[POLYMARKET] GTC Response:`, JSON.stringify(response));

      return {
        success: response.success === true,
        orderId: response.orderID || null,
        errorMsg: response.errorMsg || response.error,
        status: response.status,
      };
    } catch (error) {
      console.error(`[POLYMARKET] GTC order failed:`, error);
      return {
        success: false,
        orderId: null,
        errorMsg: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Cancel a single order by ID.
   *
   * @param orderId - Order ID (hash) to cancel
   * @returns Cancel result
   */
  async cancelOrder(orderId: string): Promise<CancelResult> {
    const client = this.getClient();

    try {
      const response = await client.cancelOrder({ orderID: orderId });
      return {
        canceled: response.canceled || [],
        notCanceled: response.not_canceled || {},
      };
    } catch (error) {
      return {
        canceled: [],
        notCanceled: { [orderId]: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  /**
   * Cancel multiple orders by ID.
   *
   * @param orderIds - Array of order IDs to cancel
   * @returns Cancel result
   */
  async cancelOrders(orderIds: string[]): Promise<CancelResult> {
    const client = this.getClient();

    try {
      const response = await client.cancelOrders(orderIds);
      return {
        canceled: response.canceled || [],
        notCanceled: response.not_canceled || {},
      };
    } catch (error) {
      const notCanceled: Record<string, string> = {};
      const errMsg = error instanceof Error ? error.message : String(error);
      for (const id of orderIds) {
        notCanceled[id] = errMsg;
      }
      return { canceled: [], notCanceled };
    }
  }

  /**
   * Cancel all open orders.
   *
   * @returns Cancel result
   */
  async cancelAllOrders(): Promise<CancelResult> {
    const client = this.getClient();

    try {
      const response = await client.cancelAll();
      return {
        canceled: response.canceled || [],
        notCanceled: response.not_canceled || {},
      };
    } catch (error) {
      return {
        canceled: [],
        notCanceled: { all: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  /**
   * Cancel all orders for a specific market or asset.
   *
   * @param options - Market condition ID and/or asset ID
   * @returns Cancel result
   */
  async cancelMarketOrders(options: {
    market?: string;
    assetId?: string;
  }): Promise<CancelResult> {
    const client = this.getClient();

    try {
      // Map to clob-client's expected parameter names
      const params: OrderMarketCancelParams = {};
      if (options.market) params.market = options.market;
      if (options.assetId) params.asset_id = options.assetId;

      const response = await client.cancelMarketOrders(params);
      return {
        canceled: response.canceled || [],
        notCanceled: response.not_canceled || {},
      };
    } catch (error) {
      return {
        canceled: [],
        notCanceled: { market: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  /**
   * Get all open orders.
   *
   * @returns Array of open orders
   */
  async getOpenOrders(): Promise<OpenOrder[]> {
    const client = this.getClient();

    try {
      const orders = await client.getOpenOrders();
      return orders || [];
    } catch (error) {
      console.error(`[POLYMARKET] Failed to get open orders:`, error);
      return [];
    }
  }

  /**
   * Get a single order by ID.
   *
   * @param orderId - Order ID (hash)
   * @returns Order details or null if not found
   */
  async getOrder(orderId: string): Promise<OpenOrder | null> {
    const client = this.getClient();

    try {
      const order = await client.getOrder(orderId);
      return order || null;
    } catch (error) {
      // Order not found typically throws
      return null;
    }
  }

  /**
   * Get USDC collateral balance available for trading.
   *
   * @returns Balance in dollars (parsed from string)
   */
  async getCollateralBalance(): Promise<number> {
    const client = this.getClient();

    try {
      const result = await client.getBalanceAllowance({
        asset_type: "COLLATERAL" as any,
      });
      const rawBalance = parseFloat(result?.balance ?? "0");
      // CLOB API returns raw on-chain units (6 decimals for USDC). Convert to dollars.
      return rawBalance / 1e6;
    } catch (error) {
      console.error(`[POLYMARKET] Failed to get collateral balance:`, error);
      return 0;
    }
  }

  /**
   * Get the balance of a conditional token (position in a market).
   *
   * @param tokenId - The conditional token ID to check
   * @returns Number of tokens held (0 if none or error)
   */
  async getConditionalTokenBalance(tokenId: string): Promise<number> {
    const client = this.getClient();

    try {
      const result = await client.getBalanceAllowance({
        asset_type: "CONDITIONAL" as any,
        token_id: tokenId,
      });
      const rawBalance = parseFloat(result?.balance ?? "0");
      // CLOB API returns raw on-chain units (6 decimals). Convert to token count.
      return rawBalance / 1e6;
    } catch (error) {
      console.error(
        `[POLYMARKET] Failed to get token balance for ${tokenId.substring(0, 20)}...:`,
        error
      );
      return 0;
    }
  }

  /**
   * Get the current API credentials.
   */
  getCredentials(): ApiKeyCreds | null {
    return this.creds;
  }

  /**
   * Get the funder/proxy wallet address.
   */
  getFunderAddress(): string {
    return this.options.funderAddress;
  }

  /**
   * Get the signer address (derived from private key).
   */
  getSignerAddress(): string {
    return this.wallet.address;
  }

  /**
   * Get human-readable name for signature type.
   */
  private getSignatureTypeName(signatureType: SignatureType): string {
    switch (signatureType) {
      case SignatureType.EOA:
        return "EOA";
      case SignatureType.POLY_PROXY:
        return "POLY_PROXY";
      case SignatureType.POLY_GNOSIS_SAFE:
        return "POLY_GNOSIS_SAFE";
      default:
        return `UNKNOWN(${signatureType})`;
    }
  }
}
