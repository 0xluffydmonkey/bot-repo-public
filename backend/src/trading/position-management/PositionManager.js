// src/trading/position-management/PositionManager.js
// Tracks open positions, manages profit alerts, and enforces trailing stops.
//
// Production hardening:
//   - Tracking state persisted to disk (survives restarts)
//   - Trailing stop validated before applying (never decreases, must be below price)
//   - Close routed through PerpExecutionService (correct venue, not Drift-only)
//   - Duplicate close guard (_closing set) prevents double-close on rapid updates
//   - Debounce: max one trailing update per asset per second
//   - All errors caught and logged — never crashes bot
//
// Config (non-sensitive, set in .env):
//   ENABLE_POSITION_ALERTS=true
//   POSITION_ALERT_PROFIT_PERCENT=10
//   ENABLE_TRAILING_STOP=true
//   TRAILING_STOP_PERCENT=5
//   TRAILING_STOP_ONLY_AFTER_PROFIT_PERCENT=3

import state from '../../core/state.js';
import logger from '../../utils/logger.js';
import { telegramAlertService } from './TelegramService.js';
import { savePositionTracking, loadPositionTracking } from './PositionStore.js';
import { perpService } from '../PerpExecutionService.js';
import { resolveCloseVenue } from '../closeVenueResolver.js';
import { persistenceService } from '../../services/persistenceService.js';

const DEBOUNCE_MS = 1_000; // max one trailing update per asset per second
const CLOSE_CONFIRMATION_MISSES = 2;

class PositionManager {
  constructor() {
    // Restore tracking from disk — survives restarts
    this._tracking     = loadPositionTracking();
    // Set of assets currently being closed — prevents duplicate close attempts
    this._closing      = new Set();
    // Debounce: asset → last trailing update timestamp (ms)
    this._lastTrailAt  = new Map();
    // asset → consecutive monitoring snapshots where the tracked asset is absent
    this._missingCount = new Map();
    // Assets whose tracking was restored from disk this session.
    // Used to emit a one-time "reutilizado" log when identity is validated on first use.
    this._diskRestored = new Set(this._tracking.keys());

    this._readConfig();
  }

  _readConfig() {
    this._enableAlerts      = process.env.ENABLE_POSITION_ALERTS !== 'false';
    this._alertThresholdPct = parseFloat(process.env.POSITION_ALERT_PROFIT_PERCENT ?? '10');
    this._enableTrailing    = process.env.ENABLE_TRAILING_STOP    !== 'false';
    this._trailingPct       = parseFloat(process.env.TRAILING_STOP_PERCENT ?? '5') / 100;
    this._trailingAfterPct  = parseFloat(process.env.TRAILING_STOP_ONLY_AFTER_PROFIT_PERCENT ?? '3') / 100;
  }

  /**
   * Start listening to position updates from state.
   * Call once in main() after state.setMode().
   */
  start() {
    state.on('positions:update', (positions) => this._onPositionsUpdate(positions));

    logger.info('[PM] PositionManager iniciado', {
      alertas:          this._enableAlerts,
      threshold:        `${this._alertThresholdPct}%`,
      trailingStop:     this._enableTrailing,
      trailingPct:      `${(this._trailingPct * 100).toFixed(1)}%`,
      trailingAfter:    `${(this._trailingAfterPct * 100).toFixed(1)}%`,
      posicoesCached:   this._tracking.size,
    });
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _onPositionsUpdate(positions) {
    if (!Array.isArray(positions)) return;

    // Clean up tracking and closing guard for positions that are no longer active
    const activeAssets = new Set(positions.map(p => p.asset));
    for (const asset of this._tracking.keys()) {
      if (!activeAssets.has(asset)) {
        const misses = (this._missingCount.get(asset) ?? 0) + 1;
        this._missingCount.set(asset, misses);

        if (misses < CLOSE_CONFIRMATION_MISSES) {
          logger.warn(`[PM] Posição ${asset} ausente no snapshot (${misses}/${CLOSE_CONFIRMATION_MISSES}) — aguardando confirmação`);
          continue;
        }

        // Capture before deleting — needed for persistence call below
        const trackedEntry = this._tracking.get(asset);

        // If the bot did NOT initiate this close, the position was closed externally
        // (liquidation, venue UI, TP/SL at exchange, bot restart mid-close).
        // Persist the closure now. If _closing has the asset, _triggerClose() already
        // called recordTradeClosed() in its .then() — skip to avoid a double call.
        if (!this._closing.has(asset) && trackedEntry?.venue) {
          logger.warn(`[PM] Posição ${asset} fechada externamente — persistindo fechamento`, {
            event:         'external_close_detected',
            asset,
            venue:         trackedEntry.venue,
            bot_trade_ref: trackedEntry.bot_trade_ref ?? null,
            direction:     trackedEntry.direction     ?? null,
          });
          persistenceService.recordTradeClosed(
            asset,
            trackedEntry.venue,
            trackedEntry.bot_trade_ref ?? null,
            'external_close',
            {
              side:        trackedEntry.direction  ?? null,
              entry_price: trackedEntry.entryPrice ?? null,
            }
          ).catch(err => logger.warn(`[PM] Falha ao persistir close externo de ${asset}: ${err.message}`));
        }

        logger.info(`[PM] Posição ${asset} — tracking removido`);
        this._tracking.delete(asset);
        this._closing.delete(asset);
        this._lastTrailAt.delete(asset);
        this._missingCount.delete(asset);
        this._diskRestored.delete(asset);
      } else {
        this._missingCount.delete(asset);
      }
    }

    // Save after cleanup (remove stale entries from disk)
    if (positions.length > 0 || this._tracking.size > 0) {
      savePositionTracking(this._tracking);
    }

    // Inject bot_trade_ref from disk-restored tracking into position objects.
    // This handles restarts: persistenceService._botTradeRefs is empty after restart,
    // but _tracking was loaded from disk and may carry the ref. Running before
    // _processPosition ensures the ref is visible when tracking is first created.
    for (const pos of positions) {
      if (pos.bot_trade_ref == null) {
        const ref = this._tracking.get(pos.asset)?.bot_trade_ref;
        if (ref != null) {
          pos.bot_trade_ref = ref;
          logger.info(`[PM] position restored with bot_trade_ref — ${pos.asset} ref=${ref}`);
        }
      }
    }

    for (const position of positions) {
      try {
        this._processPosition(position);
      } catch (err) {
        logger.warn(`[PM] Erro ao processar posição ${position?.asset}: ${err.message}`);
      }
    }
  }

  _processPosition(position) {
    const { asset, direction, entryPrice, markPrice, pnlPct } = position;
    const venue = this._resolvePositionVenue(position);

    // Guard: require minimum data
    if (!asset || !direction || typeof markPrice !== 'number' || markPrice <= 0) return;

    // Skip if already being closed (trailing stop already triggered)
    if (this._closing.has(asset)) return;

    // Initialize tracking on first sight of this position
    if (!this._tracking.has(asset)) {
      const initial = {
        direction,
        entryPrice:    entryPrice ?? markPrice,
        highestPrice:  markPrice,
        lowestPrice:   markPrice,
        stopPrice:     null,
        alerted:       false,
        venue,
        // bot_trade_ref injected by persistenceService (same-process) or by
        // the restart injection loop above (from disk). null if neither is available.
        bot_trade_ref: position.bot_trade_ref ?? null,
      };
      this._tracking.set(asset, initial);
      savePositionTracking(this._tracking);
      logger.info(`[PM] tracking criado — ${direction} ${asset} @ $${entryPrice ?? markPrice}`, {
        event:         'tracking_created',
        asset,
        direction,
        entryPrice:    entryPrice ?? markPrice,
        venue,
        bot_trade_ref: position.bot_trade_ref ?? null,
      });
    }
    this._missingCount.delete(asset);

    let track = this._tracking.get(asset);
    if (!track.venue) track.venue = venue;

    // ── Identity check ─────────────────────────────────────────────────────────
    // Tracking is indexed by asset only. A prior entry — from disk or still in
    // memory — may belong to a previous position on the same asset. Detect any
    // material divergence and reset before price-extreme or trailing-stop logic.
    //
    // NOTE: entryPrice is passed raw (not ?? markPrice) to avoid false resets
    // when entryPrice is temporarily absent and markPrice has drifted from entry.
    const mismatchReason = this._detectIdentityMismatch(track, { direction, entryPrice, venue });
    if (mismatchReason) {
      logger.warn(`[PM] tracking resetado — posição divergente em ${asset} (${mismatchReason})`, {
        event:   'tracking_reset',
        asset,
        reason:  mismatchReason,
        saved:   { direction: track.direction, entryPrice: track.entryPrice, venue: track.venue },
        current: { direction, entryPrice: entryPrice ?? markPrice, venue },
      });
      track = {
        direction,
        entryPrice:    entryPrice ?? markPrice,
        highestPrice:  markPrice,
        lowestPrice:   markPrice,
        stopPrice:     null,
        alerted:       false,
        venue,
        bot_trade_ref: position.bot_trade_ref ?? null,
      };
      this._tracking.set(asset, track);
      this._diskRestored.delete(asset);
      savePositionTracking(this._tracking);
    } else if (this._diskRestored.has(asset)) {
      // First validated reuse of disk-restored tracking — confirms safe rehydration.
      this._diskRestored.delete(asset);
      logger.info(`[PM] tracking reutilizado (restaurado do disco, identidade validada) — ${direction} ${asset}`, {
        event:        'tracking_reused',
        asset,
        direction:    track.direction,
        entryPrice:   track.entryPrice,
        venue:        track.venue,
        highestPrice: track.highestPrice,
        lowestPrice:  track.lowestPrice,
        stopPrice:    track.stopPrice,
      });
    }
    // ──────────────────────────────────────────────────────────────────────────

    // Propagate bot_trade_ref into tracking when it becomes available after tracking was created.
    // Covers: (a) adopted external positions whose ref is injected by persistenceService
    //         after recordExternalTradeAdopted(); (b) normal positions where the
    //         positions:update listener ran before the ref was first available.
    let changed = false;
    if (track.bot_trade_ref == null && position.bot_trade_ref != null) {
      track.bot_trade_ref = position.bot_trade_ref;
      changed = true;
      logger.info(`[PM] bot_trade_ref disponível — atualizado no tracking: ${asset} ref=${position.bot_trade_ref}`, {
        event:        'tracking_ref_updated',
        asset,
        bot_trade_ref: position.bot_trade_ref,
      });
    }

    // Update price extremes (always)
    if (markPrice > track.highestPrice) { track.highestPrice = markPrice; changed = true; }
    if (markPrice < track.lowestPrice)  { track.lowestPrice  = markPrice; changed = true; }

    // ── Trailing stop ──────────────────────────────────────────────────────
    if (this._enableTrailing) {
      // Debounce: skip if updated too recently (prevents spam on rapid updates)
      const lastAt = this._lastTrailAt.get(asset) ?? 0;
      const now    = Date.now();
      if (now - lastAt >= DEBOUNCE_MS) {
        const stopUpdated = this._updateTrailingStop(asset, direction, markPrice, pnlPct, track);
        if (stopUpdated) {
          this._lastTrailAt.set(asset, now);
          changed = true;
        }
      }

      // Check for breach — even outside the debounce window, safety must run
      if (track.stopPrice !== null && !this._closing.has(asset)) {
        const breached = direction === 'LONG'
          ? markPrice <= track.stopPrice
          : markPrice >= track.stopPrice;

        if (breached) {
          logger.warn(`[PM] Trailing stop atingido — ${asset}`, {
            event:      'stop_triggered',
            asset,
            direction,
            markPrice,
            stopPrice:  track.stopPrice,
            venue:      track.venue ?? venue,
          });
          this._triggerClose(asset);
          return;
        }
      }
    }

    // ── Profit alert ───────────────────────────────────────────────────────
    if (this._enableAlerts && !track.alerted && typeof pnlPct === 'number') {
      if (pnlPct >= this._alertThresholdPct) {
        logger.info(`[PM] Threshold de lucro atingido — ${asset}: ${pnlPct.toFixed(2)}%`);
        this._sendProfitAlert(position, track.stopPrice);
        track.alerted = true;
        changed = true;
      }
    }

    if (changed) savePositionTracking(this._tracking);
  }

  /**
   * Attempt to update the trailing stop price.
   * Returns true if the stop was updated (for debounce/save tracking).
   *
   * Safety rules enforced here:
   *   1. Only activate after profit threshold is reached
   *   2. candidateStop must be a positive finite number
   *   3. For LONG:  candidateStop must be strictly below markPrice
   *   4. For SHORT: candidateStop must be strictly above markPrice
   *   5. Stop can only move in the favorable direction (never weaken protection)
   */
  _updateTrailingStop(asset, direction, markPrice, pnlPct, track) {
    // Do not activate until profit threshold is met
    if (typeof pnlPct !== 'number' || pnlPct < this._trailingAfterPct * 100) return false;

    const candidateStop = direction === 'LONG'
      ? track.highestPrice * (1 - this._trailingPct)
      : track.lowestPrice  * (1 + this._trailingPct);

    // ── Safety gate ────────────────────────────────────────────────────────
    if (!Number.isFinite(candidateStop) || candidateStop <= 0) {
      logger.warn(`[PM] trailing_update ignorado — candidateStop inválido (${candidateStop}) para ${asset}`);
      return false;
    }
    if (direction === 'LONG' && candidateStop >= markPrice) {
      logger.warn(`[PM] trailing_update ignorado — stop $${candidateStop.toFixed(4)} >= preço $${markPrice.toFixed(4)} (${asset})`);
      return false;
    }
    if (direction === 'SHORT' && candidateStop <= markPrice) {
      logger.warn(`[PM] trailing_update ignorado — stop $${candidateStop.toFixed(4)} <= preço $${markPrice.toFixed(4)} (${asset})`);
      return false;
    }
    // ──────────────────────────────────────────────────────────────────────

    const isFirstActivation = track.stopPrice === null;
    const improvesStop = !isFirstActivation && (
      direction === 'LONG'
        ? candidateStop > track.stopPrice
        : candidateStop < track.stopPrice
    );

    if (!isFirstActivation && !improvesStop) return false;

    const prev = track.stopPrice;
    track.stopPrice = candidateStop;

    logger.info(`[PM] Trailing stop atualizado — ${asset}`, {
      event:     'trailing_update',
      asset,
      direction,
      prev:      prev !== null ? +prev.toFixed(4) : null,
      stopPrice: +candidateStop.toFixed(4),
      highest:   +track.highestPrice.toFixed(4),
      lowest:    +track.lowestPrice.toFixed(4),
      markPrice: +markPrice.toFixed(4),
    });

    return true;
  }

  /**
   * Compare saved tracking identity against the current position snapshot.
   * Returns a human-readable reason string on material mismatch, or null if
   * identities match and tracking can be safely reused.
   *
   * Checks (in priority order):
   *   1. direction — exact; any flip is a definitive new position
   *   2. venue     — exact when both sides are known
   *   3. entryPrice — within 0.1% tolerance to absorb fill rounding/slippage
   *
   * entryPrice is expected to be the RAW position.entryPrice (not ?? markPrice)
   * to avoid false resets when entryPrice is temporarily absent and markPrice
   * has drifted materially from the original entry.
   */
  _detectIdentityMismatch(savedTrack, { direction, entryPrice, venue }) {
    if (savedTrack.direction !== direction) {
      return `direction (${savedTrack.direction} → ${direction})`;
    }
    if (savedTrack.venue && venue && savedTrack.venue !== venue) {
      return `venue (${savedTrack.venue} → ${venue})`;
    }
    if (savedTrack.entryPrice > 0 && entryPrice != null && entryPrice > 0) {
      const delta = Math.abs(savedTrack.entryPrice - entryPrice) / savedTrack.entryPrice;
      if (delta > 0.001) { // 0.1% — absorbs rounding, not a real position change
        return `entryPrice materialmente diferente (${savedTrack.entryPrice} → ${entryPrice}, Δ${(delta * 100).toFixed(3)}%)`;
      }
    }
    return null; // identidades compatíveis — tracking pode ser reutilizado
  }

  /**
   * Close a position via PerpExecutionService (correct venue, not Drift-only).
   * Guards against duplicate close attempts using _closing set.
   */
  _triggerClose(asset) {
    if (this._closing.has(asset)) {
      logger.debug(`[PM] Close já em andamento para ${asset} — ignorando duplicata`);
      return;
    }

    this._closing.add(asset);
    const trackedEntry = this._tracking.get(asset);
    const trackedVenue = trackedEntry?.venue ?? null;
    const botTradeRef  = trackedEntry?.bot_trade_ref ?? null;
    const { venue, source } = resolveCloseVenue(asset, trackedVenue, { allowActiveFallback: false });
    if (source === 'unresolved') {
      const err = new Error(`Venue não resolvida para trailing close de ${asset}; fechamento recusado por segurança`);
      logger.error(`[PM] ⛔ ${err.message}`);
      state.addError(`pm:close ${asset}`, err);
      this._closing.delete(asset);
      return;
    }
    logger.warn(`[PM] Iniciando close via PerpExecutionService — ${asset} (venue: ${venue})`);

    // Use the service layer — routes to the same venue that opened the trade
    perpService.closeTrade(asset, venue)
      .then(() => {
        logger.info(`[PM] Close concluído — ${asset}`);
        persistenceService.recordTradeClosed(asset, venue, botTradeRef).catch(() => {});
      })
      .catch(err => {
        logger.error(`[PM] Falha ao fechar ${asset}: ${err.message}`);
        // Remove from _closing so a retry is possible on next update
        this._closing.delete(asset);
      });
  }

  _sendProfitAlert(position, stopPrice) {
    const { asset, direction, entryPrice, markPrice, pnlPct } = position;
    const venue = this._tracking.get(asset)?.venue ?? this._resolvePositionVenue(position);

    const message = telegramAlertService.formatProfitAlert({
      symbol:       `${direction} ${asset}`,
      venue,
      entryPrice:   entryPrice ?? 0,
      currentPrice: markPrice,
      pnlPct:       pnlPct ?? 0,
      stopPrice,
      isPaper:      state.status.mode === 'paper',
    });

    // sendAlert is already wrapped in try/catch internally; belt-and-suspenders here
    telegramAlertService.sendAlert(message).catch(err => {
      logger.warn(`[PM] Falha no alerta de lucro (${asset}): ${err.message}`);
    });
  }

  _resolvePositionVenue(position) {
    return (
      position?.venue ??
      this._tracking.get(position?.asset)?.venue ??
      perpService.getActiveVenue()
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getTrackingSnapshot() {
    const result = {};
    for (const [asset, track] of this._tracking.entries()) {
      result[asset] = { ...track };
    }
    return result;
  }
}

export const positionManager = new PositionManager();
