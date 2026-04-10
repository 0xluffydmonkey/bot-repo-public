// src/trading/adapters/valiantAdapter.js
// Valiant execution adapter — thin routing layer over valiantClient.
//
// All Valiant-specific HTTP and auth logic lives in valiantClient.js.
// This file only maps the internal tradeParams schema → client calls.
//
// Phase 1 capabilities: openTrade, closeTrade, getBalance, getAccountSnapshot
// Phase 2 (deferred):   closeAllTrades, reduceTrade, updateTpSl

import logger from '../../utils/logger.js';
import { VALIANT_MARKETS } from '../../config/index.js';
import {
  placeOrder,
  updateLeverage,
  fetchOpenPositions,
  getBalance,
  fetchAccountSnapshot,
} from '../clients/valiantClient.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _resolveAssetIndex(asset) {
  const index = VALIANT_MARKETS.ASSET_INDEX[asset?.toUpperCase()];
  if (index === undefined) {
    throw new Error(
      `[VALIANT] Ativo nao suportado: "${asset}". ` +
      `Suportados: ${Object.keys(VALIANT_MARKETS.ASSET_INDEX).join(', ')}. ` +
      'Verifique VALIANT_MARKETS.ASSET_INDEX em config/index.js.'
    );
  }
  return index;
}

// 2% slippage added to the limit price so IOC orders fill immediately at market.
const MARKET_SLIPPAGE_PCT = 0.02;

function _buildMarketPrice(entryPrice, direction) {
  const adjusted = direction === 'LONG'
    ? entryPrice * (1 + MARKET_SLIPPAGE_PCT)
    : entryPrice * (1 - MARKET_SLIPPAGE_PCT);
  return adjusted.toFixed(6);
}

// Extracts the order ID from the Valiant/Hyperliquid response structure.
// Returns 'unknown' if the response shape is unexpected — never throws.
function _extractOrderId(result) {
  const status = result?.response?.data?.statuses?.[0];
  return String(status?.resting?.oid ?? status?.filled?.oid ?? 'unknown');
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const valiantAdapter = {
  venue: 'valiant',

  /**
   * Open a perpetual position on Valiant.
   *
   * Flow:
   *   1. Set leverage (required before order)
   *   2. Place market-equivalent IOC order
   *
   * @param {object} tradeParams - output of risk_manager.calculateTradeParams
   */
  async openTrade(tradeParams) {
    const {
      signalId,
      asset,
      direction,
      entry,
      leverage,
      positionSizeUSD,
      notionalValueUSD,
    } = tradeParams;

    const assetIndex = _resolveAssetIndex(asset);
    const isBuy      = direction === 'LONG';
    const sizeInBase = (notionalValueUSD / entry).toFixed(6);
    const limitPx    = _buildMarketPrice(entry, direction);

    // ── PRE-ORDER LOG — emitted before the real order reaches the API ─────────
    logger.info('[VALIANT] PRE-ORDER ─────────────────────────────────────────', {
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

    // 1. Set leverage
    logger.info(`[VALIANT] Ajustando leverage: ${asset} → ${leverage}x (cross)`);
    const leverageResult = await updateLeverage(assetIndex, leverage, /* isCross */ true);
    logger.info('[VALIANT] Leverage definida:', leverageResult);

    // 2. Place IOC order
    logger.info(`[VALIANT] Enviando ordem: ${direction} ${sizeInBase} ${asset} @ limite $${limitPx}`);
    const orderResult = await placeOrder({
      assetIndex,
      isBuy,
      size:       sizeInBase,
      limitPrice: limitPx,
      reduceOnly: false,
    });

    // ── POST-ORDER LOG — raw response + parsed result ─────────────────────────
    logger.info('[VALIANT] RESPOSTA BRUTA /exchange:', orderResult);
    const orderId = _extractOrderId(orderResult);
    logger.info('[VALIANT] Ordem executada:', {
      orderId,
      asset,
      side:    direction,
      size:    sizeInBase,
      limitPx,
      signalId,
    });
    // ─────────────────────────────────────────────────────────────────────────

    return {
      success:      true,
      venue:        'valiant',
      signalId,
      asset,
      direction,
      entry,
      leverage,
      collateralUSD: positionSizeUSD,
      notionalUSD:   notionalValueUSD,
      signatures:   { marketOrder: orderId },
      executedAt:   new Date().toISOString(),
    };
  },

  /**
   * Close an open position on Valiant via a reduce-only IOC order.
   * Fetches current position size/direction from the API first.
   *
   * @param {string} asset - e.g. 'SOL', 'BTC'
   * @returns {Promise<string>} order ID
   */
  async closeTrade(asset) {
    const assetIndex = _resolveAssetIndex(asset);

    const positions = await fetchOpenPositions();
    const pos = positions.find(
      (p) => p.position?.coin?.toUpperCase() === asset.toUpperCase()
    );

    if (!pos) {
      throw new Error(`[VALIANT] Sem posicao aberta em ${asset} para fechar`);
    }

    const szi     = parseFloat(pos.position.szi);
    const isLong  = szi > 0;
    const absSize = Math.abs(szi).toFixed(6);
    const isBuy   = !isLong;
    const closePx = isLong ? '1' : '999999999';

    // ── PRE-CLOSE LOG ─────────────────────────────────────────────────────────
    logger.info('[VALIANT] PRE-CLOSE ─────────────────────────────────────────', {
      asset,
      side:    isLong ? 'LONG' : 'SHORT',
      size:    absSize,
      closePx,
      assetIndex,
    });
    // ─────────────────────────────────────────────────────────────────────────

    const closeResult = await placeOrder({
      assetIndex,
      isBuy,
      size:       absSize,
      limitPrice: closePx,
      reduceOnly: true,
    });

    // ── POST-CLOSE LOG ────────────────────────────────────────────────────────
    logger.info('[VALIANT] RESPOSTA BRUTA /exchange (close):', closeResult);
    const orderId = _extractOrderId(closeResult);
    logger.info('[VALIANT] Posicao fechada:', { asset, orderId });
    // ─────────────────────────────────────────────────────────────────────────

    return orderId;
  },

  async getBalance() {
    return getBalance();
  },

  async getAccountSnapshot() {
    return fetchAccountSnapshot();
  },

  getSupportedAssets() {
    return Object.keys(VALIANT_MARKETS.ASSET_INDEX);
  },

  getMarketLimits(asset) {
    const limits = VALIANT_MARKETS.MARKET_LIMITS[asset?.toUpperCase()];
    if (!limits) {
      throw new Error(
        `[VALIANT] Limites de mercado nao configurados para: "${asset}". ` +
        'Adicione em VALIANT_MARKETS.MARKET_LIMITS em config/index.js.'
      );
    }
    return limits;
  },

  getPlatformMaxLeverage(asset) {
    return VALIANT_MARKETS.MAX_LEVERAGE_BY_ASSET[asset?.toUpperCase()] ?? 20;
  },
};
