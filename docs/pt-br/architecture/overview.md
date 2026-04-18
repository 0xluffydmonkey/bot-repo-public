# Visão Geral da Arquitetura

## Propósito

Explicar como o Bot Trader / TradeFinderBot está organizado hoje — sem propor reescrita ou arquitetura nova.

## Público-alvo

Desenvolvedores, operadores e revisores que precisam entender o fluxo real antes de alterar configuração, código ou ambiente.

## Status

Já implementado:

- backend Node.js em `backend/src`
- frontend Vite/React em `frontend/src`
- dashboard servido pelo backend a partir de `backend/src/web/public`
- listener Telegram MTProto para sinais
- control bot Telegram opcional
- paper engine em memória
- live trading por venues/adapters
- Supabase/PostgreSQL opcional para auditoria e métricas
- systemd para VM Ubuntu

Parcialmente implementado:

- multi-venue simultâneo: o core tem `venue` em posições e resolução de close, mas tracking simultâneo do mesmo ativo em múltiplas venues tem limitações operacionais conhecidas.
- Jupiter e Phoenix: registrados como venues, mas não live-ready.

## Mapa de Componentes

| Área | Caminhos principais |
|------|---------------------|
| Orquestrador | `backend/src/index.js` |
| Config e fail-fast | `backend/src/config/index.js`, `backend/src/config/validateEnv.js` |
| Secrets por arquivo | `backend/src/services/secretFileLoader.js`, `backend/src/services/walletLoader.js`, `backend/src/services/telegramSessionLoader.js` |
| Telegram listener | `backend/src/telegram/telegram_listener.js` |
| Telegram control bot | `backend/src/telegram/telegram_control.js`, `backend/src/telegram/handlers/*` |
| Execução perp | `backend/src/trading/PerpExecutionService.js` |
| Trade manual | `backend/src/trading/ManualTradeService.js` |
| Paper trading | `backend/src/trading/paperEngine.js` |
| Venues | `backend/src/venues/*`, `backend/src/trading/adapters/*` |
| Gerenciamento de posições | `backend/src/trading/position-management/PositionManager.js` |
| Monitoramento | `backend/src/monitor/*` |
| Dashboard backend | `backend/src/web/server.js` |
| Dashboard frontend | `frontend/src/*` |
| Persistência externa | `backend/src/services/persistenceService.js` |
| Reconciliação | `backend/src/services/positionReconciliationService.js` |
| Persistência local | `backend/data/positions.json`, logs em `LOG_DIR` |
| systemd | `backend/deploy/systemd/*` |

## Fluxo de Sinais

1. O listener Telegram recebe mensagens do canal configurado em `TELEGRAM_CHANNEL_ID`.
2. `signal_parser.js` tenta extrair um sinal válido.
3. `index.js` aplica gates de intake, pausa, auto-trading global e gate específico de venue.
4. `ManualTradeService.executeSignal()` executa o núcleo compartilhado.
5. O risk manager calcula parâmetros com base em saldo, limites e configurações.
6. `PerpExecutionService` roteia para o paper engine ou adapter live.
7. `state` alimenta dashboard, control bot e monitoramento.
8. `persistenceService` grava auditoria best-effort se `SUPABASE_DB_URL_PATH` estiver configurado.

## Fluxo de Controle Manual

Controles manuais entram por:

- dashboard REST/Socket.IO em `backend/src/web/server.js`
- Telegram control bot em `backend/src/telegram/telegram_control.js`
- scripts manuais em `backend/scripts/*`

Aberturas manuais passam pelo mesmo `executeSignal()` dos sinais automáticos. Fechamentos remotos são mais estritos na resolução de venue que helpers locais. Veja [../trading/close-policy.md](../trading/close-policy.md).

## Reconciliação de Posições

O sistema tem um mecanismo de reconciliação em duas camadas para tratar posições fechadas externamente (liquidações, UI da venue, TP/SL na exchange, reinício do bot durante um close).

- **Camada 1** — reativa, inline no `PositionManager`: detecta quando uma posição desaparece dos snapshots da venue (após `CLOSE_CONFIRMATION_MISSES=2` ausências consecutivas) e persiste o fechamento imediatamente.
- **Camada 2** — safety net periódica em `positionReconciliationService.js`: consulta o banco por trades OPEN não presentes na venue e por trades recentemente fechados sem `exit_price`.

Veja [../operations/reconciliation.md](../operations/reconciliation.md).

## Pré-requisitos

- Node.js 18+
- npm
- Acesso ao canal Telegram e credenciais MTProto
- Arquivo de secrets fora do repo
- Para live: venue live-ready configurada com preflight completo
- Para Supabase: projeto criado e schema aplicado

## Configuração Mínima

`backend/.env`:

```env
TELEGRAM_CHANNEL_ID=-1001234567890
PAPER_TRADING=true
PERP_OPEN_VENUE=drift
ENABLE_SIGNAL_LISTENER=true
ENABLE_WEB=true
ENABLE_CONTROL_BOT=false
```

`/opt/bot/secrets/bot-secrets.env`:

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=hash_real
TELEGRAM_PHONE=+5511999999999
```

Use valores reais apenas no arquivo externo de secrets. Não use esses exemplos como segredos reais.

## Riscos

- Crítico: private key ou sessão Telegram dentro do repo.
- Alto: habilitar live antes de validar venue, saldo, RPC/API e permissão de controle remoto.
- Médio: Supabase indisponível reduz auditoria e métricas, mas não bloqueia trades.
- Baixo: docs antigas podem permanecer como referência histórica; o índice central aponta para a estrutura atual.

## Checklist Final

- [ ] `npm install` executado em `backend/`
- [ ] `backend/.env` contém apenas configuração não secreta
- [ ] `/opt/bot/secrets/bot-secrets.env` existe com `chmod 600`
- [ ] `./start.sh` inicia em modo paper
- [ ] Dashboard responde em `/api/state` quando habilitado
- [ ] Logs não mostram secrets raw
