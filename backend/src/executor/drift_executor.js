// src/executor/drift_executor.js
import {
  DriftClient,
  User,
  initialize,
  PositionDirection,
  MarketType,
  BN,
  Wallet,
  PRICE_PRECISION,
  BASE_PRECISION,
  QUOTE_PRECISION,
  MARGIN_PRECISION,
  getMarketOrderParams,
  getTriggerLimitOrderParams,
  OrderTriggerCondition,
} from '@drift-labs/sdk';

import { AnchorProvider }  from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import logger              from '../utils/logger.js';
import { config }          from '../config/index.js';
import { loadWalletKeypair } from '../services/walletLoader.js';

// ─── Mapa símbolo → marketIndex (validado contra MainnetPerpMarkets do SDK) ──
// Conferido em 2026-03 via: MainnetPerpMarkets.forEach(m => console.log(m.marketIndex, m.baseAssetSymbol))
// Erros anteriores: BNB estava em 4 (real: 8), BONK em 24 (real: 4 como 1MBONK),
//                  JUP em 26 (real: 24), MATIC em 8 (real: 5 como POL).
export const DRIFT_MARKET_INDEX = {
  'SOL':    0,
  'BTC':    1,
  'ETH':    2,
  'APT':    3,
  '1MBONK': 4,  // Drift usa 1M multiplier; sinal pode vir como "BONK" ou "1MBONK"
  'BONK':   4,  // alias
  'POL':    5,  // MATIC foi renomeado para POL
  'MATIC':  5,  // alias legado
  'ARB':    6,
  'DOGE':   7,
  'BNB':    8,  // CORRIGIDO: estava 4 (1MBONK), real BNB é 8
  'SUI':    9,
  'WIF':    23,
  'JUP':    24, // CORRIGIDO: estava 26 (TAO), real JUP é 24
};

// ─── Limites de ordem por mercado ────────────────────────────────────────────
// minBase:  menor quantidade base aceita por ordem (unidades humanas)
// stepBase: granularidade da ordem — tamanho deve ser múltiplo deste valor
// Fonte: SDK MainnetPerpMarkets + testes empíricos 2026-03
const MARKET_LIMITS = {
  0:  { minBase: 0.1,    stepBase: 0.01   },  // SOL-PERP
  1:  { minBase: 0.0001, stepBase: 0.0001 },  // BTC-PERP
  2:  { minBase: 0.001,  stepBase: 0.001  },  // ETH-PERP
  3:  { minBase: 1,      stepBase: 0.1    },  // APT-PERP
  4:  { minBase: 100,    stepBase: 100    },  // 1MBONK-PERP
  5:  { minBase: 1,      stepBase: 1      },  // POL-PERP
  6:  { minBase: 1,      stepBase: 0.1    },  // ARB-PERP
  7:  { minBase: 10,     stepBase: 1      },  // DOGE-PERP
  8:  { minBase: 0.01,   stepBase: 0.001  },  // BNB-PERP
  9:  { minBase: 1,      stepBase: 0.1    },  // SUI-PERP
  23: { minBase: 1,      stepBase: 1      },  // WIF-PERP
  24: { minBase: 1,      stepBase: 1      },  // JUP-PERP
};

/**
 * Retorna limites de ordem para um mercado.
 * Consulta o SDK ao vivo se o cliente já estiver ativo; senão usa valores estáticos.
 */
export function getMarketLimits(marketIndex) {
  const fallback = MARKET_LIMITS[marketIndex] ?? { minBase: 0.1, stepBase: 0.1 };

  if (_driftClient) {
    try {
      const market   = _driftClient.getPerpMarketAccount(marketIndex);
      const B        = BASE_PRECISION.toNumber();
      const minBase  = market.amm.minOrderSize.toNumber() / B;
      const stepBase = market.amm.orderStepSize.toNumber() / B;
      if (minBase > 0 && stepBase > 0) {
        logger.debug(`[DRIFT] Limites ao vivo idx ${marketIndex}: min=${minBase} step=${stepBase}`);
        return { minBase, stepBase };
      }
    } catch (_) { /* fallback */ }
  }

  return fallback;
}

/**
 * Arredonda baseAmount para baixo ao múltiplo mais próximo de stepBase.
 * Evita erros de "order size not multiple of step size".
 */
export function snapToStep(baseAmount, stepBase) {
  if (stepBase <= 0) return baseAmount;
  // Aritmética inteira para evitar float drift
  const factor = Math.round(1 / stepBase);
  return Math.floor(baseAmount * factor) / factor;
}

// Margem inicial mínima por mercado (BPS, base 10_000).
// Formula: min_margin_ratio = 10_000 / max_leverage_mercado
// SOL/BTC/ETH: max 20x padrão = 500 BPS; outros: max 10x = 1000 BPS
const DRIFT_MARKET_MIN_MARGIN_RATIO = {
  0:  500,  // SOL    → 20x
  1:  500,  // BTC    → 20x
  2:  500,  // ETH    → 20x
  3:  1000, // APT    → 10x
  4:  1000, // 1MBONK → 10x
  5:  1000, // POL    → 10x
  6:  1000, // ARB    → 10x
  7:  1000, // DOGE   → 10x
  8:  1000, // BNB    → 10x
  9:  1000, // SUI    → 10x
  23: 1000, // WIF    → 10x
  24: 1000, // JUP    → 10x
};

let _driftClient = null;
let _driftUser   = null;
let _connection  = null;
let _keypair     = null;

function getKeypair() {
  if (!_keypair) {
    _keypair = loadWalletKeypair();
    logger.info(`[DRIFT] Wallet pública: ${_keypair.publicKey.toBase58()}`);
  }
  return _keypair;
}

function getConnection() {
  if (!_connection) {
    _connection = new Connection(config.solana.rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60_000,
      wsEndpoint: config.solana.rpcUrl
        .replace('https://', 'wss://')
        .replace('http://', 'ws://'),
    });
  }
  return _connection;
}

export async function initDriftClient() {
  if (_driftClient) return { driftClient: _driftClient, driftUser: _driftUser };

  logger.info(`[DRIFT] Inicializando cliente via WebSocket...`);

  // Garante reset total em caso de falha — evita singleton quebrado em retries
  async function resetSingleton() {
    try { if (_driftUser)   await _driftUser.unsubscribe();   } catch (_) {}
    try { if (_driftClient) await _driftClient.unsubscribe(); } catch (_) {}
    _driftClient = null;
    _driftUser   = null;
    _connection  = null;
  }

  try {
    const keypair    = getKeypair();
    const connection = getConnection();
    const wallet     = new Wallet(keypair);
    const env        = config.solana.rpcUrl.includes('devnet') ? 'devnet' : 'mainnet-beta';
    const sdkConfig  = initialize({ env });

    logger.info(`[DRIFT] Ambiente: ${env}`);

    // ─── WebSocket nativo (evita batch requests de RPCs pagos) ───────────────
    _driftClient = new DriftClient({
      connection,
      wallet,
      programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
      accountSubscription: {
        type: 'websocket',
        resubTimeoutMs: 30_000,
      },
      env,
    });

    await _driftClient.subscribe();
    logger.info(`[DRIFT] DriftClient subscrito via WebSocket ✓`);

    _driftUser = new User({
      driftClient:          _driftClient,
      userAccountPublicKey: await _driftClient.getUserAccountPublicKey(),
      accountSubscription: {
        type: 'websocket',
        resubTimeoutMs: 30_000,
      },
    });

    // Criar conta Drift se não existir (custo único ~0.035 SOL)
    const accountExists = await _driftUser.exists();
    if (!accountExists) {
      logger.warn(`[DRIFT] Conta Drift não encontrada — criando (~0.035 SOL)...`);
      await _driftClient.initializeUserAccount();
      logger.info(`[DRIFT] Conta Drift criada ✓`);
    }

    await _driftUser.subscribe();
    logger.info(`[DRIFT] DriftUser subscrito ✓`);

    return { driftClient: _driftClient, driftUser: _driftUser };
  } catch (err) {
    logger.error(`[DRIFT] Falha na inicialização — resetando singleton para retry: ${err.message}`);
    await resetSingleton();
    throw err;
  }
}

export async function getWalletBalance() {
  if (config.trading.paperMode) return 1000;

  try {
    const { driftUser } = await initDriftClient();
    const freeCollateral = driftUser.getFreeCollateral('Initial');
    const balanceUSD     = freeCollateral.toNumber() / QUOTE_PRECISION.toNumber();
    logger.info(`[DRIFT] Free collateral: $${balanceUSD.toFixed(2)}`);
    return balanceUSD;
  } catch (err) {
    logger.error(`[DRIFT] Erro ao buscar saldo: ${err.message}`);
    return 0;
  }
}

/**
 * Retorna snapshot ao vivo da conta Drift — fonte de verdade para decisões de risco.
 * Chama diretamente o DriftUser, não depende do state store.
 *
 * @returns {{ freeCollateral, totalEquity, positionCount, totalNotional }}
 */
export async function getLiveAccountSnapshot() {
  const { driftClient, driftUser } = await initDriftClient();

  const Q = QUOTE_PRECISION.toNumber();
  const B = BASE_PRECISION.toNumber();
  const P = PRICE_PRECISION.toNumber();

  const freeCollateral = driftUser.getFreeCollateral('Initial').toNumber() / Q;
  const totalEquity    = driftUser.getTotalCollateral().toNumber() / Q;

  const perpPositions = driftUser.getActivePerpPositions();
  const positionCount = perpPositions.length;

  let totalNotional = 0;
  for (const pos of perpPositions) {
    const oracle = driftClient.getOracleDataForPerpMarket(pos.marketIndex);
    if (oracle?.price) {
      const markPrice = oracle.price.toNumber() / P;
      const sizeBase  = Math.abs(pos.baseAssetAmount.toNumber()) / B;
      totalNotional  += sizeBase * markPrice;
    }
  }

  return { freeCollateral, totalEquity, positionCount, totalNotional };
}

function toPrice(humanPrice) {
  return new BN(Math.round(humanPrice * PRICE_PRECISION.toNumber()));
}

function toBaseSize(notionalUSD, entryPrice, stepBase = 0) {
  let base = notionalUSD / entryPrice;
  if (stepBase > 0) base = snapToStep(base, stepBase);
  return new BN(Math.round(base * BASE_PRECISION.toNumber()));
}

/**
 * Configura o margin ratio do mercado PERP para a leverage desejada.
 * Deve ser chamado antes de placePerpOrder.
 *
 * @param {object} driftClient
 * @param {number} marketIndex    - índice do mercado (ex: 0 = SOL)
 * @param {number} requestedLev   - leverage desejada (ex: 19.3)
 * @returns {{ marginRatio: number, effectiveLeverage: number }}
 */
async function setPositionLeverage(driftClient, marketIndex, requestedLev) {
  const precision       = MARGIN_PRECISION.toNumber(); // 10_000
  const rawRatio        = Math.round(precision / requestedLev);
  const minRatio        = DRIFT_MARKET_MIN_MARGIN_RATIO[marketIndex] ?? 1_000;
  const finalRatio      = Math.max(rawRatio, minRatio);
  const effectiveLev    = precision / finalRatio;
  const needsHighLev    = requestedLev > 20;

  logger.info(`[DRIFT] ⚙️  Configurando leverage:`, {
    leverageSinalRecebida: `${requestedLev}x`,
    marginRatioBruto:      `${rawRatio} bps  (${(rawRatio / 100).toFixed(2)}%)`,
    minMarginRatioMercado: `${minRatio} bps`,
    marginRatioFinal:      `${finalRatio} bps`,
    leverageEfetivaFinal:  `${effectiveLev.toFixed(2)}x`,
    highLeverageMode:      needsHighLev,
  });

  const tx = await driftClient.updateUserPerpPositionCustomMarginRatio(
    marketIndex,
    finalRatio,
    0,          // subAccountId
    undefined,  // txParams
    needsHighLev,
  );

  logger.info(`[DRIFT] ✅ Leverage configurada: ${effectiveLev.toFixed(2)}x | tx: ${tx}`);
  return { marginRatio: finalRatio, effectiveLeverage: effectiveLev };
}

export async function openPosition(tradeParams) {
  const {
    signalId, asset, direction,
    entry, tp, sl,
    leverage, positionSizeUSD, notionalValueUSD,
    slippageBps, marginType,
  } = tradeParams;

  // ─── Validação de segurança: marginType deve ser explícito ────────────────
  const resolvedMarginType = (marginType ?? '').toLowerCase();
  if (resolvedMarginType !== 'isolated' && resolvedMarginType !== 'cross') {
    throw new Error(
      `[DRIFT] BLOQUEADO: marginType inválido ou ausente ("${marginType}"). ` +
      `Deve ser "isolated" ou "cross". Execução cancelada por segurança.`
    );
  }

  // ─── Log de ação pré-execução ─────────────────────────────────────────────
  logger.info(`[ACTION] Abrindo posição`, {
    market:     asset,
    side:       direction,
    size:       `$${notionalValueUSD}`,
    collateral: `$${positionSizeUSD}`,
    leverage:   `${leverage}x`,
    marginType: resolvedMarginType,
    signalId,
  });

  if (config.trading.paperMode) return simulateTrade(tradeParams);

  const marketIndex = DRIFT_MARKET_INDEX[asset.toUpperCase()];
  if (marketIndex === undefined) {
    throw new Error(`[DRIFT] Ativo não suportado: ${asset}. Suportados: ${Object.keys(DRIFT_MARKET_INDEX).join(', ')}`);
  }

  const { driftClient, driftUser } = await initDriftClient();

  // ─── Pré-validação: colateral disponível ─────────────────────────────────
  const freeCollateral = driftUser.getFreeCollateral('Initial').toNumber() / QUOTE_PRECISION.toNumber();
  if (positionSizeUSD > freeCollateral * 1.01) { // 1% tolerância para arredondamento
    throw new Error(
      `Colateral insuficiente: precisa $${positionSizeUSD.toFixed(2)}, disponível $${freeCollateral.toFixed(2)}`
    );
  }
  logger.info(`[DRIFT] Colateral: precisa $${positionSizeUSD.toFixed(2)} | disponível $${freeCollateral.toFixed(2)} ✓`);

  // ─── Pré-validação: tamanho mínimo de ordem ───────────────────────────────
  const limits          = getMarketLimits(marketIndex);
  const baseRaw         = notionalValueUSD / entry;
  const baseSnapped     = snapToStep(baseRaw, limits.stepBase);
  if (baseSnapped < limits.minBase) {
    throw new Error(
      `Ordem abaixo do mínimo do mercado: ${baseSnapped.toFixed(6)} < ${limits.minBase} ` +
      `(nocional $${notionalValueUSD.toFixed(2)} / entrada $${entry})`
    );
  }
  logger.info(`[DRIFT] Tamanho de ordem: ${baseSnapped.toFixed(6)} (min ${limits.minBase}, step ${limits.stepBase}) ✓`);

  // ─── 1. Configurar leverage (margem) ANTES da ordem ──────────────────────
  logger.info(`[DRIFT] Leverage recebida pelo executor: ${leverage}x`);
  const { effectiveLeverage } = await setPositionLeverage(driftClient, marketIndex, leverage);
  logger.info(`[DRIFT] Leverage efetivamente aplicada: ${effectiveLeverage.toFixed(2)}x`);

  const driftDirection  = direction === 'LONG' ? PositionDirection.LONG : PositionDirection.SHORT;
  const baseAssetAmount = toBaseSize(notionalValueUSD, entry, limits.stepBase);
  const slippageMult    = slippageBps / 10_000;
  const worstPrice      = direction === 'LONG'
    ? entry * (1 + slippageMult)
    : entry * (1 - slippageMult);

  // ─── 2. Colateral isolado (ISOLATED margin) ───────────────────────────────
  // isolatedPositionDepositAmount faz o SDK emitir getTransferIsolatedPerpPositionDepositIx
  // antes da ordem, alocando exatamente positionSizeUSD como margem isolada.
  // Se este valor for 0 ou undefined, o SDK usa CROSS margin — jamais permitido aqui.
  const isolatedDepositAmount = new BN(
    Math.round(positionSizeUSD * QUOTE_PRECISION.toNumber())
  );

  // ─── SAFETY CHECK: garantir que a execução real corresponde ao marginType ─
  if (resolvedMarginType === 'isolated') {
    if (isolatedDepositAmount.isZero()) {
      throw new Error(
        `[DRIFT] SAFETY VIOLATION: marginType=isolated mas isolatedDepositAmount=0 ` +
        `(positionSizeUSD=${positionSizeUSD}). ` +
        `O SDK usaria CROSS margin. Execução bloqueada.`
      );
    }
    logger.info(`[DRIFT] 🔒 Tipo de margem: ISOLATED | colateral alocado: $${positionSizeUSD.toFixed(4)}`);
  } else {
    // cross: não passa isolatedDepositAmount — mas exige confirmação explícita
    logger.info(`[DRIFT] 🔓 Tipo de margem: CROSS (solicitado explicitamente)`);
  }

  // ─── 3. Market Order ──────────────────────────────────────────────────────
  const marketOrderParams = getMarketOrderParams({
    marketIndex,
    direction:       driftDirection,
    baseAssetAmount,
    price:           toPrice(worstPrice),
    marketType:      MarketType.PERP,
  });

  logger.info(`[DRIFT] Enviando market order (${resolvedMarginType.toUpperCase()} ${effectiveLeverage.toFixed(2)}x)...`);
  const marketTxSig = await driftClient.placePerpOrder(
    marketOrderParams,
    undefined,                                                      // txParams
    0,                                                              // subAccountId
    resolvedMarginType === 'isolated' ? isolatedDepositAmount : undefined // ISOLATED ou CROSS
  );
  logger.info(`[DRIFT] ✅ Market order: ${marketTxSig}`);

  await sleep(2000);

  // ─── 2. Take Profit ───────────────────────────────────────────────────────
  const tpTriggerCondition = direction === 'LONG'
    ? OrderTriggerCondition.ABOVE
    : OrderTriggerCondition.BELOW;

  const tpCloseDirection = direction === 'LONG'
    ? PositionDirection.SHORT
    : PositionDirection.LONG;

  const tpOrderParams = getTriggerLimitOrderParams({
    marketIndex,
    direction:        tpCloseDirection,
    baseAssetAmount,
    price:            toPrice(tp),
    triggerPrice:     toPrice(tp),
    triggerCondition: tpTriggerCondition,
    marketType:       MarketType.PERP,
    reduceOnly:       true,
  });

  const tpTxSig = await driftClient.placePerpOrder(tpOrderParams);
  logger.info(`[DRIFT] ✅ Take Profit $${tp}: ${tpTxSig}`);

  // ─── 3. Stop Loss ─────────────────────────────────────────────────────────
  const slTriggerCondition = direction === 'LONG'
    ? OrderTriggerCondition.BELOW
    : OrderTriggerCondition.ABOVE;

  const slCloseDirection = direction === 'LONG'
    ? PositionDirection.SHORT
    : PositionDirection.LONG;

  const slOrderParams = getTriggerLimitOrderParams({
    marketIndex,
    direction:        slCloseDirection,
    baseAssetAmount,
    price:            direction === 'LONG' ? toPrice(sl * 0.995) : toPrice(sl * 1.005),
    triggerPrice:     toPrice(sl),
    triggerCondition: slTriggerCondition,
    marketType:       MarketType.PERP,
    reduceOnly:       true,
  });

  const slTxSig = await driftClient.placePerpOrder(slOrderParams);
  logger.info(`[DRIFT] ✅ Stop Loss $${sl}: ${slTxSig}`);

  const result = {
    success: true,
    signalId, asset, direction, entry, tp, sl, leverage,
    marginType:     resolvedMarginType,
    collateralUSD:  positionSizeUSD,
    notionalUSD:    notionalValueUSD,
    marketIndex,
    signatures: {
      marketOrder: marketTxSig,
      takeProfit:  tpTxSig,
      stopLoss:    slTxSig,
    },
    explorerUrls: {
      marketOrder: `https://solscan.io/tx/${marketTxSig}`,
      takeProfit:  `https://solscan.io/tx/${tpTxSig}`,
      stopLoss:    `https://solscan.io/tx/${slTxSig}`,
    },
    executedAt: new Date().toISOString(),
  };

  // ─── Log de resultado pós-execução ────────────────────────────────────────
  logger.info(`[RESULT] Posição aberta`, {
    marginType:  resolvedMarginType,
    marketOrder: result.explorerUrls.marketOrder,
    takeProfit:  result.explorerUrls.takeProfit,
    stopLoss:    result.explorerUrls.stopLoss,
  });

  return result;
}

function simulateTrade(tradeParams) {
  const { signalId, asset, direction, entry, tp, sl, leverage, positionSizeUSD, notionalValueUSD, marginType } = tradeParams;
  const resolvedMarginType = (marginType ?? 'isolated').toLowerCase();
  const fakeSig = (label) => `PAPER_${label}_${Date.now()}_${Math.random().toString(36).substr(2,6).toUpperCase()}`;

  const result = {
    success: true, paperTrade: true,
    signalId, asset, direction, entry, tp, sl, leverage,
    marginType:     resolvedMarginType,
    collateralUSD:  positionSizeUSD,
    notionalUSD:    notionalValueUSD,
    marketIndex:    DRIFT_MARKET_INDEX[asset.toUpperCase()] ?? '?',
    signatures: {
      marketOrder: fakeSig('MKT'),
      takeProfit:  fakeSig('TP'),
      stopLoss:    fakeSig('SL'),
    },
    pnlProjection: {
      maxProfit: +((Math.abs(tp - entry) / entry) * notionalValueUSD).toFixed(2),
      maxLoss:   +((Math.abs(sl - entry) / entry) * notionalValueUSD).toFixed(2),
    },
    executedAt: new Date().toISOString(),
  };

  logger.info(`[PAPER] 📝 Trade simulado (Drift):`, {
    sinal: signalId, ativo: `${direction} ${asset}`,
    entrada: `$${entry}`, tp: `$${tp}`, sl: `$${sl}`,
    alavancagem: `${leverage}x`,
    marginType:  resolvedMarginType,
    colateral: `$${positionSizeUSD.toFixed(2)}`,
    nocional:  `$${notionalValueUSD.toFixed(2)}`,
    lucroMax:  `$${result.pnlProjection.maxProfit}`,
    perdaMax:  `$${result.pnlProjection.maxLoss}`,
  });

  return result;
}

export async function openPositionWithRetry(tradeParams, maxRetries = config.trading.maxRetries) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[DRIFT] Tentativa ${attempt}/${maxRetries} — ${tradeParams.signalId}`);
      return await openPosition(tradeParams);
    } catch (err) {
      lastError = err;
      logger.warn(`[DRIFT] Tentativa ${attempt} falhou: ${err.message}`);
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        logger.info(`[DRIFT] Aguardando ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  throw new Error(`[DRIFT] Todas as ${maxRetries} tentativas falharam. Último erro: ${lastError?.message}`);
}

// ── Fechar posição específica ──────────────────────────────────────────────
export async function closePosition(asset) {
  if (config.trading.paperMode) {
    logger.info(`[PAPER] 📝 Fechando posição ${asset} (simulado)`);
    return `PAPER_CLOSE_${Date.now()}`;
  }

  const marketIndex = DRIFT_MARKET_INDEX[asset.toUpperCase()];
  if (marketIndex === undefined) {
    throw new Error(`[DRIFT] Ativo não suportado: ${asset}`);
  }

  const { driftClient, driftUser } = await initDriftClient();

  const pos = driftUser.getPerpPosition(marketIndex);
  if (!pos || pos.baseAssetAmount.eq(new BN(0))) {
    throw new Error(`[DRIFT] Sem posição aberta em ${asset}`);
  }

  // Cancelar ordens abertas (TP/SL) antes de fechar
  try {
    await driftClient.cancelOrders(MarketType.PERP, marketIndex);
    logger.info(`[DRIFT] Ordens de ${asset} canceladas`);
    await sleep(1000);
  } catch (err) {
    logger.warn(`[DRIFT] Aviso ao cancelar ordens de ${asset}: ${err.message}`);
  }

  // Fechar com market order reduceOnly na direção oposta
  const isLong          = pos.baseAssetAmount.gt(new BN(0));
  const closeDirection  = isLong ? PositionDirection.SHORT : PositionDirection.LONG;
  const baseAssetAmount = pos.baseAssetAmount.abs();

  const closeParams = getMarketOrderParams({
    marketIndex,
    direction:       closeDirection,
    baseAssetAmount,
    marketType:      MarketType.PERP,
    reduceOnly:      true,
  });

  const txSig = await driftClient.placePerpOrder(closeParams);
  logger.info(`[DRIFT] ✅ Posição ${asset} fechada: ${txSig}`);
  return txSig;
}

// ── Fechar todas as posições abertas ──────────────────────────────────────
export async function closeAllPositions() {
  if (config.trading.paperMode) {
    logger.info(`[PAPER] 📝 Fechando todas as posições (simulado)`);
    return [];
  }

  const { driftUser } = await initDriftClient();
  const positions = driftUser.getActivePerpPositions();

  if (positions.length === 0) {
    logger.info(`[DRIFT] Nenhuma posição aberta para fechar`);
    return [];
  }

  const results = [];
  for (const pos of positions) {
    const asset = Object.keys(DRIFT_MARKET_INDEX)
      .find(k => DRIFT_MARKET_INDEX[k] === pos.marketIndex) ?? `MKT_${pos.marketIndex}`;
    try {
      const txSig = await closePosition(asset);
      results.push({ asset, marketIndex: pos.marketIndex, txSig, success: true });
    } catch (err) {
      logger.error(`[DRIFT] Falha ao fechar ${asset}: ${err.message}`);
      results.push({ asset, marketIndex: pos.marketIndex, error: err.message, success: false });
    }
  }

  logger.info(`[DRIFT] Close all concluído: ${results.filter(r => r.success).length}/${results.length} fechadas`);
  return results;
}

export async function disconnectDrift() {
  try {
    if (_driftUser)   await _driftUser.unsubscribe();
    if (_driftClient) await _driftClient.unsubscribe();
    logger.info(`[DRIFT] Desconectado.`);
  } catch (_) {}
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
