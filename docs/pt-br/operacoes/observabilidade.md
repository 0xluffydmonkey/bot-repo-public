# Observabilidade e Logs

## Propósito

Explicar onde observar estado, logs e métricas do bot.

## Público-alvo

Operadores e desenvolvedores em diagnóstico.

## Dependências

- Logger Winston em `backend/src/utils/logger.js`
- journald quando rodando via systemd
- Painel opcional
- Supabase opcional para métricas históricas

## Onde se encaixa

O backend loga no console e em arquivos rotativos. Em systemd, stdout/stderr também vão para journald com `SyslogIdentifier=bot-trader`.

## Configuração

Em `backend/.env`:

```env
LOG_LEVEL=info
LOG_DIR=./logs
```

Arquivos gerados:

```
logs/bot-YYYY-MM-DD.log
logs/errors-YYYY-MM-DD.log
```

## Logs do systemd

```bash
journalctl -u bot-trader -f -o cat
journalctl -u bot-trader -n 100 -o cat
journalctl -u bot-trader -n 50 -o cat | grep '\[CONFIG\]\|\[START\]'
```

## Estado em Tempo Real

```bash
curl -sS http://127.0.0.1:3000/api/state
```

O painel também recebe updates por Socket.IO.

## Métricas Históricas

Quando Supabase está configurado, os endpoints leem a tabela `trades`:

```
GET /api/metrics/summary
GET /api/metrics/by-symbol
GET /api/metrics/pnl-timeseries
GET /api/metrics/distribution
GET /api/metrics/by-side
GET /api/metrics/risk
GET /api/audit/:botTradeRef
```

Sem Supabase, esses endpoints retornam dados vazios/default porque o service é best-effort.

## Prefixos de Log Principais

| Prefixo | Significado |
|---------|-------------|
| `[CONFIG]` | Carregamento de configuração no boot |
| `[START]` | Sequência de boot |
| `[BOT]` | Estado principal do bot |
| `[TELEGRAM]` | Listener de sinais e bot de controle |
| `[TRADE]` | Execução de trades |
| `[PM]` | Position manager |
| `[PERSIST]` | Persistência no banco |
| `[RECONCILE]` | Serviço de reconciliação: fecha `OPEN` travado no banco, enriquece closes e adota posições externas da venue |
| `[WEB]` | Servidor do painel |
| `[RISK]` | Decisões do risk manager |

## Logs de Reconciliação

Para verificar se o serviço de reconciliação está rodando e encontrando algo:

```bash
journalctl -u bot-trader -f | grep '\[RECONCILE\]'
```

Eventos-chave para observar:

```
[RECONCILE] Serviço de reconciliação iniciado
[RECONCILE] Pass 1: verificando N trade(s) OPEN ...
[RECONCILE] Trade OPEN no banco ausente na venue — reconciliando
[RECONCILE] Pass 2: N trade(s) CLOSED sem exit_price ...
[RECONCILE] Enrich encontrado para SYMBOL
[RECONCILE] Pass 3: posição ... não rastreada no banco — aguardando confirmação
[RECONCILE] Pass 3: adotando posição externa
```

Para interpretação e limitações, veja [reconciliacao.md](reconciliacao.md).

## Riscos

- Alto: logs não devem conter segredos.
- Médio: `LOG_DIR` sem permissão impede arquivos, mas journald ainda pode capturar console.
- Médio: Supabase fora do ar remove histórico/auditoria, não bloqueia trading.

## Resolução de Problemas

- Sem logs em arquivo: confira `LOG_DIR` e usuário do processo.
- Sem logs systemd: confira unit e `SyslogIdentifier`.
- Métricas vazias: confira esquema Supabase e `SUPABASE_DB_URL_PATH`.

## Lista de Verificação Final

- [ ] Logs aparecem em journald
- [ ] Arquivos rotativos são escritos
- [ ] `/api/state` responde
- [ ] Se Supabase está habilitado, métricas deixam de ficar zeradas após trades fechados
