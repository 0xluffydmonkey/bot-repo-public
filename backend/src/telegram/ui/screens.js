// src/telegram/ui/screens.js
// Renderizadores de telas — retornam strings HTML para exibição no Telegram.
// parse_mode: 'HTML' em todas as mensagens.

import {
  fmt, fmtSign, fmtPrice, fmtPct,
  fmtUptime, fmtDirIcon, fmtPnlIcon, fmtTime, esc,
} from './formatters.js';

// ── Menu principal ─────────────────────────────────────────────────────────────
export function renderMenu(snap) {
  const { status, account, positions, signals, session } = snap;
  const statusIcon = status.paused ? '⏸️' : status.running ? '🟢' : '🔴';
  const modeTag    = status.mode === 'live' ? '🔴 LIVE' : '📝 PAPER';
  const atTag      = status.autoTrading ? '✅ ON' : '❌ OFF';
  const pnlLine    = account.unrealizedPnl !== 0
    ? `📈 <b>PnL aberto:</b> ${fmtSign(account.unrealizedPnl)}`
    : '';

  return [
    `🤖 <b>TradeFinderBot</b>  <i>${modeTag}</i>`,
    ``,
    `${statusIcon} <b>Status:</b> ${status.paused ? 'Pausado ⏸️' : status.running ? 'Ativo' : 'Parado'}`,
    `⚡ <b>Auto-trading:</b> ${atTag}`,
    `⏱ <b>Uptime:</b> ${fmtUptime(status.uptime)}`,
    ``,
    `💰 <b>Equity:</b> ${fmt(account.totalEquity)}  |  <b>Livre:</b> ${fmt(account.freeCollateral)}`,
    pnlLine,
    `📊 <b>Posições abertas:</b> ${positions.length}`,
    `📩 <b>Sinais processados:</b> ${signals.count}`,
    ``,
    `<i>Selecione uma opção abaixo:</i>`,
  ].filter(Boolean).join('\n');
}

// ── Status detalhado ──────────────────────────────────────────────────────────
export function renderStatus(snap) {
  const { status, positions, signals, errors, session } = snap;
  const statusIcon = status.paused ? '⏸️' : status.running ? '🟢' : '🔴';

  return [
    `${statusIcon} <b>Status do Bot</b>`,
    ``,
    `Rodando:      ${status.running    ? '✅ Sim' : '❌ Não'}`,
    `Pausado:      ${status.paused     ? '⏸️ Sim' : 'Não'}`,
    `Auto-trading: ${status.autoTrading ? '✅ ON'  : '❌ OFF'}`,
    `Modo:         ${status.mode === 'live' ? '🔴 <b>LIVE</b>' : '📝 <b>PAPER</b>'}`,
    `Uptime:       ${fmtUptime(status.uptime)}`,
    ``,
    `📊 Posições abertas:  <b>${positions.length}</b>`,
    `📩 Sinais detectados: <b>${signals.count}</b>`,
    `✅ Executados:         <b>${signals.executed.length}</b>`,
    `⛔ Ignorados:          <b>${signals.ignored.length}</b>`,
    `⚠️ Erros:              <b>${errors.length}</b>`,
    ``,
    `🕐 ${fmtTime(snap.lastUpdate)}`,
  ].join('\n');
}

// ── Saldo ─────────────────────────────────────────────────────────────────────
export function renderBalance(account, session) {
  const pnlPct = account.totalEquity > 0
    ? ((account.unrealizedPnl / account.totalEquity) * 100)
    : 0;

  return [
    `💰 <b>Saldo da Conta</b>`,
    ``,
    `Equity Total:    <code>${fmt(account.totalEquity)}</code>`,
    `Free Collateral: <code>${fmt(account.freeCollateral)}</code>`,
    `Margem Usada:    <code>${fmt(account.marginUsed)}</code>`,
    ``,
    `PnL Aberto:  <code>${fmtSign(account.unrealizedPnl)}</code>  (${fmtPct(pnlPct)})`,
    `PnL Sessão:  <code>${fmtSign(session?.sessionPnl)}</code>`,
    ``,
    `🕐 ${fmtTime(new Date())}`,
  ].join('\n');
}

// ── Lista de posições (header + instrução; itens ficam nos botões) ────────────
export function renderPositionsList(positions) {
  if (!positions.length) {
    return [
      `📭 <b>Nenhuma posição aberta</b>`,
      ``,
      `O bot está monitorando sinais.`,
    ].join('\n');
  }

  const lines = [
    `📊 <b>Posições Abertas (${positions.length})</b>`,
    ``,
    `Selecione uma posição para ver detalhes:`,
    ``,
  ];

  for (const [i, p] of positions.entries()) {
    const pnlIcon = (p.pnlUSD ?? 0) >= 0 ? '✅' : '⛔';
    const lev     = Math.round(p.leverage ?? 0);
    lines.push(
      `${pnlIcon} <b>[${i + 1}] ${esc(p.asset)} ${p.direction}</b> ⚡ ${lev}x  →  ${fmtSign(p.pnlUSD)} (${fmtPct(p.pnlPct)})`
    );
  }

  return lines.join('\n');
}

// ── Detalhe de uma posição ────────────────────────────────────────────────────
export function renderPositionDetail(pos, snap) {
  if (!pos) return '📭 <b>Posição não encontrada.</b>';

  const lev        = Math.round(pos.leverage ?? 0);
  const marginType = pos.marginType ?? 'ISOLATED';
  const dirIcon    = fmtDirIcon(pos.direction);
  const pnlIcon    = fmtPnlIcon(pos.pnlUSD);

  // Tenta recuperar o signalId do histórico de executados
  const executed = snap?.signals?.executed ?? [];
  const signalId = executed.find(e => e.signal?.asset === pos.asset)?.signal?.signalId ?? null;
  const idTag    = signalId ? ` <code>#${esc(signalId)}</code>` : '';

  return [
    `📋 <b>Posição${idTag}</b>`,
    ``,
    `${dirIcon} <b>${esc(pos.asset)} ${pos.direction}</b>  ⚡ ${lev}x <i>(${esc(marginType)})</i>`,
    `Colateral: <code>${fmt(pos.collateralUSD)}</code>`,
    `Nocional:  <code>${fmt(pos.sizeUSD)}</code>`,
    ``,
    `Entrada: <code>${fmtPrice(pos.entryPrice)}</code>`,
    `Atual:   <code>${fmtPrice(pos.markPrice)}</code>`,
    ``,
    `${pnlIcon} PnL: <b>${fmtSign(pos.pnlUSD)}</b>  (${fmtPct(pos.pnlPct)})`,
    ``,
    pos.tp != null ? `🎯 TP: <code>${fmtPrice(pos.tp)}</code>` : null,
    pos.sl != null ? `🛑 SL: <code>${fmtPrice(pos.sl)}</code>` : null,
    ``,
    `🕐 ${fmtTime(new Date())}`,
  ].filter(v => v != null).join('\n');
}

// ── PnL ao vivo ───────────────────────────────────────────────────────────────
export function renderPnl(snap) {
  const { account, session, positions } = snap;
  const pnlPct  = account.totalEquity > 0
    ? (account.unrealizedPnl / account.totalEquity) * 100
    : 0;
  const pnlIcon = fmtPnlIcon(account.unrealizedPnl);

  const lines = [
    `${pnlIcon} <b>PnL ao vivo</b>`,
    ``,
    `Aberto:  <b>${fmtSign(account.unrealizedPnl)}</b>  (${fmtPct(pnlPct)})`,
    `Sessão:  <b>${fmtSign(session?.sessionPnl)}</b>`,
    ``,
  ];

  if (positions.length > 0) {
    lines.push(`<b>Por posição:</b>`);
    for (const p of positions) {
      const icon = (p.pnlUSD ?? 0) >= 0 ? '✅' : '⛔';
      const lev  = Math.round(p.leverage ?? 0);
      lines.push(
        `${icon} <b>${esc(p.asset)}</b> ${p.direction} ⚡${lev}x`,
        `   Entrada: ${fmtPrice(p.entryPrice)} → Atual: ${fmtPrice(p.markPrice)}`,
        `   PnL: <b>${fmtSign(p.pnlUSD)}</b>  (${fmtPct(p.pnlPct)})`,
      );
    }
    lines.push(``);
  }

  lines.push(`🕐 ${fmtTime(new Date())}`);
  return lines.join('\n');
}

// ── Sinais ────────────────────────────────────────────────────────────────────
export function renderSignals(snap) {
  const { signals } = snap;

  const lines = [
    `📩 <b>Sinais</b>`,
    ``,
    `Total detectados: <b>${signals.count}</b>`,
    `Executados:       <b>${signals.executed.length}</b>`,
    `Ignorados:        <b>${signals.ignored.length}</b>`,
  ];

  if (signals.last) {
    const s   = signals.last;
    const dir = fmtDirIcon(s.direction);
    lines.push(
      ``,
      `<b>Último sinal recebido:</b>`,
      `${dir} <b>${esc(s.asset)}</b> ${s.direction}  ⚡ ${s.leverage}x`,
      `Entrada: ${fmtPrice(s.entry)}  TP: ${fmtPrice(s.tp)}  SL: ${fmtPrice(s.sl)}`,
      `<code>#${esc(s.signalId ?? '—')}</code>`,
    );
  }

  if (signals.executed.length > 0) {
    lines.push(``, `<b>Últimos executados:</b>`);
    for (const e of signals.executed.slice(0, 3)) {
      const s = e.signal ?? {};
      lines.push(`${fmtDirIcon(s.direction)} ${esc(s.asset)}  ${fmtPrice(s.entry)}  <code>#${esc(s.signalId ?? '—')}</code>`);
    }
  }

  if (signals.ignored.length > 0) {
    lines.push(``, `<b>Últimos ignorados:</b>`);
    for (const e of signals.ignored.slice(0, 3)) {
      const s = e.signal ?? {};
      lines.push(`• ${esc(s.asset ?? '?')}  Motivo: <i>${esc(e.reason)}</i>`);
    }
  }

  return lines.join('\n');
}

// ── Config/Modo ───────────────────────────────────────────────────────────────
export function renderConfig(snap) {
  const { status } = snap;
  return [
    `⚙️ <b>Configurações</b>`,
    ``,
    `Modo: ${status.mode === 'live' ? '🔴 <b>LIVE</b> (ordens reais)' : '📝 <b>PAPER</b> (simulação)'}`,
    `Auto-trading: ${status.autoTrading ? '✅ <b>ON</b>' : '❌ <b>OFF</b>'}`,
    `Status: ${status.paused ? '⏸️ Pausado' : '▶️ Ativo'}`,
    ``,
    `<i>Use os botões abaixo para alterar.</i>`,
  ].join('\n');
}

// ── Confirmação: fechar posição ───────────────────────────────────────────────
export function renderConfirmClose(pos) {
  const lev     = (pos.leverage ?? 0).toFixed(2);
  const dirIcon = fmtDirIcon(pos.direction);
  const pnlIcon = fmtPnlIcon(pos.pnlUSD);

  return [
    `⚠️ <b>Confirmar Fechamento</b>`,
    ``,
    `${dirIcon} <b>${esc(pos.asset)} ${pos.direction}</b>  ⚡ ${lev}x`,
    `Nocional: <code>${fmt(pos.sizeUSD)}</code>`,
    `${pnlIcon} PnL atual: <b>${fmtSign(pos.pnlUSD)}</b>  (${fmtPct(pos.pnlPct)})`,
    ``,
    `Esta ação é <b>irreversível</b>.`,
    `Confirma o fechamento a mercado?`,
  ].join('\n');
}

// ── Confirmação: fechar todas ─────────────────────────────────────────────────
export function renderConfirmCloseAll(positions) {
  const lines = [
    `⚠️ <b>Fechar TODAS as Posições</b>`,
    ``,
  ];

  let totalPnl = 0;
  for (const p of positions) {
    const icon = (p.pnlUSD ?? 0) >= 0 ? '✅' : '⛔';
    lines.push(`${icon} <b>${esc(p.asset)}</b> ${p.direction}  →  ${fmtSign(p.pnlUSD)}`);
    totalPnl += p.pnlUSD ?? 0;
  }

  lines.push(
    ``,
    `PnL total: <b>${fmtSign(totalPnl)}</b>`,
    ``,
    `Esta ação é <b>irreversível</b>.`,
    `Confirma o fechamento de <b>${positions.length}</b> posição(ões)?`,
  );

  return lines.join('\n');
}

// ── Solicitar novo TP ou SL ───────────────────────────────────────────────────
export function renderAskTpSl(pos, type) {
  const label  = type === 'tp' ? 'Take Profit' : 'Stop Loss';
  const emoji  = type === 'tp' ? '🎯' : '🛑';
  const dirIcon = fmtDirIcon(pos?.direction);
  const current = type === 'tp' ? pos?.tp : pos?.sl;

  return [
    `${emoji} <b>Modificar ${label}</b>`,
    ``,
    `Ativo: ${dirIcon} <b>${esc(pos?.asset)}</b>`,
    `Atual: <code>${fmtPrice(current)}</code>`,
    `Mark:  <code>${fmtPrice(pos?.markPrice)}</code>`,
    ``,
    `Digite o novo preço (ex: <code>${Math.round(pos?.markPrice ?? 0)}</code>):`,
    ``,
    `<i>Ou cancele abaixo.</i>`,
  ].join('\n');
}

// ── Erros recentes ────────────────────────────────────────────────────────────
export function renderErrors(errors) {
  if (!errors.length) return '✅ <b>Sem erros recentes</b>';

  const lines = [`⚠️ <b>Erros Recentes (${errors.length})</b>`, ``];

  for (const [i, e] of errors.entries()) {
    lines.push(`${i + 1}. <code>${esc(e.context)}</code>`);
    lines.push(`   ${esc(e.message.slice(0, 200))}`);
    if (i < errors.length - 1) lines.push('');
  }

  return lines.join('\n');
}
