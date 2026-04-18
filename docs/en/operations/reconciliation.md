# Position Reconciliation and Trade Enrichment

## Purpose

Document how the bot detects and persists positions closed by external events — liquidations, TP/SL hits at the exchange, manual close via the venue UI, or bot restarts mid-close — and how it enriches those trades with real fill data.

## Audience

Operators monitoring database consistency and developers extending the service.

## Why it exists

In live trading, a position can be closed at the venue without the bot initiating the close. If the bot is restarted mid-close, or if the exchange closes a position via liquidation or TP/SL, the `trades` table can be left with an OPEN status indefinitely. The reconciliation system prevents this.

## Two-Layer Design

### Layer 1 — Reactive (PositionManager)

`backend/src/trading/position-management/PositionManager.js`

The position manager polls the venue every few seconds for current positions. When a tracked position is absent from `CLOSE_CONFIRMATION_MISSES=2` consecutive snapshots, it concludes the position was closed externally and immediately calls `persistenceService.recordTradeClosed()`.

The `_closing` Set guard ensures that if the bot itself initiated the close via `_triggerClose()`, the duplicate call is skipped — `recordTradeClosed()` is already being called in the `_triggerClose()` flow.

This layer reacts in real time — as soon as the position tracker detects the absence.

### Layer 2 — Periodic Safety Net (positionReconciliationService)

`backend/src/services/positionReconciliationService.js`

A timer-based service that runs every 5 minutes (default) with a 30-second initial delay after boot. It performs two independent passes:

**Pass 1 — Status reconciliation:**

- Queries DB for all OPEN trades with `mode != 'paper'`.
- Skips trades belonging to inactive venues (logs skipped count).
- Calls `fetchPositions()` for the active venue. If it fails, the pass is aborted — absent data ≠ closed position.
- For each DB-OPEN trade not in the live position set, and with age > `RECONCILE_MIN_TRADE_AGE_MS` (default: 60 s), calls `recordTradeClosed()` with `close_source='venue_reconciliation'`.
- The `AND closed_at IS NULL` guard in `recordTradeClosed()` makes this idempotent — a second call affects 0 rows.

**Pass 2 — Data enrichment:**

- Queries DB for CLOSED trades with `exit_price IS NULL` and `mode != 'paper'` within the last `RECONCILE_ENRICH_WINDOW_HOURS` hours (default: 2 h).
- For each eligible trade, fetches fill history from the venue and aggregates the exit price and realized PnL.
- Writes the enriched data only if `exit_price IS NULL` — controlled closes that already have fill data are never overwritten.
- Both passes are independent: Pass 2 failure does not affect Pass 1.

## Fill Matching Logic (Valiant/Hyperliquid only)

For `valiant` venue trades, Pass 2 uses the Hyperliquid `userFillsByTime` endpoint:

1. Query all fills for the account from `trade.opened_at` to `trade.closed_at + 5 min`.
2. Filter: coin matches asset, dir contains "Close".
3. Sort fills by time ascending.
4. Take the **first cluster** — fills within 5 minutes of each other starting from the earliest closing fill. This protects against accidentally mixing fills from a re-open/re-close of the same asset within the same time window.
5. Aggregate: weighted average of `exit_price` by fill size; sum of `closedPnl` for `realized_pnl`; timestamp of the last fill in the cluster as `closed_at`.
6. If zero qualifying fills, zero total size, or a fetch error: skip enrichment silently — the record keeps `exit_price = null`.

## Venue Support

| Venue | Pass 1 (close stale OPEN) | Pass 2 (enrich exit_price) |
|-------|--------------------------|---------------------------|
| `valiant` | Yes | Yes — via userFillsByTime |
| `drift` | Yes | No — no fills history endpoint |
| `jupiter` | Yes (active venue only) | No — not implemented |
| `phoenix` | Yes (active venue only) | No — not implemented |
| `paper` | Excluded from both passes | Excluded |

## Configuration

All variables are optional. Safe defaults work without configuration.

In `backend/.env`:

```env
RECONCILE_INTERVAL_MS=300000       # how often to run (default: 5 min)
RECONCILE_MIN_TRADE_AGE_MS=60000   # min age before a trade is eligible for Pass 1 (default: 60 s)
RECONCILE_ENRICH_WINDOW_HOURS=2    # lookback window for Pass 2 (default: 2 h)
```

## How to Verify It Is Working

Check logs after the first 30-second initial delay:

```bash
journalctl -u bot-trader | grep '\[RECONCILE\]'
```

Expected on a healthy deployment with no stuck trades:

```
[RECONCILE] Serviço de reconciliação iniciado (intervalo: 300s, primeiro ciclo em 30s)
[RECONCILE] Pass 1: verificando 0 trade(s) OPEN contra N posição(ões) ativas em valiant
[RECONCILE] Pass 2: 0 trade(s) CLOSED sem exit_price — tentando enriquecimento
```

When a stuck trade is found and closed:

```
[RECONCILE] Trade OPEN no banco ausente na venue — reconciliando
  event: reconcile_close, symbol: SOL, venue: valiant, trade_id: ...
```

When enrichment succeeds:

```
[RECONCILE] Enrich encontrado para SOL
  event: reconcile_enrich_found, exit_price: 155.23, realized_pnl: 3.44
```

## Design Principles

- **Never closes if `fetchPositions()` fails** — absent data ≠ closed position.
- **Enrichment only overwrites if `exit_price IS NULL`** — never corrupts data from controlled closes.
- **Idempotent** — running Pass 1 twice on the same trade changes nothing the second time.
- **Failure isolation** — Pass 2 failure does not affect Pass 1; individual trade enrichment failure does not affect other trades.
- **Paper excluded** — paper trades are always excluded from both passes.

## Troubleshooting

- Reconciliation logs never appear: check `[RECONCILE] Serviço de reconciliação iniciado` — if missing, the service was not imported in `index.js`.
- Pass 1 always finds stuck trades: check if `fetchPositions()` is working; look for `reconcile_fetch_failed` events.
- Pass 2 never enriches: confirm venue is `valiant`; check for `reconcile_enrich_fetch_failed` or `reconcile_enrich_no_fills` events.
- `exit_price` stays null for a valiant trade: the closing fills may be outside the time window. Check `RECONCILE_ENRICH_WINDOW_HOURS`.
