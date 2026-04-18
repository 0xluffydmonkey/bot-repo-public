# Variables, Secrets, and Paths

## Purpose

Define the secure configuration pattern: `.env` without secrets, secrets stored outside the project, and dedicated loaders.

## Audience

Everyone who edits configuration, deployment, or documentation.

## Dependencies

- `backend/.env.example`
- `backend/src/config/index.js`
- `backend/src/config/validateEnv.js`
- Loaders in `backend/src/services/*Loader.js`

## Where it fits

`backend/src/config/index.js` loads `BOT_SECRETS_FILE` first, then `backend/.env`. `validateEnv()` runs fail-fast and blocks known prohibited raw secrets.

## Mandatory Separation

| Type | Location |
|------|----------|
| Non-secret config | `backend/.env` |
| Secrets and tokens | `/opt/bot/secrets/bot-secrets.env` |
| Private keys / sessions / DB URL raw | Dedicated files in `/opt/bot/secrets/*` |

## Blocked Raw Variables

The boot process rejects:

```
WALLET_PRIVATE_KEY
TELEGRAM_SESSION
VALIANT_AGENT_KEY
VALIANT_MAIN_KEY
SUPABASE_DB_URL
```

Use paths instead:

```env
BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
VALIANT_AGENT_KEY_PATH=/opt/bot/secrets/valiant-agent-key.txt
VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt
SUPABASE_DB_URL_PATH=/opt/bot/secrets/supabase-db-url.txt
```

## Example File Setup

```bash
sudo mkdir -p /opt/bot/secrets /opt/bot/wallets
sudo chown -R ubuntu:ubuntu /opt/bot
chmod 700 /opt/bot/secrets /opt/bot/wallets
touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
```

Secrets file example:

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_hash_here
TELEGRAM_PHONE=+15551234567
SOLANA_RPC_URL=https://your-rpc-provider.example
WEB_API_TOKEN=a-long-random-token-here
SUPABASE_DB_URL_PATH=/opt/bot/secrets/supabase-db-url.txt
```

Dedicated Supabase file:

```
postgresql://postgres.xxxxx:password@aws-0-region.pooler.supabase.com:5432/postgres
```

## Validation

```bash
./scripts/scan-secrets.sh
./start.sh
```

Note: `scripts/scan-secrets.sh` checks only some raw patterns in repo config files. It does not replace human review.

## Risks

- Critical: private key in `.env`.
- Critical: Telegram session in `.env`.
- Critical: Supabase connection string in `.env`.
- High: permissions greater than `600` on files containing secrets.
- Medium: relative paths for secrets confuse systemd; prefer absolute paths.

## Troubleshooting

- `raw secrets are not accepted`: remove the raw variable and use `*_PATH`.
- `Missing required secret`: value was not loaded from the secrets file or systemd.
- `Placeholder detected`: `SET_IN_SERVER_ONLY` is still in use.

## Final Checklist

- [ ] `.env` contains only config, flags, and paths
- [ ] Secrets are stored outside the repo
- [ ] Sensitive files have `chmod 600`
- [ ] Boot passes fail-fast
- [ ] No secrets appear in logs, docs, or commits
