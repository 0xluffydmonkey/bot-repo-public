// src/telegram/handlers/commands.js
// Handlers de slash commands. Mantém 100% de retrocompatibilidade com a v1.
// Os comandos agora usam InlineKeyboard e parse_mode: HTML.

import state    from '../../core/state.js';
import sessions from '../sessions.js';
import * as S   from '../ui/screens.js';
import * as KB  from '../ui/keyboards.js';

const HTML = { parse_mode: 'HTML', disable_web_page_preview: true };

/** Envia mensagem e persiste o messageId na sessão (para edições futuras via callback). */
async function send(bot, chatId, userId, text, keyboard) {
  const sent = await bot.sendMessage(chatId, text, { ...HTML, reply_markup: keyboard });
  if (userId) sessions.set(String(userId), { messageId: sent.message_id, chatId });
  return sent;
}

export function registerCommandHandlers(bot, handle) {
  // ── /start  /help ────────────────────────────────────────────────────────────
  bot.onText(/^\/(start|help)(@\S+)?$/, (msg) => handle(msg, async (chatId, msg) => {
    const snap = state.getSnapshot();
    await send(bot, chatId, msg.from?.id, S.renderMenu(snap), KB.mainMenuKeyboard(snap.status));
  }));

  // ── /status ──────────────────────────────────────────────────────────────────
  bot.onText(/^\/status(@\S+)?$/, (msg) => handle(msg, async (chatId) => {
    const snap = state.getSnapshot();
    await bot.sendMessage(chatId, S.renderStatus(snap), { ...HTML, reply_markup: KB.backToMenuKeyboard() });
  }));

  // ── /balance ─────────────────────────────────────────────────────────────────
  bot.onText(/^\/balance(@\S+)?$/, (msg) => handle(msg, async (chatId) => {
    const snap = state.getSnapshot();
    await bot.sendMessage(chatId, S.renderBalance(snap.account, snap.session), { ...HTML, reply_markup: KB.backToMenuKeyboard() });
  }));

  // ── /positions ───────────────────────────────────────────────────────────────
  bot.onText(/^\/positions(@\S+)?$/, (msg) => handle(msg, async (chatId, msg) => {
    const snap = state.getSnapshot();
    await send(bot, chatId, msg.from?.id,
      S.renderPositionsList(snap.positions),
      KB.positionsListKeyboard(snap.positions)
    );
  }));

  // ── /pnl ─────────────────────────────────────────────────────────────────────
  bot.onText(/^\/pnl(@\S+)?$/, (msg) => handle(msg, async (chatId, msg) => {
    const snap = state.getSnapshot();
    await send(bot, chatId, msg.from?.id,
      S.renderPnl(snap),
      KB.pnlKeyboard(snap.positions)
    );
  }));

  // ── /last_signal ─────────────────────────────────────────────────────────────
  bot.onText(/^\/last_signal(@\S+)?$/, (msg) => handle(msg, async (chatId) => {
    const snap = state.getSnapshot();
    await bot.sendMessage(chatId, S.renderSignals(snap), { ...HTML, reply_markup: KB.backToMenuKeyboard() });
  }));

  // ── /executed ────────────────────────────────────────────────────────────────
  bot.onText(/^\/executed(@\S+)?$/, (msg) => handle(msg, async (chatId) => {
    const snap = state.getSnapshot();
    await bot.sendMessage(chatId, S.renderSignals(snap), { ...HTML, reply_markup: KB.backToMenuKeyboard() });
  }));

  // ── /ignored ─────────────────────────────────────────────────────────────────
  bot.onText(/^\/ignored(@\S+)?$/, (msg) => handle(msg, async (chatId) => {
    const snap = state.getSnapshot();
    await bot.sendMessage(chatId, S.renderSignals(snap), { ...HTML, reply_markup: KB.backToMenuKeyboard() });
  }));

  // ── /errors ──────────────────────────────────────────────────────────────────
  bot.onText(/^\/errors(@\S+)?$/, (msg) => handle(msg, async (chatId) => {
    const snap = state.getSnapshot();
    await bot.sendMessage(chatId, S.renderErrors(snap.errors), { ...HTML, reply_markup: KB.backToMenuKeyboard() });
  }));

  // ── /mode ────────────────────────────────────────────────────────────────────
  bot.onText(/^\/mode(@\S+)?$/, (msg) => handle(msg, async (chatId) => {
    const snap = state.getSnapshot();
    await bot.sendMessage(chatId, S.renderConfig(snap), { ...HTML, reply_markup: KB.configKeyboard(snap.status) });
  }));

  // ── /pause ───────────────────────────────────────────────────────────────────
  bot.onText(/^\/pause(@\S+)?$/, (msg) => handle(msg, async (chatId) => {
    if (state.status.paused) {
      return bot.sendMessage(chatId, '⏸️ Bot já está pausado.', HTML);
    }
    state.setPaused(true);
    await bot.sendMessage(chatId,
      '⏸️ <b>Bot pausado.</b> Sinais serão recebidos mas não executados.\nUse /resume para retomar.',
      { ...HTML, reply_markup: KB.backToMenuKeyboard() }
    );
  }));

  // ── /resume ──────────────────────────────────────────────────────────────────
  bot.onText(/^\/resume(@\S+)?$/, (msg) => handle(msg, async (chatId) => {
    if (!state.status.paused) {
      return bot.sendMessage(chatId, '▶️ Bot já está ativo.', HTML);
    }
    state.setPaused(false);
    await bot.sendMessage(chatId,
      '▶️ <b>Bot retomado.</b> Sinais serão executados normalmente.',
      { ...HTML, reply_markup: KB.backToMenuKeyboard() }
    );
  }));

  // ── /autotrading on|off ───────────────────────────────────────────────────────
  bot.onText(/^\/autotrading(?:@\S+)?\s*(on|off)?$/i, (msg, match) => handle(msg, async (chatId) => {
    const arg = (match[1] ?? '').toLowerCase();
    if (!arg) {
      const snap = state.getSnapshot();
      return bot.sendMessage(chatId, S.renderConfig(snap), { ...HTML, reply_markup: KB.configKeyboard(snap.status) });
    }
    const enabled = arg === 'on';
    state.setAutoTrading(enabled);
    await bot.sendMessage(chatId,
      `🔄 Auto-trading ${enabled ? '<b>ativado ✅</b>' : '<b>desativado ❌</b>'}`,
      HTML
    );
  }));

  // ── /close <ATIVO> ────────────────────────────────────────────────────────────
  bot.onText(/^\/close(?:@\S+)?\s+(\S+)$/, (msg, match) => handle(msg, async (chatId, msg) => {
    const asset = match[1].toUpperCase();
    const pos   = state.positions.find(p => p.asset === asset);
    if (!pos) {
      return bot.sendMessage(chatId, `📭 Sem posição aberta em <b>${asset}</b>.`, HTML);
    }
    await send(bot, chatId, msg.from?.id, S.renderConfirmClose(pos), KB.confirmCloseKeyboard(asset));
  }));

  // ── /close_all ────────────────────────────────────────────────────────────────
  bot.onText(/^\/close_all(@\S+)?$/, (msg) => handle(msg, async (chatId, msg) => {
    if (!state.positions.length) {
      return bot.sendMessage(chatId, '📭 Nenhuma posição aberta para fechar.', HTML);
    }
    await send(bot, chatId, msg.from?.id,
      S.renderConfirmCloseAll(state.positions),
      KB.confirmCloseAllKeyboard()
    );
  }));
}
