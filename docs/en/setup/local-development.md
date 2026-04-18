# Local Development Setup

## Purpose

Safe local setup for development and incremental validation — without touching real funds.

## Audience

Developers and operators who need to test changes without triggering live execution.

## Prerequisites

- Node.js 18+
- npm
- Access to the repo
- Real Telegram MTProto credentials in an external file
- Optional: Supabase for persistence validation

## How it fits

The local setup uses the same production backend, but must run with `PAPER_TRADING=true`. `backend/.env` lives in the local repo with non-secret config; secrets go in `/opt/bot/secrets/bot-secrets.env` or another external path pointed to by `BOT_SECRETS_FILE`.

## Step-by-Step

1. Install backend dependencies:

```bash
cd backend
npm install
cd ..
```

2. Create `.env` from the example:

```bash
cp backend/.env.example backend/.env
```

3. Keep `.env` secrets-free. Minimum example:

```env
TELEGRAM_CHANNEL_ID=-1001234567890
PAPER_TRADING=true
PERP_OPEN_VENUE=drift
ENABLE_SIGNAL_LISTENER=true
ENABLE_WEB=true
ENABLE_CONTROL_BOT=false
WEB_PORT=3000
LOG_LEVEL=info
LOG_DIR=./logs
```

4. Create the external secrets folder:

```bash
sudo mkdir -p /opt/bot/secrets
sudo chown "$USER":"$USER" /opt/bot/secrets
chmod 700 /opt/bot/secrets
touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
```

5. Add only the necessary secrets to the external file:

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_hash_here
TELEGRAM_PHONE=+15551234567
```

6. Start:

```bash
./start.sh
```

7. If `ENABLE_WEB=true`, open:

```
http://localhost:3000
```

## Real Examples

Run backend only in paper mode:

```bash
cd backend
npm run paper
```

Run with dashboard and control bot using legacy npm flags (still supported):

```bash
cd backend
npm run full:paper
```

The canonical path is to set `ENABLE_WEB` and `ENABLE_CONTROL_BOT` in `.env` and start with `./start.sh`.

## Risks

- Critical: do not put private keys in `backend/.env`.
- Critical: do not put raw Telegram session strings in `backend/.env`.
- High: do not run locally with `PAPER_TRADING=false` unless you intend an isolated live test.
- Medium: the first Telegram authentication may create `backend/telegram_session.txt` — move it to `/opt/bot/secrets/telegram_session.txt` afterwards.

## Troubleshooting

- `Secrets file not found`: create `/opt/bot/secrets/bot-secrets.env` or export `BOT_SECRETS_FILE`.
- `Placeholder detected`: replace `SET_IN_SERVER_ONLY` in the external secrets file, not in `.env`.
- Telegram login keeps looping: check `TELEGRAM_SESSION_PATH` and file permissions.
- Web port already in use: change `WEB_PORT`.

## Final Checklist

- [ ] `PAPER_TRADING=true`
- [ ] `backend/.env` has no secrets
- [ ] `/opt/bot/secrets/bot-secrets.env` has `chmod 600`
- [ ] `./start.sh` starts without `[CONFIG]` errors
- [ ] Dashboard responds when enabled
