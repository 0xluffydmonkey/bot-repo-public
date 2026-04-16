# TradeFinderBot

> **Leia em Português:** [README.pt-BR.md](README.pt-BR.md)

Algorithmic trading bot platform that monitors a private Telegram channel for trade signals and can execute perpetual trades through a configured backend/venue.

Supports paper trading, manual position management, real-time dashboard, Telegram control bot, and multi-venue architecture.

---

## Quick Start

```bash
git clone git@github.com:YOUR_USER/bot-repo.git
cd bot-repo
./start.sh
```

That's it. The bot starts, validates your secrets, and waits for signals.

---

## First Run Checklist

Before running `./start.sh` for the first time:

- [ ] Node.js >= 18 installed (`node --version`)
- [ ] `npm install` run inside `backend/`
- [ ] `backend/.env` created from `backend/.env.example`
- [ ] Secrets file created at `/opt/bot/secrets/bot-secrets.env`
- [ ] Required wallet/key files stored outside the repo and referenced by `*_PATH` variables
- [ ] `chmod +x start.sh stop.sh status.sh`

See [docs/en/installation.md](docs/en/installation.md) for step-by-step instructions.

---

## Safe Mode

Always start in paper mode first. Set this in `backend/.env`:

File: `backend/.env`

```env
PAPER_TRADING=true
```

In paper mode the bot reads signals, validates them through all risk checks, and simulates execution — **no real transactions are submitted**. Run for at least 24 hours before switching to live trading.

See [docs/en/paper-mode.md](docs/en/paper-mode.md) for full paper vs live behavior.

---

## Commands

```bash
./start.sh    # start the bot
./stop.sh     # stop the bot
./status.sh   # check if it's running
```

---

## What the bot does

1. Monitors a private Telegram channel for formatted trade signals
2. Parses signals: asset, direction, entry price, TP, SL, leverage
3. Validates each signal through a 7-layer risk manager (leverage cap, R:R, balance, exposure, step size)
4. Executes perpetual trades through `executeSignal` and `PerpExecutionService`; paper and live share this flow, with routing decided inside the execution layer
5. Records trade audit data through fail-safe persistence when PostgreSQL/Supabase is configured
6. Tracks open positions and sends PnL alerts via Telegram
7. Accepts manual trading commands (open, close, reduce, TP/SL) from dashboard and Telegram

Manual closes from Telegram or the web dashboard are intentional full market exits; on Valiant/Hyperliquid this is implemented with aggressive reduce-only IOC orders.

---

## Operational Modes

| Setting | Behavior |
|---------|---------|
| `PAPER_TRADING=true` | Simulate trades, no real transactions |
| `PAPER_TRADING=false` | Live trading with real funds |

Mode is read from `PAPER_TRADING` in `backend/.env` / process env. Keep it consistent with the intended venue and database records: a wrong mode can produce incorrect persistence metadata.

Persistence is optional and fail-safe. When configured, `trades` is the trade source of truth and `trade_events` records persistence events. `[PERSIST]` logs are the operational signal for database interaction; persistence failures do not block execution.

Operational controls (changeable at runtime):

| Control | What it does |
|---------|-------------|
| Pause | Hold signal execution (signals logged as ignored) |
| Auto-trading off | Monitor signals without executing |
| Signal intake off | Silently discard all incoming signals |

---

## Feature Toggles

```env
# File: backend/.env
ENABLE_SIGNAL_LISTENER=true   # Telegram MTProto signal listener
ENABLE_WEB=true               # web dashboard at http://localhost:3000
ENABLE_CONTROL_BOT=false      # Telegram bot for remote control
```

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Installation](docs/en/installation.md) | Prerequisites and setup |
| [Configuration](docs/en/configuration.md) | All settings, secrets, toggles |
| [Running](docs/en/running.md) | Start, stop, first run |
| [Paper Mode](docs/en/paper-mode.md) | Paper vs live behavior |
| [Backends / Venues](docs/en/venues.md) | Generic backend selection and support status |
| [Operator Guide](docs/en/operator-guide.md) | Dashboard, Telegram, manual trading, operational controls |
| [Close Policy](docs/en/close-policy.md) | Venue resolution rules for close operations |
| [Systemd](docs/en/systemd.md) | Auto-start on server |
| [Troubleshooting](docs/en/troubleshooting.md) | Common errors and fixes |

---

## Warnings

- Leverage can cause full position liquidation
- Start with `POSITION_SIZE_PCT=0.01` (1%) and paper mode for at least 24h
- Keep the required gas/fee asset available for your selected backend
- Never invest more than you can afford to lose
- Signal quality determines trade quality — you are responsible for your signal source
