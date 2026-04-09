// src/telegram/position_tracker.js
// Sistema de acompanhamento de posições via Telegram.
// Envia um card por posição ao abrir, atualiza PnL periodicamente,
// e dispara alertas de milestone (+10%, +20%... / -10%, -20%...).

import state  from '../core/state.js';
import logger from '../utils/logger.js';
import { positionCardKeyboard } from './ui/keyboards.js';
import {
  fmt, fmtSign, fmtPrice, fmtPct, fmtPnlIcon, fmtDirIcon, fmtTime, esc, paperBanner,
} from './ui/formatters.js';

const HTML = { parse_mode: 'HTML', disable_web_page_preview: true };

// ── Renderizadores ────────────────────────────────────────────────────────────

function renderCard(pos, signalId, isPaper = false) {
  const lev        = Math.round(pos.leverage ?? 0);
  const marginType = pos.marginType ?? 'ISOLATED';
  const dirIcon    = fmtDirIcon(pos.direction);
  const pnlIcon    = fmtPnlIcon(pos.pnlUSD);
  const idTag      = signalId ? ` <code>#${esc(String(signalId))}</code>` : '';

  return [
    `${paperBanner(isPaper)}📋 <b>Posição aberta${idTag}</b>`,
    ``,
    `${dirIcon} <b>${esc(pos.asset)} ${pos.direction}</b>  ⚡ ${lev}x <i>(${esc(marginType)})</i>`,
    `Colateral: <code>${fmt(pos.collateralUSD ?? 0)}</code>`,
    `Nocional:  <code>${fmt(pos.sizeUSD)}</code>`,
    ``,
    `Entrada: <code>${fmtPrice(pos.entryPrice)}</code>`,
    `Atual:   <code>${fmtPrice(pos.markPrice)}</code>`,
    ``,
    `${pnlIcon} PnL: <b>${fmtSign(pos.pnlUSD)}</b>  (${fmtPct(pos.pnlPct)})`,
    pos.tp != null ? `🎯 TP: <code>${fmtPrice(pos.tp)}</code>` : null,
    pos.sl != null ? `🛑 SL: <code>${fmtPrice(pos.sl)}</code>` : null,
    ``,
    `🕐 ${fmtTime(new Date())}`,
  ].filter(v => v != null).join('\n');
}

function renderClosed(card, isPaper = false) {
  return [
    `${paperBanner(isPaper)}✅ <b>Posição fechada: ${esc(card.asset)}</b>`,
    ``,
    `Posição não está mais em aberto.`,
    `Use /pnl para ver o resultado final da sessão.`,
  ].join('\n');
}

function renderMilestone(pos, milestone, isPaper = false) {
  const sign    = milestone > 0 ? '+' : '';
  const emoji   = milestone > 0 ? '🎉' : '⚠️';
  const dirIcon = fmtDirIcon(pos.direction);

  return [
    `${paperBanner(isPaper)}${emoji} <b>Milestone: ${sign}${milestone}%</b>`,
    ``,
    `${dirIcon} <b>${esc(pos.asset)} ${pos.direction}</b>`,
    `PnL: <b>${fmtSign(pos.pnlUSD)}</b>  (${fmtPct(pos.pnlPct)})`,
    `Atual: <code>${fmtPrice(pos.markPrice)}</code>`,
  ].join('\n');
}

// ── Detecção de milestones ────────────────────────────────────────────────────

/**
 * Retorna milestones recém-cruzados que ainda não foram disparados.
 * @param {number} pnlPct       - PnL em percentagem (ex: 12.3 ou -7.5)
 * @param {Set<number>} fired   - Set de milestones já disparados
 * @param {number} [step=10]    - Intervalo entre milestones (%)
 * @returns {number[]}          - Novos milestones a disparar
 */
function getNewMilestones(pnlPct, fired, step = 10) {
  const newOnes = [];
  const bracket = Math.floor(Math.abs(pnlPct) / step);

  if (pnlPct >= 0) {
    for (let i = 1; i <= bracket; i++) {
      const m = i * step;
      if (!fired.has(m)) newOnes.push(m);
    }
  } else {
    for (let i = 1; i <= bracket; i++) {
      const m = -(i * step);
      if (!fired.has(m)) newOnes.push(m);
    }
  }

  return newOnes;
}

// ── Tracker principal ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} PositionCard
 * @property {string}   asset
 * @property {string}   [signalId]
 * @property {Map<number, number>} messageIds  - chatId → messageId
 * @property {Set<number>} milestonesFired
 * @property {number}   lastRefresh
 */

/**
 * Inicia o sistema de acompanhamento de posições.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number[]} chatIds        - Lista de chatIds para broadcast
 * @param {Object}  [options]
 * @param {number}  [options.refreshIntervalMs=30000]
 * @param {number}  [options.minRefreshMs=10000]     - cooldown entre edições por card
 */
export function startPositionTracker(bot, chatIds, options = {}) {
  const {
    refreshIntervalMs = 30_000,
    minRefreshMs      = 10_000,
  } = options;

  /** @type {Map<string, PositionCard>} asset → card */
  const cards = new Map();

  // ── Envio do card inicial ─────────────────────────────────────────────────

  async function createCard(pos, signalId) {
    const isPaper  = state.status.mode === 'paper';
    const text     = renderCard(pos, signalId, isPaper);
    const keyboard = positionCardKeyboard(pos.asset);
    const messageIds = new Map();

    for (const chatId of chatIds) {
      try {
        const sent = await bot.sendMessage(chatId, text, { ...HTML, reply_markup: keyboard });
        messageIds.set(chatId, sent.message_id);
      } catch (err) {
        logger.warn(`[TRACKER] Erro ao enviar card ${pos.asset} para ${chatId}: ${err.message}`);
      }
    }

    cards.set(pos.asset, {
      asset: pos.asset,
      signalId,
      messageIds,
      milestonesFired: new Set(),
      lastRefresh: Date.now(),
    });

    logger.info(`[TRACKER] Card criado para ${pos.asset}`);
  }

  // ── Atualização de card existente ─────────────────────────────────────────

  async function refreshCard(pos) {
    const card = cards.get(pos.asset);
    if (!card) return;

    const now = Date.now();
    if (now - card.lastRefresh < minRefreshMs) return;
    card.lastRefresh = now;

    const isPaper  = state.status.mode === 'paper';
    const text     = renderCard(pos, card.signalId, isPaper);
    const keyboard = positionCardKeyboard(pos.asset);

    for (const [chatId, messageId] of card.messageIds) {
      try {
        await bot.editMessageText(text, {
          chat_id:                  chatId,
          message_id:               messageId,
          parse_mode:               'HTML',
          reply_markup:             keyboard,
          disable_web_page_preview: true,
        });
      } catch (err) {
        if (!err.message?.includes('message is not modified')) {
          logger.warn(`[TRACKER] Erro ao editar card ${pos.asset}: ${err.message}`);
        }
      }
    }
  }

  // ── Notificação de fechamento ─────────────────────────────────────────────

  async function notifyClosed(card) {
    const isPaper = state.status.mode === 'paper';
    const text = renderClosed(card, isPaper);

    for (const [chatId, messageId] of card.messageIds) {
      try {
        await bot.editMessageText(text, {
          chat_id:    chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        });
      } catch (err) {
        if (!err.message?.includes('message is not modified')) {
          logger.warn(`[TRACKER] Erro ao notificar fechamento de ${card.asset}: ${err.message}`);
        }
      }
    }

    cards.delete(card.asset);
    logger.info(`[TRACKER] Posição ${card.asset} fechada — card removido`);
  }

  // ── Alertas de milestone ──────────────────────────────────────────────────

  async function sendMilestoneAlerts(pos, card) {
    const pnlPct = pos.pnlPct ?? 0;
    const newMilestones = getNewMilestones(pnlPct, card.milestonesFired);

    for (const m of newMilestones) {
      card.milestonesFired.add(m);
      const isPaper = state.status.mode === 'paper';
      const text = renderMilestone(pos, m, isPaper);

      for (const chatId of chatIds) {
        try {
          await bot.sendMessage(chatId, text, HTML);
        } catch (err) {
          logger.warn(`[TRACKER] Erro ao enviar milestone ${m}% de ${pos.asset}: ${err.message}`);
        }
      }

      logger.info(`[TRACKER] Milestone ${m}% disparado para ${pos.asset}`);
    }
  }

  // ── Detecção de posições fechadas ─────────────────────────────────────────

  function detectClosures(currentAssets) {
    for (const [asset, card] of cards) {
      if (!currentAssets.has(asset)) {
        notifyClosed(card).catch(err =>
          logger.error(`[TRACKER] Erro em notifyClosed(${asset}): ${err.message}`)
        );
      }
    }
  }

  // ── Listener: posição executada ───────────────────────────────────────────
  // Payload emitido por state.signalExecuted: { signal, result, timestamp }
  // 'result' é o objeto retornado pelo executor (drift_executor.openPosition).
  // NÃO usar state.positions aqui: o poller de conta ainda não rodou, então
  // a nova posição ainda não está no state no momento deste evento.

  state.on('signal:executed', ({ signal, result }) => {
    if (!result?.asset) {
      logger.warn(`[TRACKER] signal:executed sem result.asset — card ignorado`);
      return;
    }

    // Evitar duplicatas (caso o evento dispare mais de uma vez)
    if (cards.has(result.asset)) return;

    // Construir position-like object a partir do resultado da execução.
    // markPrice = entryPrice e pnl = 0 no momento da abertura;
    // serão corrigidos no próximo ciclo do poller (~30s).
    const pos = {
      asset:         result.asset,
      direction:     result.direction,
      marginType:    result.marginType ?? 'ISOLATED',
      leverage:      result.leverage,
      collateralUSD: result.collateralUSD,
      sizeUSD:       result.notionalUSD,
      entryPrice:    result.entry,
      markPrice:     result.entry,
      tp:            result.tp,
      sl:            result.sl,
      pnlUSD:        0,
      pnlPct:        0,
    };

    createCard(pos, signal?.signalId).catch(err =>
      logger.error(`[TRACKER] Erro em createCard(${result.asset}): ${err.message}`)
    );
  });

  // ── Listener: atualização de posições ────────────────────────────────────

  state.on('positions:update', (positions) => {
    const currentAssets = new Set(positions.map(p => p.asset));

    detectClosures(currentAssets);

    for (const pos of positions) {
      const card = cards.get(pos.asset);
      if (!card) continue;

      sendMilestoneAlerts(pos, card).catch(err =>
        logger.error(`[TRACKER] Erro em sendMilestoneAlerts(${pos.asset}): ${err.message}`)
      );
    }
  });

  // ── Refresh periódico ─────────────────────────────────────────────────────

  const timer = setInterval(() => {
    const positions = state.positions;

    for (const pos of positions) {
      if (!cards.has(pos.asset)) continue;
      refreshCard(pos).catch(err =>
        logger.error(`[TRACKER] Erro em refreshCard(${pos.asset}): ${err.message}`)
      );
    }
  }, refreshIntervalMs);

  // Não impedir o processo de terminar por causa deste timer
  if (timer.unref) timer.unref();

  logger.info(`[TRACKER] Position tracker iniciado (refresh: ${refreshIntervalMs / 1000}s)`);

  return { cards };
}
