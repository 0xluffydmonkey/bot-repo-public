# Observability and Logs

## Purpose

Explain where to observe bot state, logs, and metrics.

## Audience

Operators and developers performing diagnostics.

## Dependencies

- Winston logger in `backend/src/utils/logger.js`
- journald when running via systemd
- Optional dashboard
- Optional Supabase for historical metrics

## Where it fits

The backend logs to the console and to rotating files. Under systemd, stdout/stderr also go to journald with `SyslogIdentifier=bot-trader`.

## Configuration

In `backend/.env`:

```env
LOG_LEVEL=info
LOG_DIR=./logs
```

Generated files:

```
logs/bot-YYYY-MM-DD.log
logs/errors-YYYY-MM-DD.log
```

## Systemd Logs

```bash
journalctl -u bot-trader -f -o cat
journalctl -u bot-trader -n 100 -o cat
journalctl -u bot-trader -n 50 -o cat | grep '\[CONFIG\]\|\[START\]'
```

## Real-Time State

```bash
curl -sS http://127.0.0.1:3000/api/state
```

The dashboard also receives updates via Socket.IO.

## Historical Metrics

When Supabase is configured, these endpoints read the `trades` table:

```
GET /api/metrics/summary
GET /api/metrics/by-symbol
GET /api/metrics/pnl-timeseries
GET /api/metrics/distribution
GET /api/metrics/by-side
GET /api/metrics/risk
GET /api/audit/:botTradeRef
```

Without Supabase, these endpoints return empty/default data because persistence is best-effort.

## Key Log Prefixes

| Prefix | Meaning |
|--------|---------|
| `[CONFIG]` | Startup configuration loading |
| `[START]` | Boot sequence |
| `[BOT]` | Main bot state |
| `[TELEGRAM]` | Signal listener and control bot |
| `[TRADE]` | Trade execution |
| `[PM]` | Position manager |
| `[PERSIST]` | Database persistence |
| `[RECONCILE]` | Reconciliation service: close stale DB `OPEN`, enrich closes, adopt external venue positions |
| `[WEB]` | Dashboard server |
| `[RISK]` | Risk manager decisions |

## Valiant / Hyperliquid Execution Logs

To monitor order-open execution on Valiant:

```bash
journalctl -u bot-trader -f | grep '\[VALIANT\]'
```

Leverage retry events (prefix `[VALIANT]`, field `event`):

| Event | Level | Meaning |
|-------|-------|---------|
| `leverage_set_retry_attempt` | WARN | A leverage call failed transiently; retry in progress. Includes `attempt` (1 or 2) and error message. |
| `leverage_set_retry_success` | INFO | Leverage accepted on a retry. Open continues normally. |
| `leverage_set_retry_failed_final` | ERROR | All 3 leverage attempts exhausted. Open aborted — no order was sent. |
| `leverage_set_no_retry_unmapped_error` | ERROR | Signing or auth error on leverage call. Fails immediately without retry. |

To filter only leverage retry events:

```bash
journalctl -u bot-trader -f | grep 'leverage_set_retry'
```

## Log Noise Reduction

Some recurring log messages are deduplicated in memory to keep the terminal readable at runtime without losing diagnostic value:

| Log | Dedup policy |
|-----|-------------|
| `[RECONCILE] Pass 3: N trades OPEN ... adoção ignorada (ambiguidade)` | Emitted only when `db_open_count` changes for that asset/venue pair. If the count stays the same it is suppressed on subsequent reconciliation cycles. |
| `[PM] position restored with bot_trade_ref` | Emitted once per `asset:ref` pair per session. Not repeated on every polling cycle. Re-emits on restart or after the position is closed and a new ref appears. |

This dedup is in-memory only. It resets on bot restart, so the message fires at least once after every restart. No diagnostic information is removed — only repetition is suppressed.

## Reconciliation Logs

To check whether the reconciliation service is running and finding anything:

```bash
journalctl -u bot-trader -f | grep '\[RECONCILE\]'
```

Key events to look for:

```
event: reconcile_close
event: reconcile_enrich_found
event: adopt_candidate_seen
event: adopt_external_position
event: trade_external_adopted
```

For interpretation and limitations, see [reconciliation.md](reconciliation.md).

## Risks

- High: logs must not contain secrets.
- Medium: `LOG_DIR` without write permission prevents log files, but journald may still capture console output.
- Medium: Supabase outage removes history/audit, but does not block trading.

## Troubleshooting

- No log files: check `LOG_DIR` and process user permissions.
- No systemd logs: check the unit and `SyslogIdentifier`.
- Metrics empty: check Supabase schema and `SUPABASE_DB_URL_PATH`.

## Final Checklist

- [ ] Logs appear in journald
- [ ] Rotating files are written
- [ ] `/api/state` responds
- [ ] If Supabase is enabled, metrics stop being empty after closed trades
