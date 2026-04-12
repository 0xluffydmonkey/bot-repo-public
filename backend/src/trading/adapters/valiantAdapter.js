// src/trading/adapters/valiantAdapter.js
//
// Valiant execution adapter.
//
// Architecture:
//   Valiant = adapter layer only  — maps internal tradeParams ↔ Hyperliquid call args
//   Hyperliquid = execution layer — all signing, HTTP, and close logic lives in hyperliquidClient.js
//
// This file must NOT contain:
//   - HTTP calls
//   - EIP-712 signing
//   - position lookup logic
//   - API error handling
//
// Implemented: openTrade, closeTrade, closeAllTrades, reduceTrade, getPositions, getBalance, getAccountSnapshot

import logger from '../../utils/logger.js';
import { VALIANT_MARKETS } from '../../config/index.js';
import {
  placeOrder,
  closePosition,
  reducePosition,
  updateLeverage,
  getPositions,
  getBalance,
  getAccountSnapshot,
  setTpSl,
} from '../clients/hyperliquidClient.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _resolveAssetIndex(asset) {
  const index = VALIANT_MARKETS.ASSET_INDEX[asset?.toUpperCase()];
  if (index === undefined) {
    throw new Error(
      `[VALIANT] Ativo nao suportado: "${asset}". ` +
      `Suportados: ${Object.keys(VALIANT_MARKETS.ASSET_INDEX).join(', ')}`
    );
  }
  return index;
}

// 2% slippage so IOC orders fill immediately at market price.
const MARKET_SLIPPAGE_PCT = 0.02;

function _buildMarketPrice(entryPrice, direction) {
  const adjusted = direction === 'LONG'
    ? entryPrice * (1 + MARKET_SLIPPAGE_PCT)
    : entryPrice * (1 - MARKET_SLIPPAGE_PCT);
  return adjusted.toFixed(6);
}

function _extractOrderId(result) {
  const status = result?.response?.data?.statuses?.[0];
  return String(status?.resting?.oid ?? status?.filled?.oid ?? 'unknown');
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const valiantAdapter = {
  venue: 'valiant',

  /**
   * Open a perpetual position via Hyperliquid.
   * 1. Set leverage on the asset
   * 2. Place a market-equivalent IOC order
   * 3. Verify the fill (zero fill = throw; partial fill = warn)
   * 4. Place native TP/SL trigger orders if tradeParams includes them (best-effort)
   *
   * Safety contract:
   *   - State is never mutated before exchange acceptance is confirmed.
   *   - Zero fill throws — caller sees a real error, not a false success.
   *   - Partial fill warns but succeeds — position is open, size is adjusted.
   *   - TP/SL failure is non-fatal — position remains open, operator can set manually.
   *
   * @param {object} tradeParams - from risk_manager.calculateTradeParams
   */
  async openTrade(tradeParams) {
    const { signalId, asset, direction, entry, leverage, positionSizeUSD, notionalValueUSD, tp, sl } = tradeParams;

    const assetIndex  = _resolveAssetIndex(asset);
    const isBuy       = direction === 'LONG';
    const sizeInBase  = (notionalValueUSD / entry).toFixed(6);
    const requestedSz = parseFloat(sizeInBase);
    const limitPx     = _buildMarketPrice(entry, direction);

    // ── PRE-ORDER log — emitted before any HTTP call ──────────────────────────
    logger.info('[VALIANT] PRE-ORDER', {
      venue:      'valiant',
      asset,
      side:       direction,
      leverage:   `${leverage}x`,
      size:       sizeInBase,
      limitPx,
      collateral: `$${positionSizeUSD.toFixed(2)}`,
      notional:   `$${notionalValueUSD.toFixed(2)}`,
      tp:         tp  ?? '(none)',
      sl:         sl  ?? '(none)',
      assetIndex,
      signalId,
    });
    // ─────────────────────────────────────────────────────────────────────────

    logger.info(`[VALIANT] Ajustando leverage: ${asset} → ${leverage}x (isolated)`);
    const levResult = await updateLeverage(assetIndex, leverage, false); // false = isolated margin
    logger.info('[VALIANT] Leverage definida:', levResult);

    logger.info(`[VALIANT] Enviando ordem: ${direction} ${sizeInBase} ${asset} @ $${limitPx}`);
    const orderResult = await placeOrder({ assetIndex, isBuy, size: sizeInBase, limitPrice: limitPx, reduceOnly: false });

    // ── Fill verification — fail closed on zero fill, warn on partial ─────────
    //
    // Hyperliquid IOC orders: either fill immediately or cancel the remainder.
    // statuses[0].filled = { oid, totalSz, avgPx } if any fill occurred.
    // A zero fill means no execution — throw to prevent false success state.
    const st         = orderResult?.response?.data?.statuses?.[0];
    const filled     = st?.filled;
    const orderId    = String(st?.resting?.oid ?? filled?.oid ?? 'unknown');
    const filledSz   = filled ? parseFloat(filled.totalSz ?? '0') : 0;
    const avgFillPx  = filled ? parseFloat(filled.avgPx   ?? '0') : 0;

    logger.info('[VALIANT] Resposta bruta /exchange:', orderResult);

    if (filledSz === 0) {
      throw new Error(
        `[VALIANT] Zero fill: ${direction} ${asset} — ordem nao executada. ` +
        `Verifique liquidez, preco limite, e margem disponivel. Raw: ${JSON.stringify(st)}`
      );
    }

    const fillRatio = requestedSz > 0 ? filledSz / requestedSz : 1;
    if (fillRatio < 0.99) {
      logger.warn('[VALIANT] PARTIAL FILL detectado', {
        asset, direction, requestedSz, filledSz,
        fillRatio: fillRatio.toFixed(4), orderId, signalId,
      });
    }

    // Adjust result to reflect ACTUAL fill, not requested size
    const actualNotionalUSD = filledSz * avgFillPx;
    const actualCollateral  = leverage > 0 ? actualNotionalUSD / leverage : positionSizeUSD;

    logger.info('[VALIANT] Ordem executada', {
      orderId, asset, side: direction,
      requestedSz, filledSz, avgFillPx,
      actualNotionalUSD: actualNotionalUSD.toFixed(2),
      partialFill: fillRatio < 0.99,
      signalId,
    });
    // ─────────────────────────────────────────────────────────────────────────

    // ── Native TP/SL placement (best-effort — never fails the open) ───────────
    //
    // Placed after fill confirmation so the size matches actual filled size.
    // If placement fails, the position remains open and TP/SL can be set manually
    // via perpService.updateTpSl / cmd:update_tpsl / Telegram control.
    let tpslOrders = null;
    if (tp != null || sl != null) {
      try {
        tpslOrders = await setTpSl(assetIndex, asset, tp ?? null, sl ?? null);
        logger.info('[VALIANT] TP/SL definido', { asset, tp: tp ?? '-', sl: sl ?? '-', orders: tpslOrders });
      } catch (tpslErr) {
        logger.warn(
          `[VALIANT] TP/SL placement falhou (posicao aberta, TP/SL pode ser definido manualmente): ${tpslErr.message}`
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    return {
      success:       true,
      venue:         'valiant',
      signalId,
      asset,
      direction,
      entry:         avgFillPx || entry, // prefer actual fill price
      tp,            // required by position_tracker initial card (result.tp)
      sl,            // required by position_tracker initial card (result.sl)
      marginType:    'isolated',          // Hyperliquid perps are always isolated
      leverage,
      collateralUSD: actualCollateral,
      notionalUSD:   actualNotionalUSD,
      filledBase:    filledSz,
      partialFill:   fillRatio < 0.99,
      signatures:    { marketOrder: orderId },
      tpsl:          tpslOrders,
      executedAt:    new Date().toISOString(),
    };
  },

  /**
   * Close an open position via Hyperliquid at market (reduce-only IOC).
   * Position lookup and order placement are delegated to hyperliquidClient.closePosition().
   *
   * @param {string} asset - e.g. 'SOL', 'BTC'
   */
  async closeTrade(asset) {
    const assetIndex = _resolveAssetIndex(asset);

    // ── PRE-CLOSE log ─────────────────────────────────────────────────────────
    logger.info('[VALIANT] PRE-CLOSE MARKET', { asset, assetIndex, orderType: 'market_ioc' });
    // ─────────────────────────────────────────────────────────────────────────

    const { orderId, raw } = await closePosition(assetIndex, asset);

    // ── POST-CLOSE log ────────────────────────────────────────────────────────
    logger.info('[VALIANT] Resposta bruta /exchange (close):', raw);
    logger.info('[VALIANT] Posicao fechada:', { asset, orderId });
    // ─────────────────────────────────────────────────────────────────────────

    return orderId;
  },

  /**
   * Close all open positions sequentially (reduce-only IOC per asset).
   *
   * Hyperliquid has no atomic close-all endpoint, so positions are closed one
   * by one.  Failures on individual assets are caught and recorded — the loop
   * always continues so that a single bad asset cannot block the others.
   *
   * @returns {Promise<Array<{ asset: string, success: boolean, orderId?: string, error?: string }>>}
   */
  async closeAllTrades() {
    const rawPositions = await getPositions();
    if (rawPositions.length === 0) {
      logger.info('[VALIANT] closeAllTrades: nenhuma posicao aberta');
      return [];
    }

    logger.info('[VALIANT] closeAllTrades: fechando', { count: rawPositions.length });

    const results = [];
    for (const p of rawPositions) {
      const asset = p.position.coin.replace(/-PERP$/i, '').toUpperCase();
      try {
        const assetIndex = _resolveAssetIndex(asset);
        const { orderId, raw } = await closePosition(assetIndex, asset);
        logger.info('[VALIANT] closeAllTrades: fechado', { asset, orderId });
        results.push({ asset, success: true, orderId });
      } catch (err) {
        logger.error('[VALIANT] closeAllTrades: falha ao fechar', { asset, error: err.message });
        results.push({ asset, success: false, error: err.message });
      }
    }

    const ok = results.filter(r => r.success).length;
    logger.info('[VALIANT] closeAllTrades: concluido', { total: results.length, ok, failed: results.length - ok });
    return results;
  },

  /**
   * Reduce an open position by a specific base-asset size (reduce-only IOC).
   * Fails if no open position exists or size exceeds open position.
   *
   * @param {string} asset     - e.g. 'SOL', 'BTC'
   * @param {number} sizeBase  - base-asset units to reduce
   */
  async reduceTrade(asset, sizeBase) {
    const assetIndex = _resolveAssetIndex(asset);

    logger.info('[VALIANT] PRE-REDUCE', { venue: 'valiant', asset, assetIndex, reduceSize: sizeBase });

    const { orderId, raw } = await reducePosition(assetIndex, asset, sizeBase);

    logger.info('[VALIANT] Resposta bruta /exchange (reduce):', raw);
    logger.info('[VALIANT] Posicao reduzida:', { venue: 'valiant', asset, orderId, reduceSize: sizeBase });

    // Return shape matches drift_executor.reducePosition: { txSig } so that
    // ManualTradeService.reduceManualTrade can read result.txSig correctly.
    return { txSig: orderId };
  },

  /**
   * Returns all non-zero open positions in the venue-agnostic shape.
   * Delegates directly to hyperliquidClient — no adapter transformation.
   * @returns {Promise<Array>}
   */
  async getPositions() {
    return getPositions();
  },

  /**
   * Place or replace native TP/SL trigger orders on Hyperliquid for an open position.
   *
   * Cancels any existing orders for the asset, then places new TP and/or SL
   * trigger orders (isMarket:true, reduce-only).  A null value for tp or sl
   * means "do not place" — the other side is still placed.
   *
   * Safe to call multiple times — each call replaces all previous orders.
   *
   * @param {string}      asset - e.g. 'SOL', 'BTC'
   * @param {number|null} tp    - take profit price (null = skip)
   * @param {number|null} sl    - stop loss price (null = skip)
   * @returns {Promise<Array<{ type: 'tp'|'sl', price: number, orderId: string }>>}
   */
  async updateTpSl(asset, tp, sl) {
    const assetIndex = _resolveAssetIndex(asset);

    logger.info('[VALIANT] PRE-TPSL', {
      venue:      'valiant',
      asset,
      tp:         tp  ?? '(skip)',
      sl:         sl  ?? '(skip)',
      assetIndex,
    });

    const placed = await setTpSl(assetIndex, asset, tp ?? null, sl ?? null);

    logger.info('[VALIANT] POST-TPSL', { venue: 'valiant', asset, placed });
    return { asset, tpsl: placed };
  },

  async getBalance() {
    return getBalance();
  },

  async getAccountSnapshot() {
    return getAccountSnapshot();
  },

  getSupportedAssets() {
    return Object.keys(VALIANT_MARKETS.ASSET_INDEX);
  },

  getMarketLimits(asset) {
    const limits = VALIANT_MARKETS.MARKET_LIMITS[asset?.toUpperCase()];
    if (!limits) {
      throw new Error(`[VALIANT] Limites nao configurados para: "${asset}"`);
    }
    return limits;
  },

  getPlatformMaxLeverage(asset) {
    return VALIANT_MARKETS.MAX_LEVERAGE_BY_ASSET[asset?.toUpperCase()] ?? 20;
  },
};
