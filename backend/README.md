# Backend — Developer Reference

> **User documentation** is in the repository root: [README.md](../README.md) and [docs/](../docs/).
> This file is internal developer reference for the backend module.

---

# TradeFinderBot — Drift Protocol Perps on Solana

Algorithmic trading bot that monitors a private Telegram channel for trade signals and executes them automatically on [Drift Protocol](https://drift.trade/) (on-chain perpetuals on Solana).

Includes a real-time web dashboard, CLI monitor, Telegram control bot with InlineKeyboard interface, and automatic position tracking with PnL alerts.

---

## How the bot runs

The canonical start command is:

```bash
./start.sh
```

`start.sh` handles secrets file validation, Node binary resolution, and process launch. It resolves the backend directory from its own location — no hardcoded paths.

Which modules run is controlled entirely by `.env` feature toggles:

```env
ENABLE_SIGNAL_LISTENER=true   # Telegram MTProto listener (trade signals)
ENABLE_WEB=true               # Express + Socket.IO web dashboard
ENABLE_CONTROL_BOT=false      # Telegram control bot with InlineKeyboard
```

No CLI flags needed. The start command is always the same — `.env` decides the behavior.

In production, the bot runs as a systemd service (`bot-trader.service`) which calls `backend/start.sh` with no flags.

---

## Secrets strategy

Configuration is split into two files:

| File | Location | Contains | In repo? |
|------|----------|----------|---------|
| `.env` | `backend/.env` | Non-secret config: trading limits, feature flags, file paths | Yes (no real secrets) |
| `bot-secrets.env` | `/opt/bot/secrets/bot-secrets.env` | Real secrets: RPC URL, Telegram credentials, bot token | Never |

The bot refuses to start if the secrets file is missing or contains any `SET_IN_SERVER_ONLY` placeholder.

See [.env.example](.env.example) for a fully documented reference of every variable.

---

## Architecture

```
Canal Telegram (signals)
     │
     ▼  WebSocket MTProto (GramJS)
┌──────────────────┐
│ telegram_listener│  Monitors private channel in real time
└────────┬─────────┘
         │ message text
         ▼
┌──────────────────┐
│  signal_parser   │  Regex → asset, direction, entry, TP, SL, leverage
└────────┬─────────┘
         │ signal object
         ▼
┌──────────────────┐
│  signal_store    │  Deduplication by signal ID
└────────┬─────────┘
         ▼
┌──────────────────┐   Validates: supported asset, R:R, margin,
│  risk_manager    │   leverage cap, open positions, exposure,
└────────┬─────────┘   step size — live data from DriftUser
         │ adjusted tradeParams
         ▼
┌──────────────────┐
│  drift_executor  │  Drift SDK v2 → sign TX → Solana mainnet
└──────────────────┘

┌────────────────────────────────────────────┐
│         STATE STORE (EventEmitter)          │
│  Shared by: bot, web, monitor, control bot  │
└────────────────────────────────────────────┘
```

---

## Components

| Component | File | Purpose |
|-----------|------|---------|
| Orchestrator | `src/index.js` | Wires all modules, handles CLI flags |
| Config loader | `src/config/index.js` | Loads `.env` + secrets file, validates |
| State store | `src/core/state.js` | Central EventEmitter shared by all modules |
| Signal listener | `src/telegram/telegram_listener.js` | GramJS MTProto user client |
| Signal parser | `src/parser/signal_parser.js` | Regex extraction of trade parameters |
| Risk manager | `src/risk/risk_manager.js` | 7-layer pre-trade validation |
| Executor | `src/executor/drift_executor.js` | Drift Protocol SDK v2 integration |
| Web server | `src/web/server.js` | Express + Socket.IO dashboard |
| Control bot | `src/telegram/telegram_control.js` | Telegram bot with InlineKeyboard |
| CLI monitor | `src/monitor/index.js` | Standalone terminal dashboard |
| Logger | `src/utils/logger.js` | Winston + daily rotation |

---

## Risk management — 7 layers

Every signal is validated before reaching the executor:

| # | Check | What it does |
|---|-------|-------------|
| 0 | Supported asset | Rejects assets not in `DRIFT_MARKET_INDEX` |
| 1 | Leverage cap | Uses the minimum of: signal / platform / `MAX_LEVERAGE` |
| 2 | R:R minimum | Rejects if risk:reward ratio < 1:1 |
| 3 | Live snapshot | Queries DriftUser directly (not cached state) |
| 4 | Max positions | Rejects if `MAX_POSITIONS` already open |
| 5 | Margin buffer | Rejects if free collateral < `MIN_FREE_MARGIN_PCT` |
| 6 | Max exposure | Caps total notional at `MAX_TOTAL_EXPOSURE_PCT` of equity |
| 7 | Step size | Rounds base amount to market step; rejects if below minimum |

---

## Supported assets (Drift Protocol)

| Asset | Market Index | Notes |
|-------|-------------|-------|
| SOL | 0 | |
| BTC | 1 | |
| ETH | 2 | |
| APT | 3 | |
| 1MBONK / BONK | 4 | Drift uses 1M multiplier |
| POL / MATIC | 5 | MATIC renamed to POL |
| ARB | 6 | |
| DOGE | 7 | |
| BNB | 8 | |
| SUI | 9 | |
| WIF | 23 | |
| JUP | 24 | |

Signals for unsupported assets are rejected with an explicit log entry.

---

## NPM scripts

These scripts are shortcuts for development. In production, always use `./start.sh`.

| Command | Description |
|---------|-------------|
| `npm start` | Bot (modules per `.env`) |
| `npm run dev` | Bot with hot-reload (`--watch`) |
| `npm run paper` | Override: paper trading mode |
| `npm run web` | Override: force-enable web dashboard |
| `npm run full` | Override: force web + control bot |
| `npm run full:paper` | Override: full stack in paper mode |
| `npm run monitor` | CLI monitor standalone |
| `npm run monitor:paper` | CLI monitor in paper trading mode |

> npm scripts bypass secrets file loading — they call `node src/index.js` directly. Use `./start.sh` for production and systemd.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Telegram signals | GramJS (MTProto) — monitors private channels as a user client |
| Telegram control | node-telegram-bot-api — bot with InlineKeyboard |
| Blockchain | Drift Protocol SDK v2 — on-chain perps on Solana |
| Web dashboard | Express + Socket.IO |
| Logging | Winston + daily rotation |
| Process manager | systemd (production) |

---

## Guides

- [Quick Start — local run](docs/quick-start-local.md)
- [Quick Start — VM / production](docs/quick-start-vm.md)
- [Git commands](docs/git-commands.md)
- [Systemd service details](deploy/systemd/README.md)

---

## Risks and warnings

- **Leverage** can result in full position liquidation
- **RPC latency**: use a premium node (Helius, QuickNode, Triton) in production
- **Telegram session expiry**: renew `telegram_session.txt` in `/opt/bot/secrets/` periodically
- **Signal quality**: the bot executes any valid signal from the monitored channel — you are responsible for the signal source
- Start with `POSITION_SIZE_PCT=0.01` (1%) and `PAPER_TRADING=true` for at least 24h before going live
- Keep SOL in the wallet to pay gas fees (~0.1 SOL for many transactions)
- **Never invest more than you can afford to lose**
