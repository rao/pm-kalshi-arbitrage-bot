/**
 * Polymarket order placement module.
 *
 * Provides functions for posting, canceling, and querying orders
 * on the Polymarket CLOB.
 */

import type { PolymarketAuth } from "./auth";
import type { SignedOrder } from "./signer";
import type {
  PolymarketOrderType,
  PolymarketPostOrderResponse,
  PolymarketCancelResponse,
  PolymarketOpenOrder,
  PolymarketGetOrdersResponse,
} from "./types";

/** Default CLOB API host */
const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";

/**
 * Polymarket order client.
 *
 * Handles all order-related API calls.
 */
export class PolymarketOrderClient {
  private auth: PolymarketAuth;
  private host: string;

  /**
   * Create a PolymarketOrderClient.
   *
   * @param auth - Initialized PolymarketAuth instance
   * @param host - CLOB API host (optional)
   */
  constructor(auth: PolymarketAuth, host: string = DEFAULT_CLOB_HOST) {
    this.auth = auth;
    this.host = host.replace(/\/$/, ""); // Remove trailing slash
  }

  /**
   * Make an authenticated request to the CLOB API.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const bodyStr = body ? JSON.stringify(body) : "";
    const headers = this.auth.getL2Headers(method, path, bodyStr);

    const fetchOptions: RequestInit = {
      method,
      headers: {
        ...(headers as unknown as Record<string, string>),
        "Content-Type": "application/json",
      },
    };

    if (body && (method === "POST" || method === "DELETE")) {
      fetchOptions.body = bodyStr;
    }

    const response = await fetch(`${this.host}${path}`, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Polymarket API error (${response.status}): ${errorText}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Post a signed order to the CLOB.
   *
   * @param signedOrder - Order signed via PolymarketSigner
   * @param orderType - Order type (GTC, GTD, FOK)
   * @returns Order response with success status and order ID
   *
   * @example
   * ```ts
   * const response = await client.postOrder(signedOrder, "FOK");
   * if (response.success) {
   *   console.log("Order placed:", response.orderId);
   * }
   * ```
   */
  async postOrder(
    signedOrder: SignedOrder,
    orderType: PolymarketOrderType = "GTC"
  ): Promise<PolymarketPostOrderResponse> {
    const payload = {
      order: signedOrder.order,
      signature: signedOrder.signature,
      owner: this.auth.getCredentials()?.apiKey,
      orderType,
    };

    return this.request<PolymarketPostOrderResponse>("POST", "/order", payload);
  }

  /**
   * Cancel a single order.
   *
   * @param orderId - Order ID (hash) to cancel
   * @returns Cancel response
   *
   * @example
   * ```ts
   * const response = await client.cancelOrder("0xabc123...");
   * console.log("Canceled:", response.canceled);
   * ```
   */
  async cancelOrder(orderId: string): Promise<PolymarketCancelResponse> {
    return this.request<PolymarketCancelResponse>("DELETE", "/order", {
      orderID: orderId,
    });
  }

  /**
   * Cancel multiple orders.
   *
   * @param orderIds - Array of order IDs to cancel
   * @returns Cancel response
   */
  async cancelOrders(orderIds: string[]): Promise<PolymarketCancelResponse> {
    return this.request<PolymarketCancelResponse>("DELETE", "/orders", orderIds);
  }

  /**
   * Cancel all open orders.
   *
   * @returns Cancel response
   */
  async cancelAllOrders(): Promise<PolymarketCancelResponse> {
    return this.request<PolymarketCancelResponse>("DELETE", "/cancel-all", {});
  }

  /**
   * Cancel all orders for a specific market or token.
   *
   * @param options - Market condition ID and/or token ID
   * @returns Cancel response
   *
   * @example
   * ```ts
   * // Cancel by market
   * await client.cancelMarketOrders({ market: "0x..." });
   *
   * // Cancel by token
   * await client.cancelMarketOrders({ asset_id: "12345..." });
   * ```
   */
  async cancelMarketOrders(options: {
    market?: string;
    asset_id?: string;
  }): Promise<PolymarketCancelResponse> {
    return this.request<PolymarketCancelResponse>(
      "DELETE",
      "/cancel-market-orders",
      options
    );
  }

  /**
   * Get a single order by ID.
   *
   * @param orderId - Order ID (hash)
   * @returns Order details or undefined if not found
   */
  async getOrder(orderId: string): Promise<PolymarketOpenOrder | undefined> {
    try {
      const response = await this.request<{ order: PolymarketOpenOrder }>(
        "GET",
        `/data/order/${orderId}`
      );
      return response.order;
    } catch (error) {
      // Order not found returns 404
      if (error instanceof Error && error.message.includes("404")) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Get all open orders.
   *
   * @returns List of open orders
   */
  async getOpenOrders(): Promise<PolymarketOpenOrder[]> {
    const response = await this.request<PolymarketGetOrdersResponse>(
      "GET",
      "/data/orders"
    );
    return response.orders || [];
  }
}

/**
 * Post a signed order to the CLOB.
 *
 * Standalone function that doesn't require a client instance.
 *
 * @param auth - Initialized PolymarketAuth instance
 * @param signedOrder - Order signed via PolymarketSigner
 * @param orderType - Order type (GTC, GTD, FOK)
 * @param host - CLOB API host (optional)
 * @returns Order response
 */
export async function postOrder(
  auth: PolymarketAuth,
  signedOrder: SignedOrder,
  orderType: PolymarketOrderType = "GTC",
  host: string = DEFAULT_CLOB_HOST
): Promise<PolymarketPostOrderResponse> {
  const client = new PolymarketOrderClient(auth, host);
  return client.postOrder(signedOrder, orderType);
}

/**
 * Cancel a single order.
 *
 * Standalone function that doesn't require a client instance.
 *
 * @param auth - Initialized PolymarketAuth instance
 * @param orderId - Order ID to cancel
 * @param host - CLOB API host (optional)
 * @returns Cancel response
 */
export async function cancelOrder(
  auth: PolymarketAuth,
  orderId: string,
  host: string = DEFAULT_CLOB_HOST
): Promise<PolymarketCancelResponse> {
  const client = new PolymarketOrderClient(auth, host);
  return client.cancelOrder(orderId);
}

/**
 * Cancel all open orders.
 *
 * Standalone function that doesn't require a client instance.
 *
 * @param auth - Initialized PolymarketAuth instance
 * @param host - CLOB API host (optional)
 * @returns Cancel response
 */
export async function cancelAllOrders(
  auth: PolymarketAuth,
  host: string = DEFAULT_CLOB_HOST
): Promise<PolymarketCancelResponse> {
  const client = new PolymarketOrderClient(auth, host);
  return client.cancelAllOrders();
}

/**
 * Cancel all orders for a market/token.
 *
 * Standalone function that doesn't require a client instance.
 *
 * @param auth - Initialized PolymarketAuth instance
 * @param tokenId - Token ID to cancel orders for
 * @param host - CLOB API host (optional)
 * @returns Cancel response
 */
export async function cancelMarketOrders(
  auth: PolymarketAuth,
  tokenId: string,
  host: string = DEFAULT_CLOB_HOST
): Promise<PolymarketCancelResponse> {
  const client = new PolymarketOrderClient(auth, host);
  return client.cancelMarketOrders({ asset_id: tokenId });
}

/**
 * Get a single order by ID.
 *
 * Standalone function that doesn't require a client instance.
 *
 * @param auth - Initialized PolymarketAuth instance
 * @param orderId - Order ID (hash)
 * @param host - CLOB API host (optional)
 * @returns Order details or undefined if not found
 */
export async function getOrder(
  auth: PolymarketAuth,
  orderId: string,
  host: string = DEFAULT_CLOB_HOST
): Promise<PolymarketOpenOrder | undefined> {
  const client = new PolymarketOrderClient(auth, host);
  return client.getOrder(orderId);
}

/**
 * Get all open orders.
 *
 * Standalone function that doesn't require a client instance.
 *
 * @param auth - Initialized PolymarketAuth instance
 * @param host - CLOB API host (optional)
 * @returns List of open orders
 */
export async function getOpenOrders(
  auth: PolymarketAuth,
  host: string = DEFAULT_CLOB_HOST
): Promise<PolymarketOpenOrder[]> {
  const client = new PolymarketOrderClient(auth, host);
  return client.getOpenOrders();
}
