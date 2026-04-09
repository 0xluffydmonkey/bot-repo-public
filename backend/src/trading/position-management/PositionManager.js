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

const DEBOUNCE_MS = 1_000; // max one trailing update per asset per second

class PositionManager {
  constructor() {
    // Restore tracking from disk — survives restarts
    this._tracking     = loadPositionTracking();
    // Set of assets currently being closed — prevents duplicate close attempts
    this._closing      = new Set();
    // Debounce: asset → last trailing update timestamp (ms)
    this._lastTrailAt  = new Map();

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
        logger.info(`[PM] Posição ${asset} fechada — tracking removido`);
        this._tracking.delete(asset);
        this._closing.delete(asset);
        this._lastTrailAt.delete(asset);
      }
    }

    // Save after cleanup (remove stale entries from disk)
    if (positions.length > 0 || this._tracking.size > 0) {
      savePositionTracking(this._tracking);
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
        entryPrice:   entryPrice ?? markPrice,
        highestPrice: markPrice,
        lowestPrice:  markPrice,
        stopPrice:    null,
        alerted:      false,
        venue,
      };
      this._tracking.set(asset, initial);
      savePositionTracking(this._tracking);
      logger.info(`[PM] Iniciando tracking: ${direction} ${asset} @ $${entryPrice ?? markPrice}`, {
        event: 'trade_open',
        asset,
        direction,
        entryPrice: entryPrice ?? markPrice,
        venue,
      });
    }

    const track = this._tracking.get(asset);
    if (!track.venue) track.venue = venue;

    // Update price extremes (always)
    let changed = false;
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
   * Close a position via PerpExecutionService (correct venue, not Drift-only).
   * Guards against duplicate close attempts using _closing set.
   */
  _triggerClose(asset) {
    if (this._closing.has(asset)) {
      logger.debug(`[PM] Close já em andamento para ${asset} — ignorando duplicata`);
      return;
    }

    this._closing.add(asset);
    const trackedVenue = this._tracking.get(asset)?.venue ?? null;
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
