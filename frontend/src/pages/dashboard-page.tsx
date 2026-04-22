import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Layers,
  Settings2,
  TrendingUp,
  Receipt,
  Terminal,
  FileSearch,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { AnalyticsPanel, PerformancePanel, FeesPanel } from '@/components/charts/analytics-panel';
import { ControlPanel, CompactControls } from '@/components/controls/control-panel';
import { ManualTradePanel } from '@/components/controls/manual-trade-panel';
import { LogStream } from '@/components/logs/log-stream';
import { TradeAuditPanel } from '@/components/audit/trade-audit-panel';
import { HeroStats } from '@/components/metrics/hero-stats';
import { SymbolPerformanceTable } from '@/components/metrics/symbol-performance-table';
import { SideBreakdown } from '@/components/metrics/side-breakdown';
import { PnlDistributionChart } from '@/components/metrics/pnl-distribution-chart';
import { PositionsTable } from '@/components/positions/positions-table';
import { AlertsPanel } from '@/components/status/alerts-panel';
import { ProtectionBadges } from '@/components/status/protection-badges';
import { OperationalStatusCard } from '@/components/status/operational-status-card';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { useDashboard } from '@/hooks/use-dashboard';

const tabs = [
  { id: 'overview', label: 'Visao Geral', icon: LayoutDashboard },
  { id: 'positions', label: 'Posicoes', icon: Layers },
  { id: 'operations', label: 'Operacional', icon: Settings2 },
  { id: 'performance', label: 'Performance', icon: TrendingUp },
  { id: 'fees', label: 'Fees', icon: Receipt },
  { id: 'logs', label: 'Logs', icon: Terminal },
  { id: 'audit', label: 'Auditoria', icon: FileSearch },
];

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const {
    snapshot,
    connection,
    lastUpdate,
    metrics,
    positions,
    alerts,
    localLogs,
    commandPending,
    clearLocalLogs,
    pause,
    resume,
    setAutotrading,
    openTrade,
    closeAsset,
    closeAll,
    updateTpSl,
    refetch,
    summary,
    timeseries,
    bySymbol,
    risk,
    bySide,
    distribution,
    insights,
  } = useDashboard();

  return (
    <AppShell connection={connection} updatedAt={lastUpdate} onRefresh={() => void refetch()}>
      <div className="space-y-4 pb-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <TabsList className="w-full overflow-x-auto sm:w-auto">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5">
                  <tab.icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {/* Protection status + Quick Controls — always visible */}
            <div className="flex flex-wrap items-center gap-2">
              <ProtectionBadges
                tpEnable={snapshot?.config?.tpEnable}
                slEnable={snapshot?.config?.slEnable}
              />
              <CompactControls
                paused={Boolean(snapshot?.paused)}
                autoTrading={Boolean(snapshot?.autoTrading)}
                pending={commandPending}
                onPause={pause}
                onResume={resume}
                onAutotrading={setAutotrading}
              />
            </div>
          </div>

          {/* Overview Tab */}
          <TabsContent value="overview">
            <div className="space-y-4">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <OperationalStatusCard snapshot={snapshot} />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.03 }}
              >
                <HeroStats
                  snapshot={snapshot}
                  connection={connection}
                  updatedAt={lastUpdate}
                />
              </motion.div>

              <div className="grid gap-4 lg:grid-cols-3">
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 }}
                  className="lg:col-span-2"
                >
                  <PositionsTable
                    positions={positions}
                    pending={commandPending}
                    onCloseAsset={closeAsset}
                    onUpdateTpSl={updateTpSl}
                    compact
                  />
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  <AlertsPanel alerts={alerts} compact />
                </motion.div>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
              >
                <AnalyticsPanel metrics={metrics} />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <LogStream logs={localLogs} onClear={clearLocalLogs} compact />
              </motion.div>
            </div>
          </TabsContent>

          {/* Positions Tab */}
          <TabsContent value="positions">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <PositionsTable
                positions={positions}
                pending={commandPending}
                onCloseAsset={closeAsset}
                onUpdateTpSl={updateTpSl}
              />
            </motion.div>
          </TabsContent>

          {/* Operations Tab */}
          <TabsContent value="operations">
            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <ManualTradePanel
                  pending={commandPending}
                  onOpenTrade={openTrade}
                />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="space-y-4"
              >
                <ControlPanel
                  paused={Boolean(snapshot?.paused)}
                  autoTrading={Boolean(snapshot?.autoTrading)}
                  pending={commandPending}
                  onPause={pause}
                  onResume={resume}
                  onAutotrading={setAutotrading}
                  onCloseAll={closeAll}
                />
                <AlertsPanel alerts={alerts} />
              </motion.div>
            </div>
          </TabsContent>

          {/* Performance Tab */}
          <TabsContent value="performance">
            <div className="space-y-6">

              {/* 1. Resumo Principal */}
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Resumo Principal
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">PnL Total</p>
                      <p className={cn('mt-1 text-2xl font-semibold', summary.totalPnL >= 0 ? 'text-profit' : 'text-loss')}>
                        {formatCurrency(summary.totalPnL)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatNumber(summary.closedTrades, 0)} trades fechados</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Win Rate</p>
                      <p className={cn('mt-1 text-2xl font-semibold', summary.winRate >= 50 ? 'text-profit' : 'text-loss')}>
                        {formatNumber(summary.winRate, 1)}%
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">dos trades fechados</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Profit Factor</p>
                      <p className={cn('mt-1 text-2xl font-semibold', (risk.profit_factor ?? Infinity) >= 1.5 ? 'text-profit' : 'text-loss')}>
                        {risk.profit_factor === null ? '∞' : `${risk.profit_factor.toFixed(2)}x`}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">ganhos ÷ perdas</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">PnL Médio</p>
                      <p className={cn('mt-1 text-2xl font-semibold', summary.avgPnL >= 0 ? 'text-profit' : 'text-loss')}>
                        {formatCurrency(summary.avgPnL)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">por trade fechado</p>
                    </CardContent>
                  </Card>
                </div>
              </motion.div>

              {/* 2. Qualidade da Estrategia */}
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Qualidade da Estratégia
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Trades Fechados</p>
                      <p className="mt-1 text-2xl font-semibold">{formatNumber(summary.closedTrades, 0)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Melhor Trade</p>
                      <p className="mt-1 text-2xl font-semibold text-profit">{formatCurrency(summary.bestTrade)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Pior Trade</p>
                      <p className="mt-1 text-2xl font-semibold text-loss">{formatCurrency(summary.worstTrade)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Ganho Médio</p>
                      <p className="mt-1 text-2xl font-semibold text-profit">{formatCurrency(risk.avg_win)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Perda Média</p>
                      <p className="mt-1 text-2xl font-semibold text-loss">{formatCurrency(risk.avg_loss)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Payoff Ratio</p>
                      <p className={cn('mt-1 text-2xl font-semibold', (risk.payoff_ratio ?? Infinity) >= 1 ? 'text-profit' : 'text-loss')}>
                        {risk.payoff_ratio === null ? '∞' : `${risk.payoff_ratio.toFixed(2)}x`}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">ganho médio ÷ perda média</p>
                    </CardContent>
                  </Card>
                </div>
              </motion.div>

              {/* 3. Graficos */}
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Gráficos
                </p>
                <PerformancePanel metrics={metrics} timeseries={timeseries} hideSummaryCards />
              </motion.div>

              {/* 4. Breakdowns */}
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Detalhamento
                </p>
                <div className="space-y-3">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <SideBreakdown data={bySide} />
                    <PnlDistributionChart data={distribution} />
                  </div>
                  <SymbolPerformanceTable data={bySymbol} />
                </div>
              </motion.div>

              {/* 5. Insights */}
              {insights.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Insights
                  </p>
                  <Card>
                    <CardContent className="p-4">
                      <ul className="space-y-2.5">
                        {insights.map((text, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-500/70" />
                            {text}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

            </div>
          </TabsContent>

          {/* Fees Tab */}
          <TabsContent value="fees">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <FeesPanel metrics={metrics} />
            </motion.div>
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <LogStream logs={localLogs} onClear={clearLocalLogs} />
            </motion.div>
          </TabsContent>

          {/* Audit Tab */}
          <TabsContent value="audit">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <TradeAuditPanel />
            </motion.div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
