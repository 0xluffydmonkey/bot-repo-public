import type {
  ActivityLog,
  BackendAccountState,
  BackendErrorEntry,
  BackendPosition,
  BackendSessionState,
  BackendSignal,
  BackendSignalHistoryEntry,
  BackendStatusState,
  BotMetrics,
  BotMode,
  BotState,
  LogLevel,
  Position,
  RawBotState,
} from '@/types/state';
import { ensureArray } from './utils';

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toIsoString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeAccount(input: RawBotState['account']): BackendAccountState {
  return {
    freeCollateral: asNumber(input?.freeCollateral) ?? 0,
    totalEquity: asNumber(input?.totalEquity) ?? 0,
    marginUsed: asNumber(input?.marginUsed) ?? 0,
    unrealizedPnl: asNumber(input?.unrealizedPnl) ?? 0,
    isPaper: Boolean(input?.isPaper),
  };
}

function normalizeStatus(input: RawBotState['status']): BackendStatusState {
  return {
    running: Boolean(input?.running),
    paused: Boolean(input?.paused),
    autoTrading: typeof input?.autoTrading === 'boolean' ? input.autoTrading : true,
    mode: asString(input?.mode) ?? 'paper',
    startedAt: toIsoString(input?.startedAt) ?? null,
    uptime: asNumber(input?.uptime) ?? 0,
  };
}

function normalizeSession(input: RawBotState['session']): BackendSessionState {
  return {
    startPnl: typeof input?.startPnl === 'number' ? input.startPnl : null,
    sessionPnl: asNumber(input?.sessionPnl) ?? 0,
  };
}

function inferBotMode(status: BackendStatusState): BotMode {
  if (status.paused) return 'paused';
  if (status.running) return 'running';
  return 'stopped';
}

function classifyRisk(position: BackendPosition, account: BackendAccountState): Position['risk'] {
  const leverage = asNumber(position.leverage) ?? 0;
  const sizeUSD = Math.abs(asNumber(position.sizeUSD) ?? 0);
  const totalEquity = Math.abs(account.totalEquity);
  const exposureRatio = totalEquity > 0 ? sizeUSD / totalEquity : 0;

  if (leverage >= 15 || exposureRatio >= 1) return 'critical';
  if (leverage >= 10 || exposureRatio >= 0.6) return 'high';
  if (leverage >= 5 || exposureRatio >= 0.3) return 'medium';
  if (sizeUSD > 0) return 'low';
  return undefined;
}

function normalizePositions(input: RawBotState['positions'], updatedAt: string, account: BackendAccountState): Position[] {
  return ensureArray<BackendPosition>(input).map((item) => {
    const direction = asString(item.direction);
    const side =
      direction === 'LONG'
        ? 'long'
        : direction === 'SHORT'
          ? 'short'
          : undefined;

    return {
      ...item,
      asset: String(item.asset ?? 'N/A'),
      side,
      quantity: asNumber(item.sizeBase),
      entryPrice: asNumber(item.entryPrice),
      currentPrice: asNumber(item.markPrice),
      pnl: asNumber(item.pnlUSD),
      pnlPct: asNumber(item.pnlPct),
      exposure: asNumber(item.sizeUSD),
      risk: classifyRisk(item, account),
      updatedAt,
      status: 'open',
      tags: [
        asString(item.market),
        asString(item.marginType),
        typeof item.leverage === 'number' ? `${item.leverage.toFixed(1)}x` : undefined,
      ].filter((tag): tag is string => Boolean(tag)),
      market: asString(item.market),
      leverage: asNumber(item.leverage),
      collateral: asNumber(item.collateralUSD),
      stopLoss: typeof item.sl === 'number' ? item.sl : null,
      takeProfit: typeof item.tp === 'number' ? item.tp : null,
      marginType: asString(item.marginType),
    };
  });
}

function makeSignalMessage(signal?: BackendSignal | null): string {
  if (!signal) return 'Sinal recebido';
  const parts = [signal.asset, signal.direction, typeof signal.entry === 'number' ? `@ ${signal.entry}` : undefined].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Sinal recebido';
}

function normalizeErrorLogs(errors: RawBotState['errors']): ActivityLog[] {
  return ensureArray<BackendErrorEntry>(errors).map((error, index) => ({
    id: `error-${index}-${error.timestamp ?? index}`,
    message: error.message ?? 'Erro do backend',
    level: 'error',
    source: 'backend',
    timestamp: toIsoString(error.timestamp) ?? new Date().toISOString(),
    meta: error as Record<string, unknown>,
  }));
}

function historyLevel(kind: 'executed' | 'ignored', entry: BackendSignalHistoryEntry): LogLevel {
  if (kind === 'executed') return 'success';
  const reason = (entry.reason ?? '').toLowerCase();
  if (reason.includes('invalid') || reason.includes('insufficient') || reason.includes('rejected')) return 'error';
  return 'warning';
}

function normalizeSignalLogs(signals: RawBotState['signals']): ActivityLog[] {
  const executed = ensureArray<BackendSignalHistoryEntry>(signals?.executed).map((entry, index) => ({
    id: `signal-executed-${index}-${entry.timestamp ?? index}`,
    message: `${makeSignalMessage(entry.signal)} executado`,
    level: historyLevel('executed', entry),
    source: 'backend' as const,
    timestamp: toIsoString(entry.timestamp) ?? new Date().toISOString(),
    meta: entry as Record<string, unknown>,
  }));

  const ignored = ensureArray<BackendSignalHistoryEntry>(signals?.ignored).map((entry, index) => ({
    id: `signal-ignored-${index}-${entry.timestamp ?? index}`,
    message: `${makeSignalMessage(entry.signal)} ignorado${entry.reason ? `: ${entry.reason}` : ''}`,
    level: historyLevel('ignored', entry),
    source: 'backend' as const,
    timestamp: toIsoString(entry.timestamp) ?? new Date().toISOString(),
    meta: entry as Record<string, unknown>,
  }));

  const last = signals?.last
    ? [{
        id: `signal-last-${signals.last.signalId ?? signals.last.receivedAt ?? 'latest'}`,
        message: `Ultimo sinal: ${makeSignalMessage(signals.last)}`,
        level: 'info' as const,
        source: 'backend' as const,
        timestamp: toIsoString(signals.last.receivedAt) ?? new Date().toISOString(),
        meta: signals.last as Record<string, unknown>,
      }]
    : [];

  return [...last, ...executed, ...ignored];
}

function buildAlerts(status: BackendStatusState, account: BackendAccountState, positions: Position[], errors: BackendErrorEntry[]): BotState['alerts'] {
  const alerts: NonNullable<BotState['alerts']> = [];

  if (status.paused) {
    alerts.push({
      id: 'paused',
      title: 'Bot pausado',
      description: 'O bot segue online, mas novos sinais nao serao executados.',
      severity: 'warning',
    });
  }

  if (!status.autoTrading) {
    alerts.push({
      id: 'autotrading-off',
      title: 'Auto-trading desativado',
      description: 'O bot esta monitorando, mas nao envia novas ordens automaticamente.',
      severity: 'info',
    });
  }

  if (account.marginUsed > account.totalEquity && account.totalEquity > 0) {
    alerts.push({
      id: 'margin-pressure',
      title: 'Margem acima do patrimonio',
      description: 'A margem utilizada excede o patrimonio atual da conta.',
      severity: 'critical',
    });
  }

  const highRiskPositions = positions.filter((position) => position.risk === 'high' || position.risk === 'critical');
  if (highRiskPositions.length > 0) {
    alerts.push({
      id: 'high-risk-positions',
      title: 'Posicoes com risco elevado',
      description: highRiskPositions.map((position) => position.asset).join(', '),
      severity: highRiskPositions.some((position) => position.risk === 'critical') ? 'critical' : 'warning',
    });
  }

  if (errors.length > 0) {
    alerts.push({
      id: 'recent-errors',
      title: 'Erros recentes no bot',
      description: errors[0]?.message ?? 'Ha falhas recentes registradas pelo backend.',
      severity: 'error',
    });
  }

  return alerts;
}

function inferMetrics(
  account: BackendAccountState,
  status: BackendStatusState,
  session: BackendSessionState,
  signals: RawBotState['signals'],
  positions: Position[],
): BotMetrics {
  const exposureByAsset = positions.map((position) => ({
    asset: position.asset,
    value: Math.abs(position.exposure ?? 0),
  }));

  const winningPositions = positions.filter((position) => (position.pnl ?? 0) > 0).length;
  const openTrades = positions.length;
  const executedTrades = ensureArray(signals?.executed).length;
  const closedTradesEstimate = Math.max(executedTrades, openTrades);
  const winRate = closedTradesEstimate > 0 ? (winningPositions / closedTradesEstimate) * 100 : undefined;
  const pnlBase = account.unrealizedPnl;
  const pnlPct = account.totalEquity > 0 ? (pnlBase / account.totalEquity) * 100 : undefined;
  const drawdown = session.startPnl != null ? Math.max(0, session.startPnl - account.unrealizedPnl) : undefined;

  return {
    pnl: pnlBase,
    pnlPct,
    trades: signals?.count ?? executedTrades ?? openTrades,
    winRate,
    drawdown,
    exposure: exposureByAsset.reduce((sum, item) => sum + item.value, 0),
    exposureByAsset,
    equityCurve: [
      { time: 'Inicio', value: session.startPnl ?? 0 },
      { time: 'Atual', value: account.unrealizedPnl },
    ],
    freeCollateral: account.freeCollateral,
    totalEquity: account.totalEquity,
    marginUsed: account.marginUsed,
    sessionPnl: session.sessionPnl,
    uptime: status.uptime,
  };
}

function dedupeLogs(logs: ActivityLog[]): ActivityLog[] {
  const seen = new Set<string>();
  return logs.filter((log) => {
    const key = `${log.timestamp}-${log.message}-${log.level}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeSnapshot(raw: unknown): BotState {
  const snapshot = (raw && typeof raw === 'object' ? raw : {}) as RawBotState;
  const updatedAt = toIsoString(snapshot.lastUpdate) ?? new Date().toISOString();
  const account = normalizeAccount(snapshot.account);
  const status = normalizeStatus(snapshot.status);
  const session = normalizeSession(snapshot.session);
  const positions = normalizePositions(snapshot.positions, updatedAt, account);
  const logs = dedupeLogs(
    [...normalizeErrorLogs(snapshot.errors), ...normalizeSignalLogs(snapshot.signals)]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
  );

  return {
    paused: status.paused,
    autoTrading: status.autoTrading,
    updatedAt,
    botMode: inferBotMode(status),
    account,
    status,
    session,
    signals: snapshot.signals,
    errorCount: ensureArray(snapshot.errors).length,
    positions,
    assets: positions.map((position) => position.asset),
    logs,
    metrics: inferMetrics(account, status, session, snapshot.signals, positions),
    alerts: buildAlerts(status, account, positions, ensureArray(snapshot.errors)),
  };
}
