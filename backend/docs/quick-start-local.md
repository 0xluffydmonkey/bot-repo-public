# Quick Start — Local Run

How to clone and run the bot locally after a fresh clone.

---

## Prerequisites

```bash
node --version   # >= 18.0.0
npm --version    # >= 9.0.0
```

---

## 1. Clone and install

```bash
git clone git@github.com:YOUR_USER/bot-repo.git
cd bot-repo/backend
npm install
```

---

## 2. Create `.env` (non-secret config)

```bash
cp .env.example .env
```

Edit `.env` to configure trading parameters and activate modules. Key settings:

```env
# Trading behavior
PAPER_TRADING=true              # always start with paper mode locally
POSITION_SIZE_PCT=0.01          # start small (1%)
TELEGRAM_CHANNEL_ID=-100...     # channel to monitor

# Secret file paths (paths are non-secret, values are not)
BOT_WALLET_PATH=/opt/bot/secrets/drift-bot-wallet.json
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt

# Feature toggles — controls which modules start
ENABLE_SIGNAL_LISTENER=true     # Telegram signal listener
ENABLE_WEB=true                 # web dashboard at http://localhost:3000
ENABLE_CONTROL_BOT=false        # Telegram control bot
```

> `.env` must never contain real secrets. Only non-sensitive config goes here.

---

## 3. Create the secrets file

```bash
sudo mkdir -p /opt/bot/secrets
sudo chown $USER:$USER /opt/bot/secrets
chmod 700 /opt/bot/secrets

touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
```

Fill in the secrets (real values, never committed to git):

```bash
nano /opt/bot/secrets/bot-secrets.env
```

Minimum required content:

```env
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_hash_here
TELEGRAM_PHONE=+5511999999999
```

For the Telegram control bot (only if `ENABLE_CONTROL_BOT=true`):

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CONTROL_ALLOWED_IDS=123456789,987654321
```

**Multi-venue wallets** (optional — only needed if using Jupiter or Phoenix):

```env
# Drift: if not set, falls back to BOT_WALLET_PATH automatically
WALLET_DRIFT_PATH=/opt/bot/wallets/drift.json

# Required when PERP_OPEN_VENUE=jupiter
WALLET_JUPITER_PATH=/opt/bot/wallets/jupiter.json

# Required when PERP_OPEN_VENUE=phoenix
WALLET_PHOENIX_PATH=/opt/bot/wallets/phoenix.json
```

---

## 4. Add secrets files

**Wallet keypair:**

```bash
# Generate a new wallet (or copy an existing one)
solana-keygen new -o /opt/bot/secrets/drift-bot-wallet.json
chmod 600 /opt/bot/secrets/drift-bot-wallet.json
```

**Telegram session** (generated on first run — see step 5 below).

---

## 5. First run — Telegram authentication

On the first run, the bot will prompt for your phone number and SMS code:

```bash
./start.sh
```

After authentication, a `telegram_session.txt` file is created. Move it to the secrets directory:

```bash
mv telegram_session.txt /opt/bot/secrets/telegram_session.txt
chmod 600 /opt/bot/secrets/telegram_session.txt
```

Subsequent runs will load the session automatically.

---

## 6. Running the bot

The start command is always the same:

```bash
./start.sh
```

Which modules run is decided by your `.env`:

```env
ENABLE_SIGNAL_LISTENER=true   # run the Telegram signal listener
ENABLE_WEB=true               # run the web dashboard
ENABLE_CONTROL_BOT=false      # skip the Telegram control bot
```

Override the secrets file path if needed:

```bash
BOT_SECRETS_FILE=/path/to/other-secrets.env ./start.sh
```

---

## 7. Verify startup

Expected log output:

```
[START] Loading secrets from: /opt/bot/secrets/bot-secrets.env
[START] node: /home/user/.nvm/versions/node/v20.x.x/bin/node (v20.x.x)
[START] Backend: /path/to/backend
[CONFIG] Secret loaded: SOLANA_RPC_URL ✓
[CONFIG] Secret loaded: TELEGRAM_API_ID ✓
[TELEGRAM] Authenticated successfully
[BOT] Active — waiting for signals
[WEB] Dashboard available at http://localhost:3000   # if ENABLE_WEB=true
```

---

## Troubleshooting

**"Secrets file not found"**
```bash
ls -la /opt/bot/secrets/bot-secrets.env   # file must exist
chmod 600 /opt/bot/secrets/bot-secrets.env
```

**"node binary not found"**
```bash
# If using nvm:
nvm use 20
which node   # confirm it's in PATH
```

**"Missing required secret: SOLANA_RPC_URL"**
The secrets file exists but a required value is missing or still set to `SET_IN_SERVER_ONLY`.
Edit `/opt/bot/secrets/bot-secrets.env` and fill in the real value.

**Telegram authentication loops**
Delete the stale session file and reauthenticate:
```bash
rm /opt/bot/secrets/telegram_session.txt
./start.sh
```

**Permission denied on start.sh**
```bash
chmod +x ./start.sh
```

---

## Getting Telegram credentials

**API ID and Hash** — from [my.telegram.org/apps](https://my.telegram.org/apps):
1. Log in with your phone number
2. Click "API development tools"
3. Create an app (any name/platform)
4. Copy `App api_id` and `App api_hash`

**Channel ID** — forward any message from the channel to `@userinfobot`.
It returns: `Forwarded from channel id: -1001234567890`

**Bot token** (control bot only) — create via `@BotFather` → `/newbot`

**Your user ID** (control bot) — send any message to `@userinfobot`
