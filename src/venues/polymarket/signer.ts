/**
 * Polymarket order signing module.
 *
 * Implements EIP-712 signing for Polymarket CLOB orders using viem.
 */

import {
  createWalletClient,
  http,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

/**
 * Side of the order.
 */
export type OrderSide = "BUY" | "SELL";

/**
 * Side enum values for EIP-712 signing.
 * BUY = 0, SELL = 1
 */
export const SIDE_VALUES = {
  BUY: 0,
  SELL: 1,
} as const;

/**
 * Signature type values.
 * EOA = 0, POLY_PROXY = 1, GNOSIS_SAFE = 2
 */
export const SIGNATURE_TYPE = {
  EOA: 0,
  POLY_PROXY: 1,
  GNOSIS_SAFE: 2,
} as const;

export type SignatureType = (typeof SIGNATURE_TYPE)[keyof typeof SIGNATURE_TYPE];

/**
 * Input parameters for creating an order.
 */
export interface OrderInput {
  /** ERC-1155 token ID (string, large number) */
  tokenId: string;
  /** Price (0-1) representing probability */
  price: number;
  /** Number of shares to trade */
  size: number;
  /** Order side: BUY or SELL */
  side: OrderSide;
  /** Fee rate in basis points (default 0) */
  feeRateBps?: number;
  /** Order nonce (default: current timestamp in seconds) */
  nonce?: number;
  /** Order expiration Unix timestamp (default: 0 = no expiration) */
  expiration?: number;
}

/**
 * Full order structure for EIP-712 signing.
 */
export interface Order {
  /** Random salt for uniqueness */
  salt: bigint;
  /** Maker address (funder/proxy wallet) */
  maker: string;
  /** Signer address */
  signer: string;
  /** Taker address (operator - fixed for Polymarket) */
  taker: string;
  /** ERC-1155 token ID */
  tokenId: bigint;
  /** Maker amount (USDC in 6 decimals) */
  makerAmount: bigint;
  /** Taker amount (shares in 6 decimals) */
  takerAmount: bigint;
  /** Expiration timestamp (0 = no expiration) */
  expiration: bigint;
  /** Order nonce */
  nonce: bigint;
  /** Fee rate in basis points */
  feeRateBps: bigint;
  /** Side: 0 = BUY, 1 = SELL */
  side: number;
  /** Signature type: 0 = EOA, 1 = POLY_PROXY, 2 = GNOSIS_SAFE */
  signatureType: number;
}

/**
 * Signed order ready to post to CLOB.
 */
export interface SignedOrder {
  order: {
    salt: string;
    maker: string;
    signer: string;
    taker: string;
    tokenId: string;
    makerAmount: string;
    takerAmount: string;
    expiration: string;
    nonce: string;
    feeRateBps: string;
    side: string;
    signatureType: string;
  };
  signature: string;
}

/**
 * Polymarket operator address (taker for all orders).
 */
const OPERATOR_ADDRESS = "0xC5d563A36AE78145C45a50134d48A1215220f80a";

/**
 * USDC decimals on Polygon.
 */
const USDC_DECIMALS = 6;

/**
 * EIP-712 domain for Polymarket orders.
 */
const ORDER_DOMAIN = {
  name: "Polymarket CTF Exchange",
  version: "1",
  chainId: 137, // Polygon mainnet
} as const;

/**
 * EIP-712 types for Polymarket orders.
 */
const ORDER_TYPES = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "taker", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "feeRateBps", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" },
  ],
} as const;

/**
 * Generate a random salt for order uniqueness.
 */
function generateSalt(): bigint {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  return BigInt("0x" + Buffer.from(randomBytes).toString("hex"));
}

/**
 * Round a price to the nearest tick (0.01).
 */
function roundToTick(price: number, tickSize: number = 0.01): number {
  return Math.round(price / tickSize) * tickSize;
}

/**
 * Calculate maker and taker amounts for an order.
 *
 * For BUY orders:
 * - makerAmount = price * size (USDC spent)
 * - takerAmount = size (shares received)
 *
 * For SELL orders:
 * - makerAmount = size (shares spent)
 * - takerAmount = price * size (USDC received)
 */
function calculateAmounts(
  price: number,
  size: number,
  side: OrderSide
): { makerAmount: bigint; takerAmount: bigint } {
  const priceDecimal = roundToTick(price);
  const sizeInUnits = BigInt(Math.floor(size * 10 ** USDC_DECIMALS));
  const priceInUnits = BigInt(Math.floor(priceDecimal * 10 ** USDC_DECIMALS));

  if (side === "BUY") {
    // Buying: spend USDC, receive shares
    // makerAmount = price * size (in USDC units)
    // takerAmount = size (in share units)
    const makerAmount = (priceInUnits * sizeInUnits) / BigInt(10 ** USDC_DECIMALS);
    return {
      makerAmount,
      takerAmount: sizeInUnits,
    };
  } else {
    // Selling: spend shares, receive USDC
    // makerAmount = size (in share units)
    // takerAmount = price * size (in USDC units)
    const takerAmount = (priceInUnits * sizeInUnits) / BigInt(10 ** USDC_DECIMALS);
    return {
      makerAmount: sizeInUnits,
      takerAmount,
    };
  }
}

/**
 * Build an Order struct from input parameters.
 *
 * @param input - Order input parameters
 * @param makerAddress - Maker/funder address (proxy wallet)
 * @param signerAddress - Signer address
 * @param signatureType - Signature type (default: GNOSIS_SAFE)
 * @returns Order struct ready for signing
 */
export function buildOrder(
  input: OrderInput,
  makerAddress: string,
  signerAddress: string,
  signatureType: SignatureType = SIGNATURE_TYPE.GNOSIS_SAFE
): Order {
  const { makerAmount, takerAmount } = calculateAmounts(
    input.price,
    input.size,
    input.side
  );

  const nonce = input.nonce ?? Math.floor(Date.now() / 1000);
  const expiration = input.expiration ?? 0;

  return {
    salt: generateSalt(),
    maker: makerAddress,
    signer: signerAddress,
    taker: OPERATOR_ADDRESS,
    tokenId: BigInt(input.tokenId),
    makerAmount,
    takerAmount,
    expiration: BigInt(expiration),
    nonce: BigInt(nonce),
    feeRateBps: BigInt(input.feeRateBps ?? 0),
    side: SIDE_VALUES[input.side],
    signatureType,
  };
}

/**
 * Sign an order using EIP-712.
 *
 * @param account - Viem private key account
 * @param order - Order to sign
 * @returns Hex-encoded signature
 */
export async function signOrderEip712(
  account: PrivateKeyAccount,
  order: Order
): Promise<string> {
  const client = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  const signature = await client.signTypedData({
    account,
    domain: ORDER_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: {
      salt: order.salt,
      maker: order.maker as `0x${string}`,
      signer: order.signer as `0x${string}`,
      taker: order.taker as `0x${string}`,
      tokenId: order.tokenId,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      expiration: order.expiration,
      nonce: order.nonce,
      feeRateBps: order.feeRateBps,
      side: order.side,
      signatureType: order.signatureType,
    },
  });

  return signature;
}

/**
 * Convert Order to SignedOrder format for API submission.
 */
function orderToSignedOrder(order: Order, signature: string): SignedOrder {
  return {
    order: {
      salt: order.salt.toString(),
      maker: order.maker,
      signer: order.signer,
      taker: order.taker,
      tokenId: order.tokenId.toString(),
      makerAmount: order.makerAmount.toString(),
      takerAmount: order.takerAmount.toString(),
      expiration: order.expiration.toString(),
      nonce: order.nonce.toString(),
      feeRateBps: order.feeRateBps.toString(),
      side: order.side.toString(),
      signatureType: order.signatureType.toString(),
    },
    signature,
  };
}

/**
 * Create and sign an order.
 *
 * @param privateKey - Signer private key (0x-prefixed hex)
 * @param makerAddress - Maker/funder address (proxy wallet)
 * @param input - Order input parameters
 * @param signatureType - Signature type (default: GNOSIS_SAFE)
 * @returns Signed order ready for API submission
 *
 * @example
 * ```ts
 * const signedOrder = await signOrder(
 *   "0xabc123...",
 *   "0xdef456...",
 *   {
 *     tokenId: "12345...",
 *     price: 0.65,
 *     size: 100,
 *     side: "BUY"
 *   }
 * );
 * ```
 */
export async function signOrder(
  privateKey: string,
  makerAddress: string,
  input: OrderInput,
  signatureType: SignatureType = SIGNATURE_TYPE.GNOSIS_SAFE
): Promise<SignedOrder> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const signerAddress = account.address;

  const order = buildOrder(input, makerAddress, signerAddress, signatureType);
  const signature = await signOrderEip712(account, order);

  return orderToSignedOrder(order, signature);
}

/**
 * Polymarket order signer.
 *
 * Manages order signing for a wallet.
 */
export class PolymarketSigner {
  private privateKey: string;
  private account: PrivateKeyAccount;
  private makerAddress: string;
  private signatureType: SignatureType;

  /**
   * Create a PolymarketSigner instance.
   *
   * @param privateKey - Signer private key (0x-prefixed hex)
   * @param makerAddress - Maker/funder address (proxy wallet)
   * @param signatureType - Signature type (default: GNOSIS_SAFE)
   */
  constructor(
    privateKey: string,
    makerAddress: string,
    signatureType: SignatureType = SIGNATURE_TYPE.GNOSIS_SAFE
  ) {
    this.privateKey = privateKey;
    this.account = privateKeyToAccount(privateKey as `0x${string}`);
    this.makerAddress = makerAddress;
    this.signatureType = signatureType;
  }

  /**
   * Get the signer address.
   */
  getSignerAddress(): string {
    return this.account.address;
  }

  /**
   * Get the maker/funder address.
   */
  getMakerAddress(): string {
    return this.makerAddress;
  }

  /**
   * Sign an order.
   *
   * @param input - Order input parameters
   * @returns Signed order ready for API submission
   */
  async sign(input: OrderInput): Promise<SignedOrder> {
    return signOrder(
      this.privateKey,
      this.makerAddress,
      input,
      this.signatureType
    );
  }

  /**
   * Build an order without signing (for inspection).
   *
   * @param input - Order input parameters
   * @returns Order struct
   */
  buildOrder(input: OrderInput): Order {
    return buildOrder(
      input,
      this.makerAddress,
      this.account.address,
      this.signatureType
    );
  }
}
