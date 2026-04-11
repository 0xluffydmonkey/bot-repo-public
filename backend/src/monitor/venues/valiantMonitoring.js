// src/monitor/venues/valiantMonitoring.js
// Monitoring adapter for Valiant — reuses the same client as the execution adapter.
// No separate auth or connection needed: /info endpoint is public.

import {
  getAccountSnapshot  as fetchAccountSnapshot,
  getPositions        as fetchOpenPositions,
} from '../../trading/clients/hyperliquidClient.js';

export const valiantMonitoringAdapter = {
  venue: 'valiant',

  /**
   * Returns venue-agnostic account summary.
   * @returns {Promise<{ freeCollateral: number, totalEquity: number, positionCount: number, totalNotional: number }>}
   */
  async fetchAccountSummary() {
    return fetchAccountSnapshot();
  },

  /**
   * Returns open positions in the venue-agnostic format used by the dashboard,
   * PositionManager, ManualTradeService, and closeVenueResolver.
   *
   * Shape per position:
   *   { asset, direction, size, sizeBase, sizeUSD, entryPrice, markPrice,
   *     pnlUSD, pnlPct, collateralUSD, marginType, leverage, venue }
   *
   * Required fields and why:
   *   direction     — PositionManager guard, Telegram screens, callbacks venue-lookup
   *   sizeBase      — ManualTradeService.reduceManualTrade reads pos.sizeBase
   *   sizeUSD       — screens.js "Nocional" line in position detail
   *   pnlUSD        — screens.js position list and detail (all callers use pnlUSD)
   *   pnlPct        — PositionManager uses this for profit alerts and trailing stop activation
   *   collateralUSD — screens.js "Colateral" line in position detail
   *   venue         — closeVenueResolver and PositionManager use this for routing
   *
   * @returns {Promise<Array>}
   */
  async fetchPositions() {
    const raw = await fetchOpenPositions();

    return raw.map((p) => {
      const pos     = p.position;
      const szi     = parseFloat(pos.szi ?? '0');
      const absSize = Math.abs(szi);

      // Normalize coin name: strip -PERP suffix and uppercase for consistent keying
      // across PositionManager, closeVenueResolver, and ManualTradeService lookups.
      const asset = pos.coin.replace(/-PERP$/i, '').toUpperCase();

      // sizeUSD (notional): positionValue is mark-to-market notional from Hyperliquid
      const sizeUSD   = Math.abs(parseFloat(pos.positionValue ?? '0'));
      const markPrice = absSize > 0 ? sizeUSD / absSize : 0;

      const entryPrice = parseFloat(pos.entryPx ?? '0');
      const leverage   = parseFloat(pos.leverage?.value ?? '1');
      const pnlUSD     = parseFloat(pos.unrealizedPnl ?? '0');

      // collateralUSD: initial margin at entry (notional / leverage).
      // Used by Telegram position detail screen (screens.js:130).
      const collateralUSD = leverage > 0 && entryPrice > 0
        ? (absSize * entryPrice) / leverage
        : 0;

      // pnlPct: unrealized PnL as percentage of collateral at entry.
      // PositionManager uses this to activate profit alerts and trailing stops.
      const pnlPct = collateralUSD > 0 ? (pnlUSD / collateralUSD) * 100 : 0;

      return {
        asset,
        direction:    szi > 0 ? 'LONG' : 'SHORT', // field name used by all consumers
        size:         absSize,
        sizeBase:     absSize,        // ManualTradeService.reduceManualTrade reads pos.sizeBase
        sizeUSD,                      // screens.js "Nocional" line
        entryPrice,
        markPrice,
        pnlUSD,                       // screens.js, keyboards.js — all consumers use pnlUSD
        pnlPct,                       // PositionManager profit alerts and trailing stop
        collateralUSD,                // screens.js "Colateral" line
        marginType:   'ISOLATED',     // Hyperliquid perps are always isolated; prevents undefined in screens
        leverage,
        venue:        'valiant',      // PositionManager, closeVenueResolver routing
      };
    });
  },
};
