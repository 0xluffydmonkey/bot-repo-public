# Systemd — Production Deployment

> **Advanced.** Only needed if you want the bot to run continuously on a server and restart automatically after crashes or reboots.

---

## Before you start

Make sure the bot works manually first:

```bash
./start.sh   # must start without errors
# Press Ctrl+C to stop
```

Also confirm the Telegram session file is already in `/opt/bot/secrets/` (see [running.md](../operations/running.md)).

---

## Install the service

```bash
sudo cp backend/deploy/systemd/bot-trader.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bot-trader
```

Files:
- source: `backend/deploy/systemd/bot-trader.service`
- installed service: `/etc/systemd/system/bot-trader.service`

`enable` means the service will start automatically at boot.

---

## Start and verify

```bash
sudo systemctl start bot-trader
sudo systemctl status bot-trader
```

You should see `Active: active (running)`.

---

## Control commands

```bash
sudo systemctl start bot-trader      # start
sudo systemctl stop bot-trader       # stop
sudo systemctl restart bot-trader    # restart (after code changes or .env edits)
sudo systemctl status bot-trader     # status
```

Or use the root scripts:

```bash
./stop.sh
./status.sh
```

---

## View logs

```bash
# Follow in real time (clean)
journalctl -u bot-trader -f -o cat

# Last 100 lines
journalctl -u bot-trader -n 100

# Filter startup messages only
journalctl -u bot-trader -n 50 | grep '\[START\]\|\[CONFIG\]'

# Filter bot activity
journalctl -u bot-trader -f | grep '\[BOT\]'
```

---

## Update the bot

```bash
git pull
cd backend && npm install && cd ..   # only needed if package.json changed
sudo systemctl restart bot-trader
sudo systemctl status bot-trader
```

---

## Override settings without editing files

```bash
sudo systemctl edit bot-trader
```

File created/updated by systemd: `/etc/systemd/system/bot-trader.service.d/override.conf`

Example — force paper trading:

File: `/etc/systemd/system/bot-trader.service.d/override.conf`

```ini
[Service]
Environment=PAPER_TRADING=true
```

Save and restart:

```bash
sudo systemctl restart bot-trader
```

---

## Uninstall

```bash
sudo systemctl stop bot-trader
sudo systemctl disable bot-trader
sudo rm /etc/systemd/system/bot-trader.service
sudo systemctl daemon-reload
```
