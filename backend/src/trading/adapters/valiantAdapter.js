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
// Implemented: openTrade, closeTrade, reduceTrade, getPositions, getBalance, getAccountSnapshot
// Deferred:    closeAllTrades, updateTpSl

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
   *
   * @param {object} tradeParams - from risk_manager.calculateTradeParams
   */
  async openTrade(tradeParams) {
    const { signalId, asset, direction, entry, leverage, positionSizeUSD, notionalValueUSD } = tradeParams;

    const assetIndex = _resolveAssetIndex(asset);
    const isBuy      = direction === 'LONG';
    const sizeInBase = (notionalValueUSD / entry).toFixed(6);
    const limitPx    = _buildMarketPrice(entry, direction);

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
      assetIndex,
      signalId,
    });
    // ─────────────────────────────────────────────────────────────────────────

    logger.info(`[VALIANT] Ajustando leverage: ${asset} → ${leverage}x`);
    const levResult = await updateLeverage(assetIndex, leverage, true);
    logger.info('[VALIANT] Leverage definida:', levResult);

    logger.info(`[VALIANT] Enviando ordem: ${direction} ${sizeInBase} ${asset} @ $${limitPx}`);
    const orderResult = await placeOrder({ assetIndex, isBuy, size: sizeInBase, limitPrice: limitPx, reduceOnly: false });

    // ── POST-ORDER log — raw response + parsed orderId ────────────────────────
    logger.info('[VALIANT] Resposta bruta /exchange:', orderResult);
    const orderId = _extractOrderId(orderResult);
    logger.info('[VALIANT] Ordem executada:', { orderId, asset, side: direction, size: sizeInBase, signalId });
    // ─────────────────────────────────────────────────────────────────────────

    return {
      success:       true,
      venue:         'valiant',
      signalId,
      asset,
      direction,
      entry,
      leverage,
      collateralUSD: positionSizeUSD,
      notionalUSD:   notionalValueUSD,
      signatures:    { marketOrder: orderId },
      executedAt:    new Date().toISOString(),
    };
  },

  /**
   * Close an open position via Hyperliquid (reduce-only IOC).
   * Position lookup and order placement are delegated to hyperliquidClient.closePosition().
   *
   * @param {string} asset - e.g. 'SOL', 'BTC'
   */
  async closeTrade(asset) {
    const assetIndex = _resolveAssetIndex(asset);

    // ── PRE-CLOSE log ─────────────────────────────────────────────────────────
    logger.info('[VALIANT] PRE-CLOSE', { asset, assetIndex });
    // ─────────────────────────────────────────────────────────────────────────

    const { orderId, raw } = await closePosition(assetIndex, asset);

    // ── POST-CLOSE log ────────────────────────────────────────────────────────
    logger.info('[VALIANT] Resposta bruta /exchange (close):', raw);
    logger.info('[VALIANT] Posicao fechada:', { asset, orderId });
    // ─────────────────────────────────────────────────────────────────────────

    return orderId;
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

    return orderId;
  },

  /**
   * Returns all non-zero open positions in the venue-agnostic shape.
   * Delegates directly to hyperliquidClient — no adapter transformation.
   * @returns {Promise<Array>}
   */
  async getPositions() {
    return getPositions();
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
