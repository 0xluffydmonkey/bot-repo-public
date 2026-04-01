# Systemd Deployment

The full VM setup and operational guide lives at:

**[backend/docs/quick-start-vm.md](../../docs/quick-start-vm.md)**

That document covers: initial setup, secrets, .env, installing the service, controlling it, viewing logs, updating, and troubleshooting.

---

## Files in this directory

| File | Purpose |
|------|---------|
| `bot-trader.service` | systemd unit file — copy to `/etc/systemd/system/` |
| `start.sh` | Backward-compatibility wrapper → delegates to `backend/start.sh` |

The canonical entrypoint is `backend/start.sh`. The service file calls it with no flags — module activation is controlled by `.env` (see `ENABLE_SIGNAL_LISTENER`, `ENABLE_WEB`, `ENABLE_CONTROL_BOT`).

---

## Quick reference

```bash
# Install service
sudo cp bot-trader.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bot-trader

# Control
sudo systemctl start bot-trader
sudo systemctl stop bot-trader
sudo systemctl restart bot-trader
sudo systemctl status bot-trader

# Logs
journalctl -u bot-trader -f
journalctl -u bot-trader -n 100

# Uninstall
sudo systemctl disable bot-trader
sudo rm /etc/systemd/system/bot-trader.service
sudo systemctl daemon-reload
```
