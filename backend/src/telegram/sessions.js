// src/telegram/sessions.js
// Gerenciador de sessão por usuário.
// Armazena: messageId para edição, tela atual, contexto de navegação,
// e estado de "aguardando entrada de texto" (para TP/SL).

class SessionManager {
  constructor() {
    /** @type {Map<string, SessionData>} */
    this._sessions = new Map();
  }

  /** @returns {SessionData} */
  get(userId) {
    return this._sessions.get(String(userId)) ?? {};
  }

  set(userId, data) {
    const current = this.get(userId);
    this._sessions.set(String(userId), { ...current, ...data });
  }

  clear(userId) {
    this._sessions.delete(String(userId));
  }

  // ── Controle de entrada de texto (TP/SL) ─────────────────────────────────

  isWaiting(userId) {
    return this.get(userId).waitingFor != null;
  }

  getWaiting(userId) {
    return this.get(userId).waitingFor ?? null;
  }

  /** @param {{ type: 'tp'|'sl', asset: string }} waitingFor */
  setWaiting(userId, waitingFor) {
    this.set(userId, { waitingFor });
  }

  clearWaiting(userId) {
    const s = this.get(userId);
    const { waitingFor: _, ...rest } = s;
    this._sessions.set(String(userId), rest);
  }
}

// Singleton por processo
export default new SessionManager();

/**
 * @typedef {Object} SessionData
 * @property {number}  [messageId]   - ID da última mensagem enviada pelo bot (para edição)
 * @property {number}  [chatId]      - Chat ID do usuário
 * @property {string}  [screen]      - Nome da tela atual
 * @property {Object}  [waitingFor]  - { type: 'tp'|'sl', asset: string } | null
 */
