import { normalizeSnapshot } from '@/lib/state-adapters';
import type { BotState, ManualOpenTradeInput, UpdateTpSlInput } from '@/types/state';

export type MetricsSummary = {
  totalTrades: number;
  closedTrades: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  bestTrade: number;
  worstTrade: number;
};

export type SymbolMetrics = {
  symbol: string;
  total_trades: number;
  total_pnl: number;
  avg_pnl: number;
  win_rate: number;
};

export type PnlTimeseriesPoint = {
  date: string;
  daily_pnl: number;
  cumulative_pnl: number;
};

export type DistributionBucket = {
  bucket: string;
  count: number;
};

export type SideMetrics = {
  side: string;
  total_trades: number;
  pnl: number;
  win_rate: number;
};

export type RiskMetrics = {
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number | null;
  payoff_ratio: number | null;
};

export type InsightsResult = {
  ok: boolean;
  insights: string[];
};

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
  getMetricsSummary: () =>
    request<{ ok: boolean; data: MetricsSummary }>('/api/metrics/summary').then((r) => r.data),
  getPnlTimeseries: () =>
    request<{ ok: boolean; data: PnlTimeseriesPoint[] }>('/api/metrics/pnl-timeseries').then((r) => r.data),
  getMetricsBySymbol: () =>
    request<{ ok: boolean; data: SymbolMetrics[] }>('/api/metrics/by-symbol').then((r) => r.data),
  getRiskMetrics: () =>
    request<{ ok: boolean; data: RiskMetrics }>('/api/metrics/risk').then((r) => r.data),
  getMetricsBySide: () =>
    request<{ ok: boolean; data: SideMetrics[] }>('/api/metrics/by-side').then((r) => r.data),
  getMetricsDistribution: () =>
    request<{ ok: boolean; data: DistributionBucket[] }>('/api/metrics/distribution').then((r) => r.data),
  getMetricsInsights: () =>
    request<InsightsResult>('/api/metrics/insights').then((r) => r.insights),
};
