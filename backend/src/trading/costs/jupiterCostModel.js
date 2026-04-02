// src/trading/costs/jupiterCostModel.js
// Calculates real trade costs in USD for Jupiter Perps positions.
//
// Jupiter Perps fee structure (as of 2026):
//   Open fee:   6 bps (0.06%) on notional
//   Close fee:  6 bps (0.06%) on notional
//   Borrow fee: variable — fetched from on-chain custody data
//   Price impact: estimated from position size vs pool depth
//
// Reference: https://dev.jup.ag/docs/perps

import fetch from 'node-fetch';
import logger from '../../utils/logger.js';

// Fixed protocol fee (documented, stable)
const JUPITER_OPEN_CLOSE_FEE_PCT = 0.0006; // 6 bps

// Jupiter Perps stats API (non-sensitive, public endpoint)
function getStatsUrl() {
  const base = (process.env.JUPITER_API_BASE_URL ?? 'https://api.jup.ag').replace(/\/$/, '');
  return `${base}/perps/stats`;
}

/**
 * Attempts to fetch the current borrow rate for an asset from Jupiter Perps.
 *
 * Jupiter Perps stores borrow rates in on-chain custody accounts.
 * A public stats endpoint may expose these; this implementation queries it
 * and falls back to 0 if unavailable.
 *
 * TODO: When Jupiter Perps exposes a stable borrow-rate endpoint, implement:
 *   GET ${base}/perps/custody/${assetMint} → custody.borrowRate.hourly
 *   or parse from the on-chain custody account directly.
 *
 * @param {string} asset - e.g. 'SOL'
 * @returns {Promise<number>} borrow rate per hour as a decimal (e.g. 0.0001 = 1 bps/hr)
 */
// Returns { rate: number, fromApi: boolean }
async function fetchBorrowRatePerHour(asset) {
  try {
    const url = getStatsUrl();
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return { rate: 0, fromApi: false };

    const data = await res.json();

    // TODO: Parse the asset-specific borrow rate from the response.
    // The exact field path depends on the API schema (not yet stable).
    // Expected shape (hypothetical, update when documented):
    //   data.markets[asset].borrowRate.hourly
    const assetData = data?.markets?.[asset.toUpperCase()];
    if (assetData?.borrowRate?.hourly) {
      return { rate: parseFloat(assetData.borrowRate.hourly), fromApi: true };
    }
    return { rate: 0, fromApi: false };
  } catch (err) {
    logger.debug(`[COST/JUPITER] Borrow rate indisponível — usando 0: ${err.message}`);
    return { rate: 0, fromApi: false };
  }
}

export const jupiterCostModel = {
  /**
   * Calculate the estimated USD cost of a Jupiter Perps trade.
   *
   * @param {object} params
   * @param {string} params.asset         - e.g. 'SOL', 'BTC'
   * @param {number} params.notionalUSD   - position notional value in USD
   * @param {string} params.direction     - 'LONG' | 'SHORT'
   * @param {number} [params.hoursHeld=8] - estimated hold duration in hours
   * @returns {Promise<object>} cost breakdown
   */
  async calculate({ asset, notionalUSD, direction, hoursHeld = 8 }) {
    const openFeeUsd  = notionalUSD * JUPITER_OPEN_CLOSE_FEE_PCT;
    const closeFeeUsd = notionalUSD * JUPITER_OPEN_CLOSE_FEE_PCT;

    // Borrow rate: fetch live, default to 0 if unavailable
    const { rate: borrowRatePerHour, fromApi } = await fetchBorrowRatePerHour(asset);

    // Price impact: Jupiter Perps uses a virtual AMM — impact varies by pool depth
    // TODO: Fetch pool depth from Jupiter API and compute actual impact
    const priceImpactUsd = 0;

    // Explicit notes: surface uncertainty to callers
    const notes = ['Open/close fee: 6 bps (documented protocol fee)'];
    if (!fromApi) notes.push('Borrow/carry rate: defaulted to 0 — live rate endpoint not yet stable');
    notes.push('Price impact: not modeled — pool depth API pending');

    const carryCostUsd  = notionalUSD * borrowRatePerHour * hoursHeld;
    const totalCostUsd  = openFeeUsd + closeFeeUsd + carryCostUsd + priceImpactUsd;

    logger.debug(`[COST/JUPITER] event:cost_estimated`, {
      event: 'cost_estimated', venue: 'jupiter', asset, totalCostUsd: +totalCostUsd.toFixed(4), notes,
    });

    return {
      venue:          'jupiter',
      openFeeUsd:     +openFeeUsd.toFixed(4),
      closeFeeUsd:    +closeFeeUsd.toFixed(4),
      carryCostUsd:   +carryCostUsd.toFixed(4),
      priceImpactUsd: +priceImpactUsd.toFixed(4),
      totalCostUsd:   +totalCostUsd.toFixed(4),
      notes,
      meta: {
        asset,
        notionalUSD,
        hoursHeld,
        openCloseFeePct:  JUPITER_OPEN_CLOSE_FEE_PCT,
        borrowRatePerHour,
        borrowRateSource: fromApi ? 'live_api' : 'default_zero',
      },
    };
  },
};
