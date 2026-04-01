// src/telegram/ui/formatters.js
// Funções de formatação de valores para exibição no Telegram.

export function fmt(n) {
  if (n == null || isNaN(n)) return '--';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-' : '') + '$' + abs;
}

export function fmtSign(n) {
  if (n == null || isNaN(n)) return '--';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n > 0) return '+$' + abs;
  if (n < 0) return '-$' + abs;
  return '$' + abs;
}

export function fmtPrice(p) {
  if (p == null) return '—';
  const n = Number(p);
  if (n >= 10000) return '$' + Math.round(n).toLocaleString('en-US');
  if (n >= 1000)  return '$' + n.toFixed(2);
  if (n >= 100)   return '$' + n.toFixed(3);
  if (n >= 10)    return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

export function fmtPct(n) {
  if (n == null || isNaN(n)) return '--';
  return (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%';
}

export function fmtUptime(secs) {
  if (!secs) return '--';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtDir(dir) {
  return dir === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
}

export function fmtDirIcon(dir) {
  return dir === 'LONG' ? '🟢' : '🔴';
}

export function fmtPnlIcon(pnl) {
  return (pnl ?? 0) >= 0 ? '📈' : '📉';
}

export function fmtTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return '--';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Escapa caracteres especiais do HTML para uso em parse_mode: HTML */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
