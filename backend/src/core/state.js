// src/core/state.js
// Camada central de estado compartilhada entre bot, web e Telegram control.
// Todos os módulos leem e escrevem aqui; nenhum duplica lógica de cálculo.

import EventEmitter from 'events';
import logger from '../utils/logger.js';

const MAX_HISTORY = 50;

class BotState extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(30);

    // Dados da conta Drift (atualizado pelo data_fetcher a cada refresh)
    this.account = {
      freeCollateral: 0,
      totalEquity:    0,
      marginUsed:     0,
      unrealizedPnl:  0,
      isPaper:        false,
    };

    // Posições abertas (array de objetos do data_fetcher)
    this.positions = [];

    // Histórico de sinais
    this.signals = {
      last:     null,   // último sinal recebido
      count:    0,      // total de sinais detectados
      executed: [],     // [{ signal, result, timestamp }]
      ignored:  [],     // [{ signal, reason, timestamp }]
    };

    // Log de erros recentes
    this.errors = [];

    // Status operacional do bot
    this.status = {
      running:     false,
      paused:      false,      // sinais recebidos mas não executados
      autoTrading: true,       // false = só monitora, não executa
      mode:        'paper',    // 'live' | 'paper'
      startedAt:   null,
    };

    // PnL da sessão
    this.session = {
      startPnl:   null,
      sessionPnl: 0,
    };

    // Confirmações pendentes do Telegram (userId → { action, timer })
    this._pendingConfirm = new Map();

    this.lastUpdate = null;
  }

  // ── Atualização de dados de conta ──────────────────────────────────────────
  updateAccount(data) {
    this.account = { ...this.account, ...data };

    if (this.session.startPnl === null && data.unrealizedPnl != null) {
      this.session.startPnl = data.unrealizedPnl;
    }
    if (this.session.startPnl !== null) {
      this.session.sessionPnl = (this.account.unrealizedPnl ?? 0) - this.session.startPnl;
    }

    this.lastUpdate = new Date();
    this.emit('account:update', this.account);
    this.emit('update', this.getSnapshot());
  }

  updatePositions(positions) {
    this.positions = positions;
    this.lastUpdate = new Date();
    this.emit('positions:update', positions);
    this.emit('update', this.getSnapshot());
  }

  // ── Rastreamento de sinais ──────────────────────────────────────────────────
  signalReceived(signal) {
    this.signals.last  = { ...signal, receivedAt: new Date() };
    this.signals.count++;
    this.emit('signal:received', signal);
    this.emit('update', this.getSnapshot());
  }

  signalExecuted(signal, result) {
    const entry = { signal, result, timestamp: new Date() };
    this.signals.executed.unshift(entry);
    if (this.signals.executed.length > MAX_HISTORY) this.signals.executed.pop();
    this.emit('signal:executed', entry);
    this.emit('update', this.getSnapshot());
  }

  signalIgnored(signal, reason) {
    const entry = { signal: signal ?? {}, reason, timestamp: new Date() };
    this.signals.ignored.unshift(entry);
    if (this.signals.ignored.length > MAX_HISTORY) this.signals.ignored.pop();
    this.emit('signal:ignored', entry);
    this.emit('update', this.getSnapshot());
  }

  // ── Erros ──────────────────────────────────────────────────────────────────
  addError(context, error) {
    const entry = {
      context,
      message:   error?.message ?? String(error),
      timestamp: new Date(),
    };
    this.errors.unshift(entry);
    if (this.errors.length > MAX_HISTORY) this.errors.pop();
    this.emit('error:logged', entry);
    this.emit('update', this.getSnapshot());
  }

  // ── Controles operacionais ──────────────────────────────────────────────────
  setRunning(running) {
    this.status.running = running;
    if (running && !this.status.startedAt) this.status.startedAt = new Date();
    this.emit('status:update', this.status);
    this.emit('update', this.getSnapshot());
  }

  setPaused(paused) {
    this.status.paused = paused;
    logger.info(`[STATE] Bot ${paused ? 'pausado ⏸' : 'retomado ▶'}`);
    this.emit('status:update', this.status);
    this.emit('update', this.getSnapshot());
  }

  setAutoTrading(enabled) {
    this.status.autoTrading = enabled;
    logger.info(`[STATE] Auto-trading ${enabled ? 'ativado ✅' : 'desativado ❌'}`);
    this.emit('status:update', this.status);
    this.emit('update', this.getSnapshot());
  }

  setMode(mode) {
    this.status.mode = mode;
    this.emit('status:update', this.status);
    this.emit('update', this.getSnapshot());
  }

  // ── Confirmações pendentes do Telegram ────────────────────────────────────
  setPendingConfirm(userId, action, expiresInMs = 30_000) {
    const existing = this._pendingConfirm.get(userId);
    if (existing?.timer) clearTimeout(existing.timer);
    const timer = setTimeout(() => this._pendingConfirm.delete(userId), expiresInMs);
    this._pendingConfirm.set(userId, { action, timer });
  }

  checkAndClearConfirm(userId, action) {
    const pending = this._pendingConfirm.get(userId);
    if (pending && pending.action === action) {
      clearTimeout(pending.timer);
      this._pendingConfirm.delete(userId);
      return true;
    }
    return false;
  }

  // ── Snapshot completo (serializable) ──────────────────────────────────────
  getSnapshot() {
    const now = new Date();
    return {
      account:   { ...this.account },
      positions: [...this.positions],
      signals: {
        last:     this.signals.last,
        count:    this.signals.count,
        executed: this.signals.executed.slice(0, 10),
        ignored:  this.signals.ignored.slice(0, 10),
      },
      errors: this.errors.slice(0, 10),
      status: {
        ...this.status,
        uptime: this.status.startedAt
          ? Math.floor((now - this.status.startedAt) / 1000)
          : 0,
      },
      session:    { ...this.session },
      lastUpdate: this.lastUpdate,
    };
  }
}

// Singleton — único state compartilhado por todo o processo
export default new BotState();
