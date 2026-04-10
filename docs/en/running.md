# Running the Bot

---

## Start

```bash
./start.sh
```

That's the only command you need. What runs is controlled by your `backend/.env` settings.

---

## First run — Telegram login

The very first time you start, the bot needs to log in to Telegram on your behalf. It will ask:

```
Enter your phone number: +15551234567
Enter the code you received: 12345
```

After that, it saves a session file so you won't be asked again.

Move the session file to the secrets folder:

```bash
mv backend/telegram_session.txt /opt/bot/secrets/telegram_session.txt
chmod 600 /opt/bot/secrets/telegram_session.txt
```

---

## What to expect on startup

```
[START] Loading secrets from: /opt/bot/secrets/bot-secrets.env
[START] node: v20.x.x
[CONFIG] Secret loaded: SOLANA_RPC_URL ✓
[CONFIG] Secret loaded: TELEGRAM_API_ID ✓
[TELEGRAM] Authenticated successfully
[BOT] Active — waiting for signals
[WEB] Dashboard available at http://localhost:3000
```

If you see these lines, the bot is running correctly.

---

## Stop

```bash
./stop.sh
```

---

## Check status

```bash
./status.sh
```

---

## Paper mode vs live trading

**Paper mode** (safe — no real transactions):

```env
# backend/.env
PAPER_TRADING=true
```

The bot runs the full signal processing pipeline and simulates execution — no blockchain transactions are submitted. The dashboard shows real simulated positions and PnL. Use this for at least 24 hours before going live.

**Live trading:**

```env
# backend/.env
PAPER_TRADING=false
```

Signals that pass all risk checks will be executed on-chain with real funds.

> Recommended first steps: `PAPER_TRADING=true` + `POSITION_SIZE_PCT=0.01` for 24h, then gradually increase.

See [paper-mode.md](paper-mode.md) for full paper vs live behavior comparison.

---

## Operational controls

Once the bot is running, you can control it without restarting via:
- the web dashboard at `http://localhost:3000` (if `ENABLE_WEB=true`)
- the Telegram control bot (if `ENABLE_CONTROL_BOT=true`)

Available runtime controls:

| Control | Effect |
|---------|--------|
| Pause | Holds signal execution (signals logged as ignored) |
| Resume | Returns bot to normal execution |
| Auto-trading OFF | Monitor-only mode — no new trades executed |
| Signal intake OFF | Silently discard all incoming signals before processing |
| Close position | Close a single open position at market |
| Close all | Close all open positions at market |
| Manual open | Open a position manually (bypasses signal listener) |
| Update TP/SL | Change take profit or stop loss on an open position |
| Partial reduce | Reduce a position by 1–95% at market |

See [operator-guide.md](operator-guide.md) for full instructions on each control.

---

## Custom secrets file

If your secrets are stored somewhere other than the default path:

```bash
BOT_SECRETS_FILE=/path/to/secrets.env ./start.sh
```

---

## Running 24/7 on a server

Use systemd so the bot restarts automatically after reboots or crashes. See [systemd.md](systemd.md).
