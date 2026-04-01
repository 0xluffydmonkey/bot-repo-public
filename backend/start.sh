#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# start.sh — canonical launch entrypoint for bot-trader
#
# Usage:
#   ./start.sh                        # default (no flags)
#   ./start.sh --web                  # enable web dashboard
#   ./start.sh --web --control-bot    # enable web + Telegram control bot
#
# Secrets:
#   Reads secrets from $BOT_SECRETS_FILE (default: /opt/bot/secrets/bot-secrets.env)
#   Override by exporting BOT_SECRETS_FILE before calling this script.
# ---------------------------------------------------------------------------
set -euo pipefail

# --- Secrets file -----------------------------------------------------------
# Default path — override by setting BOT_SECRETS_FILE in the environment.
export BOT_SECRETS_FILE="${BOT_SECRETS_FILE:-/opt/bot/secrets/bot-secrets.env}"

if [ ! -f "$BOT_SECRETS_FILE" ]; then
  echo "[START] Secrets file not found: $BOT_SECRETS_FILE" >&2
  echo "[START] Create it with chmod 600 and fill in your secrets." >&2
  echo "[START] See backend/.env.example for the required keys." >&2
  exit 1
fi

echo "[START] Loading secrets from: $BOT_SECRETS_FILE"

# --- Resolve node binary ----------------------------------------------------
# systemd runs with a minimal PATH; nvm-managed node won't be found by default.
# We probe common locations in order of preference.
NODE_BIN=""

# 1. nvm (most common on Ubuntu dev/prod VMs)
if [ -d "$HOME/.nvm/versions/node" ]; then
  LATEST_NVM_NODE=$(ls "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)
  NVM_CANDIDATE="$HOME/.nvm/versions/node/$LATEST_NVM_NODE/bin/node"
  if [ -x "$NVM_CANDIDATE" ]; then
    NODE_BIN="$NVM_CANDIDATE"
  fi
fi

# 2. System-wide installs
for CANDIDATE in /usr/local/bin/node /usr/bin/node; do
  if [ -z "$NODE_BIN" ] && [ -x "$CANDIDATE" ]; then
    NODE_BIN="$CANDIDATE"
  fi
done

if [ -z "$NODE_BIN" ]; then
  echo "[START] node binary not found. Install Node.js >= 18 or check your nvm setup." >&2
  exit 1
fi

echo "[START] node: $NODE_BIN ($("$NODE_BIN" --version 2>&1))"

# --- Resolve paths ----------------------------------------------------------
# start.sh lives at: backend/start.sh
# BACKEND_DIR is:    backend/
BACKEND_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ENTRY_POINT="$BACKEND_DIR/src/index.js"

if [ ! -f "$ENTRY_POINT" ]; then
  echo "[START] Entry point not found: $ENTRY_POINT" >&2
  exit 1
fi

echo "[START] Backend: $BACKEND_DIR"
echo "[START] Starting bot..."

# --- Launch -----------------------------------------------------------------
# exec replaces this script's process so systemd tracks the node PID directly.
# All arguments passed to start.sh are forwarded to node (e.g. --web --control-bot).
cd "$BACKEND_DIR"
exec "$NODE_BIN" src/index.js "$@"
