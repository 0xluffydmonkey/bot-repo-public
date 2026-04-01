import { Wifi, WifiOff, RotateCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConnectionStatus } from '@/types/state';

const statusConfig = {
  connected: {
    label: 'Online',
    icon: Wifi,
    className: 'bg-profit/10 text-profit border-profit/20',
    dotClass: 'bg-profit',
  },
  connecting: {
    label: 'Conectando',
    icon: RotateCw,
    className: 'bg-warning/10 text-warning border-warning/20',
    dotClass: 'bg-warning',
  },
  degraded: {
    label: 'Degradado',
    icon: AlertTriangle,
    className: 'bg-warning/10 text-warning border-warning/20',
    dotClass: 'bg-warning',
  },
  disconnected: {
    label: 'Offline',
    icon: WifiOff,
    className: 'bg-loss/10 text-loss border-loss/20',
    dotClass: 'bg-loss',
  },
};

interface ConnectionIndicatorProps {
  status: ConnectionStatus;
}

export function ConnectionIndicator({ status }: ConnectionIndicatorProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        config.className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dotClass)} />
      <Icon className={cn('h-3 w-3', status === 'connecting' && 'animate-spin')} />
      <span>{config.label}</span>
    </div>
  );
}

export function LivePing() {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-profit opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-profit" />
      </span>
      <span>Tempo real</span>
    </div>
  );
}
