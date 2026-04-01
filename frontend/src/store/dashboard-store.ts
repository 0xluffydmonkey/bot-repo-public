import { create } from 'zustand';
import type { ActivityLog, BotState, DashboardState } from '@/types/state';

interface DashboardActions {
  setSnapshot: (snapshot: BotState) => void;
  setConnection: (connection: DashboardState['connection']) => void;
  setSocketConnected: (connected: boolean) => void;
  setCommandPending: (key: string, pending: boolean) => void;
  addLocalLog: (log: ActivityLog) => void;
  clearLocalLogs: () => void;
}

export const useDashboardStore = create<DashboardState & DashboardActions>((set) => ({
  snapshot: null,
  lastUpdate: undefined,
  connection: 'connecting',
  socketConnected: false,
  commandPending: {},
  localLogs: [],
  setSnapshot: (snapshot) =>
    set((state) => ({
      snapshot,
      lastUpdate: snapshot.updatedAt ?? new Date().toISOString(),
      localLogs: [...snapshot.logs ?? [], ...state.localLogs].slice(0, 200),
    })),
  setConnection: (connection) => set({ connection }),
  setSocketConnected: (socketConnected) => set({ socketConnected }),
  setCommandPending: (key, pending) =>
    set((state) => ({
      commandPending: {
        ...state.commandPending,
        [key]: pending,
      },
    })),
  addLocalLog: (log) => set((state) => ({ localLogs: [log, ...state.localLogs].slice(0, 300) })),
  clearLocalLogs: () => set({ localLogs: [] }),
}));
