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
   * Returns open positions in the venue-agnostic format used by the dashboard.
   *
   * Shape per position:
   *   { asset, side, size, entryPrice, markPrice, pnl, leverage }
   *
   * @returns {Promise<Array>}
   */
  async fetchPositions() {
    const raw = await fetchOpenPositions();

    return raw.map((p) => {
      const pos     = p.position;
      const szi     = parseFloat(pos.szi ?? '0');
      const absSize = Math.abs(szi);

      // markPrice derived from positionValue / size (approximate)
      const positionValue = Math.abs(parseFloat(pos.positionValue ?? '0'));
      const markPrice     = absSize > 0 ? positionValue / absSize : 0;

      return {
        asset:      pos.coin,
        side:       szi > 0 ? 'LONG' : 'SHORT',
        size:       absSize,
        entryPrice: parseFloat(pos.entryPx ?? '0'),
        markPrice,
        pnl:        parseFloat(pos.unrealizedPnl ?? '0'),
        leverage:   parseFloat(pos.leverage?.value ?? '1'),
      };
    });
  },
};
