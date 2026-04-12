# Troubleshooting

---

## Bot won't start

**"Secrets file not found"**

The file `/opt/bot/secrets/bot-secrets.env` is missing or the path is wrong.

```bash
ls -la /opt/bot/secrets/bot-secrets.env
```

If it doesn't exist, create it:

```bash
touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
nano /opt/bot/secrets/bot-secrets.env
```

---

**"Missing required secret: SOLANA_RPC_URL" or another backend credential**

The file exists but the selected module/backend is missing a required value or still has a placeholder (`SET_IN_SERVER_ONLY`). Open the secrets file and replace placeholders with real values:

```bash
nano /opt/bot/secrets/bot-secrets.env
```

---

**"node binary not found"**

Node.js isn't installed or isn't in the expected path.

```bash
node --version   # if this fails, install Node.js
```

Install via nvm:

```bash
nvm install 20 && nvm use 20
```

---

**"Permission denied"**

The scripts aren't executable.

```bash
chmod +x start.sh stop.sh status.sh backend/start.sh
```

---

## Telegram issues

**Authentication keeps looping / "phone code invalid"**

The session file is stale or corrupt. Delete it and log in again:

```bash
rm /opt/bot/secrets/telegram_session.txt
./start.sh
```

After the new session is created, move it:

```bash
mv backend/telegram_session.txt /opt/bot/secrets/telegram_session.txt
chmod 600 /opt/bot/secrets/telegram_session.txt
```

---

**"Not authorized" / session expired**

Telegram sessions expire after a period of inactivity or if you revoke them. Regenerate using the steps above.

---

**Can't find the channel ID**

Forward any message from the signal channel to `@userinfobot` on Telegram. It will reply:

```
Forwarded from channel id: -1001234567890
```

Use that number (including the minus sign) as `TELEGRAM_CHANNEL_ID` in `backend/.env`.

---

## Systemd issues

**Service fails to start**

```bash
sudo systemctl status bot-trader
journalctl -u bot-trader -n 50 --no-pager
```

Common causes:

| Error message | Fix |
|--------------|-----|
| `Secrets file not found` | Create `/opt/bot/secrets/bot-secrets.env` |
| `ConditionPathExists failed` | `backend/.env` doesn't exist — run `cp backend/.env.example backend/.env` |
| `node binary not found` | Check nvm installation |
| `Permission denied` | `chmod +x start.sh backend/start.sh` |

---

**Service keeps restarting**

```bash
journalctl -u bot-trader -b --no-pager | grep -E '(Started|Failed|Stopping)'
```

---

## Trading issues

**No trades are executing**

Check the following in order:

1. Paper mode: `grep PAPER_TRADING backend/.env` — if `true`, no real trades are expected.
2. Signal intake: check the dashboard or `/config` in Telegram — is **Intake** ON?
3. Pause: check the dashboard or `/config` — is bot **Paused**?
4. Auto-trading: check the dashboard or `/config` — is **Auto-trading** ON?

If all three are enabled and you still see no trades, check the signal log (`/signals` in Telegram or the dashboard signal panel) to see if signals are arriving.

---

**Signal intake is OFF — signals not appearing in the ignored log**

That is expected behavior. When signal intake is disabled, signals are silently discarded before any processing — they do not appear in the signal log. To see signals again, re-enable intake:
- Telegram: `⚙️ Config` → `🔔 Ativar Intake`
- REST: `POST /api/intake` with `{ "enabled": true }`

---

**Risk manager is rejecting all signals**

Check the bot logs for the rejection reason. Common causes:

- `MAX_POSITIONS` already reached — wait for an open position to close
- Free collateral below `MIN_FREE_MARGIN_PCT` — add funds or lower the threshold
- Signal R:R ratio below 1:1 — the signal source is sending low-quality signals
- Asset not supported — the signal mentions a token the active venue doesn't list

---

**Signals aren't being detected**

Verify `TELEGRAM_CHANNEL_ID` is correct and matches the channel exactly (including the `-` sign for channel IDs).

Also check signal intake is enabled (see above).

---

## Backend / venue issues

**"Venue '<name>' does not support openTrade"**

The selected backend is registered but does not expose live execution capability in this codebase. Either:
- choose a live-ready backend in `PERP_OPEN_VENUE`
- keep `PAPER_TRADING=true` while testing static metadata and risk validation

---

**"Execution adapter not registered for venue"**

The `PERP_OPEN_VENUE` value doesn't match any registered backend/venue. Current registered values include `drift`, `jupiter`, `phoenix`, and `valiant`. Check your `.env` for typos and confirm the venue is registered in the codebase.

---

**"Wallet/key not configured for venue"**

The selected backend requires a wallet or signing key path that is missing from the secrets file. Use the `*_PATH` model:

File: `/opt/bot/secrets/bot-secrets.env`

```env
WALLET_DRIFT_PATH=/opt/bot/wallets/drift.json
WALLET_JUPITER_PATH=/opt/bot/wallets/jupiter.json
WALLET_PHOENIX_PATH=/opt/bot/wallets/phoenix.json
VALIANT_AGENT_KEY_PATH=/opt/bot/secrets/valiant-agent-key.txt
VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt
```

Never put raw private keys in `.env` or `bot-secrets.env`.

`VALIANT_MAIN_KEY_PATH` is only required for Valiant/Hyperliquid user-signed transfer operations such as optional spot→perps transfer.

---

**Auto-trading is ON globally but automated live orders are still blocked**

Some backends have an extra explicit startup gate to prevent accidental automated execution. Check backend-specific flags such as:

File: `backend/.env`

```env
ENABLE_AUTO_TRADING_VALIANT=true
```

Only enable these after paper testing, preflight, and a small manual live test.

---

## Dashboard / web issues

**Dashboard shows stale data**

The dashboard updates via WebSocket. If the connection dropped:
- Reload the page — the WebSocket will reconnect automatically
- Check if the backend is still running: `./status.sh`

---

**REST API returns 401**

`WEB_API_TOKEN` is set in your secrets file but you're not providing it in the request header.

File: `/opt/bot/secrets/bot-secrets.env`

```bash
curl -X POST http://localhost:3000/api/pause \
  -H "X-API-Token: YOUR_TOKEN"
```

---

**REST API returns 403**

`WEB_API_TOKEN` is not set and you're connecting from a non-localhost address. Either:
- Set `WEB_API_TOKEN` in your secrets file for remote access: `/opt/bot/secrets/bot-secrets.env`
- Connect only from localhost

---

## Manual trading issues

**Manual open rejected — "risk manager"**

The manual trade failed risk validation. Common reasons:
- Asset not in supported list for the active venue
- TP/SL yields R:R < 1:1 (TP too close to entry, or SL too far)
- `MAX_POSITIONS` already reached
- Insufficient free collateral

The error message in the Telegram confirmation screen or the API response will explain the specific reason.

---

**Partial reduce rejected — "baseToReduce < minBase"**

The percentage you entered would result in a trade size below the venue's minimum order size. Try a higher percentage, or use full close.

---

**Partial reduce rejected — "baseRemaining < minBase"**

After the reduction, the remaining position would be below the venue's minimum size. Increase the percentage to leave a larger remaining position, or use full close.
