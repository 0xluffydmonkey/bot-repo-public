// src/trading/costs/driftCostModel.js
// Calculates real trade costs in USD for Drift Protocol positions.
//
// Fee data sources (in priority order):
//   1. Live: driftClient.getPerpMarketAccount() — taker fee, funding rate
//   2. Fallback: known baseline rates for retail users (tier 1)
//
// Drift fee structure (tier 1, < $1M 30-day volume, as of 2026):
//   Taker fee:       5 bps (0.05%) on notional
//   Maker rebate:   -2 bps (-0.02%) on notional  [not modeled here — bot is taker]
//   Insurance fee:   1 bps (0.01%) on notional   [included in taker fee on-chain]
//
// Reference: https://docs.drift.trade/trading/trading-fees

import { PRICE_PRECISION } from '@drift-labs/sdk';
import { initDriftClient, DRIFT_MARKET_INDEX } from '../../executor/drift_executor.js';
import logger from '../../utils/logger.js';

// Drift SDK fee precision constant
const FEE_PRECISION = 1_000_000;

// Fallback rates when SDK is unavailable (retail tier 1)
const FALLBACK_TAKER_FEE_PCT      = 0.0005;  // 5 bps
const FALLBACK_FUNDING_RATE_HOURLY = 0.0001; // 1 bps/hour (varies widely in practice)

/**
 * Fetches live fee data from the Drift SDK.
 * Returns null fields for values that could not be fetched.
 *
 * @param {number} marketIndex
 * @returns {Promise<{ takerFeePct: number, fundingRatePerHour: number }>}
 */
async function fetchLiveFees(marketIndex) {
  try {
    const { driftClient } = await initDriftClient();
    const market = driftClient.getPerpMarketAccount(marketIndex);

    if (!market) return null;

    let takerFeePct = FALLBACK_TAKER_FEE_PCT;
    let fundingRatePerHour = FALLBACK_FUNDING_RATE_HOURLY;

    // Taker fee from market fee structure
    // Field: market.amm.takerFee (BN, scaled by FEE_PRECISION = 1_000_000)
    if (market.amm?.takerFee) {
      const raw = market.amm.takerFee.toNumber();
      if (raw > 0) takerFeePct = raw / FEE_PRECISION;
    }

    // Funding rate: lastFundingRate is per funding period (1 hour on Drift)
    // Scaled by PRICE_PRECISION (10^6), represents quote/base rate
    // To get % per hour: rate / PRICE_PRECISION
    if (market.amm?.lastFundingRate) {
      const rawRate = Math.abs(market.amm.lastFundingRate.toNumber());
      const P = PRICE_PRECISION.toNumber();
      // Funding period is 1 hour on Drift mainnet
      const periodHours = 1;
      const ratePerHour = rawRate / P / periodHours;
      if (ratePerHour > 0) fundingRatePerHour = ratePerHour;
    }

    return { takerFeePct, fundingRatePerHour, source: 'live_sdk' };
  } catch (err) {
    logger.debug(`[COST/DRIFT] SDK indisponível — usando taxas fallback: ${err.message}`);
    return null;
  }
}

export const driftCostModel = {
  /**
   * Calculate the estimated USD cost of a Drift Perp trade.
   *
   * @param {object} params
   * @param {string} params.asset         - e.g. 'SOL', 'BTC'
   * @param {number} params.notionalUSD   - position notional value in USD
   * @param {string} params.direction     - 'LONG' | 'SHORT'
   * @param {number} [params.hoursHeld=8] - estimated hold duration in hours
   * @returns {Promise<object>} cost breakdown
   */
  async calculate({ asset, notionalUSD, direction, hoursHeld = 8 }) {
    const marketIndex = DRIFT_MARKET_INDEX[asset?.toUpperCase()];

    // Attempt live fee fetch; fall back to known rates
    const liveFees = marketIndex !== undefined
      ? await fetchLiveFees(marketIndex)
      : null;

    const usedFallbackFee     = !liveFees || liveFees.takerFeePct      === FALLBACK_TAKER_FEE_PCT;
    const usedFallbackFunding = !liveFees || liveFees.fundingRatePerHour === FALLBACK_FUNDING_RATE_HOURLY;

    const takerFeePct       = liveFees?.takerFeePct       ?? FALLBACK_TAKER_FEE_PCT;
    const fundingRateHourly = liveFees?.fundingRatePerHour ?? FALLBACK_FUNDING_RATE_HOURLY;
    const feeSource         = liveFees?.source ?? 'fallback_tier1';

    // Explicit notes: make uncertainty visible to callers
    const notes = [];
    if (usedFallbackFee)     notes.push('Base fee: fallback (tier 1, 5 bps) — SDK unavailable or field missing');
    if (usedFallbackFunding) notes.push('Funding rate: estimated (1 bps/hr) — live rate unavailable');
    if (marketIndex === undefined) notes.push(`Asset "${asset}" not in DRIFT_MARKET_INDEX — fees may be inaccurate`);

    // Drift market orders fill at oracle price — price impact is negligible
    const priceImpactPct = 0;

    const openFeeUsd     = notionalUSD * takerFeePct;
    const closeFeeUsd    = notionalUSD * takerFeePct;
    const carryCostUsd   = notionalUSD * fundingRateHourly * hoursHeld;
    const priceImpactUsd = notionalUSD * priceImpactPct;
    const totalCostUsd   = openFeeUsd + closeFeeUsd + carryCostUsd + priceImpactUsd;

    logger.debug(`[COST/DRIFT] event:cost_estimated`, {
      event: 'cost_estimated', venue: 'drift', asset, totalCostUsd: +totalCostUsd.toFixed(4), notes,
    });

    return {
      venue:          'drift',
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
        takerFeePct,
        fundingRateHourly,
        feeSource,
        marketIndex: marketIndex ?? 'unknown',
      },
    };
  },
};
