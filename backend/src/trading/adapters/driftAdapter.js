// src/trading/adapters/driftAdapter.js
// Thin wrapper around the existing Drift executor.
// Preserves all existing logic — only delegates to drift_executor.js.
// DO NOT add business logic here.

import {
  openPositionWithRetry,
  closePosition,
  closeAllPositions,
  reducePosition,
  updateTpSl,
  getWalletBalance,
  getLiveAccountSnapshot,
  DRIFT_MARKET_INDEX,
  getMarketLimits as _getMarketLimitsByIndex,
} from '../../executor/drift_executor.js';

// Max leverage per asset on Drift Protocol mainnet (validated 2026-03).
// Lives here rather than risk_manager so the risk manager stays venue-agnostic.
const DRIFT_MAX_LEVERAGE_BY_ASSET = {
  SOL:    20, BTC:    20, ETH:    20, APT:    10,
  '1MBONK': 10, BONK: 10, POL:    10, MATIC:  10,
  ARB:    10, DOGE:   10, BNB:    10, SUI:    10,
  WIF:    10, JUP:    10,
};

export const driftAdapter = {
  venue: 'drift',

  async openTrade(tradeParams) {
    return openPositionWithRetry(tradeParams);
  },

  async closeTrade(asset) {
    return closePosition(asset);
  },

  async closeAllTrades() {
    return closeAllPositions();
  },

  async reduceTrade(asset, baseToReduce) {
    return reducePosition(asset, baseToReduce);
  },

  async updateTpSl(asset, tp, sl) {
    return updateTpSl(asset, tp, sl);
  },

  async getBalance() {
    return getWalletBalance();
  },

  /**
   * Returns a live account snapshot for risk decisions.
   * @returns {Promise<{ freeCollateral: number, totalEquity: number, positionCount: number, totalNotional: number }>}
   */
  async getAccountSnapshot() {
    return getLiveAccountSnapshot();
  },

  /**
   * Returns all asset symbols supported by this venue.
   * @returns {string[]}
   */
  getSupportedAssets() {
    return Object.keys(DRIFT_MARKET_INDEX);
  },

  /**
   * Returns order size limits for the given asset on this venue.
   * Converts the asset symbol to the Drift marketIndex internally.
   * @param {string} asset - e.g. 'SOL', 'BTC'
   * @returns {{ minBase: number, stepBase: number }}
   */
  getMarketLimits(asset) {
    const marketIndex = DRIFT_MARKET_INDEX[asset?.toUpperCase()];
    if (marketIndex === undefined) {
      throw new Error(`[DRIFT] Ativo não suportado: ${asset}`);
    }
    return _getMarketLimitsByIndex(marketIndex);
  },

  /**
   * Returns the platform maximum leverage for the given asset on this venue.
   * @param {string} asset - e.g. 'SOL', 'BTC'
   * @returns {number}
   */
  getPlatformMaxLeverage(asset) {
    return DRIFT_MAX_LEVERAGE_BY_ASSET[asset?.toUpperCase()] ?? 10;
  },
};
