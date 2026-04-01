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

**"Missing required secret: SOLANA_RPC_URL"**

The file exists but still has a placeholder value (`SET_IN_SERVER_ONLY`). Open the file and replace it with a real value:

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

Check if paper mode is on:

```bash
grep PAPER_TRADING backend/.env
```

If `PAPER_TRADING=true`, the bot validates signals but doesn't submit transactions. That's expected.

---

**Risk manager is rejecting all signals**

Check the bot logs for the rejection reason. Common causes:

- `MAX_POSITIONS` already reached — wait for an open position to close
- Free collateral below `MIN_FREE_MARGIN_PCT` — add funds or lower the threshold
- Signal R:R ratio below 1:1 — the signal source is sending low-quality signals
- Asset not supported — the signal mentions a token Drift doesn't list

---

**Signals aren't being detected**

Verify `TELEGRAM_CHANNEL_ID` is correct and matches the channel exactly (including the `-` sign for channel IDs).
