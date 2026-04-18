import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import type { SymbolMetrics } from '@/api/client';

interface SymbolPerformanceTableProps {
  data: SymbolMetrics[];
}

export function SymbolPerformanceTable({ data }: SymbolPerformanceTableProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Performance por Ativo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum trade fechado registrado
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Performance por Ativo</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-hidden rounded-b-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Ativo</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Trades</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Win Rate</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">PnL Total</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">PnL Medio</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.symbol} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2 font-mono font-semibold">{row.symbol}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                    {formatNumber(row.total_trades, 0)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    <span className={cn(row.win_rate >= 50 ? 'text-profit' : 'text-loss')}>
                      {formatNumber(row.win_rate, 1)}%
                    </span>
                  </td>
                  <td className={cn('px-4 py-2 text-right font-mono font-medium', row.total_pnl >= 0 ? 'text-profit' : 'text-loss')}>
                    {formatCurrency(row.total_pnl)}
                  </td>
                  <td className={cn('px-4 py-2 text-right font-mono', row.avg_pnl >= 0 ? 'text-profit' : 'text-loss')}>
                    {formatCurrency(row.avg_pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
