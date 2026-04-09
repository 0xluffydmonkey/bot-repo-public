// src/trading/PerpExecutionService.js
// Routes trade execution to the configured venue using VenueRegistry.

import logger from '../utils/logger.js';
import { config } from '../config/index.js';
import { venueRegistry } from '../venues/registerBuiltInVenues.js';
import { paperEngine } from './paperEngine.js';

function requireCapability(venue, capability, actionLabel) {
  if (!venueRegistry.supports(venue, capability)) {
    throw new Error(`[PERP] Venue "${venue}" nao suporta ${actionLabel}`);
  }
}

export const perpService = {
  /**
   * Open a trade on the configured venue.
   * @param {object} tradeParams - output of risk_manager.calculateTradeParams
   */
  async openTrade(tradeParams) {
    if (config.trading.paperMode) return paperEngine.openTrade(tradeParams);
    const venue = venueRegistry.getActiveVenue();
    requireCapability(venue, 'supportsOpenTrade', 'abertura de trade');
    const adapter = venueRegistry.getExecutionAdapter(venue);
    logger.info(`[PERP] Venue selecionada: ${venue.toUpperCase()}`);
    return adapter.openTrade(tradeParams);
  },

  /**
   * Close a specific position on the configured venue.
   * @param {string} asset - e.g. 'SOL', 'BTC'
   * @param {string|null} venueOverride - optional explicit venue for this close
   */
  async closeTrade(asset, venueOverride = null) {
    if (config.trading.paperMode) return paperEngine.closeTrade(asset);
    const venue = venueOverride ?? venueRegistry.getActiveVenue();
    requireCapability(venue, 'supportsCloseTrade', 'fechamento de trade');
    const adapter = venueRegistry.getExecutionAdapter(venue);
    return adapter.closeTrade(asset);
  },

  /**
   * Close all open positions on the configured venue.
   * @param {string|null} venueOverride - optional explicit venue for this close-all
   */
  async closeAllTrades(venueOverride = null) {
    if (config.trading.paperMode) return paperEngine.closeAllTrades();
    const venue = venueOverride ?? venueRegistry.getActiveVenue();
    requireCapability(venue, 'supportsCloseAll', 'close all');
    const adapter = venueRegistry.getExecutionAdapter(venue);
    return adapter.closeAllTrades();
  },

  /**
   * Update TP and/or SL orders for an open position.
   * Cancels existing TP/SL orders for the market and places new ones.
   * @param {string}      asset - e.g. 'SOL', 'BTC'
   * @param {number|null} tp    - new take profit price (null = leave unchanged)
   * @param {number|null} sl    - new stop loss price (null = leave unchanged)
   */
  async updateTpSl(asset, tp, sl) {
    if (config.trading.paperMode) return paperEngine.updateTpSl(asset, tp, sl);
    const venue = venueRegistry.getActiveVenue();
    requireCapability(venue, 'supportsUpdateTpSl', 'atualizacao de TP/SL');
    const adapter = venueRegistry.getExecutionAdapter(venue);
    return adapter.updateTpSl(asset, tp, sl);
  },

  /**
   * Returns the wallet balance (free collateral) for the active venue.
   * Used by executeSignal() and ManualTradeService before calling the risk manager.
   * @returns {Promise<number>} balance in USD
   */
  async getBalance() {
    if (config.trading.paperMode) return paperEngine.getBalance();
    const venue = venueRegistry.getActiveVenue();
    requireCapability(venue, 'supportsBalance', 'consulta de saldo');
    const adapter = venueRegistry.getExecutionAdapter(venue);
    return adapter.getBalance();
  },

  /**
   * Returns a live account snapshot for risk decisions.
   * Shape is venue-agnostic: { freeCollateral, totalEquity, positionCount, totalNotional }
   * Used by risk_manager.calculateTradeParams() in live mode.
   * @returns {Promise<{ freeCollateral: number, totalEquity: number, positionCount: number, totalNotional: number }>}
   */
  async getAccountSnapshot() {
    if (config.trading.paperMode) return paperEngine.getAccountSnapshot();
    const venue = venueRegistry.getActiveVenue();
    requireCapability(venue, 'supportsAccountSnapshot', 'snapshot de conta');
    const adapter = venueRegistry.getExecutionAdapter(venue);
    return adapter.getAccountSnapshot();
  },

  /**
   * Returns all asset symbols supported by the active venue.
   * @returns {string[]}
   */
  getSupportedAssets() {
    const venue = venueRegistry.getActiveVenue();
    requireCapability(venue, 'supportsSupportedAssets', 'lista de ativos suportados');
    const adapter = venueRegistry.getExecutionAdapter(venue);
    return adapter.getSupportedAssets();
  },

  /**
   * Returns order size limits for the given asset on the active venue.
   * @param {string} asset - e.g. 'SOL', 'BTC'
   * @returns {{ minBase: number, stepBase: number }}
   */
  getMarketLimits(asset) {
    const venue = venueRegistry.getActiveVenue();
    requireCapability(venue, 'supportsMarketLimits', 'market limits');
    const adapter = venueRegistry.getExecutionAdapter(venue);
    return adapter.getMarketLimits(asset);
  },

  /**
   * Returns the platform maximum leverage for the given asset on the active venue.
   * @param {string} asset - e.g. 'SOL', 'BTC'
   * @returns {number}
   */
  getPlatformMaxLeverage(asset) {
    const venue = venueRegistry.getActiveVenue();
    requireCapability(venue, 'supportsPlatformMaxLeverage', 'alavancagem maxima por ativo');
    const adapter = venueRegistry.getExecutionAdapter(venue);
    return adapter.getPlatformMaxLeverage(asset);
  },

  /**
   * Rounds baseAmount DOWN to the nearest multiple of stepBase.
   * Pure arithmetic — identical for all venues, so implemented here directly.
   * stepBase comes from getMarketLimits(asset).stepBase, which IS venue-specific.
   *
   * @param {number} baseAmount
   * @param {number} stepBase
   * @returns {number}
   */
  snapToStep(baseAmount, stepBase) {
    if (stepBase <= 0) return baseAmount;
    const factor = Math.round(1 / stepBase);
    return Math.floor(baseAmount * factor) / factor;
  },

  /** Returns the currently configured venue name. */
  getActiveVenue() {
    return venueRegistry.getActiveVenue();
  },

  getCapabilities() {
    return venueRegistry.getCapabilities();
  },
};
