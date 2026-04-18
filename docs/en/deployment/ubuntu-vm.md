# Ubuntu VM Deployment

## Purpose

Operational guide for running the bot on an Ubuntu VM with low risk and no secrets exposed in the repository.

## Audience

Operators responsible for staging and production on a VM.

## Prerequisites

- Ubuntu VM with a dedicated or restricted operational user
- Node.js 18+
- git
- npm
- systemd
- Secret files stored outside the repo

## Where it fits

The repo lives at an operational path, e.g. `/home/ubuntu/bot-repo`. Secrets live in `/opt/bot/secrets`. Systemd runs `./start.sh`, which delegates to `backend/start.sh`.

## Step-by-Step

1. Prepare external directories:

```bash
sudo mkdir -p /opt/bot/secrets /opt/bot/wallets
sudo chown -R ubuntu:ubuntu /opt/bot
chmod 700 /opt/bot/secrets /opt/bot/wallets
```

2. Set up the secrets file:

```bash
touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
```

3. Configure `backend/.env` with only non-secret values.

4. Install dependencies:

```bash
cd /home/ubuntu/bot-repo/backend
npm install
```

5. Test manually before enabling systemd:

```bash
cd /home/ubuntu/bot-repo
./start.sh
```

6. After manual validation, install systemd. See [systemd.md](systemd.md).

## Example `backend/.env` (safe)

```env
TELEGRAM_CHANNEL_ID=-1001234567890
PAPER_TRADING=true
PERP_OPEN_VENUE=drift
ENABLE_SIGNAL_LISTENER=true
ENABLE_WEB=true
ENABLE_CONTROL_BOT=false
WEB_PORT=3000
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json
```

## Example `/opt/bot/secrets/bot-secrets.env`

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_hash_here
TELEGRAM_PHONE=+15551234567
SOLANA_RPC_URL=https://your-rpc-provider.example
WEB_API_TOKEN=a-long-random-token-here
```

Do not put private keys, raw Telegram sessions, or Supabase connection strings directly in the repo. For Supabase, use `SUPABASE_DB_URL_PATH`.

## Validation

```bash
journalctl -u bot-trader -n 100 -o cat
curl -sS http://127.0.0.1:3000/api/state
```

## Risks

- Critical: secrets inside the repo or open permissions on `/opt/bot/secrets`.
- High: dashboard exposed remotely without `WEB_API_TOKEN`.
- High: live trading enabled before paper testing and preflight.
- Medium: systemd pointing to old repo path.

## Troubleshooting

- `ConditionPathExists` fails: check paths in the service file.
- `node binary not found`: install Node 18+ or fix the systemd user environment.
- No log files: check `LOG_DIR` and write permissions.

## Final Checklist

- [ ] Bot starts manually in paper mode
- [ ] External secrets exist with `chmod 600`
- [ ] Systemd enabled and `active (running)`
- [ ] Remote dashboard (if used) protected by token
- [ ] Live only after the live trading checklist is complete
