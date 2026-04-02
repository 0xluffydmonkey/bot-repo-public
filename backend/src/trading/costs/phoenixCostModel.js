// src/trading/costs/phoenixCostModel.js
// Trade cost model for Phoenix Perps.
//
// ⚠️  STATUS: Phoenix Perps is in private beta.
//     Fee structure is not publicly documented.
//     Returns null values until Phoenix exits private beta.
//
// TODO: When Phoenix Perps publishes fee documentation:
//   1. Fetch maker/taker fees from their API or on-chain data
//   2. Fetch funding/borrow rate from their API
//   3. Implement calculate() with real values
//   Reference: https://docs.phoenix.trade/

import logger from '../../utils/logger.js';

export const phoenixCostModel = {
  /**
   * Calculate the estimated USD cost of a Phoenix Perps trade.
   *
   * All values are null until Phoenix exits private beta and documents fees.
   *
   * @param {object} params
   * @param {string} params.asset
   * @param {number} params.notionalUSD
   * @param {string} params.direction
   * @param {number} [params.hoursHeld]
   * @returns {Promise<object>}
   */
  async calculate({ asset, notionalUSD, direction, hoursHeld = 8 }) {
    logger.warn(
      `[COST/PHOENIX] Modelo de custo não implementado — Phoenix está em beta privado. ` +
      `Custos reais não disponíveis para ${asset}.`
    );

    const notes = [
      'Phoenix Perps in private beta — fee structure not publicly documented',
      'All cost values are null until Phoenix exits private beta',
      'Reference: https://docs.phoenix.trade/',
    ];

    return {
      venue:          'phoenix',
      openFeeUsd:     null,
      closeFeeUsd:    null,
      carryCostUsd:   null,
      priceImpactUsd: null,
      totalCostUsd:   null,
      notes,
      meta: {
        asset,
        notionalUSD,
        hoursHeld,
        status:  'not_implemented',
      },
    };
  },
};
