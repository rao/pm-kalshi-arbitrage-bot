#!/usr/bin/env bun
/**
 * CLI script to discover and display Polymarket and Kalshi 15-minute markets.
 *
 * Usage:
 *   bun scripts/discover_markets.ts           # Discover BTC markets (both venues)
 *   bun scripts/discover_markets.ts --coin ETH
 *   bun scripts/discover_markets.ts --venue polymarket  # Only Polymarket
 *   bun scripts/discover_markets.ts --venue kalshi      # Only Kalshi
 *   bun scripts/discover_markets.ts --watch   # Loop every 30s
 */

import { parseArgs } from "util";
import { GammaClient } from "../src/venues/polymarket/gamma";
import { KalshiClient } from "../src/venues/kalshi/client";
import {
  type SupportedCoin,
  SUPPORTED_COINS,
  isSupportedCoin,
} from "../src/venues/polymarket/types";
import {
  getIntervalKey,
  getNextIntervalKey,
  msUntilRollover,
  formatIntervalKey,
} from "../src/time/interval";
import {
  MarketDiscovery,
  type DiscoveryEvent,
  type Venue,
} from "../src/markets/discovery";

// Parse command line arguments
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    coin: {
      type: "string",
      short: "c",
      default: "BTC",
    },
    venue: {
      type: "string",
      short: "v",
      default: "both",
    },
    watch: {
      type: "boolean",
      short: "w",
      default: false,
    },
    interval: {
      type: "string",
      short: "i",
      default: "30",
    },
    help: {
      type: "boolean",
      short: "h",
      default: false,
    },
  },
  allowPositionals: true,
});

function printHelp(): void {
  console.log(`
Polymarket & Kalshi 15-minute Market Discovery

Usage:
  bun scripts/discover_markets.ts [options]

Options:
  -c, --coin <coin>      Coin to discover (BTC, ETH, SOL, XRP) [default: BTC]
  -v, --venue <venue>    Venue to query: polymarket, kalshi, or both [default: both]
  -w, --watch            Watch mode - continuously check for markets
  -i, --interval <sec>   Check interval in seconds for watch mode [default: 30]
  -h, --help             Show this help message

Examples:
  bun scripts/discover_markets.ts
  bun scripts/discover_markets.ts --coin ETH
  bun scripts/discover_markets.ts --venue kalshi
  bun scripts/discover_markets.ts --watch --interval 10
`);
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatPrice(price: number): string {
  return `${(price * 100).toFixed(1)}%`;
}

async function discoverOnce(
  coin: SupportedCoin,
  venues: Venue[]
): Promise<void> {
  const gamma = venues.includes("polymarket") ? new GammaClient() : null;
  const kalshi = venues.includes("kalshi") ? new KalshiClient() : null;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Market Discovery - ${coin} - ${venues.join(" & ").toUpperCase()}`);
  console.log(`${"=".repeat(70)}`);
  console.log(`Time: ${new Date().toISOString()}`);

  // Current interval info
  const currentInterval = getIntervalKey();
  const nextInterval = getNextIntervalKey();
  const msUntil = msUntilRollover();

  console.log(`\n--- Interval Info ---`);
  console.log(`Current interval: ${formatIntervalKey(currentInterval)}`);
  console.log(`Next interval:    ${formatIntervalKey(nextInterval)}`);
  console.log(`Time until rollover: ${formatMs(msUntil)}`);

  // Discover Polymarket
  if (gamma) {
    console.log(`\n${"─".repeat(35)}`);
    console.log(`POLYMARKET - Current Market`);
    console.log(`${"─".repeat(35)}`);

    const polyMarket = await gamma.getCurrentMarket(coin);
    if (polyMarket) {
      console.log(`Slug:     ${polyMarket.slug}`);
      console.log(`Question: ${polyMarket.question}`);
      console.log(`End Date: ${polyMarket.endDate}`);
      console.log(`Active:   ${polyMarket.acceptingOrders}`);
      console.log(`Token IDs:`);
      console.log(`  Up:   ${polyMarket.tokenIds.up}`);
      console.log(`  Down: ${polyMarket.tokenIds.down}`);
      console.log(`Prices:`);
      console.log(`  Up:   ${formatPrice(polyMarket.prices.up)}`);
      console.log(`  Down: ${formatPrice(polyMarket.prices.down)}`);
    } else {
      console.log(`No active market found`);
    }

    // Next market
    console.log(`\nPOLYMARKET - Next Market (Prefetch)`);
    const polyNext = await gamma.getNextMarket(coin);
    if (polyNext) {
      console.log(`Slug:   ${polyNext.slug}`);
      console.log(`Active: ${polyNext.acceptingOrders}`);
    } else {
      console.log(`Not yet available`);
    }
  }

  // Discover Kalshi
  if (kalshi) {
    console.log(`\n${"─".repeat(35)}`);
    console.log(`KALSHI - Current Event`);
    console.log(`${"─".repeat(35)}`);

    const kalshiEvent = await kalshi.getCurrentEvent(coin);
    if (kalshiEvent) {
      console.log(`Event:    ${kalshiEvent.eventTicker}`);
      console.log(`Market:   ${kalshiEvent.marketTicker}`);
      console.log(`Title:    ${kalshiEvent.title}`);
      console.log(`Subtitle: ${kalshiEvent.subtitle}`);
      console.log(`Close:    ${kalshiEvent.closeTime}`);
      console.log(`Active:   ${kalshiEvent.isActive}`);
      console.log(`Prices:`);
      console.log(
        `  Yes: ${formatPrice(kalshiEvent.yesPrices.bid)} bid / ${formatPrice(kalshiEvent.yesPrices.ask)} ask`
      );
      console.log(
        `  No:  ${formatPrice(kalshiEvent.noPrices.bid)} bid / ${formatPrice(kalshiEvent.noPrices.ask)} ask`
      );
    } else {
      console.log(`No active event found`);
    }

    // Next event
    console.log(`\nKALSHI - Next Event (Prefetch)`);
    const kalshiNext = await kalshi.getNextEvent(coin);
    if (kalshiNext) {
      console.log(`Event:  ${kalshiNext.eventTicker}`);
      console.log(`Active: ${kalshiNext.isActive}`);
    } else {
      console.log(`Not yet available`);
    }
  }

  // Summary comparison if both venues
  if (gamma && kalshi) {
    const polyMarket = await gamma.getCurrentMarket(coin);
    const kalshiEvent = await kalshi.getCurrentEvent(coin);

    if (polyMarket && kalshiEvent) {
      console.log(`\n${"─".repeat(35)}`);
      console.log(`CROSS-VENUE COMPARISON`);
      console.log(`${"─".repeat(35)}`);
      console.log(`                   Polymarket    Kalshi`);
      console.log(
        `Up/Yes Price:      ${formatPrice(polyMarket.prices.up).padEnd(12)}  ${formatPrice(kalshiEvent.yesPrices.ask)}`
      );
      console.log(
        `Down/No Price:     ${formatPrice(polyMarket.prices.down).padEnd(12)}  ${formatPrice(kalshiEvent.noPrices.ask)}`
      );

      // Calculate total cost for "buy both" arb
      const polyCost = polyMarket.prices.up + polyMarket.prices.down;
      const kalshiCost = kalshiEvent.yesPrices.ask + kalshiEvent.noPrices.ask;
      console.log(
        `Total Cost:        ${formatPrice(polyCost).padEnd(12)}  ${formatPrice(kalshiCost)}`
      );

      // Cross-venue arb (buy up on one, down on other)
      const crossArbCost1 =
        polyMarket.prices.up + kalshiEvent.noPrices.ask;
      const crossArbCost2 =
        kalshiEvent.yesPrices.ask + polyMarket.prices.down;
      console.log(`\nCross-Venue "Box" Costs:`);
      console.log(
        `  Poly Up + Kalshi No:   ${formatPrice(crossArbCost1)} (edge: ${formatPrice(1 - crossArbCost1)})`
      );
      console.log(
        `  Kalshi Yes + Poly Down: ${formatPrice(crossArbCost2)} (edge: ${formatPrice(1 - crossArbCost2)})`
      );
    }
  }

  console.log(`\n${"=".repeat(70)}\n`);
}

async function watchMode(
  coin: SupportedCoin,
  venues: Venue[],
  intervalSec: number
): Promise<void> {
  console.log(
    `\nStarting watch mode for ${coin} on ${venues.join(" & ")} (interval: ${intervalSec}s)`
  );
  console.log(`Press Ctrl+C to stop\n`);

  const discovery = new MarketDiscovery({ coin, venues });

  // Register event handlers
  discovery.onEvent((event: DiscoveryEvent) => {
    const timestamp = new Date().toISOString();

    switch (event.type) {
      case "MARKET_DISCOVERED":
        console.log(
          `[${timestamp}] [${event.venue.toUpperCase()}] DISCOVERED`
        );
        if (event.venue === "polymarket" && event.mapping.polymarket) {
          console.log(`  Slug: ${event.mapping.polymarket.slug}`);
        }
        if (event.venue === "kalshi" && event.mapping.kalshi) {
          console.log(`  Event: ${event.mapping.kalshi.eventTicker}`);
        }
        break;

      case "MARKET_CHANGED":
        console.log(`[${timestamp}] [${event.venue.toUpperCase()}] CHANGED`);
        break;

      case "PREFETCH_STARTED":
        console.log(
          `[${timestamp}] [${event.venue.toUpperCase()}] PREFETCH STARTED`
        );
        break;

      case "PREFETCH_COMPLETED":
        console.log(
          `[${timestamp}] [${event.venue.toUpperCase()}] PREFETCH ${event.success ? "SUCCESS" : "FAILED"}`
        );
        break;

      case "ROLLOVER":
        console.log(`[${timestamp}] ROLLOVER`);
        console.log(`  Old: ${formatIntervalKey(event.oldInterval)}`);
        console.log(`  New: ${formatIntervalKey(event.newInterval)}`);
        break;

      case "ERROR":
        console.error(
          `[${timestamp}] [${event.venue.toUpperCase()}] ERROR: ${event.error.message}`
        );
        break;
    }
  });

  // Start discovery
  discovery.start({
    checkIntervalMs: intervalSec * 1000,
    prefetchBeforeMs: 30_000,
    discoverImmediately: true,
  });

  // Periodic status
  const statusInterval = setInterval(() => {
    const msUntil = msUntilRollover();
    const current = discovery.getStore().getCurrentMapping();
    const polySlug = current?.polymarket?.slug || "none";
    const kalshiTicker = current?.kalshi?.eventTicker || "none";
    console.log(
      `[STATUS] Rollover in ${formatMs(msUntil)} | Poly: ${polySlug} | Kalshi: ${kalshiTicker}`
    );
  }, intervalSec * 1000);

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\nStopping discovery...");
    discovery.stop();
    clearInterval(statusInterval);
    process.exit(0);
  });

  // Keep running
  await new Promise(() => {});
}

// Main
async function main(): Promise<void> {
  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const coinInput = (values.coin || "BTC").toUpperCase();
  if (!isSupportedCoin(coinInput)) {
    console.error(
      `Error: Unsupported coin "${coinInput}". Use: ${SUPPORTED_COINS.join(", ")}`
    );
    process.exit(1);
  }

  const coin = coinInput as SupportedCoin;
  const intervalSec = parseInt(values.interval || "30", 10);

  // Parse venue option
  const venueInput = (values.venue || "both").toLowerCase();
  let venues: Venue[];
  if (venueInput === "both") {
    venues = ["polymarket", "kalshi"];
  } else if (venueInput === "polymarket" || venueInput === "poly") {
    venues = ["polymarket"];
  } else if (venueInput === "kalshi") {
    venues = ["kalshi"];
  } else {
    console.error(
      `Error: Invalid venue "${venueInput}". Use: polymarket, kalshi, or both`
    );
    process.exit(1);
  }

  if (values.watch) {
    await watchMode(coin, venues, intervalSec);
  } else {
    await discoverOnce(coin, venues);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
