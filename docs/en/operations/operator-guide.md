# Operator Guide

Everything an operator needs to run the bot safely in production:
- control surfaces
- dashboard usage
- Telegram control bot
- manual trading and position management
- operational controls (pause, intake, autotrading)

---

## Control Surfaces

The bot has two control surfaces. Both read and write the same shared backend state — they are equivalent:

| Surface | How to access | Requires |
|---------|---------------|---------|
| Web dashboard | `http://localhost:3000` (or server IP + port) | `ENABLE_WEB=true` in `.env` |
| Telegram control bot | Telegram app — any device | `ENABLE_CONTROL_BOT=true` + token + authorized ID |

Both surfaces update in real time.

---

## Dashboard

### What it shows

- **Status panel** — bot state, pause, auto-trading, signal intake, mode (paper/live), active venue, uptime
- **Positions panel** — all open positions with asset, direction, leverage, entry price, current price, PnL, TP/SL
- **Account panel** — total equity, free collateral, used margin, unrealized PnL, session PnL
- **Signal log** — received, executed, and ignored signals (with reasons)
- **Error log** — recent errors with context

### What you can control

| Action | How |
|--------|-----|
| Pause signal execution | **Pause** button |
| Resume execution | **Resume** button |
| Toggle auto-trading | **Auto-trading** toggle |
| Toggle signal intake | `POST /api/intake` with `{ "enabled": false }` |
| Close a position | **Close** button next to the position |
| Close all positions | **Close All** — requires confirmation |
| Open manual position | `POST /api/open` with parameters |
| Update TP/SL | `POST /api/tpsl` |
| Partial reduce | `POST /api/reduce` |

### REST API Reference

All write endpoints require authentication. Set `WEB_API_TOKEN` in your secrets file to protect remote access. Without it, only localhost connections are allowed.

File: `/opt/bot/secrets/bot-secrets.env`

Pass the token as a header: `X-API-Token: <your-token>`

```
GET  /api/state                              → full state snapshot

POST /api/pause                              → pause signal execution
POST /api/resume                             → resume execution
POST /api/autotrading   { enabled: bool }    → toggle auto-trading
POST /api/intake        { enabled: bool }    → toggle signal intake

POST /api/close         { asset, venue? }    → close individual position
POST /api/close_all     { venue? }           → close all positions

POST /api/open          { asset, direction, entry, tp, sl, leverage, marginType? }
POST /api/tpsl          { asset, tp?, sl? }
POST /api/reduce        { asset, reducePercent }   → 1–95% only
```

---

## Telegram Control Bot

### Setup

1. Create a bot via `@BotFather` → `/newbot`
2. Add to the secrets file:

   File: `/opt/bot/secrets/bot-secrets.env`

   ```env
   TELEGRAM_BOT_TOKEN=123456789:ABCdef...
   TELEGRAM_CONTROL_ALLOWED_IDS=123456789   # your Telegram user ID
   ```
3. Enable in `.env`:

   ```env
   ENABLE_CONTROL_BOT=true
   ```
4. Restart the bot. Send a message to the bot in Telegram — it should respond.

> To get your user ID: send any message to `@userinfobot`.

### Navigation

Send `/menu` or `/start` to open the main menu. All control surfaces are accessible via inline keyboard buttons.

### Main menu

From the main menu you can access:
- **📡 Status** — detailed bot status
- **📊 Positions** — open positions list
- **💰 Balance** — account balance
- **📈 P&L** — live PnL per position
- **📩 Signals** — signal history
- **⚙️ Config** — operational controls
- **📝 Manual Trade** — open a position manually

Quick action buttons also appear directly in the menu:
- **⏸️ Pause / ▶️ Resume** — pause or resume (pause requires confirmation)
- **🔇 AT: ON→OFF / 🔊 AT: OFF→ON** — toggle auto-trading (disabling requires confirmation)
- **⚠️ Close All** — close all positions (requires confirmation)

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
| `/config` | Operational configuration |
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
- **▶️ Resume / ⏸️ Pause** — resume or pause (pausing requires confirmation)
- **🔔 / 🔕 Intake** — enable or disable intake (disabling requires confirmation)

### Position detail

Click any position in the list to see the detail screen. From there:
- **🔄 Refresh** — update position data
- **🔴 Close** — close the position (requires confirmation)
- **🎯 Mod TP** — set new take profit (text input)
- **🛑 Mod SL** — set new stop loss (text input)
- **📉 Reduce** — partially reduce the position (text input, 1–95%)

---

## Manual Trading

### Open a position manually

Via Telegram: use **📝 Manual Trade** in the main menu.

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

After sending, the bot shows a confirmation screen. Tap **✅ Confirm Order** to execute.

Manual opens pass through the same **risk manager** as automatic signals.

Via REST API:
```bash
curl -X POST http://localhost:3000/api/open \
  -H "Content-Type: application/json" \
  -H "X-API-Token: YOUR_TOKEN" \
  -d '{"asset":"SOL","direction":"LONG","entry":150,"tp":165,"sl":145,"leverage":5}'
```

### Close a position

Via Telegram: navigate to the position detail screen → **🔴 Close** → confirm.

Via dashboard: click **Close** next to the position.

Via REST:
```bash
curl -X POST http://localhost:3000/api/close \
  -H "Content-Type: application/json" \
  -H "X-API-Token: YOUR_TOKEN" \
  -d '{"asset":"SOL"}'
```

Closes are venue-aware — the bot automatically resolves which venue holds the position.

Manual closes from Telegram or the web dashboard are always full market exits. On Valiant/Hyperliquid, this is implemented as aggressive reduce-only IOC order.

### Update TP/SL

Via Telegram: position detail → **🎯 Mod TP** or **🛑 Mod SL** → enter new price → confirm.

Via REST:
```bash
curl -X POST http://localhost:3000/api/tpsl \
  -H "Content-Type: application/json" \
  -H "X-API-Token: YOUR_TOKEN" \
  -d '{"asset":"SOL","tp":170}'
```

`tp` and `sl` are optional — send only what you want to change.

Valiant/Hyperliquid TP/SL validation checklist after opening a position:
- Confirm the position exists in the Hyperliquid UI.
- Confirm the TP appears in the UI.
- Confirm the SL appears in the UI.
- If TP/SL are absent, consider the position unprotected and set them manually or close the position.

### Partial reduce

Closes a percentage of the position without fully exiting.

Allowed range: **1–95%**. Use full close for above 95%.

Via Telegram: position detail → **📉 Reduce** → enter percentage (e.g. `25`) → confirm.

Via REST:
```bash
curl -X POST http://localhost:3000/api/reduce \
  -H "Content-Type: application/json" \
  -H "X-API-Token: YOUR_TOKEN" \
  -d '{"asset":"SOL","reducePercent":25}'
```

---

## Operational Controls

### Signal intake (`signalIntakeEnabled`)

When disabled, all incoming signals are silently discarded before any processing — before parse, deduplication, and risk checks. No `signalIgnored` entry is created. Open positions are not affected.

Use when:
- receiving a flood of invalid signals from the monitored channel
- during manual position management when you don't want new automatic entries
- during maintenance, to cleanly stop all new position activity

Difference from pause:
- use **pause** for a temporary suspension where you still want signals in the log as "ignored"
- use **intake off** for a full block where you want no signal processing at all

Control:
- Telegram: `⚙️ Config` → **🔕 Disable Intake** (requires confirmation)
- REST: `POST /api/intake` with `{ "enabled": false }`

### Pause

What it does: signals are received and parsed, but marked as `bot_paused` in the ignored log. No execution occurs.

Difference from intake: paused signals appear in history. Intake-off signals are invisible.

Control via Telegram menu or REST `/api/pause`.

### Auto-trading OFF

What it does: signals pass intake and pause filters, but are not executed. They appear in the log as `autotrading_disabled`. Useful for "observation mode" — you want to see which signals would have fired.

Control via Telegram Config screen or REST `/api/autotrading`.

### Signal filter order

```
Signal received
  │
  ▼ [1] intake enabled?         NO → silent discard
  │ YES
  ▼ [2] bot paused?             YES → signalIgnored('bot_paused')
  │ NO
  ▼ [3] autoTrading enabled?    NO → signalIgnored('autotrading_disabled')
  │ YES
  ▼ executeSignal()
```

---

## Position Tracking and Alerts

The bot tracks open positions automatically and sends Telegram alerts when:
- a position reaches the profit threshold (`POSITION_ALERT_PROFIT_PERCENT`)
- a trailing stop is triggered
- a position is closed

Configure in `backend/.env`:

```env
ENABLE_POSITION_ALERTS=true
POSITION_ALERT_PROFIT_PERCENT=10     # alert when PnL reaches +10%
ENABLE_TRAILING_STOP=true
TRAILING_STOP_PERCENT=5              # trail 5% below the peak price
TRAILING_STOP_ONLY_AFTER_PROFIT_PERCENT=3   # only activate after +3%
```

Telegram alerts require `TELEGRAM_CHAT_ID` in the secrets file.
