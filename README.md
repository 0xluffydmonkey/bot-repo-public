# TradeFinderBot

> **Leia em Português:** [README.pt-BR.md](README.pt-BR.md)

Algorithmic trading bot that monitors a private Telegram channel for trade signals and executes them automatically on [Drift Protocol](https://drift.trade/) (Solana perpetuals).

---

## Quick Start

```bash
git clone git@github.com:YOUR_USER/bot-repo.git
cd bot-repo
./start.sh
```

That's it. The bot starts, validates your secrets, and waits for signals.

---

## First Run Checklist

Before running `./start.sh` for the first time:

- [ ] Node.js >= 18 installed (`node --version`)
- [ ] `npm install` run inside `backend/`
- [ ] `backend/.env` created from `backend/.env.example`
- [ ] Secrets file created at `/opt/bot/secrets/bot-secrets.env`
- [ ] Wallet keypair at `/opt/bot/secrets/drift-bot-wallet.json`
- [ ] `chmod +x start.sh stop.sh status.sh`

See [docs/en/installation.md](docs/en/installation.md) for step-by-step instructions.

---

## Safe Mode

Always start in safe mode. Set this in `backend/.env`:

```env
PAPER_TRADING=true
```

In safe mode the bot reads signals and validates them, but **does not submit any transactions**. Run it for at least 24 hours before switching to live trading.

---

## Commands

```bash
./start.sh    # start the bot
./stop.sh     # stop the bot
./status.sh   # check if it's running
```

---

## Documentation

| Guide | |
|-------|-|
| [Installation](docs/en/installation.md) | What you need and how to set it up |
| [Configuration](docs/en/configuration.md) | Settings, secrets, feature toggles |
| [Running](docs/en/running.md) | Start, stop, first run, paper vs live |
| [Systemd](docs/en/systemd.md) | Auto-start on server (advanced) |
| [Troubleshooting](docs/en/troubleshooting.md) | Fixes for common errors |

---

## Warnings

- Leverage can cause full position liquidation
- Start with `POSITION_SIZE_PCT=0.01` (1%) and paper mode
- Keep SOL in the wallet for gas fees (~0.1 SOL)
- Never invest more than you can afford to lose
