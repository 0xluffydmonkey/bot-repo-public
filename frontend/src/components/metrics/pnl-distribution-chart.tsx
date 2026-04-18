import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { DistributionBucket } from '@/api/client';

interface PnlDistributionChartProps {
  data: DistributionBucket[];
}

// Buckets negativos = índices 0-1, positivos = índices 2-4 (ordem fixa do backend)
const BUCKET_COLOR = ['bg-loss/70', 'bg-loss/40', 'bg-profit/40', 'bg-profit/60', 'bg-profit/80'];
const BUCKET_LABEL_COLOR = ['text-loss', 'text-loss/70', 'text-muted-foreground', 'text-profit/80', 'text-profit'];

export function PnlDistributionChart({ data }: PnlDistributionChartProps) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const max   = Math.max(...data.map(d => d.count), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Distribuição de Resultados</CardTitle>
          {total > 0 && (
            <span className="text-xs text-muted-foreground">{total} trades</span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum trade fechado registrado
          </p>
        ) : (
          <div className="space-y-2">
            {data.map(({ bucket, count }, i) => {
              const pct = Math.round((count / total) * 100);
              const barWidth = Math.round((count / max) * 100);
              return (
                <div key={bucket} className="flex items-center gap-3">
                  <span className={cn('w-20 shrink-0 text-right text-xs font-mono', BUCKET_LABEL_COLOR[i] ?? 'text-muted-foreground')}>
                    {bucket}
                  </span>
                  <div className="flex-1 h-5 rounded-sm bg-muted/30 overflow-hidden">
                    <div
                      className={cn('h-full rounded-sm transition-all', BUCKET_COLOR[i] ?? 'bg-primary/50')}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-xs text-muted-foreground font-mono">
                    {count} <span className="opacity-60">({pct}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
