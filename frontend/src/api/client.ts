import { normalizeSnapshot } from '@/lib/state-adapters';
import type { BotState, ManualOpenTradeInput, UpdateTpSlInput } from '@/types/state';

export type TradeAuditResult = {
  ok: boolean;
  bot_trade_ref: string;
  trade: Record<string, unknown> | null;
  events: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  balance_snapshots: Record<string, unknown>[];
  signal_decisions: Record<string, unknown>[];
};

function getApiToken() {
  if (typeof window === 'undefined') return null;
  const token = window.localStorage.getItem('trade-dashboard-api-token');
  return token && token.trim().length > 0 ? token.trim() : null;
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const token = getApiToken();
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-API-Token': token } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data && typeof data.error === 'string' ? data.error : null) ?? 'Falha na requisição';
    throw new Error(message);
  }

  return data as T;
}

export const api = {
  async getState(): Promise<BotState> {
    const data = await request<unknown>('/api/state');
    return normalizeSnapshot(data);
  },
  pause: () => request('/api/pause', { method: 'POST' }),
  resume: () => request('/api/resume', { method: 'POST' }),
  setAutotrading: (enabled: boolean) =>
    request('/api/autotrading', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  openTrade: (payload: ManualOpenTradeInput) =>
    request('/api/open', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  closeAsset: (asset: string, venue?: string) =>
    request('/api/close', {
      method: 'POST',
      body: JSON.stringify({ asset, venue }),
    }),
  closeAll: (venue?: string) =>
    request('/api/close_all', {
      method: 'POST',
      body: JSON.stringify({ venue }),
    }),
  updateTpSl: ({ asset, tp, sl }: UpdateTpSlInput) =>
    request('/api/tpsl', {
      method: 'POST',
      body: JSON.stringify({ asset, tp, sl }),
    }),
  getTradeAudit: (botTradeRef: string) =>
    request<TradeAuditResult>(`/api/audit/${encodeURIComponent(botTradeRef)}`),
};
