// src/risk/risk_manager.js
// Sistema de decisão inteligente: valida, ajusta e decide sobre cada sinal
// antes de enviar para o executor.

import logger      from '../utils/logger.js';
import { config } from '../config/index.js';
import { perpService } from '../trading/PerpExecutionService.js';
import state from '../core/state.js';

// Colateral mínimo absoluto (USD) — venue-agnostic floor abaixo do qual qualquer
// ordem é inviável independente de plataforma.
const MIN_COLLATERAL_USD = 0.10;

/**
 * Calcula e valida todos os parâmetros para um trade.
 *
 * Sistemas aplicados (em ordem):
 *   1. Alavancagem: limitar ao mínimo entre sinal / plataforma / config
 *   2. Limite de posições simultâneas (MAX_POSITIONS)
 *   3. Tamanho dinâmico: reduzir para caber dentro da margem livre com buffer
 *   4. Exposição total máxima (MAX_TOTAL_EXPOSURE_PCT)
 *   5. Step size / min size do mercado — snapeia e rejeita só se inviável
 *
 * Retorna params ajustados ou null (rejeição com log do motivo).
 */
export async function calculateTradeParams(signal, walletBalanceUSD, opts = {}) {
  logger.info(`[RISK] ── Pré-validação ${signal.signalId} (${signal.direction} ${signal.asset}) ──`);

  const adjustments = [];

  // ─── 0. Mercado suportado? ────────────────────────────────────────────────
  const assetUpper     = signal.asset?.toUpperCase();
  const supportedAssets = perpService.getSupportedAssets();
  if (!supportedAssets.includes(assetUpper)) {
    logger.warn(`[RISK] ⛔ Ativo não suportado na venue "${perpService.getActiveVenue()}": "${signal.asset}". ` +
      `Suportados: ${supportedAssets.join(', ')}`);
    return null;
  }
  logger.info(`[RISK] Ativo: ${signal.asset} ✓ (venue: ${perpService.getActiveVenue()})`);

  // ─── 1. Alavancagem ───────────────────────────────────────────────────────
  const platformMaxLev = perpService.getPlatformMaxLeverage(assetUpper);
  const configMaxLev   = config.trading.maxLeverage;
  const requestedLev   = signal.leverage;
  const finalLeverage  = Math.min(requestedLev, platformMaxLev, configMaxLev);

  logger.info(`[RISK] Leverage: sinal=${requestedLev}x | plataforma=${platformMaxLev}x | config=${configMaxLev}x → final=${finalLeverage}x`);
  if (finalLeverage !== requestedLev) {
    adjustments.push(`leverage ajustada ${requestedLev}x→${finalLeverage}x`);
    logger.warn(`[RISK] ⚠️  Leverage reduzida: ${requestedLev}x → ${finalLeverage}x`);
  }

  // ─── 2. R:R mínimo 1:1 ────────────────────────────────────────────────────
  const riskPct   = Math.abs(signal.entry - signal.sl)   / signal.entry * 100;
  const rewardPct = Math.abs(signal.tp   - signal.entry) / signal.entry * 100;
  const rr        = rewardPct / riskPct;

  logger.info(`[RISK] R:R = 1:${rr.toFixed(2)} (risco ${riskPct.toFixed(2)}% / recompensa ${rewardPct.toFixed(2)}%)`);
  if (rr < 1.0) {
    logger.warn(`[RISK] ⛔ R:R desfavorável (${rr.toFixed(2)}) — sinal rejeitado`);
    return null;
  }

  // ─── 3. Dados de conta — venue ativa é a fonte de verdade ────────────────
  const isPaper = config.trading.paperMode;

  let freeCollateral, totalEquity, currentPositions, totalNotional;

  if (isPaper) {
    // Paper mode: sem conta real
    freeCollateral   = walletBalanceUSD;
    totalEquity      = walletBalanceUSD;
    currentPositions = 0;
    totalNotional    = 0;
    logger.info(`[RISK] Conta (paper): equity=$${totalEquity.toFixed(2)}`);
  } else {
    // Live mode: busca snapshot ao vivo via PerpExecutionService (venue-agnostic).
    // Nunca usa cache do state — fonte de verdade é sempre o adapter da venue ativa.
    const snap    = state.getSnapshot();
    const account = await perpService.getAccountSnapshot();

    // Log comparativo para diagnóstico
    logger.debug(`[RISK] Venue freeCollateral: $${account.freeCollateral.toFixed(2)}`);
    logger.debug(`[RISK] State freeCollateral: $${(snap.account?.freeCollateral ?? 0).toFixed(2)}`);
    logger.debug(`[RISK] Using venue snapshot for risk calculation`);

    // equityOverride: when passed by ManualTradeService for Valiant spot-backed margin,
    // represents effective usable equity (spot + perps) for correct trade sizing.
    // Covers both paths: spot-backed direct (no transfer, HL bridges margin at fill)
    // and auto-transfer (explicit transfer after approval, when the flag is set).
    // positionCount and totalNotional always come from the real account.
    freeCollateral   = opts.equityOverride != null ? opts.equityOverride : account.freeCollateral;
    totalEquity      = opts.equityOverride != null ? opts.equityOverride : account.totalEquity;
    currentPositions = account.positionCount;
    totalNotional    = account.totalNotional;

    logger.info(
      `[RISK] Conta (${perpService.getActiveVenue().toUpperCase()}): ` +
      `freeCollateral=$${freeCollateral.toFixed(2)} | equity=$${totalEquity.toFixed(2)} | ` +
      `posições=${currentPositions} | notional=$${totalNotional.toFixed(2)}` +
      (opts.equityOverride != null ? ' [hipotético: spot+perps combinados]' : '')
    );
  }

  // ─── 4. Limite de posições simultâneas ────────────────────────────────────
  if (!isPaper && currentPositions >= config.trading.maxPositions) {
    logger.warn(`[RISK] ⛔ Limite de posições atingido: ${currentPositions}/${config.trading.maxPositions} — sinal rejeitado`);
    return null;
  }

  // ─── 5. Calcular tamanho inicial (% do equity) ────────────────────────────
  // REGRA: targetMargin = equity * pct | targetNotional = targetMargin * leverage
  // Usa totalEquity (não freeCollateral) como base — consistente com a conta real.
  // freeCollateral continua sendo usada na step 6 para o buffer de margem livre.
  const sizingBase = totalEquity; // equity sempre, nunca freeCollateral
  let positionSizeUSD = sizingBase * config.trading.positionSizePct;

  logger.info(
    `[SIZING] equity=${sizingBase.toFixed(2)} pct=${config.trading.positionSizePct} leverage=${finalLeverage}`
  );
  logger.info(`[SIZING] targetMargin=${positionSizeUSD.toFixed(2)}`);
  logger.info(`[SIZING] targetNotional=${(positionSizeUSD * finalLeverage).toFixed(2)}`);

  // ─── 6. Buffer de margem livre (MIN_FREE_MARGIN_PCT) ──────────────────────
  if (!isPaper) {
    // Margem que podemos usar: freeCollateral menos o buffer de segurança
    const availableMargin = freeCollateral * (1 - config.trading.minFreeMarginPct);
    logger.info(`[RISK] Margem disponível (após ${(config.trading.minFreeMarginPct * 100).toFixed(0)}% buffer): $${availableMargin.toFixed(2)}`);

    if (positionSizeUSD > availableMargin) {
      const prev = positionSizeUSD;
      positionSizeUSD = availableMargin;
      adjustments.push(`colateral reduzido $${prev.toFixed(2)}→$${positionSizeUSD.toFixed(2)} (margem disponível)`);
      logger.warn(`[RISK] ⚠️  Colateral reduzido por margem disponível: $${prev.toFixed(2)} → $${positionSizeUSD.toFixed(2)}`);
    }
  }

  // ─── 7. Exposição total máxima ────────────────────────────────────────────
  if (!isPaper && totalEquity > 0) {
    const maxExposure   = totalEquity * config.trading.maxTotalExposurePct;
    const newNotional   = positionSizeUSD * finalLeverage;
    const projectedExposure = totalNotional + newNotional;

    logger.info(`[RISK] Exposição: atual=$${totalNotional.toFixed(2)} + nova=$${newNotional.toFixed(2)} = $${projectedExposure.toFixed(2)} | limite=$${maxExposure.toFixed(2)}`);

    if (projectedExposure > maxExposure) {
      const room          = Math.max(0, maxExposure - totalNotional);
      const reducedSize   = room / finalLeverage;

      if (reducedSize < MIN_COLLATERAL_USD) {
        logger.warn(`[RISK] ⛔ Exposição total máxima atingida (${(config.trading.maxTotalExposurePct * 100).toFixed(0)}%) — sem espaço para nova posição. Atual=$${totalNotional.toFixed(2)}, limite=$${maxExposure.toFixed(2)}`);
        return null;
      }

      const prev = positionSizeUSD;
      positionSizeUSD = reducedSize;
      adjustments.push(`colateral reduzido $${prev.toFixed(2)}→$${positionSizeUSD.toFixed(2)} (exposição máxima)`);
      logger.warn(`[RISK] ⚠️  Colateral reduzido por exposição máxima: $${prev.toFixed(2)} → $${positionSizeUSD.toFixed(2)}`);
    }
  }

  // ─── 8. Step size e tamanho mínimo do mercado ─────────────────────────────
  const limits      = perpService.getMarketLimits(assetUpper);
  const notionalRaw = positionSizeUSD * finalLeverage;
  const baseRaw     = notionalRaw / signal.entry;
  const baseSnapped = perpService.snapToStep(baseRaw, limits.stepBase);
  const notionalSnapped = baseSnapped * signal.entry;
  const collateralSnapped = notionalSnapped / finalLeverage;

  logger.info(`[RISK] Ordem: ${baseRaw.toFixed(6)} base → snap(${limits.stepBase}) = ${baseSnapped.toFixed(6)} | min=${limits.minBase} | nocional=$${notionalSnapped.toFixed(2)}`);

  if (baseSnapped < limits.minBase) {
    const minNotionalUSD = limits.minBase * signal.entry;
    const minCollateral  = minNotionalUSD / finalLeverage;
    logger.warn(
      `[RISK] ⛔ Ordem inviável após ajuste de step size:\n` +
      `  Base:      ${baseSnapped.toFixed(6)} < mínimo ${limits.minBase}\n` +
      `  Colateral: $${collateralSnapped.toFixed(4)} (precisaria $${minCollateral.toFixed(4)})\n` +
      `  Para resolver: deposite mais colateral na venue ou aumente POSITION_SIZE_PCT`
    );
    return null;
  }

  if (Math.abs(baseSnapped - baseRaw) / baseRaw > 0.001) {
    adjustments.push(`base snappeado ${baseRaw.toFixed(6)}→${baseSnapped.toFixed(6)} (step ${limits.stepBase})`);
  }

  // Atualizar positionSizeUSD com valor pós-snap
  positionSizeUSD    = collateralSnapped;
  const notionalValueUSD = notionalSnapped;

  // ─── 9. Mínimo absoluto ───────────────────────────────────────────────────
  if (positionSizeUSD < MIN_COLLATERAL_USD) {
    logger.warn(`[RISK] ⛔ Colateral final ($${positionSizeUSD.toFixed(4)}) abaixo do mínimo absoluto ($${MIN_COLLATERAL_USD})`);
    return null;
  }

  // ─── Resultado ────────────────────────────────────────────────────────────
  if (adjustments.length > 0) {
    logger.info(`[RISK] ⚙️  Ajustes realizados: ${adjustments.join(' | ')}`);
  }

  logger.info(`[RISK] ✅ Parâmetros aprovados:`, {
    venue:          perpService.getActiveVenue(),
    alavancagem:    `${finalLeverage}x`,
    colateral:      `$${positionSizeUSD.toFixed(4)}`,
    nocional:       `$${notionalValueUSD.toFixed(4)}`,
    base:           `${baseSnapped.toFixed(6)} ${signal.asset}`,
    RR:             `1:${rr.toFixed(2)}`,
    margemLivre:    isPaper ? 'N/A (paper)' : `$${freeCollateral.toFixed(2)}`,
    posicoes:       isPaper ? 'N/A (paper)' : `${currentPositions + 1}/${config.trading.maxPositions}`,
  });

  // marginType: propagado diretamente do sinal; safety net garante 'isolated'
  // se por alguma razão o campo não existir (não deveria acontecer após parseSignal)
  const marginType = signal.marginType ?? 'isolated';
  if (!signal.marginType) {
    logger.warn(`[RISK] ⚠️  marginType ausente no sinal — aplicando padrão seguro: isolated`);
  }
  logger.info(`[RISK] Tipo de margem: ${marginType}`);

  return {
    signalId:        signal.signalId,
    asset:           signal.asset,
    direction:       signal.direction,
    entry:           signal.entry,
    tp:              signal.tp,
    sl:              signal.sl,
    leverage:        finalLeverage,
    positionSizeUSD,
    notionalValueUSD,
    marginType,
    slippageBps:     config.trading.maxSlippageBps,
    riskPct:         parseFloat(riskPct.toFixed(2)),
    rewardPct:       parseFloat(rewardPct.toFixed(2)),
    rr:              parseFloat(rr.toFixed(2)),
    adjustments,
  };
}
