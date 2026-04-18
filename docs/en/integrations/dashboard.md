# Web Dashboard

## Purpose

Document the web dashboard: its endpoints and the authentication model for critical commands.

## Audience

Operators and developers who use or maintain the web interface.

## Dependencies

- `ENABLE_WEB=true`
- `WEB_PORT`, default `3000`
- Optional for remote access: `WEB_API_TOKEN` in the external secrets file

## Where it fits

- Backend: `backend/src/web/server.js`
- Static build served: `backend/src/web/public`
- Frontend source: `frontend/src`
- API client: `frontend/src/api/client.ts`

## Configuration

In `backend/.env`:

```env
ENABLE_WEB=true
WEB_PORT=3000
WEB_HOST=127.0.0.1
```

For remote access, configure the token in `/opt/bot/secrets/bot-secrets.env`:

```env
WEB_API_TOKEN=a-long-random-token-here
```

The frontend uses `localStorage` with the key `trade-dashboard-api-token` to send `X-API-Token`.

## Endpoints

Read-only (no authentication required):

```
GET /api/state
GET /api/metrics/summary
GET /api/metrics/by-symbol
GET /api/metrics/pnl-timeseries
GET /api/metrics/distribution
GET /api/metrics/by-side
GET /api/metrics/risk
GET /api/audit/:botTradeRef
```

Critical actions (require `X-API-Token` or localhost origin):

```
POST /api/pause
POST /api/resume
POST /api/autotrading
POST /api/intake
POST /api/open
POST /api/close
POST /api/close_all
POST /api/tpsl
POST /api/reduce
```

## Real Examples

Query local state:

```bash
curl -sS http://127.0.0.1:3000/api/state
```

Pause with token:

```bash
curl -sS -X POST http://127.0.0.1:3000/api/pause \
  -H 'Content-Type: application/json' \
  -H 'X-API-Token: a-long-random-token-here'
```

Open a manual trade:

```bash
curl -sS -X POST http://127.0.0.1:3000/api/open \
  -H 'Content-Type: application/json' \
  -H 'X-API-Token: a-long-random-token-here' \
  -d '{"asset":"SOL","direction":"LONG","entry":150,"tp":165,"sl":142,"leverage":5,"marginType":"isolated"}'
```

## Risks

- High: remote dashboard without `WEB_API_TOKEN`.
- High: ports open publicly without firewall or reverse proxy.
- Medium: metrics empty when Supabase is not configured.
- Medium: `/api/state` and WebSocket reads do not require a token today.

## Troubleshooting

- 403 on remote command: configure `WEB_API_TOKEN`.
- 401: token missing or incorrect.
- Dashboard opens but does not update: check Socket.IO and `[WEB]` logs.
- Metrics empty: see [supabase.md](supabase.md).

## Final Checklist

- [ ] `ENABLE_WEB=true`
- [ ] Remote access uses `WEB_API_TOKEN`
- [ ] Commands tested in paper mode
- [ ] `/api/state` responds
- [ ] Logs show `[WEB] Dashboard online` at boot
