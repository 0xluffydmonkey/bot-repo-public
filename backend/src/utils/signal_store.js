// src/utils/signal_store.js
// Armazena IDs de sinais já processados para evitar duplicatas
// Em produção, substituir por Redis ou SQLite para persistência

import logger from './logger.js';

class SignalStore {
  constructor() {
    this.processed = new Map(); // signalId → { timestamp, result }
    this.MAX_SIZE = 1000;       // limite de memória
  }

  /**
   * Verifica se o sinal já foi processado
   */
  has(signalId) {
    return this.processed.has(signalId);
  }

  /**
   * Marca o sinal como processado
   */
  add(signalId, result = {}) {
    if (this.processed.size >= this.MAX_SIZE) {
      // Remove os 100 mais antigos
      const keys = [...this.processed.keys()].slice(0, 100);
      keys.forEach(k => this.processed.delete(k));
      logger.warn(`[STORE] Cache cheio, removendo 100 entradas antigas`);
    }

    this.processed.set(signalId, {
      timestamp: new Date().toISOString(),
      ...result,
    });

    logger.debug(`[STORE] Sinal registrado: ${signalId} (total: ${this.processed.size})`);
  }

  /**
   * Retorna dados de um sinal processado
   */
  get(signalId) {
    return this.processed.get(signalId);
  }

  /**
   * Estatísticas
   */
  stats() {
    return {
      total:    this.processed.size,
      signals:  [...this.processed.keys()],
    };
  }
}

// Singleton
export const signalStore = new SignalStore();
