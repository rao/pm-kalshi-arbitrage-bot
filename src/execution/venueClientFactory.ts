/**
 * Venue client factory for live trading.
 *
 * Initializes authenticated venue clients and provides order placement functions.
 */

import type { Config } from "../config/config";
import type { NormalizedQuote } from "../normalization/types";
import type { Venue } from "../strategy/types";
import type { OrderParams, OrderResult, OrderStatusResult, VenueClients, LegStatus } from "./types";

// Polymarket imports
import { PolymarketClient, Side as PolySide, SignatureType } from "../venues/polymarket/client";

// Kalshi imports
import { KalshiAuth } from "../venues/kalshi/auth";
import {
  createOrder as kalshiCreateOrder,
  cancelAllOrdersForMarket as kalshiCancelAllOrdersForMarket,
  getFills as kalshiGetFills,
  getOrder as kalshiGetOrder,
} from "../venues/kalshi/orders";
import type { KalshiOrderRequest } from "../venues/kalshi/types";

/**
 * Validate that a private key is in valid Ethereum hex format.
 * @param key - The private key to validate
 * @returns true if valid hex format (64 hex chars, optionally 0x-prefixed)
 */
function isValidEthereumPrivateKey(key: string): boolean {
  // Remove 0x prefix if present
  const hexKey = key.startsWith("0x") ? key.slice(2) : key;
  // Must be exactly 64 hex characters
  return /^[0-9a-fA-F]{64}$/.test(hexKey);
}

/**
 * Initialized venue clients container.
 */
export interface InitializedClients {
  polymarket: PolymarketClient | null;
  kalshi: {
    auth: KalshiAuth;
  } | null;
}

/**
 * Function type for getting quotes.
 */
export type GetQuoteFn = (venue: Venue) => NormalizedQuote | null;

/**
 * Initialize venue clients with proper authentication.
 *
 * @param config - Application configuration with credentials
 * @returns Initialized clients (null for venues without credentials)
 */
export async function initializeVenueClients(
  config: Config
): Promise<InitializedClients> {
  const result: InitializedClients = {
    polymarket: null,
    kalshi: null,
  };

  // Initialize Polymarket
  if (config.polymarketPrivateKey && config.polymarketFunderAddress) {
    // Validate private key format before attempting to use it
    if (!isValidEthereumPrivateKey(config.polymarketPrivateKey)) {
      const keyPreview = config.polymarketPrivateKey.substring(0, 10) + "...";
      const keyLength = config.polymarketPrivateKey.length;
      throw new Error(
        `Invalid Polymarket private key format. Expected 0x-prefixed hex string (64 hex chars after prefix). ` +
        `Got: "${keyPreview}" (${keyLength} chars). ` +
        `If your key is base58-encoded (e.g., from a Solana wallet), you need the Ethereum private key instead. ` +
        `Export the correct private key from MetaMask or another Ethereum wallet.`
      );
    }

    // Determine signature type from config, defaulting to POLY_GNOSIS_SAFE (2)
    // Most Polymarket users have Gnosis Safe wallets
    const signatureType = config.polymarketSignatureType ?? SignatureType.POLY_GNOSIS_SAFE;

    // Create client - always derives fresh credentials tied to wallet address
    const client = new PolymarketClient({
      host: config.polymarketClobHost,
      privateKey: config.polymarketPrivateKey,
      funderAddress: config.polymarketFunderAddress,
      signatureType,
    });

    await client.init();
    result.polymarket = client;
  }

  // Initialize Kalshi
  if (config.kalshiApiKeyId && config.kalshiPrivateKeyPath) {
    const auth = new KalshiAuth(config.kalshiApiKeyId, config.kalshiPrivateKeyPath);
    await auth.init();

    result.kalshi = { auth };
  }

  return result;
}

/**
 * Place an order on Polymarket.
 *
 * Converts OrderParams to Polymarket format and posts via PolymarketClient.
 * For "market" orders (unwinds), uses minimum price ($0.01) for sells to ensure fill.
 *
 * @param client - Initialized PolymarketClient
 * @param params - Order parameters
 * @returns Order result
 */
async function placePolymarketOrder(
  client: PolymarketClient,
  params: OrderParams
): Promise<OrderResult> {
  const submittedAt = Date.now();

  // Determine if this is a market order (for emergency unwinds)
  const isMarketOrder = params.orderType === "market" || params.timeInForce === "MARKET";

  // For market sell orders, use minimum price ($0.01) to ensure aggressive fill
  // Polymarket doesn't have true market orders, so we simulate with aggressive limit
  const effectivePrice = isMarketOrder && params.action === "sell"
    ? 0.01
    : params.price;

  // Price bounds validation - relaxed for market sell orders (min price is valid)
  if (!isMarketOrder && (effectivePrice < 0.01 || effectivePrice > 0.99)) {
    console.error(`[POLYMARKET] Invalid price ${effectivePrice}, must be 0.01-0.99`);
    return {
      success: false,
      orderId: null,
      fillQty: 0,
      fillPrice: 0,
      venue: "polymarket",
      status: "rejected",
      submittedAt,
      filledAt: null,
      error: `Invalid price ${effectivePrice}, must be 0.01-0.99`,
    };
  }

  try {
    // Determine if this is an IOC/FAK order (for sequential execution)
    const isFakOrder = params.timeInForce === "IOC";

    // Log order details
    const orderTypeLabel = isMarketOrder ? "MARKET" : (isFakOrder ? "FAK/IOC" : "FOK");
    console.log(`[POLYMARKET] Submitting ${orderTypeLabel} order:`, JSON.stringify({
      tokenId: params.marketId,
      price: effectivePrice,
      ...(isFakOrder ? { amount: params.qty * effectivePrice } : { size: params.qty }),
      side: params.action,
    }));

    let response: { success: boolean; orderID?: string; orderId?: string; errorMsg?: string; status?: string; takingAmount?: string; makingAmount?: string };

    if (isFakOrder) {
      // FAK path: use createAndPostMarketOrder with amount (dollars to spend for BUY)
      const amount = params.action === "buy"
        ? params.qty * effectivePrice  // BUY: dollars to spend
        : params.qty;                   // SELL: shares to sell
      const fakResult = await client.placeFakOrder({
        tokenId: params.marketId,
        price: effectivePrice,
        amount,
        side: params.action === "buy" ? PolySide.BUY : PolySide.SELL,
      });
      response = { ...fakResult, orderID: fakResult.orderId ?? undefined };
    } else {
      // FOK path: use createAndPostOrder with size (unchanged)
      // For "market" orders, we use FOK with aggressive pricing
      const fokResult = await client.placeFokOrder({
        tokenId: params.marketId,
        price: effectivePrice,
        size: params.qty,
        side: params.action === "buy" ? PolySide.BUY : PolySide.SELL,
      });
      response = { ...fokResult, orderID: fokResult.orderId ?? undefined };
    }

    // Determine fill status
    // success=true + orderId present indicates fill/partial fill
    const orderId = response.orderId || response.orderID || null;
    const filled = response.success === true && orderId !== null;
    const matched = response.status === "matched";

    // Log detailed response for debugging
    console.log(`[POLYMARKET] Order response: success=${response.success}, status=${response.status}, orderId=${orderId?.substring(0, 20) ?? "N/A"}...`);

    // Compute fill qty and price from response amounts
    let fillQty = 0;
    let actualFillPrice = effectivePrice; // fallback to limit price

    if (filled && response.takingAmount && response.makingAmount) {
      const taking = parseFloat(response.takingAmount);
      const making = parseFloat(response.makingAmount);

      if (params.action === "buy" && taking > 0) {
        // BUY: takingAmount = tokens received, makingAmount = USDC paid
        fillQty = taking;
        actualFillPrice = making / taking;
      } else if (params.action === "sell" && making > 0) {
        // SELL: takingAmount = USDC received, makingAmount = tokens sold
        fillQty = making;
        actualFillPrice = taking / making;
      }

      if (isFakOrder) {
        // FAK: fillQty from amounts is authoritative (may be partial)
        console.log(`[POLYMARKET] FAK fill: ${fillQty.toFixed(2)} tokens @ $${actualFillPrice.toFixed(4)} (requested ${params.qty})`);
      } else {
        // FOK: full fill expected, use params.qty but log if amounts differ
        if (Math.abs(fillQty - params.qty) > 0.01) {
          console.log(`[POLYMARKET] FOK fill qty from amounts (${fillQty.toFixed(2)}) differs from requested (${params.qty})`);
        }
        fillQty = params.qty; // FOK: assume full fill
      }

      if (Math.abs(actualFillPrice - effectivePrice) > 0.001) {
        console.log(`[POLYMARKET] Actual fill price: $${actualFillPrice.toFixed(4)} (limit was $${effectivePrice.toFixed(2)})`);
      }
    } else if (filled) {
      // No amounts in response — fallback
      fillQty = isFakOrder ? 0 : params.qty; // FAK with no amounts = treat as 0 fill
      if (isFakOrder) {
        console.warn(`[POLYMARKET] FAK response missing takingAmount/makingAmount — treating as 0 fill`);
      }
    }

    const actuallyFilled = filled && fillQty > 0;

    return {
      success: actuallyFilled,
      orderId: orderId,
      fillQty: actuallyFilled ? fillQty : 0,
      fillPrice: actuallyFilled ? actualFillPrice : 0,
      venue: "polymarket",
      status: actuallyFilled ? "filled" as const : "rejected" as const,
      submittedAt,
      filledAt: actuallyFilled ? Date.now() : null,
      error: actuallyFilled ? null : (response.errorMsg || "Order not filled"),
    };
  } catch (error) {
    console.error(`[POLYMARKET] Order failed:`, error);
    return {
      success: false,
      orderId: null,
      fillQty: 0,
      fillPrice: 0,
      venue: "polymarket",
      status: "rejected",
      submittedAt,
      filledAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Place an order on Kalshi.
 *
 * Converts OrderParams to Kalshi format and submits via API.
 * Supports both limit (FOK) orders and market orders for unwinds.
 *
 * @param clients - Initialized Kalshi clients
 * @param params - Order parameters
 * @returns Order result
 */
async function placeKalshiOrder(
  clients: NonNullable<InitializedClients["kalshi"]>,
  params: OrderParams
): Promise<OrderResult> {
  const submittedAt = Date.now();

  // Determine if this is a market order (for emergency unwinds)
  const isMarketOrder = params.orderType === "market" || params.timeInForce === "MARKET";

  // Price bounds validation - skip for market orders (price is ignored)
  if (!isMarketOrder && (params.price < 0.01 || params.price > 0.99)) {
    console.error(`[KALSHI] Invalid price ${params.price}, must be 0.01-0.99`);
    return {
      success: false,
      orderId: null,
      fillQty: 0,
      fillPrice: 0,
      venue: "kalshi",
      status: "rejected",
      submittedAt,
      filledAt: null,
      error: `Invalid price ${params.price}, must be 0.01-0.99`,
    };
  }

  try {
    // Build Kalshi order request
    const request: KalshiOrderRequest = {
      ticker: params.marketId,
      side: params.side, // "yes" or "no"
      action: params.action, // "buy" or "sell"
      count: params.qty,
      type: isMarketOrder ? "market" : "limit",
    };

    // Set price for all orders (Kalshi requires price even for market orders)
    let priceInCents: number;

    if (isMarketOrder) {
      // Market orders: use worst-case price to ensure execution
      // For SELL: 1 cent (lowest, ensures we sell)
      // For BUY: 99 cents (highest, ensures we buy)
      priceInCents = params.action === "sell" ? 1 : 99;
    } else {
      // Limit orders: use the actual price
      priceInCents = Math.round(params.price * 100);
      priceInCents = Math.max(1, Math.min(99, priceInCents));
    }

    if (params.side === "yes") {
      request.yes_price = priceInCents;
    } else {
      request.no_price = priceInCents;
    }

    // Set reduce_only to prevent creating short positions during unwinds
    // Kalshi only allows reduce_only on IOC orders (not market or FOK)
    if (params.reduceOnly && params.timeInForce === "IOC") {
      request.reduce_only = true;
    }

    // Set time_in_force for limit orders only
    if (!isMarketOrder) {
      if (params.timeInForce === "FOK") {
        request.time_in_force = "fill_or_kill";
      } else if (params.timeInForce === "IOC") {
        request.time_in_force = "immediate_or_cancel";
      } else {
        request.time_in_force = "good_till_canceled";
      }
    }

    // Log order details for debugging
    const logDetails: Record<string, unknown> = {
      ticker: request.ticker,
      side: request.side,
      action: request.action,
      count: request.count,
      type: request.type,
    };
    if (!isMarketOrder) {
      logDetails.price = request.yes_price ?? request.no_price;
      logDetails.time_in_force = request.time_in_force;
    }
    console.log(`[KALSHI] Submitting ${isMarketOrder ? "MARKET" : "LIMIT"} order:`, JSON.stringify(logDetails));

    // Submit order
    const response = await kalshiCreateOrder(clients.auth, request);

    // Log full response for debugging
    console.log(`[KALSHI] Response:`, JSON.stringify(response.order));

    // Check fill status
    const order = response.order;
    const isIOC = params.timeInForce === "IOC";

    // Initial fill detection from order response
    // For IOC orders: partial fills are expected. The order may show status
    // "canceled" (remainder canceled after partial fill) or "executed" (fully filled).
    // Use count - remaining_count as the initial fill quantity estimate.
    // For FOK/market: either fully filled (executed) or rejected (canceled).
    const responseFillQty = (order.count ?? 0) - (order.remaining_count ?? 0);

    let filled: boolean;
    let fillQty: number;
    let fillPrice = 0;

    if (isIOC) {
      // IOC: initial estimate from order response
      fillQty = responseFillQty > 0 ? responseFillQty : 0;
      filled = fillQty > 0;

      // CRITICAL: For IOC orders, ALWAYS query Fills API as the authoritative source.
      // The createOrder response may not accurately reflect IOC fills (remaining_count
      // can equal count even when the order filled immediately).
      try {
        // Brief delay to allow Kalshi's system to record the fill
        await new Promise(r => setTimeout(r, 200));
        const fillsResponse = await kalshiGetFills(clients.auth, { order_id: order.order_id });
        if (fillsResponse.fills.length > 0) {
          // Calculate total qty and VWAP from actual fills
          let totalCost = 0;
          let totalFillQty = 0;
          for (const fill of fillsResponse.fills) {
            const price = (order.side === "yes" ? fill.yes_price : fill.no_price) / 100;
            totalCost += price * fill.count;
            totalFillQty += fill.count;
          }
          if (totalFillQty > 0) {
            // Override with authoritative fill data
            if (!filled) {
              console.warn(`[KALSHI] IOC fill detected via Fills API but NOT by order response! remaining_count=${order.remaining_count}, count=${order.count}, status=${order.status}`);
            }
            filled = true;
            fillQty = totalFillQty;
            fillPrice = totalCost / totalFillQty;
            console.log(`[KALSHI] IOC fill confirmed via Fills API: ${fillQty}/${params.qty} contracts @ $${fillPrice.toFixed(4)} (${fillsResponse.fills.length} fills)`);
          }
        }
        if (!filled) {
          console.log(`[KALSHI] IOC order: no fills detected (order response: ${responseFillQty}/${params.qty}, Fills API: 0 fills)`);
        }
      } catch (fillsError) {
        console.warn(`[KALSHI] Failed to query Fills API for IOC order, using order response data: ${fillsError instanceof Error ? fillsError.message : String(fillsError)}`);
        // Fall through to order response fill price if we had a fill from order response
        if (filled) {
          fillPrice = (order.side === "yes" ? order.yes_price : order.no_price) / 100;
        }
      }
    } else {
      filled = order.status === "executed";
      // For FOK/market: if executed, use params.qty but cross-check
      fillQty = 0;
      if (filled) {
        fillQty = params.qty;
        if (responseFillQty !== params.qty && responseFillQty > 0) {
          console.warn(`[KALSHI] Fill qty mismatch: expected ${params.qty}, response shows ${responseFillQty}`);
          fillQty = responseFillQty;
        }
      }

      // Get actual fill price for non-IOC filled orders
      if (filled) {
        // Default to the order response price
        fillPrice = (order.side === "yes" ? order.yes_price : order.no_price) / 100;

        // For market orders, query fills API to get the actual execution price
        // The order's yes_price/no_price reflects the limit, not the fill
        if (isMarketOrder) {
          try {
            const fillsResponse = await kalshiGetFills(clients.auth, { order_id: order.order_id });
            if (fillsResponse.fills.length > 0) {
              // Calculate volume-weighted average price across all fills
              let totalCost = 0;
              let totalQty = 0;
              for (const fill of fillsResponse.fills) {
                const price = (order.side === "yes" ? fill.yes_price : fill.no_price) / 100;
                totalCost += price * fill.count;
                totalQty += fill.count;
              }
              if (totalQty > 0) {
                fillPrice = totalCost / totalQty;
                console.log(`[KALSHI] Actual fill price from fills API: $${fillPrice.toFixed(4)} (${fillsResponse.fills.length} fills)`);
              }
            }
          } catch (fillsError) {
            console.warn(`[KALSHI] Failed to query fills API for actual price, using order price: ${fillsError instanceof Error ? fillsError.message : String(fillsError)}`);
          }
        }
      }
    }

    const result = {
      success: filled,
      orderId: order.order_id,
      fillQty,
      fillPrice,
      venue: "kalshi" as const,
      status: filled ? "filled" as const : "rejected" as const,
      submittedAt,
      filledAt: filled ? Date.now() : null,
      error: filled ? null : `Order status: ${order.status}`,
    };

    console.log(`[KALSHI] Result: success=${result.success}, status=${result.status}, fillQty=${result.fillQty}, fillPrice=$${result.fillPrice.toFixed(4)}`);

    return result;
  } catch (error) {
    console.error(`[KALSHI] Order failed:`, error);
    return {
      success: false,
      orderId: null,
      fillQty: 0,
      fillPrice: 0,
      venue: "kalshi",
      status: "rejected",
      submittedAt,
      filledAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create live venue clients for order execution.
 *
 * @param clients - Initialized venue clients
 * @param getQuote - Function to get current quote for a venue
 * @returns VenueClients interface for executor
 */
export function createLiveVenueClients(
  clients: InitializedClients,
  getQuote: GetQuoteFn
): VenueClients {
  return {
    placeOrder: async (params: OrderParams): Promise<OrderResult> => {
      if (params.venue === "polymarket") {
        if (!clients.polymarket) {
          return {
            success: false,
            orderId: null,
            fillQty: 0,
            fillPrice: 0,
            venue: "polymarket",
            status: "rejected",
            submittedAt: Date.now(),
            filledAt: null,
            error: "Polymarket client not initialized",
          };
        }
        return placePolymarketOrder(clients.polymarket, params);
      } else if (params.venue === "kalshi") {
        if (!clients.kalshi) {
          return {
            success: false,
            orderId: null,
            fillQty: 0,
            fillPrice: 0,
            venue: "kalshi",
            status: "rejected",
            submittedAt: Date.now(),
            filledAt: null,
            error: "Kalshi client not initialized",
          };
        }
        return placeKalshiOrder(clients.kalshi, params);
      } else {
        return {
          success: false,
          orderId: null,
          fillQty: 0,
          fillPrice: 0,
          venue: params.venue,
          status: "rejected",
          submittedAt: Date.now(),
          filledAt: null,
          error: `Unknown venue: ${params.venue}`,
        };
      }
    },

    cancelOrder: async (venue: Venue, orderId: string): Promise<boolean> => {
      try {
        if (venue === "polymarket") {
          if (!clients.polymarket) return false;
          const result = await clients.polymarket.cancelOrder(orderId);
          return result.canceled?.includes(orderId) ?? false;
        } else if (venue === "kalshi") {
          if (!clients.kalshi) return false;
          const { cancelOrder } = await import("../venues/kalshi/orders");
          await cancelOrder(clients.kalshi.auth, orderId);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    getOrderStatus: async (venue: Venue, orderId: string): Promise<OrderStatusResult> => {
      try {
        if (venue === "polymarket") {
          if (!clients.polymarket) {
            return { status: "unknown", filled: false };
          }
          const order = await clients.polymarket.getOrder(orderId);
          if (!order) {
            return { status: "not_found", filled: false };
          }
          // Polymarket OpenOrder has status field: "matched", "live", etc.
          const status = (order as any).status ?? "unknown";
          const filled = status === "matched";
          return {
            status,
            filled,
            fillPrice: filled ? Number((order as any).price ?? 0) : undefined,
            fillQty: filled ? Number((order as any).original_size ?? (order as any).size ?? 0) : undefined,
          };
        } else if (venue === "kalshi") {
          if (!clients.kalshi) {
            return { status: "unknown", filled: false };
          }
          const response = await kalshiGetOrder(clients.kalshi.auth, orderId);
          const order = response.order;
          const filled = order.status === "executed";

          let fillPrice: number | undefined;
          if (filled) {
            // Query fills API for actual execution price
            try {
              const fillsResponse = await kalshiGetFills(clients.kalshi.auth, { order_id: orderId });
              if (fillsResponse.fills.length > 0) {
                let totalCost = 0;
                let totalQty = 0;
                for (const fill of fillsResponse.fills) {
                  const price = (order.side === "yes" ? fill.yes_price : fill.no_price) / 100;
                  totalCost += price * fill.count;
                  totalQty += fill.count;
                }
                if (totalQty > 0) {
                  fillPrice = totalCost / totalQty;
                }
              }
            } catch {
              // Fall back to order price
              fillPrice = (order.side === "yes" ? order.yes_price : order.no_price) / 100;
            }
          }

          return {
            status: order.status,
            filled,
            fillPrice,
            fillQty: filled ? (order.count - (order.remaining_count ?? 0)) : undefined,
          };
        }
        return { status: "unknown", filled: false };
      } catch (error) {
        console.warn(`[VENUE] Failed to get order status for ${venue}/${orderId}: ${error instanceof Error ? error.message : String(error)}`);
        return { status: "error", filled: false };
      }
    },

    getQuote,

    getTokenBalance: async (venue: Venue, tokenId: string): Promise<number> => {
      if (venue === "polymarket" && clients.polymarket) {
        return clients.polymarket.getConditionalTokenBalance(tokenId);
      }
      return 0;
    },
  };
}

/**
 * Get Kalshi auth client for order cancellation.
 *
 * Used by the coordinator for rollover order cancellation.
 */
export function getKalshiAuth(clients: InitializedClients): KalshiAuth | null {
  return clients.kalshi?.auth ?? null;
}

/**
 * Cancel all Kalshi orders for a market.
 *
 * @param auth - Kalshi auth client
 * @param ticker - Market ticker
 * @returns Number of orders canceled
 */
export async function cancelKalshiOrdersForMarket(
  auth: KalshiAuth,
  ticker: string
): Promise<number> {
  return kalshiCancelAllOrdersForMarket(auth, ticker);
}

/**
 * Get Polymarket client for order operations.
 */
export function getPolymarketClient(
  clients: InitializedClients
): PolymarketClient | null {
  return clients.polymarket ?? null;
}
