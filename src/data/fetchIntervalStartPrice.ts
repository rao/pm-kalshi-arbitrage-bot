/**
 * Fetches the BTC price at a specific interval start time from Binance's aggTrades REST API.
 *
 * Used on mid-interval startup to pre-seed the volatility exit manager's reference price
 * with the actual BTC price at interval start (instead of the first WS tick, which may be stale).
 */

const BINANCE_AGG_TRADES_URL = "https://api1.binance.com/api/v3/aggTrades";

/**
 * Fetch the BTC price at the given interval start timestamp.
 *
 * @param intervalStartTs - Unix timestamp in **seconds** (matching IntervalKey.startTs)
 * @returns The BTC price at interval start, or null on failure (non-fatal)
 */
export async function fetchIntervalStartPrice(
  intervalStartTs: number
): Promise<number | null> {
  const startTimeMs = intervalStartTs * 1000;
  const endTimeMs = startTimeMs + 1000; // +1 second window

  const url = `${BINANCE_AGG_TRADES_URL}?symbol=BTCUSDT&startTime=${startTimeMs}&endTime=${endTimeMs}&limit=1`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(
        `[fetchIntervalStartPrice] Binance API returned ${response.status}: ${response.statusText}`
      );
      return null;
    }

    const trades: Array<{ p: string }> = await response.json();

    if (!trades || trades.length === 0) {
      console.warn(
        `[fetchIntervalStartPrice] No trades found for startTime=${startTimeMs}`
      );
      return null;
    }

    const price = parseFloat(trades[0].p);
    if (isNaN(price)) {
      console.warn(
        `[fetchIntervalStartPrice] Failed to parse price: ${trades[0].p}`
      );
      return null;
    }

    return price;
  } catch (error) {
    console.warn(
      `[fetchIntervalStartPrice] Fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}
