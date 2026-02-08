import { getIntervalKey, formatIntervalKey } from "../src/time/interval";
import { fetchIntervalStartPrice } from "../src/data/fetchIntervalStartPrice";

const interval = getIntervalKey();
const elapsedMs = Date.now() - interval.startTs * 1000;

console.log(`Current interval: ${formatIntervalKey(interval)}`);
console.log(`Interval startTs: ${interval.startTs} (${new Date(interval.startTs * 1000).toISOString()})`);
console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s into interval`);
console.log();
console.log("Fetching BTC price at interval start from Binance...");

const price = await fetchIntervalStartPrice(interval.startTs);

if (price !== null) {
  console.log(`BTC price at interval start: $${price.toFixed(2)}`);
} else {
  console.log("Failed to fetch price (returned null)");
}
