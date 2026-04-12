# Quick Start — VM / Production

How to set up and run the bot on a production VM using systemd.

---

## Prerequisites

- Ubuntu VM (user: `ubuntu`)
- Node.js >= 18 installed (via nvm or apt)
- Repository cloned on the VM
- Secrets file at `/opt/bot/secrets/bot-secrets.env`
- Non-secret config at `~/bot-repo/backend/.env`

---

## 1. Initial VM setup

### SSH access

```bash
ssh -i ~/.ssh/your-key ubuntu@YOUR_VM_IP
```

### Install Node.js (if not already installed)

```bash
# Via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node --version   # should be >= 18
```

---

## 2. Clone and prepare the repository

```bash
cd ~
git clone git@github.com:YOUR_USER/bot-repo.git bot-repo
cd bot-repo

cd backend
npm install
cd ..

# Make entrypoints executable
chmod +x start.sh stop.sh status.sh backend/start.sh
```

**To update an existing clone:**

```bash
cd ~/bot-repo
git pull
cd backend
npm install   # only if package.json changed
```

---

## 3. Create the secrets directory and file

```bash
sudo mkdir -p /opt/bot/secrets
sudo chown ubuntu:ubuntu /opt/bot/secrets
chmod 700 /opt/bot/secrets

touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
```

Fill in the secrets:

File: `/opt/bot/secrets/bot-secrets.env`

```bash
nano /opt/bot/secrets/bot-secrets.env
```

Required content:

File: `/opt/bot/secrets/bot-secrets.env`

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_hash_here
TELEGRAM_PHONE=+5511999999999
```

Add backend-specific RPC/API credentials only when your selected backend requires them.

If `ENABLE_CONTROL_BOT=true`:

File: `/opt/bot/secrets/bot-secrets.env`

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CONTROL_ALLOWED_IDS=123456789
```

**Backend wallet/key paths** (optional unless required by your selected backend):

File: `/opt/bot/secrets/bot-secrets.env`

```env
# Drift: if not set, falls back to BOT_WALLET_PATH automatically
WALLET_DRIFT_PATH=/opt/bot/wallets/drift.json

# Required when PERP_OPEN_VENUE=jupiter
WALLET_JUPITER_PATH=/opt/bot/wallets/jupiter.json

# Required when PERP_OPEN_VENUE=phoenix
WALLET_PHOENIX_PATH=/opt/bot/wallets/phoenix.json

# Example for an agent-key backend
VALIANT_AGENT_KEY_PATH=/opt/bot/secrets/valiant-agent-key.txt
VALIANT_ACCOUNT_ADDRESS=0xYourPublicAccountAddress

# Valiant/Hyperliquid: only required when ENABLE_VALIANT_AUTO_MARGIN_TRANSFER=true
VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt
```

Also place the wallet and Telegram session:

```bash
# Copy wallet/key files from local machine
scp -i ~/.ssh/your-key bot-wallet.json ubuntu@YOUR_VM_IP:/opt/bot/secrets/
chmod 600 /opt/bot/secrets/bot-wallet.json

# Copy telegram session (after authenticating locally)
scp -i ~/.ssh/your-key telegram_session.txt ubuntu@YOUR_VM_IP:/opt/bot/secrets/
chmod 600 /opt/bot/secrets/telegram_session.txt
```

---

## 4. Configure `.env`

```bash
cp ~/bot-repo/backend/.env.example ~/bot-repo/backend/.env
nano ~/bot-repo/backend/.env
```

Key settings for production:

File: `backend/.env`

```env
# Trading
PAPER_TRADING=false
POSITION_SIZE_PCT=0.05
TELEGRAM_CHANNEL_ID=-1001234567890
BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt

# Feature toggles — controls which modules start when ./start.sh is called
ENABLE_SIGNAL_LISTENER=true    # Telegram signal listener
ENABLE_WEB=true                # web dashboard
ENABLE_CONTROL_BOT=false       # Telegram control bot (set true + add secrets if needed)
WEB_PORT=3000
```

---

## 5. Verify everything before installing systemd

Run the bot manually to confirm secrets load and Telegram authenticates:

```bash
cd ~/bot-repo/backend
./start.sh
```

Expected output:

```
[START] Loading secrets from: /opt/bot/secrets/bot-secrets.env
[CONFIG] Secret loaded: TELEGRAM_API_ID ✓
[CONFIG] Secret loaded: <backend-specific credentials> ✓
[TELEGRAM] Authenticated successfully
[BOT] Active — waiting for signals
[WEB] Dashboard available at http://localhost:3000
```

Press `Ctrl+C` to stop once verified.

For Valiant/Hyperliquid, after opening a live position:

- Confirm the position exists in the venue UI.
- Confirm TP is present in the venue UI.
- Confirm SL is present in the venue UI.
- If TP/SL are missing, treat the position as unprotected and set them manually or close it.
- Check logs for `[HL] TP wire`, `[HL] SL wire`, and `[VALIANT] TP/SL placement falhou`.

---

## 6. Install systemd service

```bash
sudo cp ~/bot-repo/backend/deploy/systemd/bot-trader.service /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable bot-trader
```

The service file expects the documented clone path `/home/ubuntu/bot-repo` and runs the root `start.sh`, which delegates to `backend/start.sh`. Module activation is read from `.env` — the `ExecStart` line passes no flags.

**Override paper trading** (without editing `.env`):

```bash
sudo systemctl edit bot-trader
```

Add:

File: `/etc/systemd/system/bot-trader.service.d/override.conf`

```ini
[Service]
Environment=PAPER_TRADING=true
```

**Enable Telegram control bot:** set `ENABLE_CONTROL_BOT=true` in `.env` and ensure the secrets file includes `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CONTROL_ALLOWED_IDS`. Restart the service after the change:

Files:
- `backend/.env`
- `/opt/bot/secrets/bot-secrets.env`

```bash
sudo systemctl restart bot-trader
```

---

## 7. Control the service

```bash
# Start
sudo systemctl start bot-trader

# Stop
sudo systemctl stop bot-trader

# Restart (after code updates or .env changes)
sudo systemctl restart bot-trader

# Status
sudo systemctl status bot-trader
```

---

## 8. View logs

```bash

# Follow logs in real time like local
journalctl -u bot-trader -f -o cat

# Follow logs in real time
journalctl -u bot-trader -f

# Last 100 lines
journalctl -u bot-trader -n 100

# Logs since last boot
journalctl -u bot-trader -b

# Filter startup messages
journalctl -u bot-trader -n 30 | grep '\[CONFIG\]\|\[START\]'

# Filter bot activity
journalctl -u bot-trader -f | grep '\[BOT\]'
```

---

## 9. Update the bot

```bash
cd ~/bot-repo
git pull
cd backend
npm install   # only if package.json changed

sudo systemctl restart bot-trader
sudo systemctl status bot-trader
```

---

## 10. Uninstall

```bash
sudo systemctl stop bot-trader
sudo systemctl disable bot-trader
sudo rm /etc/systemd/system/bot-trader.service
sudo systemctl daemon-reload
```

---

## Troubleshooting

**Service fails to start**

```bash
sudo systemctl status bot-trader
journalctl -u bot-trader -n 50 --no-pager
```

Common causes:

| Error | Fix |
|-------|-----|
| `[START] Secrets file not found` | Create `/opt/bot/secrets/bot-secrets.env` with `chmod 600` |
| `ConditionPathExists` failed | `.env` or secrets file path doesn't exist — check the service file |
| `node binary not found` | nvm node not visible to systemd — `start.sh` probes `~/.nvm/versions/node` automatically |
| `Permission denied` | `chmod +x start.sh stop.sh status.sh backend/start.sh` |

**Test start.sh manually as the service user**

```bash
sudo -u ubuntu bash ~/bot-repo/backend/start.sh
# Ctrl+C to exit
```

**Service restart loop**

```bash
journalctl -u bot-trader -b --no-pager | grep -E '(Started|Failed|Stopping)'
```

---

## Security summary

- `.env` in the repo contains **no real secrets** — only placeholders and non-sensitive config
- Real secrets live at `/opt/bot/secrets/bot-secrets.env` (`chmod 600`, owned by `ubuntu`)
- Wallet JSON and Telegram session are loaded as **file paths** — never as raw env vars
- `WALLET_PRIVATE_KEY` and `TELEGRAM_SESSION` directly in the environment are **rejected** by the bot
- The bot refuses to start if any required secret is missing or set to `SET_IN_SERVER_ONLY`
- The service runs with `NoNewPrivileges=true` and `PrivateTmp=true`
- No secret values are logged — only confirmations like `Secret loaded: KEY ✓`
