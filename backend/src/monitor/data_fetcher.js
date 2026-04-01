// src/monitor/data_fetcher.js
// Busca dados em tempo real do Drift Protocol (leitura via WebSocket subscription)
// Após cada fetch, atualiza o state store central.

import {
  BN,
  QUOTE_PRECISION, BASE_PRECISION, PRICE_PRECISION, MARGIN_PRECISION,
  calculateMarketMarginRatio,
} from '@drift-labs/sdk';
import { initDriftClient } from '../executor/drift_executor.js';
import { config }          from '../config/index.js';
import logger              from '../utils/logger.js';
import state               from '../core/state.js';

// ── Helper: leverage = notional / collateral ─────────────────────────────────
// Usado para validação e log. Fonte primária é pos.maxMarginRatio via SDK.
function calculateLeverage(notional, collateral) {
  if (!notional || !collateral || collateral === 0) return null;
  return notional / collateral;
}

// Índice → símbolo (espelho do drift_executor.js — validado via MainnetPerpMarkets 2026-03)
const ASSET_BY_INDEX = {
  0:  'SOL',    1:  'BTC',  2: 'ETH', 3: 'APT',
  4:  '1MBONK', 5:  'POL',
  6:  'ARB',    7:  'DOGE', 8: 'BNB', 9: 'SUI',
  23: 'WIF',    24: 'JUP',
};

const Q_PREC = QUOTE_PRECISION.toNumber(); // 1_000_000
const B_PREC = BASE_PRECISION.toNumber();  // 1_000_000_000
const P_PREC = PRICE_PRECISION.toNumber(); // 1_000_000

const ZERO = new BN(0);

// ── Dados reais do Drift ──────────────────────────────────────────────────────
async function fetchLiveData() {
  const { driftClient, driftUser } = await initDriftClient();

  // totalEquity = saldo total da conta (depósito + PnL realizado)
  // getFreeCollateral/marginUsed calculados via SDK podem retornar valores errados
  // se o oracle data ainda não foi carregado pelo WebSocket. Usamos totalEquity
  // do SDK (sem depender de oracle) e calculamos marginUsed abaixo, por posição.
  const totalEquity = driftUser.getTotalCollateral().toNumber() / Q_PREC;
  // NOTA: getUnrealizedPNL(true) sem oracle data falha se os preços
  // ainda não foram carregados pelo WebSocket (BN.mul recebe undefined).
  // O unrealizedPnl é calculado abaixo somando o PnL de cada posição,
  // onde passamos o oracleData explicitamente.

  // Posições e ordens abertas
  const userAccount    = driftUser.getUserAccount();
  // maxMarginRatio = alavancagem escolhida pelo usuário (ex: 1000 = 10% = 10x)
  // Este campo é gravado pela Drift UI quando o usuário define o leverage.
  const maxMarginRatio = userAccount.maxMarginRatio ?? 0;
  const perpPositions  = driftUser.getActivePerpPositions();
  // Ordens ativas: orderId !== 0 indica slot ocupado
  const activeOrders  = userAccount.orders.filter(o => o.orderId !== 0);

  const positions = [];
  let totalMarginUsed = 0; // acumulado por posição com oracle data confirmado

  for (const pos of perpPositions) {
    const { marketIndex } = pos;
    const asset = ASSET_BY_INDEX[marketIndex] ?? `MKT_${marketIndex}`;

    // Preço oracle (em tempo real via WS subscription)
    // Oracle data pode ainda não ter chegado via WS — guard defensivo
    const oracleData = driftClient.getOracleDataForPerpMarket(marketIndex);
    if (!oracleData?.price) continue; // dados ainda não carregados, pula posição

    const markPrice = oracleData.price.toNumber() / P_PREC;

    // Direção: baseAssetAmount positivo → LONG
    const isLong    = pos.baseAssetAmount.gt(ZERO);
    const direction = isLong ? 'LONG' : 'SHORT';

    // Tamanho em tokens e USD
    const sizeBase = Math.abs(pos.baseAssetAmount.toNumber()) / B_PREC;
    const sizeUSD  = sizeBase * markPrice;

    // Preço de entrada = custo total / quantidade
    const quoteEntryUSD = Math.abs(pos.quoteEntryAmount.toNumber()) / Q_PREC;
    const entryPrice    = sizeBase > 0 ? quoteEntryUSD / sizeBase : markPrice;

    // PnL por posição — cálculo direto (mark vs entry), sem depender de SDK interno
    const pnlUSD = isLong
      ? (markPrice - entryPrice) * sizeBase
      : (entryPrice - markPrice) * sizeBase;
    const pnlPct = quoteEntryUSD > 0 ? (pnlUSD / quoteEntryUSD) * 100 : 0;

    // ── Leverage por posição ───────────────────────────────────────────────
    // REGRA: leverage da posição ≠ max leverage do mercado.
    //
    // pos.maxMarginRatio = ratio configurado POR POSIÇÃO (ex: 1000 = 10x).
    // userAccount.maxMarginRatio = ratio global da conta (fallback).
    // SDK pattern (user.js:721): Math.max(pos.maxMarginRatio, account.maxMarginRatio)
    //
    // BUG ANTERIOR: usava apenas account.maxMarginRatio (= 0 se não configurado),
    // fazendo calculateMarketMarginRatio retornar o mínimo do mercado (500 = 20x SOL).
    let leverage   = 0;
    let marginType = 'ISOLATED'; // Drift perp sempre usa margem isolada por padrão
    try {
      const perpMarket  = driftClient.getPerpMarketAccount(marketIndex);
      const posRatio    = pos.maxMarginRatio ?? 0;   // per-position — fonte correta
      const acctRatio   = maxMarginRatio;             // account-level — fallback
      const userCustom  = Math.max(posRatio, acctRatio); // padrão do SDK
      const marginRatio = calculateMarketMarginRatio(
        perpMarket,
        pos.baseAssetAmount.abs(),
        'Initial',
        userCustom, // 0 se não configurado → usa mínimo do mercado
      );
      leverage = marginRatio > 0 ? MARGIN_PRECISION.toNumber() / marginRatio : 0;
    } catch (_) {
      // Fallback: notional / equity (impreciso, mas melhor que 0)
      leverage = totalEquity > 0 ? sizeUSD / totalEquity : 0;
    }

    // collateralUSD = margem inicial + PnL atual (o que Drift UI exibe como "Margin")
    const initialMargin = leverage > 0 ? sizeUSD / leverage : 0;
    const collateralUSD = initialMargin + pnlUSD;
    totalMarginUsed += initialMargin;

    const leverageCheck = calculateLeverage(sizeUSD, collateralUSD);
    logger.debug(
      `[LEV] ${asset} notional=${sizeUSD.toFixed(2)} collateral=${collateralUSD.toFixed(2)}` +
      ` → leverage=${leverage.toFixed(2)}x (check=${leverageCheck?.toFixed(2)}x)` +
      ` posRatio=${pos.maxMarginRatio ?? 0} acctRatio=${maxMarginRatio}`
    );

    logger.debug(`[MONITOR] ${asset} (idx ${marketIndex}) ${direction}`, {
      entryPrice:  entryPrice.toFixed(4),
      markPrice:   markPrice.toFixed(4),
      sizeBase:    sizeBase.toFixed(6),
      sizeUSD:     sizeUSD.toFixed(2),
      pnlUSD:      pnlUSD.toFixed(4),
      pnlPct:      pnlPct.toFixed(2) + '%',
      leverage:    leverage.toFixed(2) + 'x',
    });

    // TP / SL: ordens trigger limit neste mercado
    let tp = null, sl = null;
    for (const order of activeOrders) {
      if (order.marketIndex !== marketIndex) continue;
      if (!('triggerLimit' in order.orderType)) continue;

      const trigPrice = order.triggerPrice.toNumber() / P_PREC;
      const isAbove   = 'above' in order.triggerCondition;

      if (isLong) {
        if (isAbove) tp = trigPrice;  // TP de LONG: trigger acima
        else         sl = trigPrice;  // SL de LONG: trigger abaixo
      } else {
        if (!isAbove) tp = trigPrice; // TP de SHORT: trigger abaixo
        else          sl = trigPrice; // SL de SHORT: trigger acima
      }
    }

    positions.push({
      asset,
      market:       `${asset}-PERP`,
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

  // Ordenar por PnL (melhor primeiro)
  positions.sort((a, b) => b.pnlUSD - a.pnlUSD);

  // unrealizedPnl = soma do PnL de cada posição (oracle data já usado acima)
  const unrealizedPnl  = positions.reduce((sum, p) => sum + p.pnlUSD, 0);
  // marginUsed e freeCollateral calculados por posição (oracle data confirmado)
  const marginUsed     = totalMarginUsed;
  const freeCollateral = Math.max(0, totalEquity - marginUsed);

  const result = {
    timestamp:  new Date(),
    isPaper:    false,
    account:    { freeCollateral, totalEquity, marginUsed, unrealizedPnl },
    positions,
  };

  // Alimenta o state store central (web + control bot lêem daqui)
  state.updateAccount({ freeCollateral, totalEquity, marginUsed, unrealizedPnl, isPaper: false });
  state.updatePositions(positions);

  return result;
}

// ── Mock para paper trading ───────────────────────────────────────────────────
// Simula preços oscillantes para demonstrar todas as features da UI
function buildMockData() {
  const t = Date.now();

  const solPrice = 145 + Math.sin(t / 30_000) * 6;
  const ethPrice = 2340 + Math.sin(t / 25_000) * 55;

  const solEntry = 142.50;
  const ethEntry = 2_360.00;
  const solBase  = 3.45;
  const ethBase  = 0.214;

  const solPnl = (solPrice - solEntry) * solBase;
  const ethPnl = (ethEntry - ethPrice) * ethBase; // SHORT

  const totalEquity    = 1_000 + solPnl + ethPnl;
  const marginUsed     = 650;
  const freeCollateral = Math.max(0, totalEquity - marginUsed);
  const unrealizedPnl  = solPnl + ethPnl;

  const positions = [
    {
      asset: 'SOL', market: 'SOL-PERP', direction: 'LONG', marketIndex: 0,
      sizeBase: solBase, sizeUSD: solBase * solPrice, collateralUSD: (solBase * solPrice) / 5,
      entryPrice: solEntry, markPrice: solPrice,
      tp: 158.00, sl: 138.00, leverage: 5,
      pnlUSD: solPnl,
      pnlPct: (solPnl / (solEntry * solBase)) * 100,
      isProfit: solPnl >= 0,
    },
    {
      asset: 'ETH', market: 'ETH-PERP', direction: 'SHORT', marketIndex: 2,
      sizeBase: ethBase, sizeUSD: ethBase * ethPrice, collateralUSD: (ethBase * ethPrice) / 5,
      entryPrice: ethEntry, markPrice: ethPrice,
      tp: 2_180.00, sl: 2_430.00, leverage: 5,
      pnlUSD: ethPnl,
      pnlPct: (ethPnl / (ethEntry * ethBase)) * 100,
      isProfit: ethPnl >= 0,
    },
  ].sort((a, b) => b.pnlUSD - a.pnlUSD);

  const result = {
    timestamp:  new Date(),
    isPaper:    true,
    account:    { freeCollateral, totalEquity, marginUsed, unrealizedPnl },
    positions,
  };

  // Alimenta o state store central
  state.updateAccount({ freeCollateral, totalEquity, marginUsed, unrealizedPnl, isPaper: true });
  state.updatePositions(positions);

  return result;
}

// ── Exportação pública ────────────────────────────────────────────────────────
export async function fetchAccountData() {
  if (config.trading.paperMode) return buildMockData();
  return fetchLiveData();
}