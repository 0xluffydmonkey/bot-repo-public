# Reconciliação de Posições e Enriquecimento de Trades

## Propósito

Documentar como o bot reconcilia o estado da venue live e o estado do banco nos dois sentidos:

- trade `OPEN` no banco que não existe mais na venue -> marcar como `CLOSED`.
- posição live na venue que não existe no banco -> adotar como trade `OPEN` para o bot monitorar e controlar.

Também documenta como trades fechados são enriquecidos com dados reais de fill quando houver suporte.

## Público-alvo

Operadores monitorando consistência do banco e desenvolvedores que estendem o serviço.

## Por que existe

Em operação ao vivo, o banco não é mais apenas um registro das posições abertas pelo bot. Ele também pode se tornar o registro de controle de uma posição aberta externamente na venue, por exemplo via UI manual da venue.

O reconciler protege os dois lados do estado:

- Se uma posição é fechada externamente na venue, o banco não deve permanecer `OPEN` para sempre.
- Se existe uma posição live não rastreada na venue ativa, o bot pode persisti-la de forma conservadora e começar a rastreá-la.

## Desenho em Duas Camadas

### Camada 1 — Reativa (PositionManager)

`backend/src/trading/position-management/PositionManager.js`

O position manager consulta a venue a cada poucos segundos para as posições atuais. Quando uma posição rastreada está ausente de `CLOSE_CONFIRMATION_MISSES=2` snapshots consecutivos, ele conclui que a posição foi fechada externamente e chama imediatamente `persistenceService.recordTradeClosed()`.

O guard `_closing` Set garante que se o próprio bot iniciou o close via `_triggerClose()`, a chamada duplicada seja ignorada — `recordTradeClosed()` já está sendo chamado no fluxo do `_triggerClose()`.

Esta camada reage em tempo real — assim que o tracker de posições detecta a ausência.

### Camada 2 — Rede de Segurança Periódica (positionReconciliationService)

`backend/src/services/positionReconciliationService.js`

Um serviço baseado em timer que roda a cada 5 minutos (padrão) com delay inicial de 30 segundos após o boot. Ele executa três passagens independentes:

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
**Pass 3 — Adoção externa:**

- Consulta posições live da venue ativa.
- Compara com trades `OPEN` no banco para a mesma venue ativa.
- Uma posição live só vira candidata à adoção quando não existe trade `OPEN` correspondente no banco para o mesmo `venue + asset`.
- Se existem múltiplos trades `OPEN` no banco para o mesmo `venue + asset`, a adoção é ignorada por ambiguidade.
- A direção precisa ser confiável e precisa ser `LONG` ou `SHORT`.
- A candidata precisa aparecer em `MIN_ADOPT_PASSES=2` ciclos consecutivos de reconciliação antes do insert.
- O trade inserido fica com `status='OPEN'`, `mode='live'`, `source='system'`, e o payload do evento de abertura usa `open_source='venue_reconciliation'`.
- Depois da adoção, um `bot_trade_ref` é gerado, injetado nos snapshots de posição, salvo no tracking e usado nos fluxos posteriores de close, reconciliação e auditoria.

Todas as passagens são independentes: falha em uma passagem não impede as outras de rodarem.

## Fluxo de Identidade do Trade

A identidade principal é `bot_trade_ref`.

Para trades abertos pelo bot:

1. `ManualTradeService.executeSignal()` gera ou repassa um `bot_trade_ref`.
2. `persistenceService.recordTradeOpened()` insere o trade `OPEN` e mantém mapas em memória para `${venue}:${symbol}`.
3. O persistence service injeta a ref em updates de `state.positions`.
4. `PositionManager` salva a ref no tracking persistido em disco.
5. No close, `recordTradeClosed(symbol, venue, bot_trade_ref)` prefere a ref exata, depois o id de banco em memória, depois o fallback de último recurso por `symbol + venue`.

Para trades adotados externamente:

1. O Pass 3 vê uma posição live na venue sem contraparte `OPEN` no banco.
2. Após 2 ciclos consecutivos, `recordExternalTradeAdopted()` gera um novo `bot_trade_ref`.
3. O banco recebe um novo trade `OPEN` e eventos `TRADE_OPEN_*` com `open_source='venue_reconciliation'`.
4. Os próximos updates de posição recebem a ref e o `PositionManager` a persiste no tracking.
5. A partir daí, a posição participa de alertas, trailing stop, closes manuais/trailing, detecção de close externo e enriquecimento de close quando houver suporte.

O guard contra duplicidade é conservador de propósito: a adoção só ocorre quando o snapshot da venue ativa tem o ativo, a direção é conhecida, e o banco tem exatamente zero trades `OPEN` para aquele `venue + asset`. Contagem maior que um no banco é tratada como ambiguidade e ignorada.

## Lógica de Correspondência de Fills (apenas Valiant/Hyperliquid)

Para trades da venue `valiant`, o Pass 2 usa o endpoint `userFillsByTime` da Hyperliquid:

1. Consultar todos os fills da conta de `trade.opened_at` até `trade.closed_at + 5 min`.
2. Filtrar: coin corresponde ao ativo, dir contém "Close".
3. Ordenar fills por tempo crescente.
4. Pegar o **primeiro cluster** — fills dentro de 5 minutos entre si, a partir do fill de fechamento mais antigo. Isso protege contra misturar acidentalmente fills de um re-open/re-close do mesmo ativo na mesma janela.
5. Agregar: média ponderada de `exit_price` pelo tamanho do fill; soma de `closedPnl` para `realized_pnl`; timestamp do último fill no cluster como `closed_at`.
6. Se zero fills qualificados, tamanho total zero, ou erro de fetch: pular enriquecimento silenciosamente — o registro mantém `exit_price = null`.

## Suporte por Venue

| Venue | Pass 1 (fechar OPEN travados) | Pass 2 (enriquecer exit_price) | Pass 3 (adotar OPEN externo) |
|-------|-------------------------------|-------------------------------|--------------------------------|
| `valiant` | Sim, só venue ativa | Sim — via userFillsByTime | Sim, só venue ativa |
| `drift` | Sim, só venue ativa | Não — sem endpoint de histórico de fills | Sim, só venue ativa |
| `jupiter` | Sim, só venue ativa | Não — não implementado | Sim apenas se for a venue live ativa |
| `phoenix` | Sim, só venue ativa | Não — não implementado | Sim apenas se for a venue live ativa |
| `paper` | Excluído | Excluído | Excluído |

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

Esperado em um implantação saudável sem trades travados:

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

Quando uma posição externa na venue aparece pela primeira vez, mas ainda não foi adotada:

```
[RECONCILE] Pass 3: posição LONG SOL não rastreada no banco — aguardando confirmação (1/2)
  event: adopt_candidate_seen, asset: SOL, venue: valiant, direction: LONG
```

Quando a adoção tem sucesso no segundo ciclo consecutivo:

```
[RECONCILE] Pass 3: adotando posição externa — LONG SOL @ valiant (confirmado 2 ciclos)
  event: adopt_external_position, asset: SOL, venue: valiant, direction: LONG
[PERSIST] ✅ Trade externo adotado — id=..., ref=..., venue=valiant, symbol=SOL
  event: trade_external_adopted, bot_trade_ref: ...
```

Quando uma posição rastreada desaparece dos snapshots live antes da passagem periódica:

```
[PM] Posição SOL fechada externamente — persistindo fechamento
  event: external_close_detected, asset: SOL, venue: valiant, bot_trade_ref: ...
```

Quando a identidade do close está ausente após restart ou tracking antigo, a persistência pode logar:

```
[PERSIST] ⚠️ FALLBACK por symbol+venue — bot_trade_ref e id ausentes para valiant:SOL.
```

Esse fallback é esperado apenas como último recurso. Investigue o tracking em disco e se o `bot_trade_ref` estava disponível antes do restart.

## Princípios de Desenho

- **Nunca fecha se `fetchPositions()` falhar** — dados ausentes ≠ posição fechada.
- **Nunca adota se `fetchPositions()` falhar** — adoção depende de snapshot confiável da venue.
- **Adoção exige confirmação** — a posição precisa aparecer em 2 ciclos consecutivos.
- **Sem adoção duplicada** — se já existe trade `OPEN` no banco para `venue + asset` ativo, a posição live é considerada já rastreada.
- **Enriquecimento só sobrescreve se `exit_price IS NULL`** — nunca corrompe dados de closes controlados.
- **Idempotente** — rodar o Pass 1 duas vezes no mesmo trade não muda nada na segunda vez.
- **Isolamento de falhas** — falha em uma passagem não impede as outras; falha de enriquecimento individual não afeta outros trades.
- **Paper excluído** — trades paper são sempre excluídos de todas as passagens de reconciliação.

## Limitações Atuais

- A reconciliação considera apenas a venue ativa por ciclo.
- Multi-venue simultâneo continua limitado, especialmente para o mesmo ativo.
- O tracking do `PositionManager` ainda é indexado por asset, não por `asset + venue + identidade`.
- Adoção depende da precisão e completude do snapshot `fetchPositions()` da venue ativa.
- Adoção pode atrasar porque depende de ciclos de reconciliação.
- Posições abertas e fechadas entre ciclos, ou antes de duas confirmações consecutivas, podem nunca ser adotadas.
- Enriquecimento de fills atualmente só suporta `valiant`/Hyperliquid.
- Após restart, o contador de confirmação de adoção é limpo; uma posição externa precisa aparecer duas vezes novamente antes da adoção.

## Resolução de Problemas

- Logs de reconciliação nunca aparecem: verifique `[RECONCILE] Serviço de reconciliação iniciado` — se ausente, o serviço não foi importado em `index.js`.
- Trade fechado na venue continua `OPEN` no banco: confira venue ativa, `reconcile_venue_skip`, `reconcile_fetch_failed`, e se o trade é mais recente que `RECONCILE_MIN_TRADE_AGE_MS`.
- Posição manual na venue ainda não apareceu no banco: aguarde dois ciclos de reconciliação; confira `adopt_candidate_seen`, `adopt_fetch_failed` ou `adopt_candidate_expired`.
- Adoção não ocorreu por ambiguidade: procure `adopt_skip_ambiguous`; resolva trades `OPEN` duplicados no banco para o mesmo `venue + asset` antes de esperar adoção.
- Adoção ignorada por ausência de direção: procure `adopt_skip_no_direction`; o adaptador da venue precisa fornecer `LONG` ou `SHORT` confiável.
- Trade adotado não recebeu enrich após close: o Pass 2 só suporta `valiant`; para valiant, confira `RECONCILE_ENRICH_WINDOW_HOURS`, `reconcile_enrich_fetch_failed`, `reconcile_enrich_no_fills` e `reconcile_enrich_skipped`.
- Fallback por `symbol+venue` apareceu nos logs: isso significa que `bot_trade_ref` e id de banco em memória estavam indisponíveis. Pode ocorrer após restart com tracking antigo/corrompido; verifique o trade afetado por `symbol`, `venue` e timestamps.
