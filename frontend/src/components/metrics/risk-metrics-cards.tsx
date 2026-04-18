import { Card, CardContent } from '@/components/ui/card';
import { cn, formatCurrency, formatPercent } from '@/lib/utils';
import type { RiskMetrics } from '@/api/client';

interface RiskMetricsCardsProps {
  data: RiskMetrics;
}

function formatFactor(value: number | null): string {
  if (value === null) return '∞';
  return value.toFixed(2) + 'x';
}

export function RiskMetricsCards({ data }: RiskMetricsCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Win Rate</p>
          <p className="mt-1 text-2xl font-semibold">{formatPercent(data.win_rate)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">trades vencedores</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Ganho Medio</p>
          <p className="mt-1 text-2xl font-semibold text-profit">{formatCurrency(data.avg_win)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">por trade vencedor</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Perda Media</p>
          <p className="mt-1 text-2xl font-semibold text-loss">{formatCurrency(data.avg_loss)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">por trade perdedor</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Profit Factor</p>
          <p className={cn('mt-1 text-2xl font-semibold', (data.profit_factor ?? Infinity) >= 1.5 ? 'text-profit' : 'text-loss')}>
            {formatFactor(data.profit_factor)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">ganhos / perdas</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Payoff Ratio</p>
          <p className={cn('mt-1 text-2xl font-semibold', (data.payoff_ratio ?? Infinity) >= 1 ? 'text-profit' : 'text-loss')}>
            {formatFactor(data.payoff_ratio)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">win medio / loss medio</p>
        </CardContent>
      </Card>
    </div>
  );
}
