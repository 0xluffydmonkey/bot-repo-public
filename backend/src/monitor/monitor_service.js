// src/monitor/monitor_service.js
// Loop principal do monitor: busca dados → renderiza → aguarda → repete

import { fetchAccountData } from './data_fetcher.js';
import { render, renderError, cleanup } from './ui.js';
import logger from '../utils/logger.js';
import state  from '../core/state.js';

// Remove o transporte Console do winston enquanto o monitor está ativo.
// O dashboard ocupa o stdout inteiro — logs do console poluiriam o layout.
// Os logs continuam sendo escritos nos arquivos normalmente.
function silenceConsole() {
  logger.transports.forEach(t => {
    if (t.name === 'console') t.silent = true;
  });
}
function restoreConsole() {
  logger.transports.forEach(t => {
    if (t.name === 'console') t.silent = false;
  });
}

const DEFAULT_REFRESH_MS = 10_000;

/**
 * Inicia o monitor em loop contínuo.
 *
 * @param {object} opts
 * @param {number} [opts.refreshMs]   - Intervalo de atualização em ms (padrão: 3000)
 * @param {boolean} [opts.standalone] - true = registra SIGINT próprio
 */
export async function startMonitor(opts = {}) {
  const refreshMs = parseInt(process.env.MONITOR_REFRESH_MS ?? '', 10) || opts.refreshMs || DEFAULT_REFRESH_MS;

  let lastData       = null;
  let errorCount     = 0;
  let running        = true;
  let timer          = null;
  let sessionStartPnl = null; // PnL no primeiro fetch bem-sucedido

  // Shutdown limpo
  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
    restoreConsole();
    cleanup();
    process.exit(0);
  }

  if (opts.standalone) {
    process.on('SIGINT',  stop);
    process.on('SIGTERM', stop);
  }

  // ── Loop de atualização ────────────────────────────────────────────────────
  async function tick() {
    if (!running) return;

    try {
      const data = await fetchAccountData();
      lastData   = data;
      errorCount = 0;

      // Captura PnL inicial uma única vez para calcular ganho da sessão
      if (sessionStartPnl === null) {
        sessionStartPnl = data.account.unrealizedPnl;
      }
      const sessionPnl = data.account.unrealizedPnl - sessionStartPnl;

      const nextRefresh = new Date(Date.now() + refreshMs);

      // Estatísticas de sinais vêm do state store (compartilhado com bot/web)
      const snap = state.getSnapshot();
      const stats = {
        signals:  snap.signals.count,
        executed: snap.signals.executed.length,
        ignored:  snap.signals.ignored.length,
        errors:   snap.errors.length,
      };

      render(data, { refreshMs, nextRefresh, errorCount, sessionPnl, stats });
    } catch (err) {
      errorCount++;
      renderError(err, lastData);
    }

    if (running) {
      timer = setTimeout(tick, refreshMs);
    }
  }

  // Silencia logs no console — o dashboard ocupa o stdout inteiro
  silenceConsole();

  // Limpa a tela uma única vez antes de começar (evita lixo de conteúdo anterior)
  process.stdout.write('\x1b[2J\x1b[H');

  // Primeira execução imediata
  await tick();

  return { stop };
}