import { Activity, Bot, Cpu, TrendingUp, TrendingDown, Wallet, DollarSign } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { cn, formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import type { BotState, ConnectionStatus } from '@/types/state';

interface HeroStatsProps {
  snapshot: BotState | null;
  connection?: ConnectionStatus;
  updatedAt?: string;
}

export function HeroStats({ snapshot }: HeroStatsProps) {
  const metrics = snapshot?.metrics ?? {};
  const account = snapshot?.account;
  const pnl = metrics.pnl as number | undefined;
  const pnlPct = metrics.pnlPct as number | undefined;
  const isProfitable = typeof pnl === 'number' && pnl >= 0;

  const botStatus = snapshot?.botMode === 'paused'
    ? 'Pausado'
    : snapshot?.botMode === 'stopped'
      ? 'Parado'
      : 'Ativo';

  const statusColor = snapshot?.botMode === 'running'
    ? 'text-profit'
    : snapshot?.botMode === 'paused'
      ? 'text-warning'
      : 'text-muted-foreground';

  const cards = [
    {
      label: 'PnL Total',
      value: formatCurrency(pnl),
      subValue: formatPercent(pnlPct),
      icon: isProfitable ? TrendingUp : TrendingDown,
      iconColor: isProfitable ? 'text-profit' : 'text-loss',
      valueColor: isProfitable ? 'text-profit' : 'text-loss',
    },
    {
      label: 'Patrimonio',
      value: formatCurrency(account?.totalEquity),
      subValue: `Livre: ${formatCurrency(account?.freeCollateral)}`,
      icon: Wallet,
      iconColor: 'text-info',
      valueColor: '',
    },
    {
      label: 'Posicoes Abertas',
      value: snapshot?.positions?.length ?? 0,
      subValue: `Exposicao: ${formatCurrency(metrics.exposure as number | undefined)}`,
      icon: Activity,
      iconColor: 'text-foreground',
      valueColor: '',
    },
    {
      label: 'Status do Bot',
      value: botStatus,
      subValue: snapshot?.autoTrading ? 'Auto-trading ativo' : 'Auto-trading inativo',
      icon: Bot,
      iconColor: statusColor,
      valueColor: statusColor,
    },
    {
      label: 'Auto-Trading',
      value: snapshot?.autoTrading ? 'Ligado' : 'Desligado',
      subValue: snapshot?.status?.mode === 'live' ? 'Modo: Live' : 'Modo: Paper',
      icon: Cpu,
      iconColor: snapshot?.autoTrading ? 'text-profit' : 'text-muted-foreground',
      valueColor: snapshot?.autoTrading ? 'text-profit' : 'text-muted-foreground',
    },
    {
      label: 'Trades Executados',
      value: formatNumber(metrics.trades as number | undefined, 0),
      subValue: `Win rate: ${formatPercent(metrics.winRate as number | undefined)}`,
      icon: DollarSign,
      iconColor: 'text-foreground',
      valueColor: '',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card, index) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.03 }}
        >
          <Card className="h-full">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-muted-foreground truncate">
                    {card.label}
                  </p>
                  <p className={cn('mt-1 text-xl font-semibold tracking-tight truncate', card.valueColor)}>
                    {card.value}
                  </p>
                  {card.subValue && (
                    <p className="mt-0.5 text-xs text-muted-foreground truncate">
                      {card.subValue}
                    </p>
                  )}
                </div>
                <div className={cn('rounded-md bg-muted p-2', card.iconColor)}>
                  <card.icon className="h-4 w-4" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

export function CompactStats({ snapshot }: { snapshot: BotState | null }) {
  const metrics = snapshot?.metrics ?? {};
  const pnl = metrics.pnl as number | undefined;
  const isProfitable = typeof pnl === 'number' && pnl >= 0;

  const items = [
    { label: 'PnL', value: formatCurrency(pnl), color: isProfitable ? 'text-profit' : 'text-loss' },
    { label: 'Posicoes', value: snapshot?.positions?.length ?? 0, color: '' },
    { label: 'Trades', value: formatNumber(metrics.trades as number | undefined, 0), color: '' },
    { label: 'Win Rate', value: formatPercent(metrics.winRate as number | undefined), color: '' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-4">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{item.label}:</span>
          <span className={cn('text-sm font-medium', item.color)}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}
