/**
 * Kalshi order placement module.
 *
 * Provides functions for creating, canceling, and querying orders
 * on the Kalshi exchange.
 */

import type { KalshiAuth } from "./auth";
import type {
  KalshiOrderRequest,
  KalshiCreateOrderResponse,
  KalshiCancelOrderResponse,
  KalshiGetOrderResponse,
  KalshiGetOrdersResponse,
  KalshiGetOrdersOptions,
  KalshiBatchCancelResponse,
} from "./types";

/** Base URL for Kalshi API */
const KALSHI_API_BASE = "https://api.elections.kalshi.com";

/** API path prefix */
const API_PATH_PREFIX = "/trade-api/v2";

/**
 * Generate a UUID v4 for client_order_id.
 */
function generateClientOrderId(): string {
  return crypto.randomUUID();
}

/**
 * Build query string from options object.
 */
function buildQueryString(
  options: Record<string, string | number | undefined>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Create a new order on Kalshi.
 *
 * @param auth - Initialized KalshiAuth instance
 * @param request - Order request parameters
 * @returns Order creation response with order details
 *
 * @example
 * ```ts
 * const response = await createOrder(auth, {
 *   ticker: "KXBTC15M-26FEB031730-30",
 *   side: "yes",
 *   action: "buy",
 *   count: 1,
 *   yes_price: 50,
 *   time_in_force: "fill_or_kill"
 * });
 * ```
 */
export async function createOrder(
  auth: KalshiAuth,
  request: KalshiOrderRequest
): Promise<KalshiCreateOrderResponse> {
  // Validate price range
  if (request.yes_price !== undefined) {
    if (request.yes_price < 1 || request.yes_price > 99) {
      throw new Error(`yes_price must be between 1 and 99, got ${request.yes_price}`);
    }
  }
  if (request.no_price !== undefined) {
    if (request.no_price < 1 || request.no_price > 99) {
      throw new Error(`no_price must be between 1 and 99, got ${request.no_price}`);
    }
  }

  // Validate count
  if (request.count < 1 || !Number.isInteger(request.count)) {
    throw new Error(`count must be a positive integer, got ${request.count}`);
  }

  // Build request body
  const body: Record<string, unknown> = {
    ticker: request.ticker,
    side: request.side,
    action: request.action,
    count: request.count,
    client_order_id: request.client_order_id || generateClientOrderId(),
  };

  if (request.type !== undefined) body.type = request.type;
  if (request.yes_price !== undefined) body.yes_price = request.yes_price;
  if (request.no_price !== undefined) body.no_price = request.no_price;
  if (request.time_in_force !== undefined) body.time_in_force = request.time_in_force;
  if (request.expiration_ts !== undefined) body.expiration_ts = request.expiration_ts;
  if (request.buy_max_cost !== undefined) body.buy_max_cost = request.buy_max_cost;
  if (request.post_only !== undefined) body.post_only = request.post_only;
  if (request.reduce_only !== undefined) body.reduce_only = request.reduce_only;

  const path = `${API_PATH_PREFIX}/portfolio/orders`;
  const headers = await auth.getHeaders("POST", path);

  const response = await fetch(`${KALSHI_API_BASE}${path}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Kalshi createOrder failed (${response.status}): ${errorText}`
    );
  }

  return response.json() as Promise<KalshiCreateOrderResponse>;
}

/**
 * Cancel an existing order.
 *
 * @param auth - Initialized KalshiAuth instance
 * @param orderId - ID of the order to cancel
 * @returns Cancel response with order details and contracts reduced
 *
 * @example
 * ```ts
 * const response = await cancelOrder(auth, "order-id-123");
 * console.log(`Canceled ${response.reduced_by} contracts`);
 * ```
 */
export async function cancelOrder(
  auth: KalshiAuth,
  orderId: string
): Promise<KalshiCancelOrderResponse> {
  const path = `${API_PATH_PREFIX}/portfolio/orders/${orderId}`;
  const headers = await auth.getHeaders("DELETE", path);

  const response = await fetch(`${KALSHI_API_BASE}${path}`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Kalshi cancelOrder failed (${response.status}): ${errorText}`
    );
  }

  return response.json() as Promise<KalshiCancelOrderResponse>;
}

/**
 * Batch cancel multiple orders (up to 20 at once).
 *
 * @param auth - Initialized KalshiAuth instance
 * @param orderIds - Array of order IDs to cancel
 * @returns Batch cancel response with results for each order
 *
 * @example
 * ```ts
 * const response = await batchCancelOrders(auth, ["order-1", "order-2"]);
 * ```
 */
export async function batchCancelOrders(
  auth: KalshiAuth,
  orderIds: string[]
): Promise<KalshiBatchCancelResponse> {
  if (orderIds.length > 20) {
    throw new Error(`Maximum 20 orders per batch, got ${orderIds.length}`);
  }

  const path = `${API_PATH_PREFIX}/portfolio/orders/batched`;
  const headers = await auth.getHeaders("DELETE", path);

  const body = {
    orders: orderIds.map((id) => ({ order_id: id })),
  };

  const response = await fetch(`${KALSHI_API_BASE}${path}`, {
    method: "DELETE",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Kalshi batchCancelOrders failed (${response.status}): ${errorText}`
    );
  }

  return response.json() as Promise<KalshiBatchCancelResponse>;
}

/**
 * Get details of a single order.
 *
 * @param auth - Initialized KalshiAuth instance
 * @param orderId - ID of the order to retrieve
 * @returns Order details
 *
 * @example
 * ```ts
 * const response = await getOrder(auth, "order-id-123");
 * console.log(response.order.status);
 * ```
 */
export async function getOrder(
  auth: KalshiAuth,
  orderId: string
): Promise<KalshiGetOrderResponse> {
  const path = `${API_PATH_PREFIX}/portfolio/orders/${orderId}`;
  const headers = await auth.getHeaders("GET", path);

  const response = await fetch(`${KALSHI_API_BASE}${path}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Kalshi getOrder failed (${response.status}): ${errorText}`
    );
  }

  return response.json() as Promise<KalshiGetOrderResponse>;
}

/**
 * Get multiple orders with optional filtering.
 *
 * @param auth - Initialized KalshiAuth instance
 * @param options - Query options for filtering and pagination
 * @returns List of orders with pagination cursor
 *
 * @example
 * ```ts
 * // Get all resting orders for a market
 * const response = await getOrders(auth, {
 *   ticker: "KXBTC15M-26FEB031730-30",
 *   status: "resting"
 * });
 * ```
 */
export async function getOrders(
  auth: KalshiAuth,
  options: KalshiGetOrdersOptions = {}
): Promise<KalshiGetOrdersResponse> {
  const queryString = buildQueryString(options);
  const path = `${API_PATH_PREFIX}/portfolio/orders${queryString}`;
  const headers = await auth.getHeaders("GET", path);

  const response = await fetch(`${KALSHI_API_BASE}${path}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Kalshi getOrders failed (${response.status}): ${errorText}`
    );
  }

  return response.json() as Promise<KalshiGetOrdersResponse>;
}

/**
 * Get all open (resting) orders, optionally filtered by ticker.
 *
 * Convenience function that wraps getOrders with status="resting".
 *
 * @param auth - Initialized KalshiAuth instance
 * @param ticker - Optional market ticker to filter by
 * @returns List of resting orders
 */
export async function getOpenOrders(
  auth: KalshiAuth,
  ticker?: string
): Promise<KalshiGetOrdersResponse> {
  return getOrders(auth, {
    status: "resting",
    ticker,
  });
}

/**
 * Cancel all open orders for a specific market.
 *
 * Fetches all resting orders for the ticker and batch cancels them.
 *
 * @param auth - Initialized KalshiAuth instance
 * @param ticker - Market ticker to cancel orders for
 * @returns Number of orders canceled
 */
export async function cancelAllOrdersForMarket(
  auth: KalshiAuth,
  ticker: string
): Promise<number> {
  const { orders } = await getOpenOrders(auth, ticker);

  if (orders.length === 0) {
    return 0;
  }

  // Batch cancel in chunks of 20
  let totalCanceled = 0;
  for (let i = 0; i < orders.length; i += 20) {
    const chunk = orders.slice(i, i + 20);
    const orderIds = chunk.map((o) => o.order_id);
    await batchCancelOrders(auth, orderIds);
    totalCanceled += chunk.length;
  }

  return totalCanceled;
}
