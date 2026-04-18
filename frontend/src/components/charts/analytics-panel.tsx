import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import type { BotMetrics } from '@/types/state';
import type { PnlTimeseriesPoint } from '@/api/client';

const fallbackCurve = Array.from({ length: 12 }).map((_, index) => ({
  time: `${String(index + 9).padStart(2, '0')}:00`,
  value: 0,
}));

interface AnalyticsPanelProps {
  metrics: BotMetrics;
}

export function AnalyticsPanel({ metrics }: AnalyticsPanelProps) {
  const curve =
    metrics.equityCurve && metrics.equityCurve.length > 0
      ? metrics.equityCurve
      : fallbackCurve;

  const exposure =
    metrics.exposureByAsset && metrics.exposureByAsset.length > 0
      ? metrics.exposureByAsset
      : [{ asset: 'Sem dados', value: 1 }];

  const pnl = metrics.pnl as number | undefined;
  const isProfitable = typeof pnl === 'number' && pnl >= 0;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {/* Equity Curve */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Curva de Patrimonio</CardTitle>
            <div className="flex items-center gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">PnL: </span>
                <span className={cn('font-medium', isProfitable ? 'text-profit' : 'text-loss')}>
                  {formatCurrency(pnl)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Drawdown: </span>
                <span className="font-medium text-loss">
                  {formatPercent(metrics.drawdown as number | undefined)}
                </span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={curve}>
                <defs>
                  <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={isProfitable ? 'hsl(142, 72%, 46%)' : 'hsl(0, 72%, 51%)'}
                      stopOpacity={0.2}
                    />
                    <stop
                      offset="100%"
                      stopColor={isProfitable ? 'hsl(142, 72%, 46%)' : 'hsl(0, 72%, 51%)'}
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(0, 0%, 20%)"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tick={{ fill: 'hsl(0, 0%, 55%)', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'hsl(0, 0%, 55%)', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => `$${formatNumber(value / 1000, 0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(0, 0%, 7%)',
                    border: '1px solid hsl(0, 0%, 14%)',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                  formatter={(value: number) => [formatCurrency(value), 'Valor']}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={isProfitable ? 'hsl(142, 72%, 46%)' : 'hsl(0, 72%, 51%)'}
                  fill="url(#equityGradient)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Exposure by Asset */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Exposicao por Ativo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[140px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={exposure}
                  dataKey="value"
                  nameKey="asset"
                  innerRadius={40}
                  outerRadius={65}
                  paddingAngle={2}
                >
                  {exposure.map((entry, index) => (
                    <Cell
                      key={`${entry.asset}-${index}`}
                      fill={`hsl(${(index * 45) % 360}, 50%, 55%)`}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(0, 0%, 7%)',
                    border: '1px solid hsl(0, 0%, 14%)',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                  formatter={(value: number) => [formatCurrency(value), 'Exposicao']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1">
            {exposure.slice(0, 4).map((entry, index) => (
              <div
                key={entry.asset}
                className="flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: `hsl(${(index * 45) % 360}, 50%, 55%)` }}
                  />
                  <span className="text-muted-foreground">{entry.asset}</span>
                </div>
                <span className="font-mono">{formatCurrency(entry.value)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface PerformancePanelProps {
  metrics: BotMetrics;
  timeseries?: PnlTimeseriesPoint[];
  hideSummaryCards?: boolean;
}

// Performance overview for dedicated tab — uses real metrics only
export function PerformancePanel({ metrics, timeseries = [], hideSummaryCards = false }: PerformancePanelProps) {
  const curve =
    metrics.equityCurve && metrics.equityCurve.length > 0
      ? metrics.equityCurve
      : fallbackCurve;

  const pnl = metrics.pnl as number | undefined;
  const isProfitable = typeof pnl === 'number' && pnl >= 0;

  return (
    <div className="space-y-4">
      {/* Summary Cards — all real data */}
      {!hideSummaryCards && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">PnL Total</p>
            <p className={cn('mt-1 text-2xl font-semibold', isProfitable ? 'text-profit' : 'text-loss')}>
              {formatCurrency(pnl)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatPercent(metrics.pnlPct as number | undefined)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Win Rate</p>
            <p className="mt-1 text-2xl font-semibold">
              {formatPercent(metrics.winRate as number | undefined)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatNumber(metrics.trades as number | undefined, 0)} trades
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Drawdown Maximo</p>
            <p className="mt-1 text-2xl font-semibold text-loss">
              {formatPercent(metrics.drawdown as number | undefined)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">Pico ao vale</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Exposicao Total</p>
            <p className="mt-1 text-2xl font-semibold">
              {formatCurrency(metrics.exposure as number | undefined)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">Em aberto</p>
          </CardContent>
        </Card>
      </div>}

      {/* Charts */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Equity evolution — real data */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Evolucao do Patrimonio</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={curve}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 20%)" vertical={false} />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: 'hsl(0, 0%, 55%)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'hsl(0, 0%, 55%)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `$${formatNumber(value / 1000, 0)}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(0, 0%, 7%)',
                      border: '1px solid hsl(0, 0%, 14%)',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                    formatter={(value: number) => [formatCurrency(value), 'Valor']}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={isProfitable ? 'hsl(142, 72%, 46%)' : 'hsl(0, 72%, 51%)'}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* PnL Acumulado — dados reais de /api/metrics/pnl-timeseries */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">PnL Acumulado (Historico)</CardTitle>
          </CardHeader>
          <CardContent>
            {timeseries.length > 0 ? (
              <div className="h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeseries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 20%)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: 'hsl(0, 0%, 55%)', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(d: string) => d.slice(5)}
                    />
                    <YAxis
                      tick={{ fill: 'hsl(0, 0%, 55%)', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `$${formatNumber(v, 0)}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(0, 0%, 7%)',
                        border: '1px solid hsl(0, 0%, 14%)',
                        borderRadius: '6px',
                        fontSize: '12px',
                      }}
                      formatter={(v: number) => [formatCurrency(v), 'PnL Acumulado']}
                    />
                    <Line
                      type="monotone"
                      dataKey="cumulative_pnl"
                      stroke={
                        (timeseries[timeseries.length - 1]?.cumulative_pnl ?? 0) >= 0
                          ? 'hsl(142, 72%, 46%)'
                          : 'hsl(0, 72%, 51%)'
                      }
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-[360px] flex-col items-center justify-center gap-3 rounded-md border border-border bg-muted/20">
                <Info className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Nenhum trade fechado registrado</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Fees Panel — shows only real data; fee breakdown not available from current API
export function FeesPanel({ metrics }: AnalyticsPanelProps) {
  const pnl = (metrics.pnl as number) ?? 0;
  const isProfitable = pnl >= 0;

  return (
    <div className="space-y-4">
      {/* Real data summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">PnL Bruto</p>
            <p className={cn('mt-1 text-2xl font-semibold', isProfitable ? 'text-profit' : 'text-loss')}>
              {formatCurrency(pnl)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatPercent(metrics.pnlPct as number | undefined)} sobre patrimonio
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Trades Executados</p>
            <p className="mt-1 text-2xl font-semibold">
              {formatNumber(metrics.trades as number | undefined, 0)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Win rate: {formatPercent(metrics.winRate as number | undefined)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Exposicao Total</p>
            <p className="mt-1 text-2xl font-semibold">
              {formatCurrency(metrics.exposure as number | undefined)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">Posicoes abertas</p>
          </CardContent>
        </Card>
      </div>

      {/* Fee breakdown — not available from current API */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Detalhamento de Fees por Ativo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-border bg-muted/20 py-12">
            <Info className="h-8 w-8 text-muted-foreground/50" />
            <div className="text-center">
              <p className="text-sm font-medium text-muted-foreground">
                Dados de fees indisponiveis
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                A API atual nao expoe taxas pagas por operacao ou por ativo.
                <br />
                Quando o backend incluir esse campo no state, ele sera exibido aqui automaticamente.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Exposure breakdown — real data */}
      {metrics.exposureByAsset && metrics.exposureByAsset.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Exposicao por Ativo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                      Ativo
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                      Exposicao (USD)
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                      % do Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.exposureByAsset.map((item) => {
                    const total = (metrics.exposure as number) || 1;
                    return (
                      <tr
                        key={item.asset}
                        className="border-b border-border/50 last:border-0"
                      >
                        <td className="px-3 py-2 font-mono font-medium">{item.asset}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCurrency(item.value)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                          {formatPercent((item.value / total) * 100)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
