// src/monitor/ui.js
// Dashboard CLI modernizado — pure ANSI, zero dependências extras

// ── ANSI ──────────────────────────────────────────────────────────────────────
const R       = '\x1b[0m';
const B       = '\x1b[1m';
const DIM     = '\x1b[2m';
const GREEN   = '\x1b[32m';
const RED     = '\x1b[31m';
const CYAN    = '\x1b[36m';
const BGREEN  = '\x1b[92m';
const BRED    = '\x1b[91m';
const BYELLOW = '\x1b[93m';
const BCYAN   = '\x1b[96m';
const BWHITE  = '\x1b[97m';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

// ── Layout ────────────────────────────────────────────────────────────────────
// TOTAL_W = 1 + sum(COL) + 3*numCols  → 110 = 1 + 82 + 27
const TOTAL_W = 110;
const INNER_W = TOTAL_W - 2; // 108

const COL = {
  ASSET:  5,
  DIR:    5,
  SIZE:  11,
  ENTRY: 10,
  MARK:  10,
  TP:     8,
  SL:     8,
  LEV:    5,
  PNL:   20,
}; // sum = 82

// Logo ASCII (nested squares) — 10 chars visíveis por linha
const LOGO = [
  '\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', // ┌────────┐
  '\u2502\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2502\u2502', // │┌──────┐│
  '\u2502\u2502 \u250C\u2500\u2500\u2510 \u2502\u2502',           // ││ ┌──┐ ││
  '\u2502\u2502 \u2514\u2500\u2500\u2518 \u2502\u2502',           // ││ └──┘ ││
  '\u2502\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2518\u2502', // │└──────┘│
  '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', // └────────┘
];

// Prefixo do header: 4 indent + 10 logo + 3 gap = 17 chars
const LP        = 17;
const CONTENT_W = INNER_W - LP; // 91

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function c(text, ...codes) {
  return codes.join('') + text + R;
}

/** Pad à direita baseado em comprimento visível (ignora ANSI). */
function padR(s, width) {
  const vis = stripAnsi(s).length;
  return vis >= width ? s : s + ' '.repeat(width - vis);
}

/** Centraliza texto em `width` chars visíveis. */
function centerStr(text, width) {
  const vis = stripAnsi(text).length;
  if (vis >= width) return text;
  const total = width - vis;
  const l = Math.floor(total / 2);
  return ' '.repeat(l) + text + ' '.repeat(total - l);
}

function fmtDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function fmtTime(d) { return d.toTimeString().slice(0, 8); }

function fmtPrice(p) {
  if (p == null) return '\u2014';
  if (p >= 10_000) return `$${Math.round(p).toLocaleString('en-US')}`;
  if (p >= 1_000)  return `$${p.toFixed(1)}`;
  if (p >= 100)    return `$${p.toFixed(2)}`;
  if (p >= 10)     return `$${p.toFixed(3)}`;
  return `$${p.toFixed(4)}`;
}

function fmtUSD(v, withSign = false) {
  if (v == null) return '\u2014';
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v < 0)             return `-$${abs}`;
  if (withSign && v > 0) return `+$${abs}`;
  return `$${abs}`;
}

function fmtPnl(pnlUSD, pnlPct) {
  if (pnlUSD == null) return '\u2014';
  const sign = pnlUSD >= 0 ? '+' : '-';
  const usd  = `${sign}$${Math.abs(pnlUSD).toFixed(2)}`;
  const pct  = pnlPct != null ? ` (${sign}${Math.abs(pnlPct).toFixed(2)}%)` : '';
  return `${usd}${pct}`;
}

function fmtLev(lev) {
  if (!lev || lev <= 0) return '\u2014';
  return `${Math.round(lev)}x`;
}

// ── Box (outer) ───────────────────────────────────────────────────────────────
const V        = '\u2551'; // ║
const LINE_TOP = '\u2554' + '\u2550'.repeat(INNER_W) + '\u2557'; // ╔═══╗
const LINE_SEP = '\u2560' + '\u2550'.repeat(INNER_W) + '\u2563'; // ╠═══╣
const LINE_BOT = '\u255A' + '\u2550'.repeat(INNER_W) + '\u255D'; // ╚═══╝

function row(content) {
  const vis = stripAnsi(content).length;
  const pad = vis < INNER_W ? ' '.repeat(INNER_W - vis) : '';
  return V + content + pad + V;
}
function rowBlank() { return V + ' '.repeat(INNER_W) + V; }

// ── Tabela (integrada ao outer box) ───────────────────────────────────────────
function colWidths() { return Object.values(COL).map(w => w + 2); }

// ╠═══╦═══╣  (top da tabela, integrado)
function tableIntTop() {
  return '\u2560' + colWidths().map(w => '\u2550'.repeat(w)).join('\u2566') + '\u2563';
}
// ╠═══╬═══╣  (separador do header)
function tableHSep() {
  return '\u2560' + colWidths().map(w => '\u2550'.repeat(w)).join('\u256C') + '\u2563';
}
// ╟───╫───╢  (separador entre linhas)
function tableRowSep() {
  return '\u255F' + colWidths().map(w => '\u2500'.repeat(w)).join('\u256B') + '\u2562';
}
// ╚═══╩═══╝
function tableIntBot() {
  return '\u255A' + colWidths().map(w => '\u2550'.repeat(w)).join('\u2569') + '\u255D';
}

function cell(text, width, align = 'left', color = null) {
  const s = String(text ?? '\u2014');
  const t = s.length > width ? s.slice(0, width - 1) + '\u2026' : s;
  const p = align === 'right'  ? t.padStart(width)
          : align === 'center' ? centerStr(t, width)
          : t.padEnd(width);
  return ' ' + (color ? `${color}${p}${R}` : p) + ' ';
}

function tableHeaderRow() {
  const cols = [
    cell('ATIVO',   COL.ASSET, 'center', BCYAN + B),
    cell('DIR',     COL.DIR,   'center', BCYAN + B),
    cell('TAMANHO', COL.SIZE,  'center', BCYAN + B),
    cell('ENTRADA', COL.ENTRY, 'center', BCYAN + B),
    cell('ATUAL',   COL.MARK,  'center', BCYAN + B),
    cell('TP',      COL.TP,    'center', BCYAN + B),
    cell('SL',      COL.SL,    'center', BCYAN + B),
    cell('LEV',     COL.LEV,   'center', BCYAN + B),
    cell('PNL',     COL.PNL,   'center', BCYAN + B),
  ];
  return V + cols.join(V) + V;
}

function positionRow(pos) {
  const pnlColor = pos.isProfit ? BGREEN : BRED;
  const dirColor = pos.direction === 'LONG' ? BGREEN : BRED;
  const cols = [
    cell(pos.asset,                COL.ASSET, 'left',   BCYAN),
    cell(pos.direction,            COL.DIR,   'center', dirColor + B),
    cell(fmtUSD(pos.sizeUSD),      COL.SIZE,  'right',  BWHITE),
    cell(fmtPrice(pos.entryPrice), COL.ENTRY, 'right',  DIM),
    cell(fmtPrice(pos.markPrice),  COL.MARK,  'right',  BWHITE),
    cell(fmtPrice(pos.tp),         COL.TP,    'right',  GREEN),
    cell(fmtPrice(pos.sl),         COL.SL,    'right',  RED),
    cell(fmtLev(pos.leverage),     COL.LEV,   'center', BYELLOW),
    cell(fmtPnl(pos.pnlUSD, pos.pnlPct), COL.PNL, 'right', pnlColor + B),
  ];
  return V + cols.join(V) + V;
}

// ── Render principal ──────────────────────────────────────────────────────────
/**
 * @param {object} data        - fetchAccountData()
 * @param {object} opts
 * @param {number}  opts.refreshMs
 * @param {Date}    opts.nextRefresh
 * @param {number}  opts.errorCount
 * @param {number|null} opts.sessionPnl   - PnL desde o início da sessão
 * @param {object}  opts.stats            - { signals, executed, ignored, errors }
 */
export function render(data, opts = {}) {
  const { account, positions, timestamp, isPaper } = data;
  const {
    refreshMs   = 10_000,
    nextRefresh = null,
    errorCount  = 0,
    sessionPnl  = null,
    stats       = {},
  } = opts;
  const { signals = 0, executed = 0, ignored = 0, errors = 0 } = stats;

  const pnlColor  = account.unrealizedPnl >= 0 ? BGREEN : BRED;
  const sessColor = (sessionPnl ?? 0) >= 0 ? BGREEN : BRED;
  const pnlPctAcc = account.totalEquity > 0
    ? (account.unrealizedPnl / account.totalEquity) * 100 : 0;

  const lines = [];

  // ══ HEADER ══════════════════════════════════════════════════════════════════
  lines.push(LINE_TOP);
  lines.push(rowBlank());

  // Linha 1 — nome do bot (esquerda) + data/hora (direita)
  const botLabel = isPaper
    ? c('SIGNAL BOT v1', BCYAN + B) + c(' [PAPER]', BYELLOW)
    : c('SIGNAL BOT v1', BCYAN + B);
  const dtLabel  = c(fmtDate(timestamp), DIM) + '  ' + c(fmtTime(timestamp), BWHITE + B);
  const botVis   = stripAnsi(botLabel).length;
  const dtVis    = stripAnsi(dtLabel).length;
  const gap1     = Math.max(1, CONTENT_W - botVis - dtVis);
  lines.push(row(
    ' '.repeat(4) + c(LOGO[0], CYAN) + ' '.repeat(3) +
    botLabel + ' '.repeat(gap1) + dtLabel
  ));

  // Linha 2 — protocolo
  lines.push(row(
    ' '.repeat(4) + c(LOGO[1], CYAN) + ' '.repeat(3) +
    c('Drift Protocol', CYAN)
  ));

  // Linha 3 — separador
  lines.push(row(
    ' '.repeat(4) + c(LOGO[2], CYAN) + ' '.repeat(3) +
    c('\u2500'.repeat(CONTENT_W), DIM)
  ));

  // Colunas de dados: LUCROS (40 chars) │ CONTA (48 chars)
  const LEFT_W  = 40;
  const DIV     = c(' \u2502 ', DIM); // ' │ ' (3 vis chars)

  // Linha 4 — títulos das colunas
  lines.push(row(
    ' '.repeat(4) + c(LOGO[3], CYAN) + ' '.repeat(3) +
    padR(c('LUCROS', BCYAN + B), LEFT_W) + DIV + c('CONTA', BCYAN + B)
  ));

  // Linha 5 — sessão PnL + free collateral
  const sessStr = sessionPnl != null
    ? c(fmtUSD(sessionPnl, true), sessColor + B)
    : c('\u2014', DIM);
  lines.push(row(
    ' '.repeat(4) + c(LOGO[4], CYAN) + ' '.repeat(3) +
    padR(c('Sessao  ', DIM) + sessStr, LEFT_W) +
    DIV +
    padR(c('Free Collateral  ', DIM), 17) + c(fmtUSD(account.freeCollateral), BWHITE + B)
  ));

  // Linha 6 — PnL aberto + equity total
  const pnlAccStr = c(fmtUSD(account.unrealizedPnl, true), pnlColor + B) +
    ' ' + c(`(${pnlPctAcc >= 0 ? '+' : ''}${pnlPctAcc.toFixed(2)}%)`, pnlColor);
  lines.push(row(
    ' '.repeat(4) + c(LOGO[5], CYAN) + ' '.repeat(3) +
    padR(c('PnL Aberto  ', DIM) + pnlAccStr, LEFT_W) +
    DIV +
    padR(c('Equity Total     ', DIM), 17) + c(fmtUSD(account.totalEquity), BWHITE + B)
  ));

  // Linha 7 — sem logo — margem usada
  lines.push(row(
    ' '.repeat(LP) +
    ' '.repeat(LEFT_W) +
    DIV +
    padR(c('Margem Usada     ', DIM), 17) + c(fmtUSD(account.marginUsed), BWHITE)
  ));

  // Linha 8 — sem logo — posições abertas + status
  const posCount  = c(String(positions.length), BWHITE + B);
  const statusTag = errorCount > 0
    ? '  ' + c(`[${errorCount} erros]`, BRED)
    : '  ' + c('OK', BGREEN);
  lines.push(row(
    ' '.repeat(LP) +
    ' '.repeat(LEFT_W) +
    DIV +
    padR(c('Posicoes         ', DIM), 17) + posCount + statusTag
  ));

  lines.push(rowBlank());

  // ══ STATUS BAR ══════════════════════════════════════════════════════════════
  lines.push(LINE_SEP);

  const dot    = errorCount > 0 ? c('\u25CF', BRED) : c('\u25CF', BGREEN);
  const status = errorCount > 0
    ? c(' ERRO', BRED + B)
    : c(' MONITORANDO', BGREEN + B);

  const totalErr = errors + errorCount;
  const statItems = [
    padR(dot + status, 20),
    padR(c('Sinais ', DIM)     + c(String(signals),  BWHITE + B), 12),
    padR(c('Executados ', DIM) + c(String(executed),  executed > 0 ? BGREEN + B : BWHITE + B), 15),
    padR(c('Ignorados ', DIM)  + c(String(ignored),   ignored  > 0 ? BYELLOW    : BWHITE), 14),
    c('Erros ', DIM)           + c(String(totalErr),  totalErr > 0 ? BRED + B   : BWHITE),
  ];
  lines.push(row('   ' + statItems.join(c('    ', ''/*no color, just spacing*/))));

  // ══ POSIÇÕES ════════════════════════════════════════════════════════════════
  const posTitle = c(
    `  \u25B6 POSICOES ABERTAS${positions.length > 0 ? ` (${positions.length})` : ''}`,
    BCYAN + B
  );

  lines.push(LINE_SEP);
  lines.push(row(posTitle));

  if (positions.length === 0) {
    lines.push(rowBlank());
    lines.push(row(centerStr(c('Sem posicoes abertas no momento', DIM), INNER_W)));
    lines.push(rowBlank());
  } else {
    lines.push(tableIntTop());
    lines.push(tableHeaderRow());
    lines.push(tableHSep());
    for (let i = 0; i < positions.length; i++) {
      lines.push(positionRow(positions[i]));
      if (i < positions.length - 1) lines.push(tableRowSep());
    }
    lines.push(tableIntBot());
  }

  // ══ FOOTER ══════════════════════════════════════════════════════════════════
  lines.push(LINE_SEP);
  const nextStr = nextRefresh ? fmtTime(nextRefresh) : '\u2014';
  const footerParts = [
    c('Atualizado: ', DIM) + c(fmtTime(timestamp), BWHITE),
    c('Proxima: ', DIM)    + c(nextStr, BWHITE),
    c(`Intervalo: ${(refreshMs / 1000).toFixed(0)}s`, DIM),
    c('Ctrl+C para sair', DIM),
  ].join(c('   \u2502   ', DIM));
  lines.push(row('   ' + footerParts));
  lines.push(LINE_BOT);

  // ── Redraw in-place ────────────────────────────────────────────────────────
  const EOL = '\x1b[K';
  const EOS = '\x1b[J';
  process.stdout.write(
    '\x1b[H' + HIDE_CURSOR +
    lines.map(l => l + EOL).join('\n') + '\n' + EOS
  );
}

/** Renderiza erro inline. */
export function renderError(err, lastData) {
  if (lastData) { render(lastData, { errorCount: 1 }); return; }

  // Limpa a tela completamente antes de exibir — evita sobreposição com logs
  const msg   = String(err?.message ?? err ?? 'Erro desconhecido');
  const lines = [
    '',
    `  ${BYELLOW}${B}\u26A0  Falha ao conectar ao Drift Protocol${R}`,
    '',
    `  ${DIM}Erro:${R} ${BRED}${msg}${R}`,
    '',
    `  ${DIM}Tentando reconectar automaticamente...${R}`,
    `  ${DIM}(verifique logs em ./logs/ para detalhes)${R}`,
    '',
  ];
  process.stdout.write('\x1b[2J\x1b[H' + HIDE_CURSOR + lines.join('\n') + '\x1b[J');
}

/** Restaura cursor ao encerrar. */
export function cleanup() {
  process.stdout.write(SHOW_CURSOR + '\n');
}
