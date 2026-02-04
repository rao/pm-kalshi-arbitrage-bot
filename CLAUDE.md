---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

For more information related to Bun, read the Bun API docs in `node_modules/bun-types/docs/**.md`.

### PROJECT OVERVIEW V0.1

- Description: Build a small, safety-first cross-venue arbitrage system for the always-on 15-minute BTC “Up/Down” markets on **Polymarket** and **Kalshi**. The system monitors both venues in real time, verifies that the two contracts represent the **same payoff for the same 15-minute interval**, detects net-positive arbitrage opportunities after fees/slippage, and attempts execution with strict risk limits.
- Market cadence: A new 15-minute interval starts every **HH:00, HH:15, HH:30, HH:45**. The bot must roll over to the next interval (market IDs change) without carrying stale orders.
- Current version (0.1): First iteration, max **$10 total** risked across both venues (very small size, correctness > profit).

## RELEVANT MARKET DOCUMENTATION FILES
- Located in ./docs, before writing any code related to any sort of data pulled or updated from or onto Polymarket or Kalshi, navigate through and reference through those docs first.

---

## KEY REQUIREMENT: MARKET EQUIVALENCE (NO BASIS RISK)

Before any trade, the bot must confirm market equivalence for the current interval:
- Same start/end timestamps (interval_key = {start_ts, end_ts})
- Same settlement condition (Up/Down mapping) and consistent oracle/reference rule
- If equivalence cannot be asserted deterministically, **do not trade**.

Maintain a local mapping (either in local file, in local memory, or in redis):
- interval_key -> { polymarket: token_ids(up, down), kalshi: ticker + side mapping }

---

## BASE ARBITRAGE CONDITIONS (NET OF FEES/SLIPPAGE)

Treat each interval as a binary payoff of 1.00 at settlement.

### Buy-both “box” arb (primary v1)
Execute only if:
=> bestAsk(YES_equiv) + bestAsk(NO_equiv) + feeBuffer + slippageBuffer < 1.00

Where YES_equiv/NO_equiv are the equivalent outcomes across venues (e.g., Polymarket UP == Kalshi YES, depending on mapping).

### Sell-both arb (optional / inventory-based)
If holding inventory and both venues allow it:
=> bestBid(YES_equiv) + bestBid(NO_equiv) - feeBuffer - slippageBuffer > 1.00

(v0.1 should skip this entirely and focus on buy-both only.)

---

## PARAMETERS (v0.1)

- maxNotional: **$10.00 total** split across both venues (**$5.00 portfolio on each venue**) (hard cap)
- qtyPerTrade: **1 contract per leg** (keep it tiny until correctness is proven)
- minEdgeNet: **$0.04** per completed box after fees/slippage (conservative)
- slippageBuffer: **$0.005 per leg** (initial)
- maxLegDelayMs: **500 ms** (max time allowed between legs)
- maxUnhedgedTimeMs: **1500 ms** (max time allowed holding only one leg)
- cooldownMsAfterFailure: **3000 ms**
- maxDailyLoss: **$0.50** (kill-switch threshold in v0.1)
- maxOpenOrdersPerVenue: 2

---

## MARKET DATA INGESTION (REAL-TIME)

Use WebSockets for both venues (no REST polling loops):
- Subscribe to top-of-book / orderbook updates for current interval on both Polymarket + Kalshi.
- Normalize both venues into a common quote model:

NormalizedQuote:
- yes_bid, yes_ask, yes_bid_size, yes_ask_size
- no_bid,  no_ask,  no_bid_size,  no_ask_size
- ts_exchange, ts_local

Note: Kalshi books may be represented as bids (asks may be implied). Normalize so both venues present explicit bid/ask on YES and NO.

---

## MAIN LOOP (WEBSOCKET EVENT-DRIVEN)

On any relevant quote update:
1) Ensure the bot is in the correct interval (rollover handling below).
2) Verify market equivalence + mapping for this interval_key. If not verified, skip.
3) Compute net edge:
   - cost = yesAsk_equiv + noAsk_equiv
   - edgeNet = 1.00 - cost - feeBuffer - slippageBuffer
4) Check guardrails:
   - edgeNet >= minEdgeNet
   - sufficient size exists at quoted prices for qtyPerTrade
   - totalNotional + estimatedCost <= maxNotional
   - not in cooldown
   - dailyLoss < maxDailyLoss
5) If all pass -> attempt execution (two-phase commit style).

---

## EXECUTION (TWO-PHASE COMMIT STYLE)

Goal: avoid being stuck half-filled across venues.

Execution plan (v0.1):
- Choose Leg A venue/side that is most likely to fill (better size / tighter price).
- Place Leg A as FOK (or closest equivalent) for qty=1 at the target ask.
  - If not filled: exit, do nothing.
  - If filled: immediately place Leg B as FOK at target ask (for qty=1) on the other venue/side.
    - If Leg B fills within maxLegDelayMs -> success (box locked).
    - If Leg B fails -> trigger Abort Logic.

Track timestamps for submit/fill for both legs.

---

## ABORT / UNWIND LOGIC (MANDATORY)

If Leg A fills but Leg B fails:
- Immediately unwind Leg A:
  - sell the filled position using a marketable limit / FAK at current best bid (or best available) on that venue.
- Record realized PnL (likely negative).
- Enter cooldown (cooldownMsAfterFailure).
- If realized losses reach maxDailyLoss, trigger kill switch: stop trading, cancel orders.

---

## MARKET ROLLOVER HANDLING

At each interval boundary (HH:00/15/30/45):
- Cancel all open orders on both venues for the previous interval.
- Recompute interval_key and remap to the new market IDs:
  - fetch/derive new Polymarket tokens (UP/DOWN)
  - fetch/derive new Kalshi ticker + strike mapping (if applicable)
- Re-subscribe to websockets for the new market(s).
- Reset any per-interval state (cooldowns can remain global).

Also prefetch next interval mapping ~30–60s before rollover to reduce downtime.

---

## FEES & SLIPPAGE MODEL (v0.1)

Implement a FeeEngine that returns a conservative feeBuffer per leg:
- Start with worst-case taker assumptions for both venues.
- Keep feeBuffer intentionally pessimistic until empirical fills confirm actual net edge.

slippageBuffer is additive and per-leg.

Always compute and log:
- edgeGross (no fees/slippage)
- edgeNet (after feeBuffer + slippageBuffer)

---

## POSITION TRACKING & RECONCILIATION

Maintain a PositionTracker per venue:
- open orders
- filled orders
- net positions per outcome (YES/NO equivalents)
- realized PnL

Reconcile every N seconds:
- If unexpected net exposure exists (unhedged directional risk), either hedge immediately or halt.

---

## OBSERVABILITY / LOGGING (NON-NEGOTIABLE)

For every opportunity + trade attempt, log (both in console and a .txt file of the run):
- interval_key, market IDs
- normalized quotes on both venues at decision time
- cost, edgeGross, edgeNet, fee/slippage assumptions
- order submissions and fills with timestamps
- abort/unwind details and realized PnL
- latency metrics (decision->submit, submit->fill, legA->legB)

---

## OUT OF SCOPE FOR v0.1 (DON’T BUILD YET)

- Multi-contract sizing / dynamic sizing
- Inventory-based sell-both arb
- Advanced maker strategies / rebates
- Cross-venue batching/atomicity (not possible)
- Optimizing for speed beyond basic websocket + tight loop
- Automated market equivalence inference beyond deterministic rules

---

## SUCCESS CRITERIA (v0.1)

- Correctly maps and verifies equivalent markets across Polymarket and Kalshi for each 15m interval
- Detects opportunities using normalized books and conservative fee/slippage
- Executes with minimal half-fill incidents; unwinds safely when they occur
- Produces clean logs to evaluate whether net-positive arb exists after real fees/slippage



### REPO STRUCTURE (RECOMMENDED)

This is a small-but-real trading system. Keep it modular, testable, and deterministic.

### Top-level
- /src
- /tests
- /scripts
- /.env.example
- /CLAUDE.md
- /README.md
- /package.json (or go.mod / pyproject.toml depending on language)

---

## /src MODULES

### 1) config/
**Goal:** Centralize settings + environment validation.
- config.ts
  - loads env vars (API keys, base URLs, WS URLs)
  - validates required env vars
  - exports typed Config
- constants.ts
  - interval length = 15m
  - time boundaries
- riskParams.ts
  - maxNotional, minEdgeNet, etc.

### 2) time/
**Goal:** Interval/rollover logic.
- interval.ts
  - `getIntervalKey(now): { startTs, endTs }`
  - `getNextIntervalKey(now)`
  - `msUntilRollover(now)`
- scheduler.ts
  - emits events: `INTERVAL_PREPARE`, `INTERVAL_ROLLOVER`

### 3) venues/
**Goal:** Each venue adapter is isolated and normalized.
- polymarket/
  - auth.ts (signing, headers)
  - rest.ts (fallback REST)
  - ws.ts (market data WS client)
  - orders.ts (place/cancel, FOK/FAK)
  - types.ts
- kalshi/
  - auth.ts
  - rest.ts
  - ws.ts
  - orders.ts
  - types.ts
- common/
  - `VenueClient` interface
  - errors.ts

**Core interface (conceptual)**
- `subscribeOrderbook(marketId): AsyncStream<OrderbookEvent>`
- `placeOrder(params): Promise<OrderResult>`
- `cancelAll(marketId?): Promise<void>`
- `getPositions(): Promise<PositionsSnapshot>`

### 4) markets/
**Goal:** Mapping + equivalence checks.
- mappingStore.ts
  - in-memory store + optional persistence (json file)
  - `setMapping(intervalKey, mapping)`
  - `getMapping(intervalKey)`
- equivalence.ts
  - `verifyEquivalence(mapping, metadataA, metadataB): boolean`
  - deterministic checks only (rule text fields, timestamps, strike if present)
- discovery.ts
  - `discoverPolymarketMarket(intervalKey)`
  - `discoverKalshiMarket(intervalKey)`
  - runs at PREPARE and on ROLLOVER

### 5) normalization/
**Goal:** Convert each venue’s book representation into NormalizedQuote.
- normalizePolymarket.ts
- normalizeKalshi.ts (including implied asks if needed)
- types.ts
  - `NormalizedQuote`
  - `QuoteSide`
- utils.ts
  - rounding rules, price conversions (cents vs dollars)

### 6) fees/
**Goal:** Conservative fee & slippage modeling.
- feeEngine.ts
  - `estimateFee(venue, side, price, qty, mode): number`
  - v0.1 mode = worst-case caps
- slippage.ts
  - `slippageBufferPerLeg`
- edge.ts
  - `computeEdgeNet(yesAsk, noAsk, feeBuf, slipBuf): { gross, net }`

### 7) strategy/
**Goal:** Decision logic that is pure and unit-testable.
- arbScanner.ts
  - accepts latest normalized quotes + mapping
  - returns `Opportunity | null`
- opportunityTypes.ts
  - `Opportunity { intervalKey, legs[], expectedEdgeNet, ... }`
- guards.ts
  - checks: cooldown, maxNotional, sizes, etc.

**Important:** Strategy functions should be pure:
- no IO, no network, no timers
- only input -> output

### 8) execution/
**Goal:** Two-phase commit execution + unwind.
- executor.ts
  - `execute(opportunity): Promise<ExecResult>`
  - handles Leg A then Leg B with timeouts
- orderPlanner.ts
  - choose which leg is A vs B (fill probability heuristics)
- unwind.ts
  - `unwindLeg(filledLeg): Promise<UnwindResult>`
- riskManager.ts
  - kill switch, daily loss tracking, max exposure

### 9) state/
**Goal:** Track positions, pnl, open orders, reconciliation.
- positionTracker.ts
- pnl.ts
- reconciliation.ts
  - periodic checks: positions vs expected
  - if mismatch/unhedged -> halt or hedge

### 10) logging/
**Goal:** Structured logs for every decision & execution.
- logger.ts (JSON logs)
- eventLog.ts
  - `logOpportunity(...)`
  - `logExecution(...)`
  - `logUnwind(...)`
- metrics.ts (latency stats, counters)

### 11) app/
**Goal:** Compose everything; the only “side-effect” entrypoint.
- main.ts
  - boot config
  - init venue clients
  - start scheduler
  - start WS subscriptions
  - on quote update -> scan -> execute
- lifecycle.ts
  - graceful shutdown (cancel orders, close sockets)

---

## /scripts

- smoke_test_ws.ts
  - connect to both WS and print best bid/ask
- discover_markets.ts
  - prints current interval mapping (IDs, tickers)
- cancel_all.ts
  - emergency: cancel all open orders on both venues

---

## /tests (MINIMUM)

### Unit tests (pure)
- interval.test.ts
- normalizeKalshi.test.ts
- normalizePolymarket.test.ts
- edge.test.ts
- arbScanner.test.ts
- guards.test.ts

### Integration-ish tests (with mocks)
- executor.test.ts
  - simulate: Leg A fill, Leg B fail -> unwind called

---

## DATA FLOW (VERY IMPORTANT)

WS Orderbook Events
  -> normalize -> latest quote cache
  -> strategy.arbScanner(latestQuotes, mapping, params)
  -> if opportunity -> execution.executor(opportunity)
  -> state updates + logs

---

## ENV VARS (.env.example)

- POLYMARKET_API_KEY=...
- POLYMARKET_API_SECRET=...
- POLYMARKET_WS_URL=...
- KALSHI_API_KEY=...
- KALSHI_API_SECRET=...
- KALSHI_WS_URL=...
- LOG_LEVEL=info
- DRY_RUN=true (v0.1 should support DRY_RUN to log-only)

---

## V0.1 MUST-HAVES (DO NOT SKIP)

- DRY_RUN mode
- kill switch on maxDailyLoss
- cancel-all on rollover + shutdown
- structured logs with decision + execution timestamps
- deterministic market equivalence check (no guesswork)
