# Security Rules

## Critical rules
- Private key must never be stored in `.env`
- Telegram session files must never be committed
- Wallet files must stay outside the repository
- Production secrets must exist only in isolated environment

## Secret handling
Allowed in `.env`:
- RPC URLs
- feature flags
- numeric limits
- file paths

Not allowed in `.env`:
- PRIVATE_KEY
- SECRET_KEY
- MNEMONIC
- TELEGRAM_SESSION raw value
- SUPABASE_DB_URL raw connection string

## Safe pattern
Use:
- `BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json`
- venue-specific paths such as `WALLET_<VENUE>_PATH=/opt/bot/secrets/<venue-wallet>.json`
- `TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt`
- `SUPABASE_DB_URL_PATH=/opt/bot/secrets/supabase-db-url.txt`

See [docs/security/secrets-and-paths.md](docs/security/secrets-and-paths.md) and [docs/integrations/supabase.md](docs/integrations/supabase.md) for the current operational pattern.

## Incident response
If suspicious behavior is detected:
1. stop the bot
2. remove remaining funds if possible
3. abandon compromised wallet/session
4. investigate before resuming
