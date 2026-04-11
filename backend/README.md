# Backend — Developer Reference

> **User documentation** is in the repository root: [README.md](../README.md) and [docs/](../docs/).
> This file is internal developer reference for the backend module.

---

# TradeFinderBot — Multi-Backend Perps Bot

Algorithmic trading bot that monitors a private Telegram channel for trade signals and executes them on perpetuals backends through a venue adapter.

Includes a real-time web dashboard, Telegram control bot with InlineKeyboard interface, automatic position tracking with PnL alerts, manual trading and position management, and a multi-venue architecture.

---

## How the bot runs

The canonical start command is:

```bash
./start.sh
```

`start.sh` handles secrets file validation, Node binary resolution, and process launch. It resolves the backend directory from its own location — no hardcoded paths.

Which modules run is controlled entirely by `.env` feature toggles:

File: `backend/.env`

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
Telegram channel (signals)
     │
     ▼  WebSocket MTProto (GramJS)
┌──────────────────────┐
│  telegram_listener   │  Monitors private channel in real time
└────────┬─────────────┘
         │ message text
         ▼
┌──────────────────────┐
│  [1] intake gate     │  state.status.signalIntakeEnabled — silent discard if OFF
│  [2] signal_parser   │  Regex → asset, direction, entry, TP, SL, leverage
│  [3] signal_store    │  Deduplication by signal ID
│  [4] pause gate      │  state.status.paused — logs as ignored if true
│  [5] AT gate         │  state.status.autoTrading — logs as ignored if false
└────────┬─────────────┘
         │ validated signal object
         ▼
┌──────────────────────┐   Validates: supported asset, R:R, margin,
│    risk_manager      │   leverage cap, open positions, exposure,
└────────┬─────────────┘   step size — live balance from PerpExecutionService
         │ adjusted tradeParams
         ▼
┌──────────────────────┐
│ PerpExecutionService │  Routes to venue adapter — or paper engine if paper mode
└────────┬─────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐  ┌─────────────┐
│ paper  │  │ live adapter│  backend-specific SDK/API
│ engine │  │ (venue-based│  → signs/submits order
└────────┘  └─────────────┘

┌──────────────────────────────────────────────┐
│            STATE STORE (EventEmitter)         │
│  status: { paused, autoTrading,               │
│    signalIntakeEnabled, activeVenue, mode }   │
│  Shared by: bot, web, monitor, control bot    │
└──────────────────────────────────────────────┘
```

---

## Components

| Component | File | Purpose |
|-----------|------|---------|
| Orchestrator | `src/index.js` | Wires all modules, registers command handlers |
| Config loader | `src/config/index.js` | Loads `.env` + secrets file, validates |
| State store | `src/core/state.js` | Central EventEmitter shared by all modules |
| Signal listener | `src/telegram/telegram_listener.js` | GramJS MTProto user client |
| Signal parser | `src/parser/signal_parser.js` | Regex extraction of trade parameters |
| Risk manager | `src/risk/risk_manager.js` | 7-layer pre-trade validation |
| Venue registry | `src/venues/VenueRegistry.js` | Central registry of venue manifests + capabilities |
| Perp execution service | `src/trading/PerpExecutionService.js` | Routes execution to active venue or paper engine |
| Paper engine | `src/trading/paperEngine.js` | In-memory paper trading simulation |
| Venue adapters | `src/trading/adapters/` | Backend-specific execution integrations |
| Manual trade service | `src/trading/ManualTradeService.js` | Manual open, close, reduce, TP/SL |
| Position manager | `src/trading/position-management/PositionManager.js` | PnL alerts, trailing stop |
| Web server | `src/web/server.js` | Express + Socket.IO dashboard + REST API |
| Control bot | `src/telegram/telegram_control.js` | Telegram bot with InlineKeyboard |
| Logger | `src/utils/logger.js` | Winston + daily rotation |

---

## Risk management — 7 layers

Every signal is validated before reaching the executor:

| # | Check | What it does |
|---|-------|-------------|
| 0 | Supported asset | Rejects assets not supported by the active venue |
| 1 | Leverage cap | Uses the minimum of: signal / platform / `MAX_LEVERAGE` |
| 2 | R:R minimum | Rejects if risk:reward ratio < 1:1 |
| 3 | Live snapshot | Queries the active venue directly (not cached state) |
| 4 | Max positions | Rejects if `MAX_POSITIONS` already open |
| 5 | Margin buffer | Rejects if free collateral < `MIN_FREE_MARGIN_PCT` |
| 6 | Max exposure | Caps total notional at `MAX_TOTAL_EXPOSURE_PCT` of equity |
| 7 | Step size | Rounds base amount to market step; rejects if below minimum |

---

## Supported assets

Supported assets are venue-specific and come from the active venue adapter. Signals for unsupported assets are rejected with an explicit log entry before execution.

See [../docs/en/venues.md](../docs/en/venues.md) for the current backend model and readiness status.

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
| Execution backends | Venue adapters using backend-specific SDKs/APIs |
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
- **RPC/API latency**: use reliable backend endpoints in production
- **Telegram session expiry**: renew `telegram_session.txt` in `/opt/bot/secrets/` periodically
- **Signal quality**: the bot executes any valid signal from the monitored channel — you are responsible for the signal source
- Start with `POSITION_SIZE_PCT=0.01` (1%) and `PAPER_TRADING=true` for at least 24h before going live
- Keep the required fee/gas asset available for your selected backend
- **Never invest more than you can afford to lose**
