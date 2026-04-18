# Reconciliação de Posições e Enriquecimento de Trades

## Propósito

Documentar como o bot detecta e persiste posições fechadas por eventos externos — liquidações, TP/SL hits na exchange, close manual via UI da venue, ou reinício do bot durante um close — e como ele enriquece esses trades com dados reais de fill.

## Público-alvo

Operadores monitorando consistência do banco e desenvolvedores que estendem o serviço.

## Por que existe

Em live trading, uma posição pode ser fechada na venue sem o bot ter iniciado o close. Se o bot for reiniciado durante um close, ou se a exchange fechar uma posição via liquidação ou TP/SL, a tabela `trades` pode ficar com status OPEN indefinidamente. O sistema de reconciliação previne isso.

## Design em Duas Camadas

### Camada 1 — Reativa (PositionManager)

`backend/src/trading/position-management/PositionManager.js`

O position manager consulta a venue a cada poucos segundos para as posições atuais. Quando uma posição rastreada está ausente de `CLOSE_CONFIRMATION_MISSES=2` snapshots consecutivos, ele conclui que a posição foi fechada externamente e chama imediatamente `persistenceService.recordTradeClosed()`.

O guard `_closing` Set garante que se o próprio bot iniciou o close via `_triggerClose()`, a chamada duplicada seja ignorada — `recordTradeClosed()` já está sendo chamado no fluxo do `_triggerClose()`.

Esta camada reage em tempo real — assim que o tracker de posições detecta a ausência.

### Camada 2 — Safety Net Periódica (positionReconciliationService)

`backend/src/services/positionReconciliationService.js`

Um serviço baseado em timer que roda a cada 5 minutos (padrão) com delay inicial de 30 segundos após o boot. Ele executa duas passagens independentes:

**Pass 1 — Reconciliação de status:**

- Consulta o banco por todos os trades OPEN com `mode != 'paper'`.
- Pula trades pertencentes a venues inativas (loga contagem pulada).
- Chama `fetchPositions()` para a venue ativa. Se falhar, a passagem é abortada — dados ausentes ≠ posição fechada.
- Para cada trade OPEN no banco não presente no conjunto de posições live, e com idade > `RECONCILE_MIN_TRADE_AGE_MS` (padrão: 60 s), chama `recordTradeClosed()` com `close_source='venue_reconciliation'`.
- O guard `AND closed_at IS NULL` em `recordTradeClosed()` torna isso idempotente — uma segunda chamada afeta 0 linhas.

**Pass 2 — Enriquecimento de dados:**

- Consulta o banco por trades CLOSED com `exit_price IS NULL` e `mode != 'paper'` nas últimas `RECONCILE_ENRICH_WINDOW_HOURS` horas (padrão: 2 h).
- Para cada trade elegível, busca histórico de fills na venue e agrega o preço de saída e PnL realizado.
- Grava os dados enriquecidos apenas se `exit_price IS NULL` — closes controlados que já têm dados de fill nunca são sobrescritos.
- Ambas as passagens são independentes: falha no Pass 2 não afeta o Pass 1.

## Lógica de Matching de Fills (apenas Valiant/Hyperliquid)

Para trades da venue `valiant`, o Pass 2 usa o endpoint `userFillsByTime` da Hyperliquid:

1. Consultar todos os fills da conta de `trade.opened_at` até `trade.closed_at + 5 min`.
2. Filtrar: coin corresponde ao ativo, dir contém "Close".
3. Ordenar fills por tempo crescente.
4. Pegar o **primeiro cluster** — fills dentro de 5 minutos entre si, a partir do fill de fechamento mais antigo. Isso protege contra misturar acidentalmente fills de um re-open/re-close do mesmo ativo na mesma janela.
5. Agregar: média ponderada de `exit_price` pelo tamanho do fill; soma de `closedPnl` para `realized_pnl`; timestamp do último fill no cluster como `closed_at`.
6. Se zero fills qualificados, tamanho total zero, ou erro de fetch: pular enriquecimento silenciosamente — o registro mantém `exit_price = null`.

## Suporte por Venue

| Venue | Pass 1 (fechar OPEN travados) | Pass 2 (enriquecer exit_price) |
|-------|-------------------------------|-------------------------------|
| `valiant` | Sim | Sim — via userFillsByTime |
| `drift` | Sim | Não — sem endpoint de histórico de fills |
| `jupiter` | Sim (só venue ativa) | Não — não implementado |
| `phoenix` | Sim (só venue ativa) | Não — não implementado |
| `paper` | Excluído de ambas as passagens | Excluído |

## Configuração

Todas as variáveis são opcionais. Os padrões seguros funcionam sem configuração.

Em `backend/.env`:

```env
RECONCILE_INTERVAL_MS=300000       # frequência de execução (padrão: 5 min)
RECONCILE_MIN_TRADE_AGE_MS=60000   # idade mínima para elegibilidade no Pass 1 (padrão: 60 s)
RECONCILE_ENRICH_WINDOW_HOURS=2    # janela de lookback para o Pass 2 (padrão: 2 h)
```

## Como Verificar que está Funcionando

Verifique os logs após o delay inicial de 30 segundos:

```bash
journalctl -u bot-trader | grep '\[RECONCILE\]'
```

Esperado em um deploy saudável sem trades travados:

```
[RECONCILE] Serviço de reconciliação iniciado (intervalo: 300s, primeiro ciclo em 30s)
[RECONCILE] Pass 1: verificando 0 trade(s) OPEN contra N posição(ões) ativas em valiant
[RECONCILE] Pass 2: 0 trade(s) CLOSED sem exit_price — tentando enriquecimento
```

Quando um trade travado é encontrado e fechado:

```
[RECONCILE] Trade OPEN no banco ausente na venue — reconciliando
  event: reconcile_close, symbol: SOL, venue: valiant, trade_id: ...
```

Quando o enriquecimento tem sucesso:

```
[RECONCILE] Enrich encontrado para SOL
  event: reconcile_enrich_found, exit_price: 155.23, realized_pnl: 3.44
```

## Princípios de Design

- **Nunca fecha se `fetchPositions()` falhar** — dados ausentes ≠ posição fechada.
- **Enriquecimento só sobrescreve se `exit_price IS NULL`** — nunca corrompe dados de closes controlados.
- **Idempotente** — rodar o Pass 1 duas vezes no mesmo trade não muda nada na segunda vez.
- **Isolamento de falhas** — falha no Pass 2 não afeta o Pass 1; falha de enriquecimento individual não afeta outros trades.
- **Paper excluído** — trades paper são sempre excluídos de ambas as passagens.

## Troubleshooting

- Logs de reconciliação nunca aparecem: verifique `[RECONCILE] Serviço de reconciliação iniciado` — se ausente, o serviço não foi importado em `index.js`.
- Pass 1 sempre encontra trades travados: verifique se `fetchPositions()` está funcionando; procure eventos `reconcile_fetch_failed`.
- Pass 2 nunca enriquece: confirme que a venue é `valiant`; verifique eventos `reconcile_enrich_fetch_failed` ou `reconcile_enrich_no_fills`.
- `exit_price` permanece null para um trade valiant: os fills de fechamento podem estar fora da janela de tempo. Verifique `RECONCILE_ENRICH_WINDOW_HOURS`.
