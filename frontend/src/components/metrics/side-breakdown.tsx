import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import type { SideMetrics } from '@/api/client';

interface SideBreakdownProps {
  data: SideMetrics[];
}

const SIDE_LABEL: Record<string, string> = {
  LONG:  'Long',
  SHORT: 'Short',
};

const SIDE_COLOR: Record<string, string> = {
  LONG:  'text-profit',
  SHORT: 'text-loss',
};

export function SideBreakdown({ data }: SideBreakdownProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">Nenhum trade fechado registrado</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Long vs Short</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((row) => {
            const label = SIDE_LABEL[row.side] ?? row.side;
            const color = SIDE_COLOR[row.side] ?? '';
            return (
              <div
                key={row.side}
                className="rounded-md border border-border bg-muted/20 p-4 space-y-3"
              >
                <p className={cn('text-sm font-semibold', color)}>{label}</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Trades</p>
                    <p className="mt-0.5 text-base font-semibold">{formatNumber(row.total_trades, 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">PnL</p>
                    <p className={cn('mt-0.5 text-base font-semibold', row.pnl >= 0 ? 'text-profit' : 'text-loss')}>
                      {formatCurrency(row.pnl)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Win Rate</p>
                    <p className={cn('mt-0.5 text-base font-semibold', row.win_rate >= 50 ? 'text-profit' : 'text-loss')}>
                      {formatNumber(row.win_rate, 1)}%
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
