// src/services/positionReconciliationService.js
//
// Three-pass reconciliation service:
//
//   Pass 1 — status reconciliation (DB→venue):
//     Queries DB for OPEN trades, compares against live venue positions.
//     Marks stale OPEN trades as CLOSED when the position no longer exists at the venue.
//
//   Pass 2 — data enrichment:
//     Queries DB for recently-CLOSED trades that still have exit_price = NULL.
//     These were closed by external events (Layer 1 PositionManager or Pass 1 here)
//     before fill data could be captured from state.positions.
//     Fetches fills from the venue and enriches the DB record with:
//       exit_price, realized_pnl, closed_at (from actual fill timestamp)
//
//   Pass 3 — inverse reconciliation (venue→DB) / external adoption:
//     Queries live venue positions, compares against OPEN trades in DB.
//     Positions present on venue but absent from DB for 2 consecutive passes
//     are adopted as new OPEN trades (source='system', open_source='venue_reconciliation').
//     After adoption, the position is tracked and controlled normally by the bot.
//
//     Safety guards for adoption:
//       - direction must be known (LONG|SHORT) — skips if absent
//       - requires 2 consecutive passes (≈5 min) before adopting — avoids race with bot's own DB inserts
//       - ambiguous DB state (multiple OPEN for same venue+asset) → skip with warning
//       - paper mode excluded
//       - if fetchPositions() fails → pass aborted without side effects
//       - idempotent: adopted trade appears in DB, subsequent passes see it as tracked
//
// Venue enrichment support:
//   valiant (Hyperliquid) — supported via userFillsByTime /info endpoint
//   drift                 — not supported (no fills history in current SDK adapter)
//   jupiter / phoenix     — not supported (API not publicly available)
//   paper                 — excluded (no real venue positions)
//
// Fill matching strategy (valiant):
//   1. Query all fills for the account from trade.opened_at to trade.closed_at + 5 min
//   2. Filter: coin matches asset, dir contains "Close"
//   3. Take the FIRST time-cluster of closing fills (within 5 min of each other)
//      — protects against multiple open/close cycles of the same asset
//   4. Aggregate: weighted average exit_price + sum of closedPnl
//   5. Use timestamp of the last fill in the cluster as closed_at
//   If ambiguous (zero fills, zero total size, or fetch error): skip enrichment silently.
//
// Design principles:
//   - NEVER closes a trade if fetchPositions() fails — absent data ≠ closed position
//   - NEVER adopts a position unless seen in 2 consecutive passes — race guard
//   - Enrichment only overwrites if exit_price IS NULL (enrichTradeClosed() guard)
//   - Enrichment failure leaves the record intact — safe fallback is null fields
//   - All passes are independent: failure in one does not affect others
//   - Paper trades excluded from all passes
//
// Config (.env, all optional):
//   RECONCILE_INTERVAL_MS=300000           (default: 5 min)
//   RECONCILE_MIN_TRADE_AGE_MS=60000       (default: 60 s)
//   RECONCILE_ENRICH_WINDOW_HOURS=2        (default: 2 h — Pass 2 lookback window)
//
// Limitations (documented, not treated as implemented):
//   - Multi-venue: only the active venue is reconciled per cycle (Passes 1 and 3).
//   - Enrichment: only valiant/Hyperliquid is supported today.
//   - Tracking is keyed by asset only (not asset+venue+identity).

import logger from '../utils/logger.js';
import { persistenceService } from './persistenceService.js';
import { venueMonitoringService } from '../monitor/venueMonitoringService.js';
import { getUserFillsByTime } from '../trading/clients/hyperliquidClient.js';

const DEFAULT_INTERVAL_MS           = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MIN_TRADE_AGE_MS      =      60 * 1000; // 60 seconds
const DEFAULT_ENRICH_WINDOW_HOURS   = 2;
const FILL_CLUSTER_WINDOW_MS        = 5 * 60 * 1000; // 5 minutes — max spread for a single close event
const ENRICH_CLOSE_BUFFER_MS        = 5 * 60 * 1000; // query fills up to 5 min after recorded closed_at

// ── Pass 1: close stale OPEN trades ─────────────────────────────────────────

async function _reconcileOpenTrades() {
  const openTrades = await persistenceService.getOpenTrades();
  if (!openTrades.length) return;

  const realTrades = openTrades.filter(t => t.mode !== 'paper');
  if (!realTrades.length) return;

  const activeVenue = venueMonitoringService.getActiveVenue();

  const venueTrades   = realTrades.filter(t => t.venue === activeVenue);
  const skippedVenues = [...new Set(
    realTrades.filter(t => t.venue !== activeVenue).map(t => t.venue)
  )];

  if (skippedVenues.length > 0) {
    logger.warn(
      `[RECONCILE] Trades OPEN em venue(s) inativas ignorados ` +
      `(venue ativa: ${activeVenue}, ignoradas: ${skippedVenues.join(', ')})`,
      { event: 'reconcile_venue_skip', skippedVenues, count: realTrades.length - venueTrades.length }
    );
  }

  if (!venueTrades.length) return;

  let livePositions;
  try {
    livePositions = await venueMonitoringService.fetchPositions();
  } catch (err) {
    logger.warn(
      `[RECONCILE] fetchPositions falhou para ${activeVenue} — pass 1 abortado: ${err.message}`,
      { event: 'reconcile_fetch_failed', venue: activeVenue }
    );
    return;
  }

  const liveAssets = new Set(
    (livePositions ?? []).map(p => p.asset?.toUpperCase()).filter(Boolean)
  );

  if (
    _pass1LastState.venue     !== activeVenue      ||
    _pass1LastState.dbCount   !== venueTrades.length ||
    _pass1LastState.liveCount !== liveAssets.size
  ) {
    logger.info(`[RECONCILE] Pass 1: verificando ${venueTrades.length} trade(s) OPEN contra ${liveAssets.size} posição(ões) ativas em ${activeVenue}`);
    _pass1LastState.venue     = activeVenue;
    _pass1LastState.dbCount   = venueTrades.length;
    _pass1LastState.liveCount = liveAssets.size;
  }

  const now      = Date.now();
  const minAgeMs = parseInt(process.env.RECONCILE_MIN_TRADE_AGE_MS ?? String(DEFAULT_MIN_TRADE_AGE_MS), 10);

  for (const trade of venueTrades) {
    const ageMs = now - new Date(trade.opened_at).getTime();

    if (ageMs < minAgeMs) {
      logger.debug(`[RECONCILE] ${trade.symbol} muito recente (${Math.round(ageMs / 1000)}s < ${Math.round(minAgeMs / 1000)}s mínimo) — ignorando`);
      continue;
    }

    if (!liveAssets.has(trade.symbol.toUpperCase())) {
      logger.warn(`[RECONCILE] Trade OPEN no banco ausente na venue — reconciliando`, {
        event:         'reconcile_close',
        symbol:        trade.symbol,
        venue:         trade.venue,
        bot_trade_ref: trade.bot_trade_ref ?? null,
        trade_id:      trade.id,
        opened_at:     trade.opened_at,
      });
      await persistenceService.recordTradeClosed(
        trade.symbol,
        trade.venue,
        trade.bot_trade_ref ?? null,
        'venue_reconciliation'
      );
    }
  }
}

// ── Pass 2: enrich recently-closed trades missing exit_price ─────────────────

/**
 * Fetch and aggregate Hyperliquid closing fills for a specific trade.
 *
 * Returns { exit_price, realized_pnl, closed_at } or null when:
 *   - venue is not valiant
 *   - fills API call fails
 *   - no closing fills found for the asset in the time window
 *   - total fill size is zero (data quality guard)
 *
 * Aggregation (multiple fills for one close event, e.g. partial fills):
 *   exit_price   = weighted average of fill prices by fill size
 *   realized_pnl = sum of closedPnl across all fills in the cluster
 *   closed_at    = ISO timestamp of the LAST fill in the cluster
 */
async function _fetchEnrichData(trade) {
  if (trade.venue !== 'valiant') return null;

  const sinceMs = new Date(trade.opened_at).getTime();
  const untilMs = trade.closed_at
    ? new Date(trade.closed_at).getTime() + ENRICH_CLOSE_BUFFER_MS
    : Date.now();

  let fills;
  try {
    fills = await getUserFillsByTime(sinceMs, untilMs);
  } catch (err) {
    logger.warn(`[RECONCILE] Falha ao buscar fills HL para ${trade.symbol}: ${err.message}`, {
      event: 'reconcile_enrich_fetch_failed',
      symbol: trade.symbol,
      trade_id: trade.id,
    });
    return null;
  }

  if (!Array.isArray(fills) || fills.length === 0) return null;

  const assetUpper = trade.symbol.toUpperCase();

  // Keep only closing fills for this specific asset
  const closingFills = fills.filter(f => {
    const coin    = String(f.coin ?? '').replace(/-PERP$/i, '').toUpperCase();
    const isClose = String(f.dir  ?? '').toLowerCase().includes('close');
    return coin === assetUpper && isClose;
  });

  if (closingFills.length === 0) {
    logger.info(`[RECONCILE] Nenhum fill de fechamento encontrado para ${trade.symbol} — enrich pulado`, {
      event: 'reconcile_enrich_no_fills',
      symbol: trade.symbol,
      trade_id: trade.id,
    });
    return null;
  }

  // Sort by time ascending; take the FIRST cluster (within FILL_CLUSTER_WINDOW_MS).
  // Prevents accidentally mixing fills from a re-open/re-close of the same asset
  // that may appear within the same time window if the trade was open for a long time.
  closingFills.sort((a, b) => a.time - b.time);
  const firstFillTime = closingFills[0].time;
  const cluster = closingFills.filter(f => f.time - firstFillTime <= FILL_CLUSTER_WINDOW_MS);

  let totalSize        = 0;
  let weightedPriceSum = 0;
  let totalClosedPnl   = 0;

  for (const fill of cluster) {
    const px  = parseFloat(fill.px);
    const sz  = parseFloat(fill.sz);
    const pnl = parseFloat(fill.closedPnl ?? '0');

    if (!Number.isFinite(px) || px <= 0) continue;
    if (!Number.isFinite(sz) || sz <= 0) continue;

    totalSize        += sz;
    weightedPriceSum += px * sz;
    if (Number.isFinite(pnl)) totalClosedPnl += pnl;
  }

  if (totalSize === 0) {
    logger.warn(`[RECONCILE] Fills encontrados para ${trade.symbol} mas tamanho total é zero — enrich pulado`, {
      event: 'reconcile_enrich_zero_size',
      symbol: trade.symbol,
      trade_id: trade.id,
    });
    return null;
  }

  const exitPrice = weightedPriceSum / totalSize;
  const lastFill  = cluster[cluster.length - 1];
  const closedAt  = new Date(lastFill.time).toISOString();

  logger.info(`[RECONCILE] Enrich encontrado para ${trade.symbol}`, {
    event:        'reconcile_enrich_found',
    symbol:       trade.symbol,
    venue:        trade.venue,
    trade_id:     trade.id,
    exit_price:   +exitPrice.toFixed(6),
    realized_pnl: +totalClosedPnl.toFixed(4),
    closed_at:    closedAt,
    fill_count:   cluster.length,
  });

  return { exit_price: exitPrice, realized_pnl: totalClosedPnl, closed_at: closedAt };
}

async function _enrichRecentClosedTrades() {
  const windowHours = parseInt(
    process.env.RECONCILE_ENRICH_WINDOW_HOURS ?? String(DEFAULT_ENRICH_WINDOW_HOURS), 10
  );

  const trades = await persistenceService.getRecentlyClosedWithoutPrice(windowHours);
  if (!trades.length) return;

  logger.info(`[RECONCILE] Pass 2: ${trades.length} trade(s) CLOSED sem exit_price — tentando enriquecimento`);

  for (const trade of trades) {
    if (trade.venue !== 'valiant') {
      logger.info(`[RECONCILE] Enrich não suportado para venue "${trade.venue}" — ignorando ${trade.symbol}`, {
        event:    'reconcile_enrich_unsupported_venue',
        symbol:   trade.symbol,
        venue:    trade.venue,
        trade_id: trade.id,
      });
      continue;
    }

    try {
      const enrichData = await _fetchEnrichData(trade);

      if (!enrichData) {
        logger.info(`[RECONCILE] Enrich sem evidência suficiente para ${trade.symbol} (${trade.venue}) — mantendo exit_price null`, {
          event:    'reconcile_enrich_skipped',
          symbol:   trade.symbol,
          venue:    trade.venue,
          trade_id: trade.id,
        });
        continue;
      }

      await persistenceService.enrichTradeClosed(trade.id, enrichData);
    } catch (err) {
      logger.warn(`[RECONCILE] Erro ao enriquecer trade ${trade.id} (${trade.symbol}): ${err.message}`);
    }
  }
}

// ── Pass 3: adopt external positions present at venue but absent from DB ──────
//
// Requires MIN_ADOPT_PASSES consecutive reconciliation cycles to confirm a position
// before adoption. This prevents false adoptions caused by timing races between
// the bot's own DB inserts and the reconciliation cycle.
//
// State is module-level (in-memory) — resets on bot restart, which is safe:
// a restart clears the counter, so the position must be seen twice again before adoption.

const MIN_ADOPT_PASSES        = 2;
const MIN_RECONCILE_INTERVAL  = 60_000; // floor: 1 min — prevents NaN/0 from env causing rapid loop
const _adoptionSeenCount      = new Map(); // "${venue}:${asset}" → consecutive-pass seen count
const _ambiguousLastCount     = new Map(); // "${venue}:${asset}" → last db_open_count that was logged
const _pass1LastState         = { venue: '', dbCount: -1, liveCount: -1 }; // suppress repeated identical Pass 1 logs
let   _reconcileTimer         = null; // guard against double-start

async function _adoptExternalPositions() {
  const openTrades  = await persistenceService.getOpenTrades();
  const activeVenue = venueMonitoringService.getActiveVenue();

  const realDbTrades = openTrades.filter(t => t.mode !== 'paper' && t.venue === activeVenue);

  let livePositions;
  try {
    livePositions = await venueMonitoringService.fetchPositions();
  } catch (err) {
    logger.warn(
      `[RECONCILE] Pass 3: fetchPositions falhou para ${activeVenue} — abortado: ${err.message}`,
      { event: 'adopt_fetch_failed', venue: activeVenue }
    );
    return;
  }

  if (!Array.isArray(livePositions) || livePositions.length === 0) {
    _adoptionSeenCount.clear();
    return;
  }

  // Count OPEN trades per asset in DB for ambiguity detection
  const dbOpenCount = new Map();
  for (const t of realDbTrades) {
    const asset = t.symbol.toUpperCase();
    dbOpenCount.set(asset, (dbOpenCount.get(asset) ?? 0) + 1);
  }

  const liveAssets = new Set();

  for (const livePos of livePositions) {
    const asset = livePos.asset?.toUpperCase();
    if (!asset) continue;
    liveAssets.add(asset);

    const key      = `${activeVenue}:${asset}`;
    const dbCount  = dbOpenCount.get(asset) ?? 0;

    if (dbCount > 1) {
      // Log only when count changes — suppresses repetitive identical warnings every 5 min.
      if (_ambiguousLastCount.get(key) !== dbCount) {
        logger.warn(
          `[RECONCILE] Pass 3: ${dbCount} trades OPEN no banco para ${key} — adoção ignorada (ambiguidade)`,
          { event: 'adopt_skip_ambiguous', asset, venue: activeVenue, db_open_count: dbCount }
        );
        _ambiguousLastCount.set(key, dbCount);
      }
      _adoptionSeenCount.delete(key);
      continue;
    }

    if (dbCount === 1) {
      // Position already tracked in DB — not a candidate
      _adoptionSeenCount.delete(key);
      continue;
    }

    // dbCount === 0: live position has no DB counterpart

    const direction = livePos.direction?.toUpperCase();
    if (!direction || !['LONG', 'SHORT'].includes(direction)) {
      logger.warn(
        `[RECONCILE] Pass 3: posição ${asset} sem direction confiável — adoção ignorada`,
        { event: 'adopt_skip_no_direction', asset, venue: activeVenue, direction: livePos.direction ?? null }
      );
      _adoptionSeenCount.delete(key);
      continue;
    }

    const seenCount = (_adoptionSeenCount.get(key) ?? 0) + 1;
    _adoptionSeenCount.set(key, seenCount);

    if (seenCount < MIN_ADOPT_PASSES) {
      logger.info(
        `[RECONCILE] Pass 3: posição ${direction} ${asset} não rastreada no banco — aguardando confirmação (${seenCount}/${MIN_ADOPT_PASSES})`,
        { event: 'adopt_candidate_seen', asset, venue: activeVenue, direction, seen_count: seenCount, entry_price: livePos.entryPrice ?? null }
      );
      continue;
    }

    // seenCount >= MIN_ADOPT_PASSES: position confirmed across multiple cycles — adopt
    logger.warn(
      `[RECONCILE] Pass 3: adotando posição externa — ${direction} ${asset} @ ${activeVenue} (confirmado ${seenCount} ciclos)`,
      { event: 'adopt_external_position', asset, venue: activeVenue, direction, entry_price: livePos.entryPrice ?? null, seen_count: seenCount }
    );

    await persistenceService.recordExternalTradeAdopted({
      asset,
      venue:       activeVenue,
      direction,
      entryPrice:  livePos.entryPrice ?? null,
      sizeBase:    livePos.sizeBase   ?? null,
    });

    _adoptionSeenCount.delete(key); // reset after adoption (DB now has the record)
  }

  // Remove candidates for assets that disappeared from venue before adoption.
  // Also clear _ambiguousLastCount so the warning re-fires if they reappear.
  for (const key of [..._adoptionSeenCount.keys()]) {
    const asset = key.split(':').slice(1).join(':'); // handles asset names with colons (none currently)
    if (!liveAssets.has(asset)) {
      logger.info(
        `[RECONCILE] Pass 3: candidato ${key} desapareceu da venue antes de ser adotado — descartado`,
        { event: 'adopt_candidate_expired', key }
      );
      _adoptionSeenCount.delete(key);
    }
  }
  // Also clear ambiguous-log dedup for keys no longer live (position gone)
  for (const key of [..._ambiguousLastCount.keys()]) {
    const asset = key.split(':').slice(1).join(':');
    if (!liveAssets.has(asset)) {
      _ambiguousLastCount.delete(key);
    }
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

async function reconcileOnce() {
  try {
    await _reconcileOpenTrades();
  } catch (err) {
    logger.warn(`[RECONCILE] Erro no pass 1 (não fatal): ${err.message}`);
  }

  try {
    await _enrichRecentClosedTrades();
  } catch (err) {
    logger.warn(`[RECONCILE] Erro no pass 2 de enriquecimento (não fatal): ${err.message}`);
  }

  try {
    await _adoptExternalPositions();
  } catch (err) {
    logger.warn(`[RECONCILE] Erro no pass 3 de adoção (não fatal): ${err.message}`);
  }
}

/**
 * Starts the periodic reconciliation service.
 * Returns the interval timer (already unref'd — does not keep the process alive).
 * Call once in main() after persistenceService.init() and positionManager.start().
 */
export function startReconciliation() {
  if (_reconcileTimer !== null) {
    logger.warn('[RECONCILE] startReconciliation() chamado mais de uma vez — ignorado (timer já ativo)');
    return _reconcileTimer;
  }

  const parsed      = parseInt(process.env.RECONCILE_INTERVAL_MS ?? '', 10);
  const intervalMs  = Math.max(
    MIN_RECONCILE_INTERVAL,
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS,
  );
  const initialDelayMs = 30_000; // wait for the account poller to populate state before first run

  if (!Number.isFinite(parsed) || parsed <= 0) {
    const raw = process.env.RECONCILE_INTERVAL_MS;
    if (raw !== undefined && raw !== '') {
      logger.warn(
        `[RECONCILE] RECONCILE_INTERVAL_MS="${raw}" inválido — usando padrão ${DEFAULT_INTERVAL_MS / 1000}s`,
        { event: 'reconcile_interval_invalid', raw, fallback: DEFAULT_INTERVAL_MS },
      );
    }
  }

  const firstRun = setTimeout(() => reconcileOnce(), initialDelayMs);
  if (firstRun.unref) firstRun.unref();

  _reconcileTimer = setInterval(() => reconcileOnce(), intervalMs);
  if (_reconcileTimer.unref) _reconcileTimer.unref();

  logger.info(
    `[RECONCILE] Serviço de reconciliação iniciado ` +
    `(intervalo: ${intervalMs / 1000}s, primeiro ciclo em ${initialDelayMs / 1000}s)`
  );
  return _reconcileTimer;
}
