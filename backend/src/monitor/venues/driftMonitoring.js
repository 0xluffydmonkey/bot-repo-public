// src/monitor/venues/driftMonitoring.js
// Drift-specific monitoring adapter.

import {
  BN,
  QUOTE_PRECISION, BASE_PRECISION, PRICE_PRECISION, MARGIN_PRECISION,
  calculateMarketMarginRatio,
} from '@drift-labs/sdk';
import { initDriftClient } from '../../executor/drift_executor.js';
import logger from '../../utils/logger.js';

const ASSET_BY_INDEX = {
  0:  'SOL',    1:  'BTC',  2: 'ETH', 3: 'APT',
  4:  '1MBONK', 5:  'POL',
  6:  'ARB',    7:  'DOGE', 8: 'BNB', 9: 'SUI',
  23: 'WIF',    24: 'JUP',
};

const Q_PREC = QUOTE_PRECISION.toNumber();
const B_PREC = BASE_PRECISION.toNumber();
const P_PREC = PRICE_PRECISION.toNumber();
const ZERO = new BN(0);

function calculateLeverage(notional, collateral) {
  if (!notional || !collateral || collateral === 0) return null;
  return notional / collateral;
}

async function fetchSnapshot() {
  const { driftClient, driftUser } = await initDriftClient();

  const totalEquity = driftUser.getTotalCollateral().toNumber() / Q_PREC;
  const userAccount = driftUser.getUserAccount();
  const maxMarginRatio = userAccount.maxMarginRatio ?? 0;
  const perpPositions = driftUser.getActivePerpPositions();
  const activeOrders = userAccount.orders.filter((order) => order.orderId !== 0);

  const positions = [];
  let totalMarginUsed = 0;

  for (const pos of perpPositions) {
    const { marketIndex } = pos;
    const asset = ASSET_BY_INDEX[marketIndex] ?? `MKT_${marketIndex}`;

    const oracleData = driftClient.getOracleDataForPerpMarket(marketIndex);
    if (!oracleData?.price) continue;

    const markPrice = oracleData.price.toNumber() / P_PREC;
    const isLong = pos.baseAssetAmount.gt(ZERO);
    const direction = isLong ? 'LONG' : 'SHORT';

    const sizeBase = Math.abs(pos.baseAssetAmount.toNumber()) / B_PREC;
    const sizeUSD = sizeBase * markPrice;

    const quoteEntryUSD = Math.abs(pos.quoteEntryAmount.toNumber()) / Q_PREC;
    const entryPrice = sizeBase > 0 ? quoteEntryUSD / sizeBase : markPrice;

    const pnlUSD = isLong
      ? (markPrice - entryPrice) * sizeBase
      : (entryPrice - markPrice) * sizeBase;
    const pnlPct = quoteEntryUSD > 0 ? (pnlUSD / quoteEntryUSD) * 100 : 0;

    let leverage = 0;
    const marginType = 'ISOLATED';
    try {
      const perpMarket = driftClient.getPerpMarketAccount(marketIndex);
      const posRatio = pos.maxMarginRatio ?? 0;
      const acctRatio = maxMarginRatio;
      const userCustom = Math.max(posRatio, acctRatio);
      const marginRatio = calculateMarketMarginRatio(
        perpMarket,
        pos.baseAssetAmount.abs(),
        'Initial',
        userCustom,
      );
      leverage = marginRatio > 0 ? MARGIN_PRECISION.toNumber() / marginRatio : 0;
    } catch (_) {
      leverage = totalEquity > 0 ? sizeUSD / totalEquity : 0;
    }

    const initialMargin = leverage > 0 ? sizeUSD / leverage : 0;
    const collateralUSD = initialMargin + pnlUSD;
    totalMarginUsed += initialMargin;

    const leverageCheck = calculateLeverage(sizeUSD, collateralUSD);
    logger.debug(
      `[LEV] ${asset} notional=${sizeUSD.toFixed(2)} collateral=${collateralUSD.toFixed(2)}` +
      ` -> leverage=${leverage.toFixed(2)}x (check=${leverageCheck?.toFixed(2)}x)` +
      ` posRatio=${pos.maxMarginRatio ?? 0} acctRatio=${maxMarginRatio}`
    );

    logger.debug(`[MONITOR] ${asset} (idx ${marketIndex}) ${direction}`, {
      entryPrice: entryPrice.toFixed(4),
      markPrice: markPrice.toFixed(4),
      sizeBase: sizeBase.toFixed(6),
      sizeUSD: sizeUSD.toFixed(2),
      pnlUSD: pnlUSD.toFixed(4),
      pnlPct: `${pnlPct.toFixed(2)}%`,
      leverage: `${leverage.toFixed(2)}x`,
    });

    let tp = null;
    let sl = null;
    for (const order of activeOrders) {
      if (order.marketIndex !== marketIndex) continue;
      if (!('triggerLimit' in order.orderType)) continue;

      const trigPrice = order.triggerPrice.toNumber() / P_PREC;
      const isAbove = 'above' in order.triggerCondition;

      if (isLong) {
        if (isAbove) tp = trigPrice;
        else sl = trigPrice;
      } else {
        if (!isAbove) tp = trigPrice;
        else sl = trigPrice;
      }
    }

    positions.push({
      venue: 'drift',
      asset,
      market: `${asset}-PERP`,
      direction,
      marginType,
      marketIndex,
      sizeBase,
      sizeUSD,
      collateralUSD,
      entryPrice,
      markPrice,
      tp,
      sl,
      leverage,
      pnlUSD,
      pnlPct,
      isProfit: pnlUSD >= 0,
    });
  }

  positions.sort((a, b) => b.pnlUSD - a.pnlUSD);

  const unrealizedPnl = positions.reduce((sum, position) => sum + position.pnlUSD, 0);
  const marginUsed = totalMarginUsed;
  const freeCollateral = Math.max(0, totalEquity - marginUsed);

  return {
    account: {
      freeCollateral,
      totalEquity,
      marginUsed,
      unrealizedPnl,
      isPaper: false,
    },
    positions,
  };
}

export const driftMonitoringAdapter = {
  venue: 'drift',

  async fetchSnapshot() {
    return fetchSnapshot();
  },

  async fetchAccountSummary() {
    return (await fetchSnapshot()).account;
  },

  async fetchPositions() {
    return (await fetchSnapshot()).positions;
  },
};
