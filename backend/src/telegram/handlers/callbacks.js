// src/telegram/handlers/callbacks.js
// Handler central de callback_query (InlineKeyboard).
// Todas as navegações e ações via botão passam aqui.

import state    from '../../core/state.js';
import logger   from '../../utils/logger.js';
import sessions from '../sessions.js';
import * as S   from '../ui/screens.js';
import * as KB  from '../ui/keyboards.js';

const HTML = { parse_mode: 'HTML', disable_web_page_preview: true };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Edita mensagem existente em vez de enviar nova — sem spam. */
async function editScreen(bot, chatId, messageId, text, keyboard) {
  try {
    await bot.editMessageText(text, {
      chat_id:                  chatId,
      message_id:               messageId,
      parse_mode:               'HTML',
      reply_markup:             keyboard,
      disable_web_page_preview: true,
    });
  } catch (err) {
    // Ignorar "message is not modified" (conteúdo idêntico ao atual)
    if (!err.message?.includes('message is not modified')) {
      logger.warn(`[CTRL] editMessageText falhou: ${err.message}`);
    }
  }
}

/** Responde ao callback query para remover o "loading" spinner. */
async function ack(bot, queryId, text) {
  try {
    await bot.answerCallbackQuery(queryId, text ? { text, show_alert: false } : {});
  } catch (_) { /* silenciar erro de timeout do Telegram */ }
}

/** Mostra mensagem de alerta no popup (não edita a tela). */
async function alert(bot, queryId, text) {
  try {
    await bot.answerCallbackQuery(queryId, { text, show_alert: true });
  } catch (_) {}
}

/** Espera fechamento de posição com polling (max `timeout` ms). */
async function waitForClose(asset, timeout = 15_000) {
  const interval = 1_000;
  let elapsed    = 0;
  while (elapsed < timeout) {
    await new Promise(r => setTimeout(r, interval));
    elapsed += interval;
    if (!state.positions.find(p => p.asset === asset)) return true;
  }
  return false;
}

// ── Registro do handler ───────────────────────────────────────────────────────

export function registerCallbackHandler(bot, isAllowed, audit) {
  bot.on('callback_query', async (query) => {
    const { id: queryId, from, message, data } = query;

    // Auth
    if (!isAllowed({ from })) {
      await alert(bot, queryId, '⛔ Não autorizado');
      return;
    }

    const chatId    = message.chat.id;
    const messageId = message.message_id;
    const userId    = String(from.id);

    audit(from.id, from.username, `cb:${data}`);

    // Persiste o messageId atual para edições futuras
    sessions.set(userId, { messageId, chatId });

    try {
      await dispatch(bot, { queryId, chatId, messageId, userId, data });
    } catch (err) {
      logger.error(`[CTRL] Erro no callback "${data}": ${err.message}`);
      await alert(bot, queryId, '❌ Erro interno');
    }
  });
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

async function dispatch(bot, { queryId, chatId, messageId, userId, data }) {
  const snap = state.getSnapshot();

  // Helper local: edita + ack em uma chamada
  const show = async (text, keyboard, ackText) => {
    await ack(bot, queryId, ackText);
    await editScreen(bot, chatId, messageId, text, keyboard);
  };

  // ─── Menu principal ─────────────────────────────────────────────────────────
  if (data === 'menu') {
    return show(S.renderMenu(snap), KB.mainMenuKeyboard(snap.status));
  }

  if (data === 'menu:status') {
    return show(S.renderStatus(snap), KB.backToMenuKeyboard());
  }

  if (data === 'menu:balance') {
    return show(S.renderBalance(snap.account, snap.session), KB.backToMenuKeyboard());
  }

  if (data === 'menu:positions') {
    return show(S.renderPositionsList(snap.positions), KB.positionsListKeyboard(snap.positions));
  }

  if (data === 'menu:pnl') {
    return show(S.renderPnl(snap), KB.pnlKeyboard(snap.positions));
  }

  if (data === 'menu:signals') {
    return show(S.renderSignals(snap), KB.backToMenuKeyboard());
  }

  if (data === 'menu:config') {
    return show(S.renderConfig(snap), KB.configKeyboard(snap.status));
  }

  // ─── PnL: refresh ───────────────────────────────────────────────────────────
  if (data === 'pnl:refresh') {
    const fresh = state.getSnapshot();
    return show(S.renderPnl(fresh), KB.pnlKeyboard(fresh.positions), '🔄');
  }

  // ─── PnL: fechar via tela PnL (redireciona para confirm) ──────────────────
  if (data.startsWith('pnl:close:')) {
    const asset = data.slice('pnl:close:'.length);
    const pos   = state.positions.find(p => p.asset === asset);
    if (!pos) { await alert(bot, queryId, `📭 Sem posição em ${asset}`); return; }
    return show(S.renderConfirmClose(pos), KB.confirmCloseKeyboard(asset));
  }

  // ─── Posição: ver detalhes ──────────────────────────────────────────────────
  if (data.startsWith('pos:view:') || data.startsWith('pos:refresh:')) {
    const isRefresh = data.startsWith('pos:refresh:');
    const asset     = data.slice(isRefresh ? 'pos:refresh:'.length : 'pos:view:'.length);
    const pos       = state.positions.find(p => p.asset === asset);

    if (!pos) {
      await alert(bot, queryId, `📭 Posição ${asset} não encontrada`);
      return;
    }

    const fresh = state.getSnapshot();
    return show(
      S.renderPositionDetail(pos, fresh),
      KB.positionDetailKeyboard(asset),
      isRefresh ? '🔄' : undefined
    );
  }

  // ─── Posição: iniciar fechamento (mostrar tela de confirmação) ─────────────
  if (data.startsWith('pos:close:') && !data.startsWith('pos:close_ok:')) {
    const asset = data.slice('pos:close:'.length);
    const pos   = state.positions.find(p => p.asset === asset);
    if (!pos) { await alert(bot, queryId, `📭 Sem posição em ${asset}`); return; }
    return show(S.renderConfirmClose(pos), KB.confirmCloseKeyboard(asset));
  }

  // ─── Posição: confirmar fechamento ─────────────────────────────────────────
  if (data.startsWith('pos:close_ok:')) {
    const asset = data.slice('pos:close_ok:'.length);
    const pos   = state.positions.find(p => p.asset === asset);
    if (!pos) { await alert(bot, queryId, `📭 Sem posição em ${asset}`); return; }

    await ack(bot, queryId, `🔄 Fechando ${asset}…`);
    await editScreen(bot, chatId, messageId,
      `🔄 <b>Fechando ${asset}…</b>\n\nAguarde a confirmação da blockchain.`,
      { inline_keyboard: [] }
    );

    state.emit('cmd:close', { asset });

    const closed = await waitForClose(asset, 20_000);
    const fresh  = state.getSnapshot();

    if (closed) {
      await editScreen(bot, chatId, messageId,
        `✅ <b>Posição ${asset} fechada com sucesso.</b>`,
        KB.backToMenuKeyboard()
      );
    } else {
      await editScreen(bot, chatId, messageId,
        `⚠️ <b>Comando enviado.</b>\nUse /positions para verificar o status.`,
        KB.backToMenuKeyboard()
      );
    }
    return;
  }

  // ─── Fechar todas: mostrar confirmação ─────────────────────────────────────
  if (data === 'ctrl:close_all') {
    const positions = state.positions;
    if (!positions.length) { await alert(bot, queryId, '📭 Nenhuma posição aberta'); return; }
    return show(S.renderConfirmCloseAll(positions), KB.confirmCloseAllKeyboard());
  }

  // ─── Fechar todas: executar ─────────────────────────────────────────────────
  if (data === 'ctrl:close_all_ok') {
    const count = state.positions.length;
    await ack(bot, queryId, `🔄 Fechando ${count} posição(ões)…`);
    state.emit('cmd:close_all');
    return editScreen(bot, chatId, messageId,
      `🔄 <b>Fechando ${count} posição(ões)…</b>\n\nVerifique /positions em instantes.`,
      KB.backToMenuKeyboard()
    );
  }

  // ─── Pausar / Retomar ──────────────────────────────────────────────────────
  if (data === 'ctrl:pause') {
    state.setPaused(true);
    const fresh = state.getSnapshot();
    return show(S.renderMenu(fresh), KB.mainMenuKeyboard(fresh.status), '⏸️ Pausado');
  }

  if (data === 'ctrl:resume') {
    state.setPaused(false);
    const fresh = state.getSnapshot();
    return show(S.renderMenu(fresh), KB.mainMenuKeyboard(fresh.status), '▶️ Retomado');
  }

  // ─── Auto-trading ──────────────────────────────────────────────────────────
  if (data === 'ctrl:at_on') {
    state.setAutoTrading(true);
    const fresh = state.getSnapshot();
    return show(S.renderMenu(fresh), KB.mainMenuKeyboard(fresh.status), '✅ Auto-trading ON');
  }

  if (data === 'ctrl:at_off') {
    state.setAutoTrading(false);
    const fresh = state.getSnapshot();
    return show(S.renderMenu(fresh), KB.mainMenuKeyboard(fresh.status), '❌ Auto-trading OFF');
  }

  // ─── Modificar TP / SL: entrar em modo de input ────────────────────────────
  if (data.startsWith('pos:tp:') || data.startsWith('pos:sl:')) {
    const type  = data.startsWith('pos:tp:') ? 'tp' : 'sl';
    const asset = data.slice((`pos:${type}:`).length);
    const pos   = state.positions.find(p => p.asset === asset);

    if (!pos) { await alert(bot, queryId, `📭 Sem posição em ${asset}`); return; }

    sessions.setWaiting(userId, { type, asset });
    return show(S.renderAskTpSl(pos, type), KB.inputCancelKeyboard(asset));
  }

  // ─── Fallback ──────────────────────────────────────────────────────────────
  logger.warn(`[CTRL] Callback não mapeado: ${data}`);
  await alert(bot, queryId, '❓ Ação não reconhecida');
}
