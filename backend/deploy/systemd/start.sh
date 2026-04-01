#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# start.sh — backward-compatibility wrapper
#
# The canonical entrypoint has moved to: backend/start.sh
# This wrapper exists so that older systemd configs and any scripts that
# reference the old path continue to work without modification.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
exec "$SCRIPT_DIR/../../start.sh" "$@"
