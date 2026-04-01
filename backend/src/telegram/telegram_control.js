// src/telegram/telegram_control.js
// Bootstrap do bot de controle Telegram.
// Cria o bot, wires auth/handle, registra handlers de comandos e callbacks,
// inicia o position tracker e processa entradas de texto (TP/SL).

import TelegramBot from 'node-telegram-bot-api';
import state       from '../core/state.js';
import logger      from '../utils/logger.js';
import { config }  from '../config/index.js';

import sessions from './sessions.js';
import { registerCommandHandlers }  from './handlers/commands.js';
import { registerCallbackHandler }  from './handlers/callbacks.js';
import { startPositionTracker }     from './position_tracker.js';
import * as S  from './ui/screens.js';
import * as KB from './ui/keyboards.js';

const HTML = { parse_mode: 'HTML', disable_web_page_preview: true };

// ── Audit log ─────────────────────────────────────────────────────────────────

function audit(userId, username, action) {
  logger.info(`[CTRL] ${action} | User: ${username ?? 'desconhecido'} (${userId})`);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * @param {string}   token
 * @param {string[]} allowedIds  - array de user IDs como strings
 * @returns {import('node-telegram-bot-api')} bot
 */
export function startControlBot(token, allowedIds = []) {
  const bot = new TelegramBot(token, { polling: true });

  // ── Auth ───────────────────────────────────────────────────────────────────

  /** @param {{ from?: { id: number } }} msg */
  function isAllowed(msg) {
    const id = String(msg?.from?.id ?? '');
    return allowedIds.length === 0 || allowedIds.includes(id);
  }

  /**
   * Wrapper que valida auth, faz audit e trata erros para qualquer handler.
   * @param {Object}   msg
   * @param {Function} fn  - async (chatId, msg) => void
   */
  function handle(msg, fn) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!isAllowed(msg)) {
      logger.warn(`[CTRL] ⛔ Acesso negado userId=${userId}`);
      bot.sendMessage(chatId, '⛔ Acesso não autorizado.').catch(() => {});
      return;
    }
    audit(userId, msg.from?.username, msg.text ?? '(callback)');
    Promise.resolve(fn(chatId, msg)).catch(err => {
      logger.error(`[CTRL] Erro no handler: ${err.message}`);
      bot.sendMessage(chatId, `❌ Erro interno: ${err.message}`).catch(() => {});
    });
  }

  // ── Registrar handlers de comandos e callbacks ─────────────────────────────

  registerCommandHandlers(bot, handle);
  registerCallbackHandler(bot, isAllowed, audit);

  // ── Entrada de texto livre (para TP/SL) ────────────────────────────────────

  bot.on('message', async (msg) => {
    // Ignorar mensagens que são comandos (já tratadas por onText)
    if (!msg.text || msg.text.startsWith('/')) return;
    if (!isAllowed(msg)) return;

    const userId = String(msg.from?.id);
    const chatId = msg.chat.id;

    if (!sessions.isWaiting(userId)) return;

    const waiting = sessions.getWaiting(userId);
    const { type, asset } = waiting;

    const price = parseFloat(msg.text.trim().replace(',', '.'));
    if (isNaN(price) || price <= 0) {
      await bot.sendMessage(chatId,
        `❌ Valor inválido: <code>${msg.text.trim()}</code>\nDigite um preço numérico positivo.`,
        HTML
      ).catch(() => {});
      return;
    }

    sessions.clearWaiting(userId);

    // Emite o evento para que o executor/index.js aplique a modificação
    state.emit('cmd:set_tpsl', { asset, type, price });
    logger.info(`[CTRL] cmd:set_tpsl emitido: ${asset} ${type.toUpperCase()} → ${price}`);

    // Feedback imediato ao usuário
    const label   = type === 'tp' ? 'Take Profit' : 'Stop Loss';
    const emoji   = type === 'tp' ? '🎯' : '🛑';
    const session = sessions.get(userId);

    const text = `${emoji} <b>${label} atualizado</b>\n\n<b>${asset}</b>: <code>${price}</code>\n\n<i>Aguarde confirmação da blockchain.</i>`;

    // Tenta editar a mensagem anterior; se falhar, envia nova
    if (session.messageId && session.chatId) {
      try {
        await bot.editMessageText(text, {
          chat_id:                  session.chatId,
          message_id:               session.messageId,
          parse_mode:               'HTML',
          reply_markup:             KB.backToMenuKeyboard(),
          disable_web_page_preview: true,
        });
      } catch {
        await bot.sendMessage(chatId, text, { ...HTML, reply_markup: KB.backToMenuKeyboard() }).catch(() => {});
      }
    } else {
      await bot.sendMessage(chatId, text, { ...HTML, reply_markup: KB.backToMenuKeyboard() }).catch(() => {});
    }
  });

  // ── Position Tracker ───────────────────────────────────────────────────────

  // chatIds para broadcast = allowedIds convertidos para número
  // (cada ID autorizado recebe os cards de posição)
  const chatIds = allowedIds
    .map(id => parseInt(id, 10))
    .filter(id => !isNaN(id));

  if (chatIds.length > 0) {
    startPositionTracker(bot, chatIds, {
      refreshIntervalMs: config.trading.pnlRefreshIntervalMs,
    });
  } else {
    logger.warn('[CTRL] Nenhum chatId configurado — position tracker desativado');
  }

  // ── Erros de polling ───────────────────────────────────────────────────────

  bot.on('polling_error', (err) => {
    logger.error(`[CTRL] Polling error: ${err.message}`);
  });

  logger.info(`[CTRL] Bot de controle Telegram iniciado (${allowedIds.length} IDs autorizados)`);
  return bot;
}
