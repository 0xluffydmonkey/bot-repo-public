// src/telegram/handlers/callbacks.js
// Handler central de callback_query (InlineKeyboard).
// Todas as navegações e ações via botão passam aqui.

import state    from '../../core/state.js';
import logger   from '../../utils/logger.js';
import sessions from '../sessions.js';
import * as S   from '../ui/screens.js';
import * as KB  from '../ui/keyboards.js';

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

async function waitForCloseAll(timeout = 20_000) {
  const interval = 1_000;
  let elapsed = 0;
  while (elapsed < timeout) {
    await new Promise(r => setTimeout(r, interval));
    elapsed += interval;
    if (state.positions.length === 0) return true;
  }
  return false;
}

function isRecentError(entry, contextPrefix, since) {
  if (!entry?.context || typeof entry.context !== 'string') return false;
  const ts = new Date(entry.timestamp ?? 0).getTime();
  return entry.context.startsWith(contextPrefix) && ts >= since;
}

async function waitForReduce(asset, since, timeout = 20_000) {
  const interval = 1_000;
  let elapsed = 0;
  while (elapsed < timeout) {
    await new Promise(r => setTimeout(r, interval));
    elapsed += interval;

    const error = state.errors.find((entry) => isRecentError(entry, `cmd:reduce ${asset}`, since));
    if (error) return { status: 'error', message: error.message };
  }
  // No error detected → assume success; position update visible on next poll
  return { status: 'sent' };
}

async function waitForManualOpen(asset, direction, since, timeout = 20_000) {
  const interval = 1_000;
  let elapsed = 0;
  while (elapsed < timeout) {
    await new Promise(r => setTimeout(r, interval));
    elapsed += interval;

    const error = state.errors.find((entry) => isRecentError(entry, 'cmd:open_manual', since));
    if (error) return { status: 'error', message: error.message };

    const pos = state.positions.find((entry) => entry.asset === asset && entry.direction === direction);
    if (pos) return { status: 'opened', position: pos };
  }

  return { status: 'timeout' };
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
    sessions.set(userId, { manualOpenDraft: null, waitingFor: null });
    return show(S.renderMenu(snap), KB.mainMenuKeyboard(snap.status));
  }

  if (data === 'menu:status') {
    return show(S.renderStatus(snap), KB.backToMenuKeyboard());
  }

  if (data === 'menu:balance') {
    return show(S.renderBalance(snap.account, snap.session), KB.backToMenuKeyboard());
  }

  if (data === 'menu:positions') {
    return show(S.renderPositionsList(snap.positions, snap.status.mode === 'paper'), KB.positionsListKeyboard(snap.positions));
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

  if (data === 'menu:manual_open') {
    sessions.setWaiting(userId, { kind: 'manual_open' });
    return show(S.renderAskManualOpen(), KB.manualOpenInputKeyboard());
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

    sessions.clearWaiting(userId);
    sessions.set(userId, { manualOpenDraft: null });

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

    state.emit('cmd:close', { asset, venue: pos.venue });

    const closed = await waitForClose(asset, 20_000);

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
    await editScreen(bot, chatId, messageId,
      `🔄 <b>Fechando ${count} posição(ões)…</b>\n\nAguarde a confirmação das execuções.`,
      { inline_keyboard: [] }
    );

    state.emit('cmd:close_all', { venue: state.positions[0]?.venue });

    const closedAll = await waitForCloseAll(25_000);
    if (closedAll) {
      return editScreen(bot, chatId, messageId,
        `✅ <b>Todas as posições foram fechadas.</b>`,
        KB.backToMenuKeyboard()
      );
    }

    return editScreen(bot, chatId, messageId,
      `⚠️ <b>Comando enviado.</b>\nUse /positions para confirmar o resultado final.`,
      KB.backToMenuKeyboard()
    );
  }

  // ─── Pausar / Retomar ──────────────────────────────────────────────────────
  if (data === 'ctrl:pause') {
    return show(S.renderConfirmPause(), KB.confirmPauseKeyboard());
  }

  if (data === 'ctrl:pause_ok') {
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
    return show(S.renderConfirmAtOff(), KB.confirmAtOffKeyboard());
  }

  if (data === 'ctrl:at_off_ok') {
    state.setAutoTrading(false);
    const fresh = state.getSnapshot();
    return show(S.renderMenu(fresh), KB.mainMenuKeyboard(fresh.status), '❌ Auto-trading OFF');
  }

  // ─── Signal intake ─────────────────────────────────────────────────────────
  if (data === 'ctrl:intake_on') {
    state.setSignalIntakeEnabled(true);
    const fresh = state.getSnapshot();
    return show(S.renderConfig(fresh), KB.configKeyboard(fresh.status), '🔔 Intake ON');
  }

  if (data === 'ctrl:intake_off') {
    return show(S.renderConfirmIntakeOff(), KB.confirmIntakeOffKeyboard());
  }

  if (data === 'ctrl:intake_off_ok') {
    state.setSignalIntakeEnabled(false);
    const fresh = state.getSnapshot();
    return show(S.renderConfig(fresh), KB.configKeyboard(fresh.status), '🔕 Intake OFF');
  }

  // ─── Modificar TP / SL: entrar em modo de input ────────────────────────────
  if (data.startsWith('pos:tp:') || data.startsWith('pos:sl:')) {
    const type  = data.startsWith('pos:tp:') ? 'tp' : 'sl';
    const asset = data.slice((`pos:${type}:`).length);
    const pos   = state.positions.find(p => p.asset === asset);

    if (!pos) { await alert(bot, queryId, `📭 Sem posição em ${asset}`); return; }

    sessions.setWaiting(userId, { kind: 'tpsl', type, asset });
    return show(S.renderAskTpSl(pos, type), KB.inputCancelKeyboard(asset));
  }

  // ─── Reduzir posição: entrar em modo de input ─────────────────────────────
  if (data.startsWith('pos:reduce:') && !data.startsWith('pos:reduce_ok:')) {
    const asset = data.slice('pos:reduce:'.length);
    const pos   = state.positions.find(p => p.asset === asset);

    if (!pos) { await alert(bot, queryId, `📭 Sem posição em ${asset}`); return; }

    sessions.setWaiting(userId, { kind: 'reduce', asset });
    return show(S.renderAskReduce(pos), KB.inputCancelKeyboard(asset));
  }

  // ─── Reduzir posição: confirmar e executar ─────────────────────────────────
  if (data.startsWith('pos:reduce_ok:')) {
    const parts   = data.slice('pos:reduce_ok:'.length).split(':');
    const asset   = parts[0];
    const percent = Number(parts[1]);

    if (!asset || isNaN(percent)) {
      await alert(bot, queryId, '⚠️ Parâmetros inválidos');
      return;
    }

    await ack(bot, queryId, `📉 Reduzindo ${percent}% de ${asset}…`);
    await editScreen(bot, chatId, messageId,
      `📉 <b>Reduzindo posição</b>\n\n<b>${asset}</b>: ${percent}%\n\n<i>Aguardando execução...</i>`,
      { inline_keyboard: [] }
    );

    const startedAt = Date.now();
    state.emit('cmd:reduce', { asset, reducePercent: percent });

    const outcome = await waitForReduce(asset, startedAt, 20_000);
    if (outcome.status === 'error') {
      await editScreen(bot, chatId, messageId,
        `⛔ <b>Redução rejeitada</b>\n\n${outcome.message}`,
        KB.backToPositionsKeyboard()
      );
    } else {
      await editScreen(bot, chatId, messageId,
        `✅ <b>Comando enviado</b>\n\n<b>${asset}</b>: redução de ${percent}% a mercado.\nUse /positions para confirmar o resultado.`,
        KB.backToPositionsKeyboard()
      );
    }
    return;
  }

  if (data === 'manual:open_confirm') {
    const draft = sessions.get(userId).manualOpenDraft;
    if (!draft) {
      await alert(bot, queryId, '⚠️ Nenhuma ordem manual pendente para confirmar');
      return;
    }

    if (state.positions.find((pos) => pos.asset === draft.asset)) {
      sessions.set(userId, { manualOpenDraft: null });
      return show(
        `⚠️ <b>Já existe posição aberta em ${draft.asset}.</b>\n\nFeche a posição atual antes de abrir uma nova ordem manual neste ativo.`,
        KB.backToPositionsKeyboard()
      );
    }

    const startedAt = Date.now();
    await ack(bot, queryId, `🚀 Enviando ${draft.asset}…`);
    await editScreen(bot, chatId, messageId,
      `🚀 <b>Enviando ordem manual</b>\n\n<b>${draft.asset}</b> ${draft.direction}  ⚡ ${draft.leverage}x\n\nAguardando validação e execução...`,
      { inline_keyboard: [] }
    );

    state.emit('cmd:open_manual', draft);
    sessions.set(userId, { manualOpenDraft: null, waitingFor: null });

    const outcome = await waitForManualOpen(draft.asset, draft.direction, startedAt, 25_000);
    if (outcome.status === 'opened') {
      return editScreen(bot, chatId, messageId,
        `✅ <b>Ordem manual executada</b>\n\n<b>${draft.asset}</b> ${draft.direction} foi aberta com sucesso.\nUse /positions para acompanhar a posição.`,
        KB.backToPositionsKeyboard()
      );
    }

    if (outcome.status === 'error') {
      return editScreen(bot, chatId, messageId,
        `⛔ <b>Ordem manual rejeitada</b>\n\n${outcome.message}`,
        KB.backToMenuKeyboard()
      );
    }

    return editScreen(bot, chatId, messageId,
      `⚠️ <b>Comando enviado.</b>\n\nAinda não foi possível confirmar a abertura. Use /positions para verificar o resultado.`,
      KB.backToPositionsKeyboard()
    );
  }

  // ─── Fallback ──────────────────────────────────────────────────────────────
  logger.warn(`[CTRL] Callback não mapeado: ${data}`);
  await alert(bot, queryId, '❓ Ação não reconhecida');
}
