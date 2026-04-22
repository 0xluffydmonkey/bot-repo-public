export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'degraded';
export type BotMode = 'running' | 'paused' | 'stopped' | 'unknown';
export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface BackendAccountState {
  freeCollateral: number;
  totalEquity: number;
  marginUsed: number;
  unrealizedPnl: number;
  isPaper: boolean;
}

export interface BackendPosition {
  asset: string;
  market?: string;
  direction?: 'LONG' | 'SHORT' | string;
  marginType?: string;
  marketIndex?: number;
  sizeBase?: number;
  sizeUSD?: number;
  collateralUSD?: number;
  entryPrice?: number;
  markPrice?: number;
  tp?: number | null;
  sl?: number | null;
  leverage?: number;
  pnlUSD?: number;
  pnlPct?: number;
  isProfit?: boolean;
  [key: string]: unknown;
}

export interface BackendSignal {
  signalId?: string;
  asset?: string;
  direction?: string;
  entry?: number;
  tp?: number;
  sl?: number;
  leverage?: number;
  receivedAt?: string;
  [key: string]: unknown;
}

export interface BackendSignalHistoryEntry {
  signal?: BackendSignal;
  result?: Record<string, unknown>;
  reason?: string;
  timestamp?: string;
}

export interface BackendErrorEntry {
  context?: string;
  message?: string;
  timestamp?: string;
}

export interface BackendStatusState {
  running: boolean;
  paused: boolean;
  autoTrading: boolean;
  mode: 'paper' | 'live' | string;
  activeVenue: string;
  startedAt: string | null;
  uptime: number;
}

export interface BackendSessionState {
  startPnl: number | null;
  sessionPnl: number;
}

export interface RawBotState {
  account?: Partial<BackendAccountState>;
  positions?: BackendPosition[];
  signals?: {
    last?: BackendSignal | null;
    count?: number;
    executed?: BackendSignalHistoryEntry[];
    ignored?: BackendSignalHistoryEntry[];
  };
  errors?: BackendErrorEntry[];
  status?: Partial<BackendStatusState>;
  session?: Partial<BackendSessionState>;
  lastUpdate?: string;
  [key: string]: unknown;
}

export interface MetricCardValue {
  label: string;
  value: number | string;
  change?: number;
  trend?: Array<{ time: string; value: number }>;
}

export interface Position {
  asset: string;
  venue?: string;
  side?: 'long' | 'short' | 'flat' | string;
  quantity?: number;
  entryPrice?: number;
  currentPrice?: number;
  pnl?: number;
  pnlPct?: number;
  exposure?: number;
  risk?: 'low' | 'medium' | 'high' | 'critical' | string;
  updatedAt?: string;
  status?: 'open' | 'closed' | 'watching' | string;
  tags?: string[];
  market?: string;
  leverage?: number;
  collateral?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  marginType?: string;
  [key: string]: unknown;
}

export interface ManualOpenTradeInput {
  asset: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  tp: number;
  sl: number;
  leverage: number;
  marginType?: 'isolated' | 'cross';
}

export interface UpdateTpSlInput {
  asset: string;
  tp?: number | null;
  sl?: number | null;
}

export interface ActivityLog {
  id: string;
  message: string;
  level: LogLevel;
  source: 'system' | 'user' | 'backend';
  timestamp: string;
  meta?: Record<string, unknown>;
}

export interface BotMetrics {
  pnl?: number;
  pnlPct?: number;
  trades?: number;
  winRate?: number;
  drawdown?: number;
  exposure?: number;
  exposureByAsset?: Array<{ asset: string; value: number }>;
  equityCurve?: Array<{ time: string; value: number }>;
  [key: string]: unknown;
}

export interface BotConfig {
  tpEnable: boolean;
  slEnable: boolean;
}

export interface BotState {
  paused?: boolean;
  autoTrading?: boolean;
  updatedAt?: string;
  botMode?: BotMode;
  account?: BackendAccountState;
  status?: BackendStatusState;
  session?: BackendSessionState;
  signals?: RawBotState['signals'];
  errorCount?: number;
  positions?: Position[];
  assets?: string[] | Array<{ asset: string; [key: string]: unknown }>;
  logs?: ActivityLog[];
  metrics?: BotMetrics;
  config?: BotConfig;
  alerts?: Array<{
    id?: string;
    title: string;
    description?: string;
    severity: LogLevel | 'critical';
  }>;
  [key: string]: unknown;
}

export interface DashboardState {
  snapshot: BotState | null;
  lastUpdate?: string;
  connection: ConnectionStatus;
  socketConnected: boolean;
  commandPending: Record<string, boolean>;
  localLogs: ActivityLog[];
}
