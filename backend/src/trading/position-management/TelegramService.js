// src/trading/position-management/TelegramService.js
// Send-only Telegram alert service for position profit notifications.
//
// This service uses the existing bot token (TELEGRAM_BOT_TOKEN) with polling
// disabled, so it does NOT conflict with the Telegram control bot (polling: true).
//
// Config (non-sensitive, set in .env):
//   ENABLE_POSITION_ALERTS=true
//   POSITION_ALERT_PROFIT_PERCENT=10
//
// Secrets (MUST come from BOT_SECRETS_FILE — never from .env):
//   TELEGRAM_BOT_TOKEN  — already used by control bot; shared safely here
//   TELEGRAM_CHAT_ID    — destination chat for profit alerts (your personal chat or a group)
//
// SECURITY:
//   - Token is never logged (masked in all error messages)
//   - Chat ID is never logged

import TelegramBot from 'node-telegram-bot-api';
import logger from '../../utils/logger.js';

const SEND_TIMEOUT_MS = 10_000; // 10 s per attempt
const MAX_RETRIES     = 2;
const RETRY_DELAY_MS  = 1_500;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Telegram send timeout após ${ms}ms`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

class TelegramAlertService {
  constructor() {
    this._bot = null;
  }

  _getChatId() {
    return process.env.TELEGRAM_CHAT_ID ?? '';
  }

  _getToken() {
    return process.env.TELEGRAM_BOT_TOKEN ?? '';
  }

  _isConfigured() {
    const token  = this._getToken();
    const chatId = this._getChatId();
    return (
      token  && token  !== 'SET_IN_SERVER_ONLY' &&
      chatId && chatId !== 'SET_IN_SECRETS_ONLY'
    );
  }

  /**
   * Returns (or lazily creates) the send-only bot instance.
   * polling: false → no conflict with telegram_control.js (polling: true).
   */
  _ensureBot() {
    if (this._bot) return this._bot;

    const token = this._getToken();
    if (!token || token === 'SET_IN_SERVER_ONLY') {
      throw new Error('TELEGRAM_BOT_TOKEN não configurado no arquivo de secrets');
    }

    // polling: false — send-only, does not conflict with control bot
    this._bot = new TelegramBot(token, { polling: false });
    return this._bot;
  }

  /**
   * Send a plain or HTML-formatted message to the configured alert chat.
   * Silently skips if not configured.
   * Retries up to MAX_RETRIES times with timeout protection on each attempt.
   *
   * @param {string} message - HTML formatted message
   */
  async sendAlert(message) {
    if (!this._isConfigured()) {
      logger.debug('[TG_ALERT] TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurado — alerta ignorado');
      return;
    }

    const chatId = this._getChatId();
    const opts   = { parse_mode: 'HTML', disable_web_page_preview: true };

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const bot = this._ensureBot();
        await withTimeout(bot.sendMessage(chatId, message, opts), SEND_TIMEOUT_MS);
        logger.info('[TG_ALERT] Alerta de posição enviado');
        return; // success
      } catch (err) {
        // Never include token or chat ID in logged error
        const isLast = attempt === MAX_RETRIES;
        if (isLast) {
          logger.warn(`[TG_ALERT] telegram_failed — todas as tentativas esgotadas: ${err.message}`);
        } else {
          logger.warn(`[TG_ALERT] Tentativa ${attempt}/${MAX_RETRIES} falhou: ${err.message} — retentando`);
          await sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }
  }

  /**
   * Format a profit threshold alert message.
   *
   * @param {object} params
   * @param {string} params.symbol       - e.g. 'LONG SOL'
   * @param {string} params.venue        - e.g. 'drift'
   * @param {number} params.entryPrice
   * @param {number} params.currentPrice
   * @param {number} params.pnlPct       - percentage (e.g. 10.5 for 10.5%)
   * @param {number|null} params.stopPrice
   * @returns {string} HTML-formatted message
   */
  formatProfitAlert({ symbol, venue, entryPrice, currentPrice, pnlPct, stopPrice }) {
    const sign      = pnlPct >= 0 ? '+' : '';
    const stopLine  = stopPrice !== null && stopPrice !== undefined
      ? `$${stopPrice.toFixed(4)}`
      : 'N/A';

    return (
      `🚀 <b>Alerta de Lucro — ${symbol}</b>\n` +
      `\n` +
      `📍 <b>Venue:</b> ${venue.toUpperCase()}\n` +
      `📈 <b>Entrada:</b> <code>$${entryPrice.toFixed(4)}</code>\n` +
      `💰 <b>Preço atual:</b> <code>$${currentPrice.toFixed(4)}</code>\n` +
      `📊 <b>PnL:</b> <b>${sign}${pnlPct.toFixed(2)}%</b>\n` +
      `🛑 <b>Stop:</b> <code>${stopLine}</code>`
    );
  }
}

// Singleton — one instance shared across the process
export const telegramAlertService = new TelegramAlertService();
