# Architecture Overview

## Purpose

Explain how TradeFinderBot is organized today — without proposing rewrites or new architecture.

## Audience

Developers, operators, and reviewers who need to understand the real flow before changing configuration, code, or environment.

## Status

Implemented:

- Node.js backend in `backend/src`
- Vite/React frontend in `frontend/src`
- Dashboard served by the backend from `backend/src/web/public`
- Telegram MTProto listener for signals
- Optional Telegram control bot
- In-memory paper engine
- Live trading via venues/adapters
- Optional Supabase/PostgreSQL for audit and metrics
- Systemd for Ubuntu VM deployment

Partially implemented:

- Multi-venue simultaneous tracking: the core has `venue` fields in positions and close resolution, but simultaneous tracking of the same asset across multiple venues has known operational limits.
- Jupiter and Phoenix: registered as venues but not live-ready.

## Component Map

| Area | Key paths |
|------|-----------|
| Orchestrator | `backend/src/index.js` |
| Config and fail-fast | `backend/src/config/index.js`, `backend/src/config/validateEnv.js` |
| Secrets by file | `backend/src/services/secretFileLoader.js`, `backend/src/services/walletLoader.js`, `backend/src/services/telegramSessionLoader.js` |
| Telegram listener | `backend/src/telegram/telegram_listener.js` |
| Telegram control bot | `backend/src/telegram/telegram_control.js`, `backend/src/telegram/handlers/*` |
| Perp execution | `backend/src/trading/PerpExecutionService.js` |
| Manual trade | `backend/src/trading/ManualTradeService.js` |
| Paper trading | `backend/src/trading/paperEngine.js` |
| Venues | `backend/src/venues/*`, `backend/src/trading/adapters/*` |
| Position management | `backend/src/trading/position-management/PositionManager.js` |
| Monitoring | `backend/src/monitor/*` |
| Dashboard backend | `backend/src/web/server.js` |
| Dashboard frontend | `frontend/src/*` |
| External persistence | `backend/src/services/persistenceService.js` |
| Reconciliation | `backend/src/services/positionReconciliationService.js` |
| Local persistence | `backend/data/positions.json`, logs in `LOG_DIR` |
| Systemd | `backend/deploy/systemd/*` |

## Signal Flow

1. The Telegram listener receives messages from the channel configured by `TELEGRAM_CHANNEL_ID`.
2. `signal_parser.js` attempts to extract a valid signal.
3. `index.js` applies intake, pause, global auto-trading, and venue-specific gates.
4. `ManualTradeService.executeSignal()` runs the shared core.
5. The risk manager computes parameters from balance, limits, and configuration.
6. `PerpExecutionService` routes to the paper engine or a live adapter.
7. `state` feeds the dashboard, control bot, and monitoring.
8. `persistenceService` writes best-effort audit data if `SUPABASE_DB_URL_PATH` is configured.

## Manual Control Flow

Manual controls enter through:

- Dashboard REST/Socket.IO in `backend/src/web/server.js`
- Telegram control bot in `backend/src/telegram/telegram_control.js`
- Manual scripts in `backend/scripts/*`

Manual opens pass through the same `executeSignal()` as automatic signals. Remote closes are stricter in venue resolution than local helpers. See [close-policy.md](../trading/close-policy.md).

## Position Reconciliation

The system has bidirectional reconciliation for live venue state and DB state.

- **Reactive layer** — inline in `PositionManager`: detects when a tracked position disappears from venue snapshots (after `CLOSE_CONFIRMATION_MISSES=2` consecutive misses) and persists the external close.
- **Periodic service** — in `positionReconciliationService.js`: closes stale DB `OPEN` trades, enriches recently closed trades where supported, and adopts live positions from the active venue when no matching DB `OPEN` trade exists.

Adoption is conservative: the position must be seen in 2 consecutive reconciliation cycles, have a reliable `LONG`/`SHORT` direction, and be unambiguous for the active `venue + asset`. Adopted positions are persisted with `open_source='venue_reconciliation'`, receive a new `bot_trade_ref`, and then participate in tracking, alerts, trailing stops, and reconciled closes.

Current limitation: reconciliation operates against the active venue per cycle; simultaneous multi-venue tracking remains limited.

See [reconciliation.md](../operations/reconciliation.md).

## Prerequisites

- Node.js 18+
- npm
- Telegram channel access and MTProto credentials
- Secrets file outside the repo
- For live: live-ready venue configured with preflight complete
- For Supabase: project created and schema applied

## Minimum Configuration

`backend/.env`:

```env
TELEGRAM_CHANNEL_ID=-1001234567890
PAPER_TRADING=true
PERP_OPEN_VENUE=drift
ENABLE_SIGNAL_LISTENER=true
ENABLE_WEB=true
ENABLE_CONTROL_BOT=false
```

`/opt/bot/secrets/bot-secrets.env`:

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_hash_here
TELEGRAM_PHONE=+15551234567
```

Use real values only in the external secrets file. Do not use these examples as actual secrets.

## Risks

- Critical: private key or Telegram session inside the repo.
- High: enabling live before validating venue, balance, RPC/API, and remote control permissions.
- Medium: Supabase unavailable reduces audit and metrics, but does not block trades.
- Low: old docs may remain as historical reference; the main index points to the current structure.

## Validation Checklist

- [ ] `npm install` run in `backend/`.
- [ ] `backend/.env` contains only non-secret configuration.
- [ ] `/opt/bot/secrets/bot-secrets.env` exists with `chmod 600`.
- [ ] `./start.sh` starts in paper mode.
- [ ] Dashboard responds at `/api/state` when enabled.
- [ ] Logs show no raw secrets.
