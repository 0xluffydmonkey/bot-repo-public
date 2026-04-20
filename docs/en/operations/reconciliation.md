# Position Reconciliation and Trade Enrichment

## Purpose

Document how the bot reconciles live venue state and database state in both directions:

- DB `OPEN` trade no longer present at the venue -> mark it `CLOSED`.
- Live venue position missing from the DB -> adopt it as an `OPEN` trade so the bot can monitor and control it.

It also documents how closed trades are enriched with real fill data where supported.

## Audience

Operators monitoring database consistency and developers extending the service.

## Why it exists

In live trading, the database is no longer only a record of positions opened by the bot. It can also become the control record for a position opened externally at the venue, such as a manual venue UI open.

The reconciler protects both sides of the state:

- If a venue position is closed externally, the DB must not remain `OPEN` forever.
- If an untracked live position exists at the active venue, the bot can conservatively persist it and start tracking it.

## Two-Layer Design

### Layer 1 — Reactive (PositionManager)

`backend/src/trading/position-management/PositionManager.js`

The position manager polls the venue every few seconds for current positions. When a tracked position is absent from `CLOSE_CONFIRMATION_MISSES=2` consecutive snapshots, it concludes the position was closed externally and immediately calls `persistenceService.recordTradeClosed()`.

The `_closing` Set guard ensures that if the bot itself initiated the close via `_triggerClose()`, the duplicate call is skipped — `recordTradeClosed()` is already being called in the `_triggerClose()` flow.

This layer reacts in real time — as soon as the position tracker detects the absence.

### Layer 2 — Periodic Safety Net (positionReconciliationService)

`backend/src/services/positionReconciliationService.js`

A timer-based service that runs every 5 minutes (default) with a 30-second initial delay after boot. It performs three independent passes:

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
**Pass 3 — External adoption:**

- Queries live positions from the active venue.
- Compares them with DB `OPEN` trades for the same active venue.
- A live position is an adoption candidate only when there is no corresponding DB `OPEN` trade for the same `venue + asset`.
- If there are multiple DB `OPEN` trades for the same `venue + asset`, adoption is skipped as ambiguous.
- Direction must be reliable and must be `LONG` or `SHORT`.
- The candidate must be seen in `MIN_ADOPT_PASSES=2` consecutive reconciliation cycles before it is inserted.
- The inserted trade is `status='OPEN'`, `mode='live'`, `source='system'`, and the open event payload uses `open_source='venue_reconciliation'`.
- After adoption, `bot_trade_ref` is generated, injected into position snapshots, stored in tracking, and used by later close/reconciliation/audit flows.

All passes are independent: a failure in one pass does not prevent the others from running.

## Trade Identity Flow

The main identity is `bot_trade_ref`.

For bot-opened trades:

1. `ManualTradeService.executeSignal()` generates or passes a `bot_trade_ref`.
2. `persistenceService.recordTradeOpened()` inserts the `OPEN` trade and keeps in-memory maps for `${venue}:${symbol}`.
3. The persistence service injects the ref into `state.positions` updates.
4. `PositionManager` stores the ref in disk-backed tracking.
5. On close, `recordTradeClosed(symbol, venue, bot_trade_ref)` prefers the exact ref, then DB id from memory, then a last-resort `symbol + venue` fallback.

For externally adopted trades:

1. Pass 3 sees a live venue position with no DB `OPEN` counterpart.
2. After 2 consecutive cycles, `recordExternalTradeAdopted()` generates a new `bot_trade_ref`.
3. The DB receives a new `OPEN` trade and `TRADE_OPEN_*` events with `open_source='venue_reconciliation'`.
4. The next position updates receive the ref and `PositionManager` persists it into tracking.
5. From that point, the position participates in alerts, trailing stop logic, manual/trailing closes, external-close detection, and close enrichment where supported.

The duplicate guard is intentionally conservative: adoption happens only when the active venue snapshot has the asset, direction is known, and the DB has exactly zero `OPEN` trades for that `venue + asset`. A DB count above one is treated as ambiguous and skipped.

## Fill Matching Logic (Valiant/Hyperliquid only)

For `valiant` venue trades, Pass 2 uses the Hyperliquid `userFillsByTime` endpoint:

1. Query all fills for the account from `trade.opened_at` to `trade.closed_at + 5 min`.
2. Filter: coin matches asset, dir contains "Close".
3. Sort fills by time ascending.
4. Take the **first cluster** — fills within 5 minutes of each other starting from the earliest closing fill. This protects against accidentally mixing fills from a re-open/re-close of the same asset within the same time window.
5. Aggregate: weighted average of `exit_price` by fill size; sum of `closedPnl` for `realized_pnl`; timestamp of the last fill in the cluster as `closed_at`.
6. If zero qualifying fills, zero total size, or a fetch error: skip enrichment silently — the record keeps `exit_price = null`.

## Venue Support

| Venue | Pass 1 (close stale OPEN) | Pass 2 (enrich exit_price) | Pass 3 (adopt external OPEN) |
|-------|--------------------------|---------------------------|------------------------------|
| `valiant` | Yes, active venue only | Yes — via userFillsByTime | Yes, active venue only |
| `drift` | Yes, active venue only | No — no fills history endpoint | Yes, active venue only |
| `jupiter` | Yes, active venue only | No — not implemented | Yes only if it is the active live venue |
| `phoenix` | Yes, active venue only | No — not implemented | Yes only if it is the active live venue |
| `paper` | Excluded | Excluded | Excluded |

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
[RECONCILE] reconciliation service started
[RECONCILE] Pass 1 checked DB OPEN trades against active venue positions
[RECONCILE] Pass 2 checked recently CLOSED trades missing exit_price
```

When a stuck trade is found and closed:

```
event: reconcile_close
symbol: SOL
venue: valiant
trade_id: ...
```

When enrichment succeeds:

```
event: reconcile_enrich_found
symbol: SOL
exit_price: 155.23
realized_pnl: 3.44
```

When an external venue position is first seen but not yet adopted:

```
event: adopt_candidate_seen
asset: SOL
venue: valiant
direction: LONG
seen_count: 1
```

When adoption succeeds on the second consecutive cycle:

```
event: adopt_external_position
asset: SOL
venue: valiant
direction: LONG
seen_count: 2

event: trade_external_adopted
bot_trade_ref: ...
```

When a tracked position disappears from live snapshots before the periodic pass:

```
event: external_close_detected
asset: SOL
venue: valiant
bot_trade_ref: ...
```

When close identity is missing after restart or old tracking, persistence may log:

```
FALLBACK by symbol+venue
venue: valiant
symbol: SOL
```

That fallback is expected only as a last resort. Investigate disk tracking and whether `bot_trade_ref` was available before restart.

## Design Principles

- **Never closes if `fetchPositions()` fails** — absent data ≠ closed position.
- **Never adopts if `fetchPositions()` fails** — adoption depends on a reliable venue snapshot.
- **Adoption requires confirmation** — a position must be seen in 2 consecutive cycles.
- **No duplicate adoption** — if a DB `OPEN` trade already exists for active `venue + asset`, the live position is considered already tracked.
- **Enrichment only overwrites if `exit_price IS NULL`** — never corrupts data from controlled closes.
- **Idempotent** — running Pass 1 twice on the same trade changes nothing the second time.
- **Failure isolation** — one pass failing does not prevent the other passes from running; individual trade enrichment failure does not affect other trades.
- **Paper excluded** — paper trades are always excluded from all reconciliation passes.

## Current Limitations

- Reconciliation considers only the active venue per cycle.
- Simultaneous multi-venue tracking remains limited, especially for the same asset.
- `PositionManager` tracking is still keyed by asset, not full `asset + venue + identity`.
- Adoption depends on the accuracy and completeness of the active venue `fetchPositions()` snapshot.
- Adoption can be delayed because it depends on reconciliation cycles.
- Positions opened and closed between cycles, or before two consecutive confirmations, may never be adopted.
- Fill enrichment currently supports only `valiant`/Hyperliquid.
- After restart, the adoption confirmation counter is cleared; an external position must be seen twice again before adoption.

## Troubleshooting

- Reconciliation logs never appear: check for the reconciliation service startup log — if missing, the service was not imported in `index.js`.
- DB trade closed at venue but still `OPEN`: check active venue, `reconcile_venue_skip`, `reconcile_fetch_failed`, and whether the trade is younger than `RECONCILE_MIN_TRADE_AGE_MS`.
- Manual venue position has not appeared in DB: wait for two reconciliation cycles; check for `adopt_candidate_seen`, `adopt_fetch_failed`, or `adopt_candidate_expired`.
- Adoption did not occur because of ambiguity: look for `adopt_skip_ambiguous`; resolve duplicate DB `OPEN` trades for the same `venue + asset` before expecting adoption.
- Adoption skipped because direction is missing: look for `adopt_skip_no_direction`; the venue adapter must provide a reliable `LONG` or `SHORT`.
- Adopted trade did not enrich after close: Pass 2 enrichment only supports `valiant`; for valiant, check `RECONCILE_ENRICH_WINDOW_HOURS`, `reconcile_enrich_fetch_failed`, `reconcile_enrich_no_fills`, and `reconcile_enrich_skipped`.
- Fallback by `symbol+venue` appeared in logs: this means `bot_trade_ref` and in-memory DB id were unavailable. It can happen after restart with old/corrupt tracking; verify the affected trade by `symbol`, `venue`, and timestamps.
