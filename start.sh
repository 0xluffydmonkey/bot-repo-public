#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# start.sh — root-level entrypoint for bot-trader
#
# Usage:
#   ./start.sh
#
# This script delegates to backend/start.sh, which handles secrets validation,
# Node.js resolution, and process launch.
# ---------------------------------------------------------------------------
REPO_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
exec "$REPO_DIR/backend/start.sh" "$@"
