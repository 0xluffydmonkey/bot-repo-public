import { AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { BotState } from '@/types/state';

interface OperationalStatusCardProps {
  snapshot: BotState | null;
}

interface StatusItemProps {
  label: string;
  value: string;
  valueClass?: string;
  icon?: React.ReactNode;
}

function StatusItem({ label, value, valueClass, icon }: StatusItemProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <span className={cn('flex items-center gap-1 text-xs font-semibold', valueClass)}>
        {icon}
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <span className="text-border/60 select-none">|</span>;
}

export function OperationalStatusCard({ snapshot }: OperationalStatusCardProps) {
  const mode        = snapshot?.status?.mode ?? 'paper';
  const activeVenue = snapshot?.status?.activeVenue || '—';
  const tpEnable    = snapshot?.config?.tpEnable ?? true;
  const slEnable    = snapshot?.config?.slEnable ?? true;
  const isLive      = mode === 'live';

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Status Operacional</span>
          <Divider />

          <StatusItem
            label="Modo"
            value={isLive ? 'LIVE' : 'PAPER'}
            valueClass={isLive ? 'text-loss' : 'text-info'}
          />

          <Divider />

          <StatusItem
            label="Venue"
            value={activeVenue.toUpperCase()}
            valueClass="text-foreground"
          />

          <Divider />

          <StatusItem
            label="TP"
            value={tpEnable ? 'ON' : 'OFF'}
            valueClass={tpEnable ? 'text-profit' : 'text-muted-foreground'}
          />

          <Divider />

          <StatusItem
            label="SL"
            value={slEnable ? 'ON' : 'OFF'}
            valueClass={slEnable ? 'text-profit' : 'text-warning'}
            icon={!slEnable ? <AlertTriangle className="h-3 w-3 shrink-0" /> : undefined}
          />
        </div>
      </CardContent>
    </Card>
  );
}
