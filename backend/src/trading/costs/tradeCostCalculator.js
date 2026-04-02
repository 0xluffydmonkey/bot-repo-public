// src/trading/costs/tradeCostCalculator.js
// Unified USD cost calculator — routes to the venue-specific cost model.
//
// Usage:
//   import { calculateTradeCost } from './costs/tradeCostCalculator.js';
//   const cost = await calculateTradeCost({
//     venue:       'drift',  // or 'jupiter' | 'phoenix'
//     asset:       'SOL',
//     notionalUSD: 1000,
//     direction:   'LONG',
//     hoursHeld:   8,        // optional, default 8
//   });
//
// Output:
//   {
//     venue:          'drift',
//     openFeeUsd:     0.50,
//     closeFeeUsd:    0.50,
//     carryCostUsd:   0.80,
//     priceImpactUsd: 0.00,
//     totalCostUsd:   1.80,
//     meta: { ... }
//   }

import { driftCostModel }   from './driftCostModel.js';
import { jupiterCostModel } from './jupiterCostModel.js';
import { phoenixCostModel } from './phoenixCostModel.js';
import logger from '../../utils/logger.js';

const COST_MODELS = {
  drift:   driftCostModel,
  jupiter: jupiterCostModel,
  phoenix: phoenixCostModel,
};

/**
 * Calculate total estimated trade cost in USD for a given venue.
 *
 * @param {object} params
 * @param {string} params.venue         - 'drift' | 'jupiter' | 'phoenix'
 * @param {string} params.asset         - e.g. 'SOL', 'BTC', 'ETH'
 * @param {number} params.notionalUSD   - position notional value in USD
 * @param {string} params.direction     - 'LONG' | 'SHORT'
 * @param {number} [params.hoursHeld=8] - estimated hold duration in hours
 * @returns {Promise<object|null>} cost breakdown or null on error
 */
export async function calculateTradeCost({ venue, asset, notionalUSD, direction, hoursHeld = 8 }) {
  const resolvedVenue = (venue ?? 'drift').toLowerCase();
  const model = COST_MODELS[resolvedVenue];

  if (!model) {
    logger.warn(`[COST] Venue desconhecida: "${resolvedVenue}" — nenhum modelo de custo disponível`);
    return null;
  }

  try {
    const cost = await model.calculate({ asset, notionalUSD, direction, hoursHeld });

    if (cost === null || cost === undefined) {
      logger.warn(`[COST] Modelo de custo retornou null para venue ${resolvedVenue} — custo não disponível`);
      return null;
    }

    if (cost.totalCostUsd !== null) {
      logger.info(`[COST] ${resolvedVenue.toUpperCase()} — estimativa de custo`, {
        event:  'cost_estimated',
        venue:  resolvedVenue,
        asset,
        open:   cost.openFeeUsd,
        close:  cost.closeFeeUsd,
        carry:  cost.carryCostUsd,
        impact: cost.priceImpactUsd,
        total:  cost.totalCostUsd,
      });
    }

    // Surface notes at warn level so operators see uncertainty without noise
    if (Array.isArray(cost.notes) && cost.notes.length > 0) {
      logger.warn(`[COST] Notas de estimativa (${resolvedVenue}):`, { notes: cost.notes });
    }

    return cost;
  } catch (err) {
    logger.warn(`[COST] Erro ao calcular custo (${resolvedVenue}): ${err.message}`);
    return null;
  }
}
