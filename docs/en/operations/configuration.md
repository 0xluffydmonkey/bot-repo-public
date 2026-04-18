# Configuration

The bot uses two files. Keep them separate — one goes in the repo, one stays outside.

| File | Location | What it contains |
|------|----------|-----------------|
| `.env` | `backend/.env` | Trading settings, feature flags, file paths — **no secrets** |
| `bot-secrets.env` | `/opt/bot/secrets/bot-secrets.env` | Real credentials — **never in the repo** |

---

## Required — Secrets file

`/opt/bot/secrets/bot-secrets.env` must contain the real credentials required by the modules and backend you enable. For the Telegram signal listener, the minimum is:

File: `/opt/bot/secrets/bot-secrets.env`

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_hash_here
TELEGRAM_PHONE=+15551234567
```

If your selected backend needs an RPC endpoint or signing key, add those values in the same secrets file using the documented `*_PATH` pattern. Do not put raw keys in `.env`.

If you use the Telegram control bot, also add:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CONTROL_ALLOWED_IDS=123456789
```

The bot **refuses to start** if this file is missing or any value is still `SET_IN_SERVER_ONLY`.

---

## Required — `.env` settings

Open `backend/.env` and set at minimum:

File: `backend/.env`

```env
# The Telegram channel to monitor for signals
TELEGRAM_CHANNEL_ID=-1001234567890

# Start in safe mode — no real trades
PAPER_TRADING=true
```

Select the execution backend:

```env
PERP_OPEN_VENUE=drift   # choose one registered backend/venue
```

See [../trading/venues.md](../trading/venues.md) for backend selection, readiness, and per-backend requirements.

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

## Optional — Reconciliation

The reconciliation service runs automatically with safe defaults. Override only if needed:

```env
RECONCILE_INTERVAL_MS=300000      # how often to run (default: 5 min)
RECONCILE_MIN_TRADE_AGE_MS=60000  # min age before a trade is eligible (default: 60 s)
RECONCILE_ENRICH_WINDOW_HOURS=2   # lookback window for Pass 2 enrichment (default: 2 h)
```

See [reconciliation.md](reconciliation.md).

---

## Optional — Paths and logs

```env
BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
LOG_LEVEL=info    # debug | info | warn | error
LOG_DIR=./logs
```

---

## Backend wallets and signing keys

Configure raw key material in files outside the repository and expose only paths through the secrets file.

File: `/opt/bot/secrets/bot-secrets.env`

```env
WALLET_DRIFT_PATH=/opt/bot/wallets/drift.json
WALLET_JUPITER_PATH=/opt/bot/wallets/jupiter.json
WALLET_PHOENIX_PATH=/opt/bot/wallets/phoenix.json
VALIANT_AGENT_KEY_PATH=/opt/bot/secrets/valiant-agent-key.txt
VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt
VALIANT_ACCOUNT_ADDRESS=0xYourPublicAccountAddress
```

| Venue/backend | Secret path used |
|---------------|------------------|
| Drift | `WALLET_DRIFT_PATH` → falls back to `BOT_WALLET_PATH` if not set |
| Jupiter | `WALLET_JUPITER_PATH` (required when `PERP_OPEN_VENUE=jupiter`) |
| Phoenix | `WALLET_PHOENIX_PATH` (required when `PERP_OPEN_VENUE=phoenix`) |
| Valiant-compatible | `VALIANT_AGENT_KEY_PATH` plus `VALIANT_ACCOUNT_ADDRESS`; `VALIANT_MAIN_KEY_PATH` only when spot→perps transfer signing is enabled |

Missing key path = safe failure: live mode refuses to start when the selected backend is missing required paths.

Each wallet/key file must have `chmod 600` and be owned by the bot user.

---

## Auto-trading gates

```env
ENABLE_AUTO_TRADING_VALIANT=false
```

Keep backend-specific gates disabled until paper testing, preflight checks, and a small manual live test have passed.

---

## Dashboard security

By default, the web dashboard only allows write operations from localhost. To enable remote access:

File: `/opt/bot/secrets/bot-secrets.env`

```env
WEB_API_TOKEN=a-long-random-string-here
```

Pass it in every write request:

```
X-API-Token: a-long-random-string-here
```

Read operations (`GET /api/state`, WebSocket) do not require authentication.

---

## Paper mode balance

```env
PAPER_INITIAL_BALANCE=5000
```

Only relevant when `PAPER_TRADING=true`.

---

## Full reference

See `backend/.env.example` for every available variable with comments.

---

## Operational safety note

Close flows are venue-aware and do not all behave the same way.

- direct manual helper closes may use active-venue fallback for backward compatibility
- remote, command-bus, and automated close flows are stricter and refuse the close if venue cannot be resolved safely
- manual closes initiated from Telegram or the web dashboard are always full market exits; on Valiant/Hyperliquid this is implemented as aggressive reduce-only IOC behavior

See [../trading/close-policy.md](../trading/close-policy.md) for the canonical rules.
