# Polymarket & Kalshi Arbitrage Bot

Cross-venue arbitrage bot for 15-minute BTC Up/Down prediction markets on [Polymarket](https://polymarket.com) and [Kalshi](https://kalshi.com).

Monitors both venues in real time via WebSockets, detects net-positive "box" arbitrage opportunities (buy YES on one venue + buy NO on the other for < $1.00 combined), and executes with a two-phase commit strategy and automatic unwind on failure.

**IMPORTANT NOTE**: This bot fully works. It made me money, 100% profit over some hours. It just is not sustainable long-term due to oracle resolution differences on both of the platforms, which can lead to wipeouts and what I like to call price "dead zones", and you end up losing your balance on both platforms. **Proceed with caution.** If you can end up fixing and avoiding these possible dead zones, you will end up profiting long-term, but it is **dangerous** to use this program otherwise.

## How It Works

Every 15 minutes (HH:00, HH:15, HH:30, HH:45), both Polymarket and Kalshi list binary contracts on whether BTC will be up or down relative to a reference price. Since the contracts represent the same underlying event, their prices should sum to $1.00 across venues. When they don't (after accounting for fees and slippage), a risk-free arbitrage exists.

**Example:** If Polymarket asks $0.45 for UP and Kalshi asks $0.48 for DOWN, the total cost is $0.93. Since one side _must_ pay out $1.00, the guaranteed profit is $0.07 minus fees.

### Data Flow

```
Binance BTC Price Feed ────────────────────────-─┐
                                                 │
Polymarket WS ──→ Normalize ──┐                  │
                              ├──→ Arb Scanner ──┼──→ Guards ──→ Executor
Kalshi WS ──────→ Normalize ──┘                  │       │
                                                 │       ├──→ Leg A (FOK)
Market Discovery (Gamma + Kalshi REST) ──────────┘       ├──→ Leg B (FOK)
                                                         └──→ Unwind (on failure)
```

## Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- A Polymarket account with:
  - API credentials (key, secret, passphrase)
  - A funded wallet (USDC on Polygon)
  - Token approvals set up (see [Setup](#setup))
- A Kalshi account with:
  - API key and RSA private key
  - A funded account (USD)

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment variables

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

#### Polymarket Credentials

You need L2 API credentials from Polymarket. These are derived from your wallet's private key.

| Variable | Description |
|----------|-------------|
| `POLY_API_KEY` | API key from Polymarket CLOB API |
| `POLY_SECRET` | API secret from Polymarket CLOB API |
| `POLY_PASSPHRASE` | API passphrase from Polymarket CLOB API |
| `POLY_WALLET_ADDRESS` | Your Polymarket wallet address (proxy or EOA) |
| `POLYMARKET_WALLET_PRIVATE_KEY` | Private key for order signing (`0x`-prefixed hex) |
| `POLYMARKET_FUNDER_ADDRESS` | Funder wallet address (often same as wallet address) |
| `POLYMARKET_SIGNATURE_TYPE` | `0` = EOA, `1` = POLY_PROXY, `2` = POLY_GNOSIS_SAFE (default: `2`) |

To get your API credentials, follow the [Polymarket CLOB API docs](https://docs.polymarket.com/#clob-api). You'll sign a message with your wallet to derive the key/secret/passphrase.

#### Kalshi Credentials

| Variable | Description |
|----------|-------------|
| `KALSHI_API_KEY` | Your Kalshi API key ID |
| `KALSHI_PRIVATE_KEY` | RSA private key in PEM format (inline, including `BEGIN`/`END` headers) |

Generate API credentials from your [Kalshi account settings](https://kalshi.com/account/settings). You'll receive an API key ID and download an RSA private key file.

For the `KALSHI_PRIVATE_KEY` env var, paste the full PEM content (including headers) wrapped in quotes:

```
KALSHI_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEow...
...
-----END RSA PRIVATE KEY-----"
```

#### Bot Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `DRY_RUN` | `true` = log-only, no real trades. `false` = live trading. | `true` |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error` | `info` |
| `POLYGON_RPC_URL` | Polygon RPC endpoint for on-chain operations | `https://polygon-rpc.com` |

#### Optional API Host Overrides

These default to production endpoints and rarely need changing:

| Variable | Default |
|----------|---------|
| `GAMMA_API_HOST` | `https://gamma-api.polymarket.com` |
| `POLYMARKET_CLOB_HOST` | `https://clob.polymarket.com` |
| `KALSHI_API_HOST` | `https://api.elections.kalshi.com` |

### 3. Verify market discovery

Make sure the bot can find active markets on both venues:

```bash
bun run discover
```

This prints the current 15-minute interval and the corresponding market IDs on Polymarket and Kalshi. Use `--watch` to continuously monitor:

```bash
bun run discover:watch
```

### 4. Test WebSocket connections

```bash
bun scripts/smoke_test_ws.ts
```

This connects to both venue WebSockets and prints live orderbook data.

## Running

### Dry run (recommended first)

Dry run mode processes everything normally but does not submit real orders. Use this to verify the bot correctly discovers markets, normalizes quotes, and detects opportunities:

```bash
bun run dev
```

### Live trading

```bash
bun run live
```

This sets `DRY_RUN=false` and enables real order execution. **Start with small size and monitor closely.**

### What to expect

On startup, the bot:

1. Loads config and validates credentials
2. Discovers current interval markets on both venues
3. Connects to Binance BTC price feed, Polymarket WS, and Kalshi WS
4. Begins scanning for arbitrage on every quote update
5. Logs opportunities, executions, and risk state continuously
6. Automatically rolls over to new markets every 15 minutes

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Run in dry-run mode (no real trades) |
| `bun run live` | Run in live trading mode |
| `bun run test` | Run all unit tests |
| `bun run discover` | Print current interval market mapping |
| `bun run discover:watch` | Continuously watch market discovery |
| `bun run setup:allowances` | Approve Polymarket token contracts |
| `bun run check:allowances` | Verify Polymarket token approvals |
| `bun scripts/smoke_test_ws.ts` | Test WebSocket connections to both venues |
| `bun scripts/test_binance_ws.ts` | Test Binance BTC price feed |
| `bun scripts/check-positions.ts` | View current positions on both venues |
| `bun scripts/sell-all-positions.ts` | Emergency: liquidate all positions |
| `bun scripts/sell-position.ts` | Sell a specific position |
| `bun scripts/unstick_nonce.ts` | Recover from Polymarket nonce issues |

## Architecture

```
src/
├── config/           # Environment loading, risk parameters
├── time/             # 15-minute interval logic, rollover scheduling
├── venues/
│   ├── polymarket/   # CLOB client, Gamma API, WebSocket, types
│   └── kalshi/       # REST client, auth, WebSocket, orders, types
├── markets/          # Market discovery (automatic), interval-to-ID mapping
├── normalization/    # Convert venue-specific books → NormalizedQuote
├── fees/             # Exact fee formulas per venue, edge computation
├── strategy/         # Pure arb scanner, pre-flight guard checks
├── execution/        # Two-phase executor, unwind logic, kill switch
├── state/            # Position tracking, balance reconciliation
├── data/             # WS coordinator, Binance feed, TWAP, settlement tracking
├── logging/          # Structured logs, CSV export, metrics
└── index.ts          # Entry point — composes and orchestrates everything
```

### Key Design Decisions

- **Pure strategy layer**: `arbScanner` and `guards` are pure functions (no I/O, no side effects) — easy to test and reason about.
- **Event-driven, not polling**: All quote processing is triggered by WebSocket updates.
- **Two-phase commit**: Leg A executes first (FOK). Only if it fills does Leg B fire. If Leg B fails, Leg A is automatically unwound via a price ladder.
- **Conservative defaults**: Kill switch on daily loss, cooldowns between trades, position reconciliation, volatility-triggered exits.

### Fee Model

Both venue fee formulas are implemented exactly:

- **Polymarket**: `ceil_4dp(shares * price * 0.25 * (price * (1 - price))^2)` — quartic, max ~1.56% at price 0.50
- **Kalshi**: `ceil_cents(0.07 * contracts * price * (1 - price))` — parabolic, max 2 cents at price 0.50

A per-leg slippage buffer ($0.005) is added on top.

### Risk Controls

| Control | Description |
|---------|-------------|
| Kill switch | Halts all trading if daily loss exceeds threshold |
| Cooldown | Pause between trades (longer after failures) |
| Position reconciliation | Periodic REST checks vs local state, auto-corrects mismatches |
| Volatility exit | Sells positions when BTC crosses reference price multiple times near interval end |
| Pre-close unwind | Exits 95% of position 70s before rollover |
| Balance monitor | Triggers kill switch if venue cash drops below minimum |
| No-new-positions cutoff | Blocks new arbs within 75s of rollover |

### Logging

- **Console**: Leveled structured logs (info/debug/warn/error) with periodic status reports
- **Text logs**: `logs/` directory, one file per execution run
- **CSV exports**: `logs_v2/` directory with `executions.csv` and `settlements.csv` for analysis

## Tests

```bash
bun test
```

22 test files covering interval logic, normalization, fee calculation, arb scanning, guard checks, execution flow, position tracking, reconciliation, volatility exits, and more.

## Risk Parameters

Key parameters in `src/config/riskParams.ts` (tune these for your risk tolerance):

| Parameter | Value | Description |
|-----------|-------|-------------|
| `minEdgeNet` | $0.04 | Minimum net edge after fees/slippage to trade |
| `slippageBufferPerLeg` | $0.005 | Per-leg slippage estimate |
| `maxLegDelayMs` | 500ms | Max time between leg A and leg B |
| `cooldownMsAfterFailure` | 3s | Pause after failed execution |
| `cooldownMsAfterSuccess` | 1s | Pause after successful execution |
| `maxDailyLoss` | $20 | Kill switch threshold |
| `preCloseUnwindMs` | 70s | Start exiting before rollover |
| `noNewPositionsCutoffMs` | 75s | Block new positions before rollover |

## Disclaimer

This software is provided as-is for educational and research purposes. Trading prediction markets involves real financial risk. Use at your own risk. Always start in dry-run mode, verify everything works correctly, and monitor live trading closely. The authors are not responsible for any financial losses.

## License

MIT
