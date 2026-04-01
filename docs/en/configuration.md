# Configuration

The bot uses two files. Keep them separate — one goes in the repo, one stays outside.

| File | Location | What it contains |
|------|----------|-----------------|
| `.env` | `backend/.env` | Trading settings, feature flags, file paths — **no secrets** |
| `bot-secrets.env` | `/opt/bot/secrets/bot-secrets.env` | Real credentials — **never in the repo** |

---

## Required — Secrets file

`/opt/bot/secrets/bot-secrets.env` must contain at minimum:

```env
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_hash_here
TELEGRAM_PHONE=+15551234567
```

If you use the Telegram control bot, also add:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CONTROL_ALLOWED_IDS=123456789
```

The bot **refuses to start** if this file is missing or any value is still `SET_IN_SERVER_ONLY`.

---

## Required — `.env` settings

Open `backend/.env` and set at minimum:

```env
# The Telegram channel to monitor for signals
TELEGRAM_CHANNEL_ID=-1001234567890

# Start in safe mode — no real trades
PAPER_TRADING=true
```

---

## Feature toggles

These control which parts of the bot run when you call `./start.sh`:

```env
ENABLE_SIGNAL_LISTENER=true   # receive and process trade signals
ENABLE_WEB=true               # web dashboard at http://localhost:3000
ENABLE_CONTROL_BOT=false      # Telegram bot for remote control
WEB_PORT=3000
```

Common setups:

| What you want | Settings |
|--------------|---------|
| Trading only | `LISTENER=true  WEB=false  CONTROL=false` |
| Trading + dashboard | `LISTENER=true  WEB=true   CONTROL=false` |
| Full stack | `LISTENER=true  WEB=true   CONTROL=true` |

---

## Optional — Risk limits

These have safe defaults. Change only if you know what you're doing.

```env
MAX_LEVERAGE=20             # hard cap — bot won't use more than this
MAX_POSITIONS=5             # max open trades at once
POSITION_SIZE_PCT=0.01      # 1% of your account per trade (start here)
MIN_FREE_MARGIN_PCT=0.10    # always keep 10% of funds as buffer
MAX_TOTAL_EXPOSURE_PCT=0.80 # total open exposure capped at 80% of equity
MAX_SLIPPAGE_BPS=100        # max price slippage allowed (100 = 1%)
```

---

## Optional — Paths and logs

```env
BOT_WALLET_PATH=/opt/bot/secrets/drift-bot-wallet.json
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
LOG_LEVEL=info    # debug | info | warn | error
LOG_DIR=./logs
```

---

## Full reference

See [backend/.env.example](../../backend/.env.example) for every available variable with comments.
