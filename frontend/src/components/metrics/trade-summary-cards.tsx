import { TrendingUp, TrendingDown, BarChart2, CheckCircle2, Trophy, AlertTriangle, Percent } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import type { MetricsSummary } from '@/api/client';

interface TradeSummaryCardsProps {
  summary: MetricsSummary;
}

export function TradeSummaryCards({ summary }: TradeSummaryCardsProps) {
  const cards = [
    {
      label: 'Total Trades',
      value: formatNumber(summary.totalTrades, 0),
      icon: BarChart2,
      iconColor: 'text-foreground',
      valueColor: '',
    },
    {
      label: 'Closed Trades',
      value: formatNumber(summary.closedTrades, 0),
      icon: CheckCircle2,
      iconColor: 'text-info',
      valueColor: '',
    },
    {
      label: 'Win Rate',
      value: `${formatNumber(summary.winRate, 1)}%`,
      icon: Percent,
      iconColor: summary.winRate >= 50 ? 'text-profit' : 'text-loss',
      valueColor: summary.winRate >= 50 ? 'text-profit' : 'text-loss',
    },
    {
      label: 'Total PnL',
      value: formatCurrency(summary.totalPnL),
      icon: summary.totalPnL >= 0 ? TrendingUp : TrendingDown,
      iconColor: summary.totalPnL >= 0 ? 'text-profit' : 'text-loss',
      valueColor: summary.totalPnL >= 0 ? 'text-profit' : 'text-loss',
    },
    {
      label: 'Avg PnL',
      value: formatCurrency(summary.avgPnL),
      icon: summary.avgPnL >= 0 ? TrendingUp : TrendingDown,
      iconColor: summary.avgPnL >= 0 ? 'text-profit' : 'text-loss',
      valueColor: summary.avgPnL >= 0 ? 'text-profit' : 'text-loss',
    },
    {
      label: 'Best Trade',
      value: formatCurrency(summary.bestTrade),
      icon: Trophy,
      iconColor: 'text-profit',
      valueColor: 'text-profit',
    },
    {
      label: 'Worst Trade',
      value: formatCurrency(summary.worstTrade),
      icon: AlertTriangle,
      iconColor: 'text-loss',
      valueColor: 'text-loss',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground truncate">{card.label}</p>
                <p className={cn('mt-1 text-lg font-semibold tracking-tight truncate', card.valueColor)}>
                  {card.value}
                </p>
              </div>
              <div className={cn('rounded-md bg-muted p-2', card.iconColor)}>
                <card.icon className="h-4 w-4" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
