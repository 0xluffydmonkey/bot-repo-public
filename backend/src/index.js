// src/index.js — Orquestrador principal
import logger from "./utils/logger.js";
import { config, validateConfig, envLoadInfo, runtimePaths } from "./config/index.js";
import { parseSignal, validateSignal } from "./parser/signal_parser.js";
import { runVenuePreflight, initVenueInfra, shutdownVenueInfra } from "./venues/venueBootstrap.js";
import { perpService }          from "./trading/PerpExecutionService.js";
import { executeSignal }        from "./trading/ManualTradeService.js";
import { resolveCloseVenue }    from "./trading/closeVenueResolver.js";
import { positionManager } from "./trading/position-management/PositionManager.js";
import { startTelegramListener } from "./telegram/telegram_listener.js";
import { fetchAccountData }      from "./monitor/data_fetcher.js";
import { signalStore } from "./utils/signal_store.js";
import state from "./core/state.js";

// ─── Flags CLI → variáveis de ambiente (backward compat) ──────────────────────
// The canonical way to activate modules is via .env (ENABLE_WEB, ENABLE_CONTROL_BOT,
// ENABLE_SIGNAL_LISTENER). CLI flags are still accepted for manual overrides but are
// no longer needed for normal operation — the service file passes no flags.
if (process.argv.includes('--web'))         process.env.ENABLE_WEB         = 'true';
if (process.argv.includes('--control-bot')) process.env.ENABLE_CONTROL_BOT = 'true';

// ─── Serviços opcionais ────────────────────────────────────────────────────
// Ativados por variáveis de ambiente para não quebrar o modo bot-only
let _stopWebServer   = null;
let _stopControlBot  = null;

async function startOptionalServices() {
  // Web dashboard (ENABLE_WEB=true)
  if (process.env.ENABLE_WEB === 'true') {
    try {
      const { createWebServer } = await import('./web/server.js');
      const port = parseInt(process.env.WEB_PORT ?? '3000', 10);
      const host = process.env.WEB_HOST || undefined;
      _stopWebServer = createWebServer(port, host);
    } catch (err) {
      logger.error(`[BOT] Falha ao iniciar web server: ${err.message}`);
    }
  }

  // Telegram control bot (ENABLE_CONTROL_BOT=true)
  if (process.env.ENABLE_CONTROL_BOT === 'true') {
    const token      = process.env.TELEGRAM_BOT_TOKEN ?? '';
    const allowedRaw = process.env.TELEGRAM_CONTROL_ALLOWED_IDS ?? '';
    if (!token) {
      logger.warn(`[BOT] ENABLE_CONTROL_BOT=true mas TELEGRAM_BOT_TOKEN não definido — controle ignorado`);
    } else {
      try {
        const { startControlBot } = await import('./telegram/telegram_control.js');
        const allowedIds = allowedRaw.split(',').map(s => s.trim()).filter(Boolean);
        _stopControlBot = startControlBot(token, allowedIds);
        logger.info(`[BOT] Bot de controle Telegram ativo (${allowedIds.length} IDs autorizados)`);
      } catch (err) {
        logger.error(`[BOT] Falha ao iniciar control bot: ${err.message}`);
      }
    }
  }
}

// ─── Banner ────────────────────────────────────────────────────────────────────
function printBanner() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║       🚀 SOLANA PERPS BOT — Drift Protocol v2               ║
║       Telegram → Parser → Risk → Drift Execute              ║
╠══════════════════════════════════════════════════════════════╣
║  Modo:      ${
    config.trading.paperMode
      ? "📝 PAPER TRADING (simulação)          "
      : "🔴 LIVE TRADING — DINHEIRO REAL!     "
  }  ║
║  Posição:   ${(config.trading.positionSizePct * 100).toFixed(0)}% do saldo por trade                      ║
║  Lev. Máx:  ${String(config.trading.maxLeverage + "x").padEnd(46)} ║
║  Slippage:  ${config.trading.maxSlippageBps} bps (${(config.trading.maxSlippageBps / 100).toFixed(1)}%)                        ║
║  Web:       ${(process.env.ENABLE_WEB === 'true' ? `http://localhost:${process.env.WEB_PORT ?? 3000}` : 'desabilitado').padEnd(46)} ║
╚══════════════════════════════════════════════════════════════╝
`);
  if (!config.trading.paperMode) {
    const liveVenue = (process.env.PERP_OPEN_VENUE ?? 'drift').toUpperCase();
    console.log(
      `⚠️  ATENÇÃO: MODO LIVE ATIVO — ordens reais serão executadas via ${liveVenue}!\n`,
    );
  }
}

// ─── Handler de sinais ────────────────────────────────────────────────────────
async function handleSignalMessage(text, meta = {}) {
  // Intake gate — descarta silenciosamente antes de qualquer processamento
  if (!state.status.signalIntakeEnabled) {
    logger.debug(`[BOT] 🔕 Intake desativado — sinal descartado`);
    return;
  }

  const signal = parseSignal(text);
  if (!signal) return;

  // Estado: sinal recebido
  state.signalReceived(signal);

  logger.info(`\n${"═".repeat(60)}`);
  logger.info(
    `[BOT] 📩 Sinal detectado: ${signal.signalId || "ID_DESCONHECIDO"}`,
  );

  // Deduplicação
  if (signal.signalId && signalStore.has(signal.signalId)) {
    logger.warn(`[BOT] ⏭️  Duplicado ignorado: ${signal.signalId}`);
    state.signalIgnored(signal, 'duplicate');
    return;
  }

  // Validação
  const { valid, errors } = validateSignal(signal);
  if (!valid) {
    logger.warn(`[BOT] ❌ Sinal inválido:`, { errors });
    if (signal.signalId)
      signalStore.add(signal.signalId, { status: "invalid", errors });
    state.signalIgnored(signal, `invalid: ${errors?.join(', ')}`);
    return;
  }

  // Checar pausa
  if (state.status.paused) {
    logger.warn(`[BOT] ⏸  Bot pausado — sinal ignorado: ${signal.signalId}`);
    state.signalIgnored(signal, 'bot_paused');
    signalStore.add(signal.signalId, { status: 'skipped', reason: 'bot_paused' });
    return;
  }

  // Checar auto-trading
  if (!state.status.autoTrading) {
    logger.warn(`[BOT] 🔇 Auto-trading desativado — sinal ignorado: ${signal.signalId}`);
    state.signalIgnored(signal, 'autotrading_disabled');
    signalStore.add(signal.signalId, { status: 'skipped', reason: 'autotrading_disabled' });
    return;
  }

  // Marcar como em processamento imediatamente (evita race condition)
  signalStore.add(signal.signalId, { status: "processing" });

  // Delay opcional
  if (config.trading.executionDelayMs > 0) {
    logger.info(`[BOT] ⏳ Delay de ${config.trading.executionDelayMs}ms...`);
    await new Promise((r) => setTimeout(r, config.trading.executionDelayMs));
  }

  // Núcleo de execução compartilhado com o fluxo manual:
  //   walletBalance → calculateTradeParams → (custo) → perpService.openTrade → state.signalExecuted
  // A orquestração (dedup, pause, signalStore, delay) permanece aqui.
  try {
    const execResult = await executeSignal(signal, { withCostEstimation: true });

    if (!execResult.success) {
      // Rejeição de negócio — não é erro de execução, é decisão do pipeline
      if (execResult.phase === 'venue') {
        logger.error(`[BOT] 🚫 Venue não pronta: ${execResult.reason}`);
        signalStore.add(signal.signalId, { status: "skipped", reason: "venue_not_ready" });
        state.signalIgnored(signal, `venue_not_ready: ${execResult.reason}`);
      } else if (execResult.phase === 'balance') {
        logger.error(`[BOT] 💸 ${execResult.reason}`);
        signalStore.add(signal.signalId, { status: "skipped", reason: "insufficient_balance" });
        state.signalIgnored(signal, 'insufficient_balance');
      } else {
        // phase === 'risk'
        logger.warn(`[BOT] ⛔ Rejeitado pelo risk manager: ${signal.signalId}`);
        signalStore.add(signal.signalId, { status: "rejected_by_risk" });
        state.signalIgnored(signal, 'rejected_by_risk_manager');
      }
      return;
    }

    const { result, tradeParams } = execResult;

    signalStore.add(signal.signalId, {
      status:     "executed",
      signatures: result.signatures,
      paperTrade: result.paperTrade ?? false,
    });

    logger.info(`[BOT] ✅ Posição aberta!`, {
      datetime:  new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      sinal:     signal.signalId,
      ativo:     `${signal.direction} ${signal.asset}`,
      entrada:   `$${signal.entry}`,
      tp:        `$${signal.tp}`,
      sl:        `$${signal.sl}`,
      leverage:  `${tradeParams.leverage}x`,
      colateral: `$${tradeParams.positionSizeUSD.toFixed(2)}`,
      nocional:  `$${tradeParams.notionalValueUSD.toFixed(2)}`,
      txs:       result.signatures,
    });
  } catch (err) {
    signalStore.add(signal.signalId, { status: "failed", error: err.message });
    state.addError(`Execução ${signal.signalId}`, err);
    logger.error(`[BOT] ❌ Falha ao executar ${signal.signalId}: ${err.message}`);
  }

  logger.info(`${"═".repeat(60)}\n`);
}

// ─── Poller de conta (alimenta state → web + Telegram veem dados reais) ──────
async function startAccountPoller() {
  const refreshMs = parseInt(process.env.MONITOR_REFRESH_MS ?? '30000', 10);

  async function poll() {
    try {
      await fetchAccountData();
    } catch (err) {
      logger.warn(`[BOT] Account poll erro: ${err.message}`);
    }
  }

  // Primeira fetch imediata — popula o state antes do 1º cliente conectar
  await poll();

  const timer = setInterval(poll, refreshMs);
  if (timer.unref) timer.unref(); // não impede o processo de encerrar

  logger.info(`[BOT] Account poller iniciado (intervalo: ${refreshMs / 1000}s)`);
  return timer;
}

// ─── Handlers de comandos remotos (via web ou control bot) ────────────────────
function registerCommandHandlers() {
  const handleOpenManualCommand = async (params) => {
    logger.info(`[BOT] 📤 Comando: abertura manual ${params.direction} ${params.asset}`);
    try {
      const { openManualTrade } = await import('./trading/ManualTradeService.js');
      const result = await openManualTrade(params);
      if (!result.success) {
        logger.warn(`[BOT] ⛔ Abertura manual rejeitada: ${result.reason}`);
        state.addError('cmd:open_manual', new Error(result.reason));
      }
    } catch (err) {
      logger.error(`[BOT] ❌ Falha na abertura manual: ${err.message}`);
      state.addError('cmd:open_manual', err);
    }
  };

  const handleUpdateTpSlCommand = async (payload, context = 'cmd:update_tpsl') => {
    const { asset, tp, sl } = payload ?? {};
    logger.info(`[BOT] 🔧 Comando: atualizar TP/SL ${asset} → TP:${tp ?? '-'} SL:${sl ?? '-'}`);
    try {
      const { updateManualTpSl } = await import('./trading/ManualTradeService.js');
      const result = await updateManualTpSl(asset, tp, sl);
      if (!result.success) {
        logger.warn(`[BOT] ⛔ Atualização TP/SL rejeitada: ${result.reason}`);
        state.addError(`${context} ${asset}`, new Error(result.reason));
      }
    } catch (err) {
      logger.error(`[BOT] ❌ Falha ao atualizar TP/SL de ${asset}: ${err.message}`);
      state.addError(`${context} ${asset}`, err);
    }
  };

  // Fechar posição específica — roteado via PerpExecutionService (respeita PERP_OPEN_VENUE)
  state.on('cmd:close', async ({ asset, venue } = {}) => {
    const { venue: resolvedVenue, source } = resolveCloseVenue(asset, venue, { allowActiveFallback: false });
    if (source === 'unresolved') {
      const err = new Error(`Venue não resolvida para close de ${asset}; comando recusado por segurança`);
      logger.error(`[BOT] ⛔ ${err.message}`);
      state.addError(`cmd:close ${asset}`, err);
      return;
    }
    logger.info(`[BOT] 🔒 Comando: fechar ${asset} (venue: ${resolvedVenue})`);
    try {
      await perpService.closeTrade(asset, resolvedVenue);
      logger.info(`[BOT] ✅ Posição ${asset} fechada via comando`);
    } catch (err) {
      logger.error(`[BOT] ❌ Falha ao fechar ${asset}: ${err.message}`);
      state.addError(`cmd:close ${asset}`, err);
    }
  });

  // Fechar todas as posições — roteado via PerpExecutionService (respeita PERP_OPEN_VENUE)
  state.on('cmd:close_all', async ({ venue } = {}) => {
    const { venue: resolvedVenue, source } = resolveCloseVenue(null, venue, { allowActiveFallback: false });
    if (source === 'unresolved') {
      const err = new Error('Venue não resolvida para close_all; comando recusado por segurança');
      logger.error(`[BOT] ⛔ ${err.message}`);
      state.addError('cmd:close_all', err);
      return;
    }
    logger.info(`[BOT] 🔒 Comando: fechar TODAS as posições (venue: ${resolvedVenue})`);
    try {
      const results = await perpService.closeAllTrades(resolvedVenue);
      const ok = Array.isArray(results) ? results.filter(r => r.success).length : '?';
      const total = Array.isArray(results) ? results.length : '?';
      logger.info(`[BOT] ✅ Close all: ${ok}/${total} fechadas`);
    } catch (err) {
      logger.error(`[BOT] ❌ Falha no close_all: ${err.message}`);
      state.addError('cmd:close_all', err);
    }
  });

  // ── Comandos de execução manual ─────────────────────────────────────────────

  // Abrir posição manualmente — passa pelo mesmo risk manager do fluxo automático
  state.on('cmd:open_manual', handleOpenManualCommand);

  // Atualizar TP/SL de uma posição aberta
  state.on('cmd:update_tpsl', async (payload) => {
    await handleUpdateTpSlCommand(payload, 'cmd:update_tpsl');
  });

  // Alias de compatibilidade para clientes antigos que ainda emitam:
  //   cmd:set_tpsl { asset, type: 'tp'|'sl', price }
  state.on('cmd:set_tpsl', async ({ asset, type, price } = {}) => {
    const normalizedType = String(type ?? '').toLowerCase();
    if (!asset || (normalizedType !== 'tp' && normalizedType !== 'sl') || typeof price !== 'number' || price <= 0) {
      const err = new Error('Payload inválido para cmd:set_tpsl; esperado { asset, type: tp|sl, price>0 }');
      logger.error(`[BOT] ❌ ${err.message}`);
      state.addError('cmd:set_tpsl', err);
      return;
    }

    await handleUpdateTpSlCommand({
      asset,
      tp: normalizedType === 'tp' ? price : null,
      sl: normalizedType === 'sl' ? price : null,
    }, 'cmd:set_tpsl');
  });

  // Signal intake on/off
  state.on('cmd:intake', ({ enabled } = {}) => {
    state.setSignalIntakeEnabled(Boolean(enabled));
    logger.info(`[BOT] Signal intake ${enabled ? 'ativado' : 'desativado'} via cmd:intake`);
  });

  // Redução parcial de posição aberta
  state.on('cmd:reduce', async ({ asset, reducePercent } = {}) => {
    const context = 'cmd:reduce';
    if (!asset || reducePercent == null) {
      const err = new Error('Payload inválido para cmd:reduce; esperado { asset, reducePercent }');
      logger.error(`[BOT] ❌ ${err.message}`);
      state.addError(context, err);
      return;
    }
    logger.info(`[BOT] 📉 Comando: redução parcial ${reducePercent}% ${asset}`);
    try {
      const { reduceManualTrade } = await import('./trading/ManualTradeService.js');
      const result = await reduceManualTrade(asset, Number(reducePercent));
      if (!result.success) {
        logger.warn(`[BOT] ⛔ Redução parcial rejeitada: ${result.reason}`);
        state.addError(`${context} ${asset}`, new Error(result.reason));
      }
    } catch (err) {
      logger.error(`[BOT] ❌ Falha na redução parcial de ${asset}: ${err.message}`);
      state.addError(`${context} ${asset}`, err);
    }
  });
}

// ─── Inicialização ────────────────────────────────────────────────────────────
async function main() {
  printBanner();

  validateConfig();
  logger.info(`[BOT] Configurações validadas ✓`);
  logger.info('[BOT] Runtime', {
    nodeVersion: process.version,
    cwd: process.cwd(),
    backendRoot: runtimePaths.backendRoot,
    envPath: envLoadInfo.envPath,
    envLoadedFromFile: envLoadInfo.loadedFromFile,
    envLoadError: envLoadInfo.dotenvError,
    paperTrading: config.trading.paperMode,
    signalListenerEnabled: process.env.ENABLE_SIGNAL_LISTENER !== 'false',
    webEnabled: process.env.ENABLE_WEB === 'true',
    webPort: parseInt(process.env.WEB_PORT ?? '3000', 10),
    webHost: process.env.WEB_HOST || 'default',
    controlBotEnabled: process.env.ENABLE_CONTROL_BOT === 'true',
    walletPathConfigured: Boolean(process.env.BOT_WALLET_PATH),
    telegramSessionPathConfigured: Boolean(process.env.TELEGRAM_SESSION_PATH),
  });

  // Inicializar estado
  state.setMode(config.trading.paperMode ? 'paper' : 'live');

  // Venue preflight — validates liveReady + required capabilities (fails fast if not ok)
  runVenuePreflight(config.trading.paperMode);
  state.setActiveVenue(perpService.getActiveVenue());

  // Iniciar rastreamento de posições (alertas + trailing stop)
  positionManager.start();

  // Initialize only the infrastructure required by the active venue
  await initVenueInfra(config.trading.paperMode);

  // Registrar handlers de comandos remotos
  registerCommandHandlers();

  // Iniciar serviços opcionais (web, control bot)
  await startOptionalServices();

  // Poller de conta — mantém state atualizado com dados reais do Drift
  // (web dashboard e Telegram control leem daqui; sem isso ficam com zeros)
  await startAccountPoller();

  // Iniciar listener do Telegram (ENABLE_SIGNAL_LISTENER, default: true)
  const signalListenerEnabled = process.env.ENABLE_SIGNAL_LISTENER !== 'false';
  if (signalListenerEnabled) {
    logger.info(`[BOT] Iniciando listener Telegram...`);
    await startTelegramListener(handleSignalMessage);
    logger.info(
      `[BOT] ✅ Bot ativo — aguardando sinais no canal: ${config.telegram.channelId}`,
    );
  } else {
    logger.info(`[BOT] Signal listener desabilitado (ENABLE_SIGNAL_LISTENER=false)`);
  }

  state.setRunning(true);

  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function shutdown(signal) {
  logger.info(`\n[BOT] ${signal} recebido — encerrando...`);
  state.setRunning(false);
  const stats = signalStore.stats();
  logger.info(`[BOT] Sinais processados nesta sessão: ${stats.total}`);
  if (typeof _stopControlBot?.stopPolling === 'function') {
    _stopControlBot.stopPolling();
  }
  await shutdownVenueInfra();
  process.exit(0);
}

main().catch((err) => {
  console.error(`[BOT] Erro fatal: ${err.message}`);
  process.exit(1);
});
