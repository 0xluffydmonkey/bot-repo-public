import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value?: number, currency = 'USD') {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${value.toFixed(2)}%`;
}

export function formatNumber(value?: number, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDateTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}

export function relativeTime(value?: string) {
  if (!value) return 'sem atualização';
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const seconds = Math.round(diff / 1000);
  if (Math.abs(seconds) < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function riskTone(risk?: string) {
  switch (risk) {
    case 'critical':
      return 'text-red-400 border-red-500/30 bg-red-500/10';
    case 'high':
      return 'text-orange-300 border-orange-500/30 bg-orange-500/10';
    case 'medium':
      return 'text-yellow-300 border-yellow-500/30 bg-yellow-500/10';
    case 'low':
      return 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10';
    default:
      return 'text-muted-foreground border-border bg-background/60';
  }
}

export function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
