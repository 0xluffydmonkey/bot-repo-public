// src/trading/ManualTradeService.js
// Ponto de entrada único para execução manual de trades.
//
// Exporta também executeSignal() — núcleo de execução compartilhado com o
// fluxo automático de sinais do Telegram. Ambos os fluxos passam pelo mesmo
// pipeline: walletBalance → calculateTradeParams → perpService.openTrade
//
// Compatível com PAPER_TRADING, respeita o risk manager em todas as operações.
// Não duplica lógica — não cria executor paralelo — não bypassa validações.

import logger from '../utils/logger.js';
import { validateSignal } from '../parser/signal_parser.js';
import { calculateTradeParams } from '../risk/risk_manager.js';
import { perpService } from './PerpExecutionService.js';
import { calculateTradeCost } from './costs/tradeCostCalculator.js';
import { config } from '../config/index.js';
import state from '../core/state.js';
import { resolveCloseVenue } from './closeVenueResolver.js';

/** Resolve the venue for a position from state.positions, or null if not tracked. */
function resolvePositionVenue(asset) {
  return state.positions.find(p => p.asset === asset?.toUpperCase())?.venue ?? null;
}

// ─── Núcleo de execução compartilhado ─────────────────────────────────────────
/**
 * Executa um trade a partir de um objeto signal já validado e completo.
 *
 * É o núcleo compartilhado entre o fluxo automático (Telegram) e o manual.
 * Não faz deduplicação, não checa pausa/autoTrading, não acessa signalStore —
 * essas responsabilidades pertencem ao orquestrador de cada fluxo.
 *
 * Estratégia de retorno:
 *   - Rejeições de negócio (saldo, risk manager) → retorna { success: false, phase, reason }
 *   - Falha de execução (rede, SDK) → lança exceção (caller decide como registrar)
 *
 * @param {object} signal   - Objeto signal completo e já validado
 * @param {object} [opts]
 * @param {boolean} [opts.withCostEstimation=false] - Logar estimativa de custo pré-execução
 *
 * @returns {Promise<
 *   | { success: true,  result: object, tradeParams: object }
 *   | { success: false, phase: 'balance'|'risk', reason: string }
 * >}
 * @throws Quando perpService.openTrade falha (execução na blockchain/simulação)
 */
export async function executeSignal(signal, opts = {}) {
  const { withCostEstimation = false } = opts;
  const activeVenue = perpService.getActiveVenue();

  // ── 0. Pré-validação de capabilities da venue ───────────────────────────────
  // Bloqueia venues ainda não prontas ANTES de tentar saldo, risk manager ou adapter.
  //
  // Capabilities exigidas em TODOS os modos (paper e live):
  //   supportsOpenTrade           — execução da ordem (simulada ou real)
  //   supportsSupportedAssets     — risk manager usa no step 0 (validar ativo)
  //   supportsPlatformMaxLeverage — risk manager usa no step 1 (cap de leverage)
  //   supportsMarketLimits        — risk manager usa no step 8 (step size / minBase)
  //
  // Capabilities exigidas SOMENTE em live:
  //   supportsBalance         — getBalance() chama o adapter; em paper retorna constante
  //   supportsAccountSnapshot — risk manager step 3 só chama em live; paper usa walletBalance
  const capabilities = perpService.getCapabilities();
  // In paper mode only the three static-data capabilities are required:
  // the execution capabilities (open/close/balance/snapshot) are intercepted
  // by PerpExecutionService before reaching the adapter.
  const requiredCapabilities = [
    ['supportsSupportedAssets',     'lista de ativos suportados'],
    ['supportsPlatformMaxLeverage', 'alavancagem maxima por ativo'],
    ['supportsMarketLimits',        'market limits'],
  ];

  if (!config.trading.paperMode) {
    requiredCapabilities.push(
      ['supportsOpenTrade',       'abertura de trade'],
      ['supportsBalance',         'consulta de saldo'],
      ['supportsAccountSnapshot', 'snapshot de conta'],
    );
  }

  const missingCapabilities = requiredCapabilities
    .filter(([capability]) => !capabilities?.[capability])
    .map(([, label]) => label);

  if (missingCapabilities.length > 0) {
    return {
      success: false,
      phase: 'venue',
      reason: `Venue "${activeVenue}" nao esta pronta para execucao: faltam ${missingCapabilities.join(', ')}`,
    };
  }

  // ── 1. Verificar saldo — via PerpExecutionService (venue-agnostic) ──────────
  const walletBalance = await perpService.getBalance();
  if (walletBalance <= 0 && !config.trading.paperMode) {
    return {
      success: false,
      phase:   'balance',
      reason:  `Saldo insuficiente: $${walletBalance}`,
    };
  }

  // ── 2. Risk manager ─────────────────────────────────────────────────────────
  const tradeParams = await calculateTradeParams(signal, walletBalance);
  if (!tradeParams) {
    return {
      success: false,
      phase:   'risk',
      reason:  'Rejeitado pelo risk manager',
    };
  }

  // ── 3. Estimativa de custo (informativo, nunca bloqueia execução) ───────────
  if (withCostEstimation && process.env.ENABLE_COST_ESTIMATION === 'true') {
    const venue = perpService.getActiveVenue();
    try {
      const cost = await calculateTradeCost({
        venue,
        asset:       tradeParams.asset,
        notionalUSD: tradeParams.notionalValueUSD,
        direction:   tradeParams.direction,
      });
      if (cost) {
        logger.info(`[EXEC] 💰 Estimativa de custo (${venue.toUpperCase()}):`, {
          openFee:  `$${cost.openFeeUsd}`,
          closeFee: `$${cost.closeFeeUsd}`,
          carry:    `$${cost.carryCostUsd}`,
          total:    `$${cost.totalCostUsd}`,
        });
      }
    } catch (costErr) {
      // Nunca deixar falha de estimativa impedir execução
      logger.warn(`[EXEC] Estimativa de custo falhou (não bloqueia): ${costErr.message}`);
    }
  }

  // ── 4. Execução — pode lançar exceção ──────────────────────────────────────
  logger.info(`[EXEC] 🚀 Enviando para ${activeVenue.toUpperCase()}...`);

  const result = await perpService.openTrade(tradeParams);  // lança se falhar
  state.signalExecuted(signal, result);

  // ── TP/SL protection check — surface failure to dashboard / Telegram ─────────
  // Only applies when: live mode + venue returned a tpsl field (Valiant/Hyperliquid)
  // + TP or SL was requested + placement returned nothing.
  // Drift results never include a `tpsl` field, so `'tpsl' in result` keeps them unaffected.
  if (!config.trading.paperMode && 'tpsl' in result) {
    const tpslRequested = tradeParams.tp != null || tradeParams.sl != null;
    const tpslFailed    = tpslRequested && (!result.tpsl || result.tpsl.length === 0);
    if (tpslFailed) {
      state.addError(
        `tpsl:open:${tradeParams.asset}`,
        new Error(
          `TP/SL placement failed for ${tradeParams.asset} (${result.venue}). ` +
          `Position is open without native protection. ` +
          `Set manually: cmd:update_tpsl ${tradeParams.asset}`
        )
      );
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  return { success: true, result, tradeParams };
}

// ─── Abertura manual ───────────────────────────────────────────────────────────
/**
 * Abre uma posição manualmente.
 *
 * Constrói o objeto signal a partir de params brutos, valida, e delega ao
 * núcleo compartilhado executeSignal(). Não checa pausa nem auto-trading —
 * trade manual é intenção explícita do operador.
 *
 * @param {object} params
 * @param {string}            params.asset
 * @param {'LONG'|'SHORT'}    params.direction
 * @param {number}            params.entry
 * @param {number}            params.tp
 * @param {number}            params.sl
 * @param {number}            params.leverage
 * @param {'isolated'|'cross'} [params.marginType='isolated']
 *
 * @returns {Promise<{ success: boolean, signalId?: string, result?: object, reason?: string }>}
 */
export async function openManualTrade(params) {
  const {
    asset, direction, entry, tp, sl,
    leverage, marginType = 'isolated',
  } = params;

  const signalId = `MANUAL_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

  logger.info(`[MANUAL] ── Abertura manual ${direction} ${asset} ──`, {
    signalId, entry, tp, sl, leverage, marginType,
  });

  const signal = {
    signalId,
    asset:      asset?.toUpperCase(),
    direction:  direction?.toUpperCase(),
    entry:      Number(entry),
    tp:         Number(tp),
    sl:         Number(sl),
    leverage:   Number(leverage),
    marginType: marginType ?? 'isolated',
    source:     'manual',
  };

  // Validação lógica — mesma função do fluxo automático
  const { valid, errors } = validateSignal(signal);
  if (!valid) {
    const reason = `Parâmetros inválidos: ${errors.join(', ')}`;
    logger.warn(`[MANUAL] ⛔ ${reason}`);
    return { success: false, reason };
  }

  try {
    const execResult = await executeSignal(signal);

    if (!execResult.success) {
      logger.warn(`[MANUAL] ⛔ ${execResult.reason} — ${signalId}`);
      state.addError(`manual:open ${asset}`, new Error(execResult.reason));
      return { success: false, reason: execResult.reason };
    }

    logger.info(`[MANUAL] ✅ Posição manual aberta`, { signalId, asset, direction });
    return { success: true, signalId, result: execResult.result };
  } catch (err) {
    logger.error(`[MANUAL] ❌ Falha na abertura manual: ${err.message}`);
    state.addError(`manual:open ${asset}`, err);
    return { success: false, reason: err.message };
  }
}

// ─── Fechamento manual ─────────────────────────────────────────────────────────
/**
 * Fecha manualmente uma posição específica.
 * Delega para perpService.closeTrade — mesma lógica do cmd:close automático.
 *
 * @param {string} asset
 * @param {string|null} venue
 * @returns {Promise<{ success: boolean, txSig?: string, reason?: string }>}
 */
export async function closeManualTrade(asset, venue = null) {
  const { venue: resolvedVenue, source } = resolveCloseVenue(asset, venue);
  if (source === 'active_fallback') {
    logger.warn(`[MANUAL] Venue não informada para close de ${asset} — usando venue ativa "${resolvedVenue}" como fallback`);
  }
  logger.info(`[MANUAL] Fechando posição: ${asset}`, { venue: resolvedVenue });
  try {
    const txSig = await perpService.closeTrade(asset, resolvedVenue);
    logger.info(`[MANUAL] ✅ Posição ${asset} fechada`);
    return { success: true, txSig };
  } catch (err) {
    logger.error(`[MANUAL] ❌ Falha ao fechar ${asset}: ${err.message}`);
    state.addError(`manual:close ${asset}`, err);
    return { success: false, reason: err.message };
  }
}

// ─── Fechar todas ──────────────────────────────────────────────────────────────
/**
 * Fecha todas as posições abertas manualmente.
 * Delega para perpService.closeAllTrades — mesma lógica do cmd:close_all.
 *
 * @param {string|null} venue
 * @returns {Promise<{ success: boolean, results: Array, reason?: string }>}
 */
export async function closeAllManualTrades(venue = null) {
  const { venue: resolvedVenue, source } = resolveCloseVenue(null, venue);
  if (source === 'active_fallback') {
    logger.warn(`[MANUAL] Venue não informada para close_all — usando venue ativa "${resolvedVenue}" como fallback`);
  }
  logger.info(`[MANUAL] Fechando todas as posições`, { venue: resolvedVenue });
  try {
    const results = await perpService.closeAllTrades(resolvedVenue);
    const ok    = Array.isArray(results) ? results.filter(r => r.success).length : '?';
    const total = Array.isArray(results) ? results.length : '?';
    logger.info(`[MANUAL] ✅ Close all: ${ok}/${total} fechadas`);
    return { success: true, results };
  } catch (err) {
    logger.error(`[MANUAL] ❌ Falha no close all: ${err.message}`);
    state.addError('manual:close_all', err);
    return { success: false, reason: err.message, results: [] };
  }
}

// ─── Redução parcial ──────────────────────────────────────────────────────────
/**
 * Partially reduces an open position by a percentage of its current size.
 *
 * Safety rules (enforced here, not in the adapter):
 *   - reducePercent must be 1–95 inclusive. ≥95% is rejected: use closeManualTrade.
 *   - baseToReduce and the remaining base must both be >= minBase after step snap.
 *   - Venue is resolved from state.positions (same as close/tpsl flows).
 *
 * @param {string} asset          - e.g. 'SOL', 'BTC'
 * @param {number} reducePercent  - 1–95, percentage of current size to close
 * @returns {Promise<{ success: boolean, asset?, baseReduced?, txSig?, reason? }>}
 */
export async function reduceManualTrade(asset, reducePercent) {
  const assetUpper = asset?.toUpperCase();

  if (!assetUpper) {
    return { success: false, reason: 'asset obrigatório' };
  }
  if (typeof reducePercent !== 'number' || reducePercent < 1 || reducePercent > 95) {
    return { success: false, reason: 'reducePercent deve ser entre 1 e 95 (use close para fechar tudo)' };
  }

  // Resolve position from state — venue + current size
  const pos = state.positions.find(p => p.asset === assetUpper);
  if (!pos) {
    return { success: false, reason: `Sem posição aberta em ${assetUpper}` };
  }

  const venue    = pos.venue ?? null;
  const sizeBase = pos.sizeBase;

  if (!sizeBase || sizeBase <= 0) {
    return { success: false, reason: `Tamanho da posição ${assetUpper} inválido ou zero` };
  }

  // Step size and min size validation
  let limits;
  try {
    limits = perpService.getMarketLimits(assetUpper);
  } catch (err) {
    return { success: false, reason: `Não foi possível obter limites de mercado para ${assetUpper}: ${err.message}` };
  }

  const baseRaw      = sizeBase * (reducePercent / 100);
  const baseToReduce = perpService.snapToStep(baseRaw, limits.stepBase);
  const baseRemaining = sizeBase - baseToReduce;

  if (baseToReduce < limits.minBase) {
    return {
      success: false,
      reason:  `Redução de ${reducePercent}% (${baseToReduce.toFixed(6)} ${assetUpper}) ` +
               `abaixo do mínimo de mercado (${limits.minBase} ${assetUpper}). ` +
               `Aumente o percentual ou feche completamente.`,
    };
  }

  if (baseRemaining < limits.minBase) {
    return {
      success: false,
      reason:  `Saldo restante após redução (${baseRemaining.toFixed(6)} ${assetUpper}) ` +
               `ficaria abaixo do mínimo de mercado (${limits.minBase} ${assetUpper}). ` +
               `Use close para fechar completamente.`,
    };
  }

  logger.info(`[MANUAL] Redução parcial: ${reducePercent}% de ${assetUpper}`, {
    sizeBase, baseToReduce, baseRemaining, venue: venue ?? '(venue ativa)',
  });

  try {
    const result = await perpService.reduceTrade(assetUpper, baseToReduce, venue);
    logger.info(`[MANUAL] ✅ Redução parcial concluída: ${assetUpper} −${baseToReduce} base`);
    return { success: true, asset: assetUpper, baseReduced: baseToReduce, txSig: result.txSig };
  } catch (err) {
    logger.error(`[MANUAL] ❌ Falha na redução parcial de ${assetUpper}: ${err.message}`);
    state.addError(`manual:reduce ${assetUpper}`, err);
    return { success: false, reason: err.message };
  }
}

// ─── Atualizar TP/SL ──────────────────────────────────────────────────────────
/**
 * Atualiza TP e/ou SL de uma posição aberta.
 * O lado omitido (null) é preservado — ver drift_executor.updateTpSl.
 *
 * @param {string}      asset
 * @param {number|null} tp
 * @param {number|null} sl
 * @returns {Promise<{ success: boolean, signatures?: object, reason?: string }>}
 */
export async function updateManualTpSl(asset, tp, sl) {
  if (tp == null && sl == null) {
    return { success: false, reason: 'Informe ao menos um valor: tp ou sl' };
  }

  // Resolve the venue from the tracked position — prevents routing TP/SL to the
  // wrong venue if PERP_OPEN_VENUE changed after the position was opened.
  const venue = resolvePositionVenue(asset);

  logger.info(`[MANUAL] Atualizando TP/SL: ${asset}`, {
    tp:    tp ?? '(sem alteração)',
    sl:    sl ?? '(sem alteração)',
    venue: venue ?? '(venue ativa como fallback)',
  });

  try {
    const result = await perpService.updateTpSl(asset, tp, sl, venue);
    logger.info(`[MANUAL] ✅ TP/SL atualizado: ${asset}`);
    return { success: true, ...result };
  } catch (err) {
    logger.error(`[MANUAL] ❌ Falha ao atualizar TP/SL de ${asset}: ${err.message}`);
    state.addError(`manual:tpsl ${asset}`, err);
    return { success: false, reason: err.message };
  }
}
