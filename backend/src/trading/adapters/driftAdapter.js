// src/trading/adapters/driftAdapter.js
// Thin wrapper around the existing Drift executor.
// Preserves all existing logic — only delegates to drift_executor.js.
// DO NOT add business logic here.

import {
  openPositionWithRetry,
  closePosition,
  closeAllPositions,
  getWalletBalance,
} from '../../executor/drift_executor.js';

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

  async getBalance() {
    return getWalletBalance();
  },
};
