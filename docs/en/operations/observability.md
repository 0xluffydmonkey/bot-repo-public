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
