# Operator Guide

This guide covers everything an operator needs to run the bot safely in production:
- what the control surfaces are
- how to use the dashboard
- how to use the Telegram control bot
- how to execute manual trades and manage positions
- how to use operational controls (pause, intake, autotrading)

---

## Control Surfaces

The bot has two operator-facing control surfaces. Both read from and write to the same shared backend state — they are equivalent:

| Surface | How to access | Requires |
|---------|--------------|----------|
| Web dashboard | `http://localhost:3000` (or your server IP + port) | `ENABLE_WEB=true` in `.env` |
| Telegram control bot | Telegram app — any device | `ENABLE_CONTROL_BOT=true` + bot token + authorized user ID |

Both surfaces update in real time.

---

## Dashboard

### What it shows

- **Status panel** — bot running state, pause state, auto-trading, signal intake, mode (paper/live), active venue, uptime
- **Positions panel** — all open positions with asset, direction, leverage, entry price, mark price, PnL, TP/SL
- **Account panel** — total equity, free collateral, margin used, unrealized PnL, session PnL
- **Signal log** — signals received, executed, ignored (with reasons)
- **Error log** — recent errors with context

### What you can control

| Action | How |
|--------|-----|
| Pause signal execution | Click **Pause** button |
| Resume signal execution | Click **Resume** button |
| Toggle auto-trading | Click **Auto-trading** toggle |
| Toggle signal intake | `POST /api/intake` with `{ "enabled": false }` |
| Close a single position | Click **Close** next to the position |
| Close all positions | Click **Close All** — requires confirmation |
| Open a manual position | `POST /api/open` with position parameters |
| Update TP/SL | `POST /api/tpsl` |
| Partially reduce a position | `POST /api/reduce` |

> The dashboard UI provides direct controls for pause, resume, AT, and close. For manual trading operations, use the REST API (documented below) or the Telegram control bot.

### REST API reference

All write endpoints require authentication. Set `WEB_API_TOKEN` in your secrets file to protect remote access. Without it, only localhost connections are allowed.

File: `/opt/bot/secrets/bot-secrets.env`

Pass the token as header: `X-API-Token: <your-token>`

```
GET  /api/state                              → full state snapshot

POST /api/pause                              → pause signal execution
POST /api/resume                             → resume signal execution
POST /api/autotrading   { enabled: bool }    → toggle auto-trading
POST /api/intake        { enabled: bool }    → toggle signal intake

POST /api/close         { asset, venue? }    → close single position
POST /api/close_all     { venue? }           → close all positions

POST /api/open          { asset, direction, entry, tp, sl, leverage, marginType? }
POST /api/tpsl          { asset, tp?, sl? }
POST /api/reduce        { asset, reducePercent }   → 1–95% only
```

---

## Telegram Control Bot

### Setup

1. Create a bot via `@BotFather` → `/newbot`
2. Add to secrets file:

   File: `/opt/bot/secrets/bot-secrets.env`

   ```env
   TELEGRAM_BOT_TOKEN=123456789:ABCdef...
   TELEGRAM_CONTROL_ALLOWED_IDS=123456789   # your Telegram user ID
   ```
3. Enable in `.env`:

   File: `backend/.env`

   ```env
   ENABLE_CONTROL_BOT=true
   ```
4. Restart the bot. Message your bot on Telegram — it should respond.

> Get your user ID: send any message to `@userinfobot`.

### Navigation

Send `/menu` or `/start` to open the main menu. All control surfaces are accessible from there via inline keyboard buttons.

### Main menu

From the main menu you can navigate to:
- **📡 Status** — detailed bot status
- **📊 Posições** — list of open positions
- **💰 Saldo** — account balance
- **📈 P&L** — live PnL by position
- **📩 Sinais** — signal history
- **⚙️ Config** — operational controls
- **📝 Trade Manual** — open a manual position

Quick-action buttons also appear directly in the menu:
- **⏸️ Pausar / ▶️ Retomar** — pause or resume (pause requires confirmation)
- **🔇 AT: ON→OFF / 🔊 AT: OFF→ON** — toggle auto-trading (off requires confirmation)
- **⚠️ Fechar Tudo** — close all positions (requires confirmation)

### Commands

| Command | Description |
|---------|-------------|
| `/menu` | Open the main control menu |
| `/start` | Same as `/menu` |
| `/status` | Quick status summary |
| `/positions` | List open positions |
| `/balance` | Account balance |
| `/pnl` | PnL per position |
| `/signals` | Signal history |
| `/config` | Operational config |
| `/errors` | Recent error log |

### Config screen

Access via **⚙️ Config** in the main menu or `/config`.

Shows:
- Mode (paper / live) — read-only at runtime
- Venue — read-only at runtime
- Auto-trading (ON/OFF)
- Bot status (active / paused)
- Signal intake (ON/OFF)

Controls:
- **✅ / ❌ Auto-trading** — enable or disable (disabling requires confirmation)
- **▶️ Retomar / ⏸️ Pausar** — resume or pause (pausing requires confirmation)
- **🔔 / 🔕 Intake** — enable or disable signal intake (disabling requires confirmation)

### Position detail

Click any position in the position list to see its detail screen. From there you can:
- **🔄 Atualizar** — refresh the position data
- **🔴 Fechar** — close the position (requires confirmation)
- **🎯 Mod TP** — set a new take profit price (text input)
- **🛑 Mod SL** — set a new stop loss price (text input)
- **📉 Reduzir** — partially reduce the position (text input, 1–95%)

---

## Manual Trading

### Opening a position manually

Via Telegram: use **📝 Trade Manual** in the main menu.

The bot asks for a single line in this format:
```
ASSET DIRECTION ENTRY TP SL LEVERAGE [MARGIN]
```

Example:
```
SOL LONG 150 165 145 5 isolated
```

Fields:
- `ASSET` — token symbol: `SOL`, `BTC`, `ETH`, etc.
- `DIRECTION` — `LONG` or `SHORT`
- `ENTRY` — entry price
- `TP` — take profit price
- `SL` — stop loss price
- `LEVERAGE` — leverage multiplier
- `MARGIN` — optional: `isolated` (default) or `cross`

After sending, the bot shows a confirmation screen. Tap **✅ Confirmar Ordem** to execute.

The manual open passes through the same **risk manager** as automated signals:
- validates asset support
- validates R:R ratio
- checks free collateral
- checks max positions
- checks max exposure

If the risk manager rejects it, the bot will tell you why.

Via REST API:
```bash
curl -X POST http://localhost:3000/api/open \
  -H "Content-Type: application/json" \
  -H "X-API-Token: YOUR_TOKEN" \
  -d '{"asset":"SOL","direction":"LONG","entry":150,"tp":165,"sl":145,"leverage":5}'
```

### Closing a position

Via Telegram: navigate to the position detail screen → **🔴 Fechar** → confirm.

Via dashboard: click **Close** next to the position.

Via REST:
```bash
curl -X POST http://localhost:3000/api/close \
  -H "Content-Type: application/json" \
  -H "X-API-Token: YOUR_TOKEN" \
  -d '{"asset":"SOL"}'
```

Close operations are venue-aware — the bot resolves which venue holds the position automatically.

### Updating TP/SL

Via Telegram: position detail → **🎯 Mod TP** or **🛑 Mod SL** → type new price → confirm.

Via REST:
```bash
curl -X POST http://localhost:3000/api/tpsl \
  -H "Content-Type: application/json" \
  -H "X-API-Token: YOUR_TOKEN" \
  -d '{"asset":"SOL","tp":170}'
```

Both `tp` and `sl` are optional — send only the one you want to change.

### Partial position reduction

Partially close a percentage of an open position without fully exiting.

Allowed range: **1–95%**. Use full close for anything above 95%.

Via Telegram: position detail → **📉 Reduzir** → type a percentage (e.g. `25`) → confirm.

Via REST:
```bash
curl -X POST http://localhost:3000/api/reduce \
  -H "Content-Type: application/json" \
  -H "X-API-Token: YOUR_TOKEN" \
  -d '{"asset":"SOL","reducePercent":25}'
```

The bot validates step size and minimum base amount before executing.

---

## Operational Controls

### Signal intake (`signalIntakeEnabled`)

**What it does:** when disabled, all incoming signals are silently discarded before any processing — before parse, before dedup, before risk checks. No `signalIgnored` entry is created. Open positions are not affected.

**When to use it:**
- receiving a flood of garbage signals from the monitored channel
- during manual position management when you don't want new automated entries
- when performing maintenance and want a clean stop of all new position activity

**When NOT to use it vs pause:**
- use **pause** for a temporary hold where you want signals tracked as "ignored" in the log
- use **intake off** for a hard gate where you don't want any signal processing at all

Toggle:
- Telegram: `⚙️ Config` → **🔕 Desativar Intake** (requires confirmation)
- REST: `POST /api/intake` with `{ "enabled": false }`
- Socket.IO: `cmd:intake` with `{ enabled: false }`

### Pause

**What it does:** signals are received and parsed, but marked as `bot_paused` in the ignored log. No execution occurs.

**Difference from intake:** paused signals appear in the signal history. Intake-off signals are invisible.

Toggle via Telegram menu or REST `/api/pause`.

### Auto-trading off

**What it does:** signals pass intake and pause checks, but are not executed. They appear in the signal log as `autotrading_disabled`. Useful for "observation mode" — you want to see what signals would have fired.

Toggle via Telegram Config screen or REST `/api/autotrading`.

### Gate order

Signals pass through these gates in sequence:

```
Signal received
  │
  ▼ [1] intake enabled?       NO → silent discard
  │ YES
  ▼ [2] paused?               YES → signalIgnored('bot_paused')
  │ NO
  ▼ [3] autoTrading enabled?  NO  → signalIgnored('autotrading_disabled')
  │ YES
  ▼ executeSignal()
```

---

## Position Tracking and Alerts

The bot tracks open positions automatically and sends Telegram alerts when:
- a position reaches the profit threshold (`POSITION_ALERT_PROFIT_PERCENT`)
- a trailing stop activates
- a position is closed

Configure in `backend/.env`:

File: `backend/.env`

```env
ENABLE_POSITION_ALERTS=true
POSITION_ALERT_PROFIT_PERCENT=10     # alert when PnL reaches +10%
ENABLE_TRAILING_STOP=true
TRAILING_STOP_PERCENT=5              # trail 5% behind peak price
TRAILING_STOP_ONLY_AFTER_PROFIT_PERCENT=3   # only trail after +3%
```

Telegram alerts require `TELEGRAM_CHAT_ID` in the secrets file.

File: `/opt/bot/secrets/bot-secrets.env`

---

## Paper Mode Operator Behavior

In paper mode, all operator surfaces work identically to live mode:
- manual open, close, reduce, TP/SL all work
- the dashboard shows live positions and PnL
- Telegram shows live position cards and alerts
- operational controls (pause, intake, AT) all function normally

The difference: **no real blockchain transactions are submitted**. The paper engine simulates position execution in-memory.

Paper mode positions and balance reset when the bot restarts.

Messages in paper mode are labeled `🧪 PAPER` in Telegram to prevent confusion with live trading.

See [paper-mode.md](paper-mode.md) for detailed paper vs live behavior.
