import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Layers,
  Settings2,
  TrendingUp,
  Receipt,
  Terminal,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { AnalyticsPanel, PerformancePanel, FeesPanel } from '@/components/charts/analytics-panel';
import { ControlPanel, CompactControls } from '@/components/controls/control-panel';
import { ManualTradePanel } from '@/components/controls/manual-trade-panel';
import { LogStream } from '@/components/logs/log-stream';
import { HeroStats } from '@/components/metrics/hero-stats';
import { PositionsTable } from '@/components/positions/positions-table';
import { AlertsPanel } from '@/components/status/alerts-panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDashboard } from '@/hooks/use-dashboard';

const tabs = [
  { id: 'overview', label: 'Visao Geral', icon: LayoutDashboard },
  { id: 'positions', label: 'Posicoes', icon: Layers },
  { id: 'operations', label: 'Operacional', icon: Settings2 },
  { id: 'performance', label: 'Performance', icon: TrendingUp },
  { id: 'fees', label: 'Fees', icon: Receipt },
  { id: 'logs', label: 'Logs', icon: Terminal },
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

            {/* Quick Controls — always visible */}
            <CompactControls
              paused={Boolean(snapshot?.paused)}
              autoTrading={Boolean(snapshot?.autoTrading)}
              pending={commandPending}
              onPause={pause}
              onResume={resume}
              onAutotrading={setAutotrading}
            />
          </div>

          {/* Overview Tab */}
          <TabsContent value="overview">
            <div className="space-y-4">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
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
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <PerformancePanel metrics={metrics} />
            </motion.div>
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
        </Tabs>
      </div>
    </AppShell>
  );
}
