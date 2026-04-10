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

function parseManualOpenInput(text) {
  const tokens = String(text ?? '')
    .trim()
    .replace(/\n+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length < 6) {
    throw new Error('Formato inválido. Use: ATIVO DIRECAO ENTRADA TP SL LEVERAGE [MARGEM]');
  }

  const [assetRaw, directionRaw, entryRaw, tpRaw, slRaw, leverageRaw, marginRaw = 'isolated'] = tokens;
  const direction = directionRaw.toUpperCase();
  const marginType = marginRaw.toLowerCase();
  const toNumber = (value) => Number(String(value).replace(',', '.'));

  const params = {
    asset: assetRaw.toUpperCase(),
    direction,
    entry: toNumber(entryRaw),
    tp: toNumber(tpRaw),
    sl: toNumber(slRaw),
    leverage: toNumber(leverageRaw),
    marginType,
  };

  if (!['LONG', 'SHORT'].includes(direction)) {
    throw new Error('Direção inválida. Use LONG ou SHORT.');
  }
  if (!['isolated', 'cross'].includes(marginType)) {
    throw new Error('Margem inválida. Use isolated ou cross.');
  }
  if ([params.entry, params.tp, params.sl, params.leverage].some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Entrada, TP, SL e leverage devem ser números positivos.');
  }

  return params;
}

async function waitForTpSlUpdate(asset, tp, sl, startedAt, timeout = 35_000) {
  const interval = 1_000;
  let elapsed = 0;

  while (elapsed < timeout) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    elapsed += interval;

    const error = state.errors.find((entry) => {
      const ts = new Date(entry.timestamp ?? 0).getTime();
      return typeof entry.context === 'string' && entry.context.startsWith('cmd:update_tpsl') && entry.context.includes(asset) && ts >= startedAt;
    });
    if (error) return { status: 'error', message: error.message };

    const pos = state.positions.find((entry) => entry.asset === asset);
    if (!pos) continue;

    const tpOk = tp == null || Number(pos.tp) === Number(tp);
    const slOk = sl == null || Number(pos.sl) === Number(sl);
    if (tpOk && slOk) return { status: 'updated', position: pos };
  }

  return { status: 'timeout' };
}

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
    if (userId != null) {
      sessions.clearWaiting(String(userId));
      sessions.set(String(userId), { manualOpenDraft: null });
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
    if (waiting.kind === 'reduce') {
      const { asset } = waiting;
      const percent = parseInt(msg.text.trim(), 10);

      if (isNaN(percent) || percent < 1 || percent > 95) {
        await bot.sendMessage(chatId,
          `❌ Percentual inválido: <code>${msg.text.trim()}</code>\nDigite um número inteiro entre <code>1</code> e <code>95</code>.`,
          HTML
        ).catch(() => {});
        return;
      }

      sessions.clearWaiting(userId);

      const pos = state.positions.find(p => p.asset === asset);
      if (!pos) {
        await bot.sendMessage(chatId, `📭 Posição <b>${asset}</b> não encontrada.`, HTML).catch(() => {});
        return;
      }

      const text     = S.renderConfirmReduce(pos, percent);
      const keyboard = KB.confirmReduceKeyboard(asset, percent);
      const session  = sessions.get(userId);

      if (session.messageId && session.chatId) {
        try {
          await bot.editMessageText(text, {
            chat_id:    session.chatId,
            message_id: session.messageId,
            parse_mode: 'HTML',
            reply_markup: keyboard,
            disable_web_page_preview: true,
          });
        } catch {
          const sent = await bot.sendMessage(chatId, text, { ...HTML, reply_markup: keyboard });
          sessions.set(userId, { messageId: sent.message_id, chatId });
        }
      } else {
        const sent = await bot.sendMessage(chatId, text, { ...HTML, reply_markup: keyboard });
        sessions.set(userId, { messageId: sent.message_id, chatId });
      }
      return;
    }

    if (waiting.kind === 'manual_open') {
      try {
        const params = parseManualOpenInput(msg.text);
        sessions.clearWaiting(userId);
        sessions.set(userId, { manualOpenDraft: params });

        const text = S.renderConfirmManualOpen(params, state.status.mode === 'paper');
        const keyboard = KB.manualOpenConfirmKeyboard();
        const session = sessions.get(userId);

        if (session.messageId && session.chatId) {
          try {
            await bot.editMessageText(text, {
              chat_id: session.chatId,
              message_id: session.messageId,
              parse_mode: 'HTML',
              reply_markup: keyboard,
              disable_web_page_preview: true,
            });
          } catch {
            const sent = await bot.sendMessage(chatId, text, { ...HTML, reply_markup: keyboard });
            sessions.set(userId, { messageId: sent.message_id, chatId });
          }
        } else {
          const sent = await bot.sendMessage(chatId, text, { ...HTML, reply_markup: keyboard });
          sessions.set(userId, { messageId: sent.message_id, chatId });
        }
      } catch (err) {
        await bot.sendMessage(chatId,
          `❌ ${err.message}\n\nUse o formato:\n<code>ATIVO DIRECAO ENTRADA TP SL LEVERAGE [MARGEM]</code>`,
          HTML
        ).catch(() => {});
      }
      return;
    }

    const type = waiting.type;
    const asset = waiting.asset;
    const price = parseFloat(msg.text.trim().replace(',', '.'));
    if (isNaN(price) || price <= 0) {
      await bot.sendMessage(chatId,
        `❌ Valor inválido: <code>${msg.text.trim()}</code>\nDigite um preço numérico positivo.`,
        HTML
      ).catch(() => {});
      return;
    }

    sessions.clearWaiting(userId);

    const payload = {
      asset,
      tp: type === 'tp' ? price : null,
      sl: type === 'sl' ? price : null,
    };
    const startedAt = Date.now();
    state.emit('cmd:update_tpsl', payload);
    logger.info(`[CTRL] cmd:update_tpsl emitido: ${asset} ${type.toUpperCase()} → ${price}`);

    const label   = type === 'tp' ? 'Take Profit' : 'Stop Loss';
    const emoji   = type === 'tp' ? '🎯' : '🛑';
    const session = sessions.get(userId);

    const updateText = async (text, keyboard = KB.backToMenuKeyboard()) => {
      if (session.messageId && session.chatId) {
        try {
          await bot.editMessageText(text, {
            chat_id: session.chatId,
            message_id: session.messageId,
            parse_mode: 'HTML',
            reply_markup: keyboard,
            disable_web_page_preview: true,
          });
          return;
        } catch {}
      }
      await bot.sendMessage(chatId, text, { ...HTML, reply_markup: keyboard }).catch(() => {});
    };

    await updateText(`${emoji} <b>Atualizando ${label}</b>\n\n<b>${asset}</b>: <code>${price}</code>\n\n<i>Aguardando confirmação...</i>`, { inline_keyboard: [] });

    const outcome = await waitForTpSlUpdate(asset, payload.tp, payload.sl, startedAt, 35_000);
    if (outcome.status === 'updated') {
      await updateText(`${emoji} <b>${label} atualizado</b>\n\n<b>${asset}</b>: <code>${price}</code>`);
    } else if (outcome.status === 'error') {
      await updateText(`⛔ <b>Falha ao atualizar ${label}</b>\n\n${outcome.message}`);
    } else {
      await updateText(`⚠️ <b>Comando enviado.</b>\n\nUse /positions para confirmar o novo ${label}.`);
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
