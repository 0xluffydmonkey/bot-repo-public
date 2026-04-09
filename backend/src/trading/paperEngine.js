// src/trading/paperEngine.js
// Venue-agnostic paper trading engine.
//
// Acts as the sole execution layer when config.trading.paperMode is true.
// PerpExecutionService intercepts ALL execution calls (openTrade, closeTrade,
// closeAllTrades, updateTpSl, getBalance, getAccountSnapshot) and routes them
// here — the live adapter is never reached in paper mode.
//
// State:
//   _freeBalance  — available capital (decreases on open, increases on close)
//   _positions    — Map<asset, positionObject> — source of truth for paper state
//
// Read path:
//   data_fetcher.buildPaperData() calls paperEngine.getSnapshot() each poll cycle.
//   getSnapshot() oscillates markPrice for visual feedback and recomputes PnL.
//   The result is fed to state.updateAccount + state.updatePositions — identical
//   to what driftMonitoring does in live mode.
//
// No imports from the rest of the project — zero risk of circular dependency.

import logger from '../utils/logger.js';

const INITIAL_BALANCE = parseFloat(process.env.PAPER_INITIAL_BALANCE ?? '10000');

// ── In-memory paper store ─────────────────────────────────────────────────────
// Resets on process restart. Acceptable for simulation.
let _freeBalance = INITIAL_BALANCE;
const _positions = new Map(); // asset (uppercase) → positionObject

function _fakeSig(label) {
  return `PAPER_${label}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
}

// ── Paper engine ──────────────────────────────────────────────────────────────
export const paperEngine = {

  // ── Execution methods (called by PerpExecutionService) ───────────────────────

  /**
   * Simulates opening a position. Writes to paper store and returns a result
   * object with the same shape as driftAdapter.openTrade() so all callers
   * (executeSignal, signalStore, dashboard) behave identically in paper mode.
   *
   * @param {object} tradeParams - output of risk_manager.calculateTradeParams
   * @returns {object}
   */
  openTrade(tradeParams) {
    const {
      signalId, asset, direction, entry, tp, sl,
      leverage, positionSizeUSD, notionalValueUSD, marginType,
    } = tradeParams;

    const assetUpper         = asset.toUpperCase();
    const resolvedMarginType = (marginType ?? 'isolated').toUpperCase();
    const sizeBase           = notionalValueUSD / entry;

    // Write to store — checked by PositionManager via data_fetcher poll
    _positions.set(assetUpper, {
      venue:         'paper',
      asset:         assetUpper,
      market:        `${assetUpper}-PERP`,
      direction:     direction.toUpperCase(),
      marginType:    resolvedMarginType,
      sizeBase,
      sizeUSD:       notionalValueUSD,
      collateralUSD: positionSizeUSD,
      entryPrice:    entry,
      markPrice:     entry,
      tp:            tp ?? null,
      sl:            sl ?? null,
      leverage,
      pnlUSD:        0,
      pnlPct:        0,
      isProfit:      false,
    });

    _freeBalance = Math.max(0, _freeBalance - positionSizeUSD);

    logger.info(`[PAPER] 📝 Trade simulado:`, {
      sinal:       signalId,
      ativo:       `${direction.toUpperCase()} ${assetUpper}`,
      entrada:     `$${entry}`,
      tp:          `$${tp}`,
      sl:          `$${sl}`,
      alavancagem: `${leverage}x`,
      colateral:   `$${positionSizeUSD.toFixed(2)}`,
      nocional:    `$${notionalValueUSD.toFixed(2)}`,
      saldoLivre:  `$${_freeBalance.toFixed(2)}`,
    });

    return {
      success:    true,
      paperTrade: true,
      signalId,
      asset:      assetUpper,
      direction:  direction.toUpperCase(),
      entry, tp, sl, leverage,
      marginType:    resolvedMarginType,
      collateralUSD: positionSizeUSD,
      notionalUSD:   notionalValueUSD,
      signatures: {
        marketOrder: _fakeSig('MKT'),
        takeProfit:  _fakeSig('TP'),
        stopLoss:    _fakeSig('SL'),
      },
      pnlProjection: {
        maxProfit: +((Math.abs(tp - entry) / entry) * notionalValueUSD).toFixed(2),
        maxLoss:   +((Math.abs(sl - entry) / entry) * notionalValueUSD).toFixed(2),
      },
      executedAt: new Date().toISOString(),
    };
  },

  /**
   * Simulates closing a single position. Realizes PnL at current markPrice.
   * If the asset is not in the store, logs a warning and returns a noop sig.
   *
   * @param {string} asset
   * @returns {string} fake tx signature
   */
  closeTrade(asset) {
    const assetUpper = asset.toUpperCase();
    const pos = _positions.get(assetUpper);

    if (pos) {
      const sign     = pos.direction === 'LONG' ? 1 : -1;
      const realized = sign * (pos.markPrice - pos.entryPrice) * pos.sizeBase;
      _freeBalance  += pos.collateralUSD + realized;
      _positions.delete(assetUpper);
      logger.info(`[PAPER] 📝 Posição ${assetUpper} fechada | PnL realizado: $${realized.toFixed(2)} | saldo: $${_freeBalance.toFixed(2)}`);
    } else {
      logger.warn(`[PAPER] closeTrade: ${assetUpper} não encontrada no paper store`);
    }

    return `PAPER_CLOSE_${Date.now()}`;
  },

  /**
   * Simulates closing all open positions.
   * @returns {Array<{ asset: string, success: boolean }>}
   */
  closeAllTrades() {
    const assets = Array.from(_positions.keys());

    if (assets.length === 0) {
      logger.info(`[PAPER] 📝 close_all: nenhuma posição aberta`);
      return [];
    }

    const results = assets.map(assetUpper => {
      this.closeTrade(assetUpper);
      return { asset: assetUpper, success: true };
    });

    logger.info(`[PAPER] 📝 close_all: ${assets.length} posição(ões) fechada(s)`);
    return results;
  },

  /**
   * Updates TP and/or SL for a paper position.
   * Preserves the unspecified side (null = leave unchanged).
   *
   * @param {string}      asset
   * @param {number|null} tp
   * @param {number|null} sl
   * @returns {object}
   */
  updateTpSl(asset, tp, sl) {
    const assetUpper = asset.toUpperCase();
    const pos = _positions.get(assetUpper);

    if (pos) {
      if (tp != null) pos.tp = tp;
      if (sl != null) pos.sl = sl;
      logger.info(`[PAPER] 📝 TP/SL atualizado: ${assetUpper} → TP:${tp ?? '(sem alteração)'} SL:${sl ?? '(sem alteração)'}`);
    } else {
      logger.warn(`[PAPER] updateTpSl: ${assetUpper} não encontrada no paper store`);
    }

    return {
      asset: assetUpper, tp, sl,
      signatures: {
        takeProfit: tp != null ? _fakeSig('TP') : null,
        stopLoss:   sl != null ? _fakeSig('SL') : null,
      },
    };
  },

  /**
   * Returns free balance — passed to risk_manager as walletBalanceUSD.
   * Decreases as positions are opened, reflecting real capital consumption.
   * @returns {number}
   */
  getBalance() {
    return _freeBalance;
  },

  /**
   * Returns a live-style account snapshot for risk decisions.
   * Shape matches driftAdapter.getAccountSnapshot() exactly.
   * @returns {{ freeCollateral, totalEquity, positionCount, totalNotional }}
   */
  getAccountSnapshot() {
    const positions     = Array.from(_positions.values());
    const marginUsed    = positions.reduce((s, p) => s + p.collateralUSD, 0);
    const unrealizedPnl = positions.reduce((s, p) => s + p.pnlUSD, 0);
    const totalEquity   = _freeBalance + marginUsed + unrealizedPnl;
    return {
      freeCollateral: _freeBalance,
      totalEquity,
      positionCount:  positions.length,
      totalNotional:  positions.reduce((s, p) => s + p.sizeUSD, 0),
    };
  },

  // ── Read method (called by data_fetcher.buildPaperData each poll cycle) ──────

  /**
   * Returns a fresh snapshot with oscillated mark prices for the dashboard.
   * Updates stored markPrice so closeTrade() realizes the correct PnL.
   *
   * Shape mirrors driftMonitoring.fetchSnapshot() — consumers (state, PositionManager,
   * web dashboard) are venue-agnostic and see no difference.
   *
   * @returns {{ account: object, positions: Array }}
   */
  getSnapshot() {
    const t = Date.now();

    const positions = Array.from(_positions.values()).map(pos => {
      // Per-asset phase keeps SOL and BTC oscillating at different points
      const phase     = (pos.asset.charCodeAt(0) ?? 0) * 1.3;
      const markPrice = pos.entryPrice * (1 + 0.02 * Math.sin(t / 30_000 + phase));

      // Update stored markPrice so closeTrade PnL reflects current price
      pos.markPrice = markPrice;

      const sign   = pos.direction === 'LONG' ? 1 : -1;
      const pnlUSD = sign * (markPrice - pos.entryPrice) * pos.sizeBase;
      const pnlPct = pos.entryPrice > 0
        ? (pnlUSD / (pos.entryPrice * pos.sizeBase)) * 100
        : 0;

      return {
        ...pos,
        markPrice: +markPrice.toFixed(4),
        sizeUSD:   +(pos.sizeBase * markPrice).toFixed(2),
        pnlUSD:    +pnlUSD.toFixed(2),
        pnlPct:    +pnlPct.toFixed(4),
        isProfit:   pnlUSD >= 0,
      };
    });

    positions.sort((a, b) => b.pnlUSD - a.pnlUSD);

    const freeCollateral = _freeBalance;
    const marginUsed     = positions.reduce((s, p) => s + p.collateralUSD, 0);
    const unrealizedPnl  = positions.reduce((s, p) => s + p.pnlUSD, 0);
    const totalEquity    = freeCollateral + marginUsed + unrealizedPnl;

    return {
      account: { freeCollateral, totalEquity, marginUsed, unrealizedPnl },
      positions,
    };
  },
};
