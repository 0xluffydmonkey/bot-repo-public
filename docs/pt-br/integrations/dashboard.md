# Dashboard Web

## Propósito

Documentar o dashboard web: seus endpoints e o modelo de autenticação para comandos críticos.

## Público-alvo

Operadores e desenvolvedores que usam ou mantêm a interface web.

## Dependências

- `ENABLE_WEB=true`
- `WEB_PORT`, padrão `3000`
- Opcional para acesso remoto: `WEB_API_TOKEN` no arquivo externo de secrets

## Onde se encaixa

- Backend: `backend/src/web/server.js`
- Build estático servido: `backend/src/web/public`
- Frontend fonte: `frontend/src`
- Cliente API: `frontend/src/api/client.ts`

## Configuração

Em `backend/.env`:

```env
ENABLE_WEB=true
WEB_PORT=3000
WEB_HOST=127.0.0.1
```

Para acesso remoto, configure token em `/opt/bot/secrets/bot-secrets.env`:

```env
WEB_API_TOKEN=token_longo_aleatorio
```

O frontend usa `localStorage` com a chave `trade-dashboard-api-token` para enviar `X-API-Token`.

## Endpoints

Leitura sem autenticação:

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

Ações críticas com `X-API-Token` ou origem localhost:

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

## Exemplos Reais

Consultar estado local:

```bash
curl -sS http://127.0.0.1:3000/api/state
```

Pausar com token:

```bash
curl -sS -X POST http://127.0.0.1:3000/api/pause \
  -H 'Content-Type: application/json' \
  -H 'X-API-Token: token_longo_aleatorio'
```

Abrir trade manual:

```bash
curl -sS -X POST http://127.0.0.1:3000/api/open \
  -H 'Content-Type: application/json' \
  -H 'X-API-Token: token_longo_aleatorio' \
  -d '{"asset":"SOL","direction":"LONG","entry":150,"tp":165,"sl":142,"leverage":5,"marginType":"isolated"}'
```

## Riscos

- Alto: dashboard remoto sem `WEB_API_TOKEN`.
- Alto: portas abertas publicamente sem firewall/reverse proxy.
- Médio: métricas vazias quando Supabase não está configurado.
- Médio: leitura de `/api/state` e WebSocket não exigem token hoje.

## Troubleshooting

- 403 em comando remoto: configure `WEB_API_TOKEN`.
- 401: token ausente ou incorreto.
- Dashboard abre mas não atualiza: confira Socket.IO e logs `[WEB]`.
- Métricas zeradas: veja [supabase.md](supabase.md).

## Checklist Final

- [ ] `ENABLE_WEB=true`
- [ ] Acesso remoto usa `WEB_API_TOKEN`
- [ ] Comandos testados em paper
- [ ] `/api/state` responde
- [ ] Logs `[WEB] Dashboard online` aparecem no boot
