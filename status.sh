#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# status.sh — show bot-trader status
#
# Checks systemd service first (production), falls back to process search.
# ---------------------------------------------------------------------------

# Try systemd service first
if systemctl list-units --type=service 2>/dev/null | grep -q bot-trader; then
  systemctl status bot-trader
  exit $?
fi

# Fall back to process search
PID=$(pgrep -f "node src/index.js" 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "[STATUS] Bot is running (PID: $PID)"
else
  echo "[STATUS] Bot is not running."
fi
