# Installation

> **10-minute setup.** Follow these steps in order.

---

## What you need

- A computer running Linux or macOS (Windows via WSL2 works too)
- Wallet/key files required by your selected trading backend
- RPC/API endpoints required by your selected backend
- Telegram API credentials (free — takes 2 minutes to get)
- The ID of the Telegram channel you want to monitor

---

## Step 1 — Install Node.js

```bash
# Check if you already have it
node --version   # needs to be 18 or higher
```

If not installed, use nvm (recommended):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

---

## Step 2 — Clone and install

```bash
git clone git@github.com:YOUR_USER/bot-repo.git
cd bot-repo
cd backend && npm install && cd ..
chmod +x start.sh stop.sh status.sh backend/start.sh
```

---

## Step 3 — Create the secrets folder

Secrets are stored **outside** the project folder so they are never accidentally committed to git.

```bash
sudo mkdir -p /opt/bot/secrets
sudo chown $USER:$USER /opt/bot/secrets
chmod 700 /opt/bot/secrets
```

---

## Step 4 — Add wallet/key files

Copy or generate the wallet/key files required by your selected backend. Store them outside the repository and restrict permissions.

Example for a Solana keypair backend:

```bash
# Generate a new wallet
solana-keygen new -o /opt/bot/secrets/bot-wallet.json

# OR copy an existing wallet
cp /path/to/your/wallet.json /opt/bot/secrets/bot-wallet.json
```

Restrict permissions:

```bash
chmod 600 /opt/bot/secrets/bot-wallet.json
```

> Fund the account with the collateral and fee/gas asset required by the backend you will use.

---

## Step 5 — Create the secrets file

```bash
touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
nano /opt/bot/secrets/bot-secrets.env
```

Paste and fill in these values:

File: `/opt/bot/secrets/bot-secrets.env`

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_hash_here
TELEGRAM_PHONE=+15551234567
```

Add backend-specific secrets only if your selected backend requires them, for example an RPC endpoint, wallet path, or agent-key path. See [configuration.md](configuration.md).

Save and close (`Ctrl+X`, then `Y`, then `Enter` in nano).

---

## Step 6 — Configure the bot

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

The minimum you need to set:

File: `backend/.env`

```env
TELEGRAM_CHANNEL_ID=-1001234567890   # the channel to monitor
PAPER_TRADING=true                    # keep this true until you're confident
```

See [configuration.md](configuration.md) for all available settings.

---

## Step 7 — Start the bot

```bash
./start.sh
```

The first time, it will ask for your Telegram phone number and a verification code. After that, it runs automatically.

---

## Getting Telegram credentials

**API ID and Hash:**
1. Go to [my.telegram.org/apps](https://my.telegram.org/apps)
2. Log in with your phone number
3. Click "API development tools"
4. Create an app (name and platform don't matter)
5. Copy the `api_id` (a number) and `api_hash` (a string)

**Channel ID:**
Forward any message from your signal channel to `@userinfobot`.
It replies with: `Forwarded from channel id: -1001234567890`
Use that number as `TELEGRAM_CHANNEL_ID`.
