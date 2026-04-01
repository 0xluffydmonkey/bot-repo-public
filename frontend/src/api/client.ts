import { normalizeSnapshot } from '@/lib/state-adapters';
import type { BotState } from '@/types/state';

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
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
  closeAsset: (asset: string) =>
    request('/api/close', {
      method: 'POST',
      body: JSON.stringify({ asset }),
    }),
  closeAll: () => request('/api/close_all', { method: 'POST' }),
};
