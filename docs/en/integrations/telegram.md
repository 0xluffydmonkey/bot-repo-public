# Telegram Integration

## Purpose

Document the Telegram integration: MTProto listener for signals, session-by-file pattern, and optional control bot.

## Audience

Operators configuring signals, remote control, and alerts.

## Dependencies

- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_PHONE`
- `TELEGRAM_CHANNEL_ID`
- `TELEGRAM_SESSION_PATH` (recommended)
- Optional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CONTROL_ALLOWED_IDS`

## Where it fits

- Signal listener: `backend/src/telegram/telegram_listener.js`
- Session: `backend/src/services/telegramSessionLoader.js`
- Control bot: `backend/src/telegram/telegram_control.js`
- Handlers: `backend/src/telegram/handlers/*`
- UI: `backend/src/telegram/ui/*`

## Secure Session Pattern

Do not use `TELEGRAM_SESSION` in env. The boot process rejects that raw variable. Use:

```env
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
```

The loader tries:

1. `TELEGRAM_SESSION_PATH`
2. Local fallback `backend/telegram_session.txt` (first-boot compatibility only)

After the first interactive login, move the session outside the repo:

```bash
mv backend/telegram_session.txt /opt/bot/secrets/telegram_session.txt
chmod 600 /opt/bot/secrets/telegram_session.txt
```

## Configuration

In `/opt/bot/secrets/bot-secrets.env`:

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_hash_here
TELEGRAM_PHONE=+15551234567
```

In `backend/.env`:

```env
TELEGRAM_CHANNEL_ID=-1001234567890
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
ENABLE_SIGNAL_LISTENER=true
```

For the control bot:

```env
ENABLE_CONTROL_BOT=true
```

In `/opt/bot/secrets/bot-secrets.env`:

```env
TELEGRAM_BOT_TOKEN=token_from_botfather
TELEGRAM_CONTROL_ALLOWED_IDS=123456789,987654321
```

## Remote Operations

The control bot lets you pause, resume, control auto-trading, open manual trades, close, reduce, and update TP/SL via the existing handlers.

Important rules:

- Authorized IDs must be in `TELEGRAM_CONTROL_ALLOWED_IDS`.
- If `ENABLE_CONTROL_BOT=true`, the fail-fast requires token and IDs.
- Remote closes use stricter venue resolution than local helpers.

## Manual Trade Format

Free-form text line in the control bot:

```
SOL LONG 150 165 142 5 isolated
```

Fields:

```
ASSET DIRECTION ENTRY TP SL LEVERAGE [MARGIN]
```

## Risks

- Critical: raw Telegram session in `.env` or committed to git.
- High: `TELEGRAM_CONTROL_ALLOWED_IDS` empty may allow broad access depending on bot configuration.
- High: control bot enabled in live without reviewed operators.
- Medium: wrong channel in `TELEGRAM_CHANNEL_ID` causes operational silence.

## Troubleshooting

- Interactive login always appears: check `TELEGRAM_SESSION_PATH`, file content, and permissions.
- Signals not arriving: confirm channel, account authorized in the channel, and `ENABLE_SIGNAL_LISTENER=true`.
- Control bot not responding: check token, polling, allowed IDs, and `[CTRL]` logs.
- Access denied: compare your user ID with `TELEGRAM_CONTROL_ALLOWED_IDS`.

## Final Checklist

- [ ] Session is outside the repo
- [ ] `TELEGRAM_SESSION` does not exist in the environment
- [ ] Listener starts and monitors the correct channel
- [ ] Control bot (if enabled) has explicit allowed IDs
- [ ] In live, remote commands were tested first in paper mode
