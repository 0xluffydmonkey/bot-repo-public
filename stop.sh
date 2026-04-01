#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# stop.sh — stop the bot-trader process
#
# Tries systemd first (production), falls back to killing the Node process.
# ---------------------------------------------------------------------------
set -euo pipefail

# Try systemd service first
if systemctl is-active --quiet bot-trader 2>/dev/null; then
  sudo systemctl stop bot-trader
  echo "[STOP] bot-trader service stopped."
  exit 0
fi

# Fall back to process search
PID=$(pgrep -f "node src/index.js" 2>/dev/null || true)
if [ -n "$PID" ]; then
  kill "$PID"
  echo "[STOP] Bot process (PID: $PID) stopped."
else
  echo "[STOP] No running bot process found."
fi
