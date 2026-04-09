import { useEffect, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { api } from '@/api/client';
import { normalizeSnapshot } from '@/lib/state-adapters';
import { useDashboardStore } from '@/store/dashboard-store';
import type { ActivityLog, ManualOpenTradeInput, UpdateTpSlInput } from '@/types/state';

let socket: Socket | null = null;

function makeLog(message: string, level: ActivityLog['level'], source: ActivityLog['source'], meta?: Record<string, unknown>): ActivityLog {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message,
    level,
    source,
    timestamp: new Date().toISOString(),
    meta,
  };
}

export function useDashboard() {
  const snapshot = useDashboardStore((state) => state.snapshot);
  const lastUpdate = useDashboardStore((state) => state.lastUpdate);
  const connection = useDashboardStore((state) => state.connection);
  const socketConnected = useDashboardStore((state) => state.socketConnected);
  const commandPending = useDashboardStore((state) => state.commandPending);
  const localLogs = useDashboardStore((state) => state.localLogs);
  const setSnapshot = useDashboardStore((state) => state.setSnapshot);
  const setConnection = useDashboardStore((state) => state.setConnection);
  const setSocketConnected = useDashboardStore((state) => state.setSocketConnected);
  const setCommandPending = useDashboardStore((state) => state.setCommandPending);
  const addLocalLog = useDashboardStore((state) => state.addLocalLog);
  const clearLocalLogs = useDashboardStore((state) => state.clearLocalLogs);

  const stateQuery = useQuery({
    queryKey: ['bot-state'],
    queryFn: api.getState,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (stateQuery.data) {
      setSnapshot(stateQuery.data);
      setConnection(socketConnected ? 'connected' : 'degraded');
    }
  }, [stateQuery.data, setSnapshot, setConnection, socketConnected]);

  useEffect(() => {
    if (!socket) {
      socket = io('/', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelayMax: 5_000,
      });
    }

    setConnection('connecting');

    const onConnect = () => {
      setSocketConnected(true);
      setConnection('connected');
      addLocalLog(makeLog('Conectado ao stream em tempo real.', 'success', 'system'));
    };

    const onDisconnect = () => {
      setSocketConnected(false);
      setConnection('disconnected');
      addLocalLog(makeLog('Socket desconectado. Operando em modo resiliente.', 'warning', 'system'));
    };

    const onState = (incoming: unknown) => {
      const normalized = normalizeSnapshot(incoming);
      setSnapshot(normalized);
    };

    const onConnectError = () => {
      setConnection('degraded');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', onState);
    socket.on('connect_error', onConnectError);

    return () => {
      socket?.off('connect', onConnect);
      socket?.off('disconnect', onDisconnect);
      socket?.off('state', onState);
      socket?.off('connect_error', onConnectError);
    };
  }, [setConnection, setSocketConnected, addLocalLog, setSnapshot]);

  const runCommand = async <T,>(key: string, action: () => Promise<T>, successMessage: string) => {
    if (commandPending[key]) return;

    setCommandPending(key, true);
    try {
      await action();
      addLocalLog(makeLog(successMessage, 'success', 'user'));
      toast.success(successMessage);
      await stateQuery.refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha no comando';
      addLocalLog(makeLog(message, 'error', 'system'));
      toast.error(message);
      throw error;
    } finally {
      setCommandPending(key, false);
    }
  };

  const pauseMutation = useMutation({ mutationFn: () => runCommand('pause', api.pause, 'Bot pausado com sucesso.') });
  const resumeMutation = useMutation({ mutationFn: () => runCommand('resume', api.resume, 'Bot retomado com sucesso.') });
  const autotradingMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      runCommand('autotrading', () => api.setAutotrading(enabled), `Auto-trading ${enabled ? 'ativado' : 'desativado'} com sucesso.`),
  });
  const openTradeMutation = useMutation({
    mutationFn: (payload: ManualOpenTradeInput) =>
      runCommand(
        'open_manual',
        () => api.openTrade(payload),
        `Ordem manual ${payload.direction} ${payload.asset} enviada com sucesso.`
      ),
  });
  const closeAssetMutation = useMutation({
    mutationFn: ({ asset, venue }: { asset: string; venue?: string }) =>
      runCommand(`close:${asset}`, () => api.closeAsset(asset, venue), `Ordem de fechamento enviada para ${asset}.`),
  });
  const closeAllMutation = useMutation({
    mutationFn: (venue?: string) =>
      runCommand('close_all', () => api.closeAll(venue), 'Fechamento global solicitado.'),
  });
  const updateTpSlMutation = useMutation({
    mutationFn: ({ asset, tp, sl }: UpdateTpSlInput) =>
      runCommand(
        `tpsl:${asset}`,
        () => api.updateTpSl({ asset, tp, sl }),
        `TP/SL atualizado para ${asset}.`
      ),
  });

  const positions = useMemo(() => snapshot?.positions ?? [], [snapshot?.positions]);
  const alerts = useMemo(() => snapshot?.alerts ?? [], [snapshot?.alerts]);
  const metrics = useMemo(() => snapshot?.metrics ?? {}, [snapshot?.metrics]);

  return {
    snapshot,
    lastUpdate,
    connection,
    socketConnected,
    commandPending,
    localLogs,
    clearLocalLogs,
    positions,
    alerts,
    metrics,
    isLoading: stateQuery.isLoading && !snapshot,
    isRefreshing: stateQuery.isRefetching,
    openTrade: (payload: ManualOpenTradeInput) => openTradeMutation.mutateAsync(payload),
    pause: pauseMutation.mutateAsync,
    resume: resumeMutation.mutateAsync,
    setAutotrading: autotradingMutation.mutateAsync,
    closeAsset: (asset: string, venue?: string) => closeAssetMutation.mutateAsync({ asset, venue }),
    closeAll: (venue?: string) => closeAllMutation.mutateAsync(venue),
    updateTpSl: (payload: UpdateTpSlInput) => updateTpSlMutation.mutateAsync(payload),
    refetch: stateQuery.refetch,
  };
}
