// src/trading/PerpExecutionService.js
// Routes trade execution to the configured venue.
//
// Config (non-sensitive, set in .env):
//   PERP_OPEN_VENUE=drift   (allowed: drift | jupiter | phoenix)
//
// When PERP_OPEN_VENUE=drift (default), all calls delegate to the existing
// drift_executor.js with zero behavioral change.

import { driftAdapter }   from './adapters/driftAdapter.js';
import { jupiterPerpAdapter } from './adapters/jupiterPerpAdapter.js';
import { phoenixPerpAdapter } from './adapters/phoenixPerpAdapter.js';
import logger from '../utils/logger.js';

const VALID_VENUES = ['drift', 'jupiter', 'phoenix'];

function resolveVenue() {
  const raw = (process.env.PERP_OPEN_VENUE ?? 'drift').toLowerCase().trim();
  if (!VALID_VENUES.includes(raw)) {
    logger.warn(`[PERP] PERP_OPEN_VENUE="${raw}" inválido — usando drift como fallback seguro`);
    return 'drift';
  }
  return raw;
}

function selectAdapter(venue) {
  switch (venue) {
    case 'jupiter': return jupiterPerpAdapter;
    case 'phoenix': return phoenixPerpAdapter;
    case 'drift':
    default:        return driftAdapter;
  }
}

export const perpService = {
  /**
   * Open a trade on the configured venue.
   * @param {object} tradeParams - output of risk_manager.calculateTradeParams
   */
  async openTrade(tradeParams) {
    const venue   = resolveVenue();
    const adapter = selectAdapter(venue);
    logger.info(`[PERP] Venue selecionada: ${venue.toUpperCase()}`);
    return adapter.openTrade(tradeParams);
  },

  /**
   * Close a specific position on the configured venue.
   * @param {string} asset - e.g. 'SOL', 'BTC'
   */
  async closeTrade(asset) {
    const venue   = resolveVenue();
    const adapter = selectAdapter(venue);
    return adapter.closeTrade(asset);
  },

  /**
   * Close all open positions on the configured venue.
   */
  async closeAllTrades() {
    const venue   = resolveVenue();
    const adapter = selectAdapter(venue);
    return adapter.closeAllTrades();
  },

  /** Returns the currently configured venue name. */
  getActiveVenue() {
    return resolveVenue();
  },
};
