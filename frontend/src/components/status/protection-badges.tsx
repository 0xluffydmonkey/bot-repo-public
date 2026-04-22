import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProtectionBadgesProps {
  tpEnable?: boolean;
  slEnable?: boolean;
}

export function ProtectionBadges({ tpEnable = true, slEnable = true }: ProtectionBadgesProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-1.5 text-xs">
      <span className="text-muted-foreground">Proteção:</span>
      <span className={cn('font-medium', tpEnable ? 'text-profit' : 'text-muted-foreground')}>
        TP: {tpEnable ? 'ON' : 'OFF'}
      </span>
      <span className="text-border">|</span>
      <span className={cn('flex items-center gap-1 font-medium', slEnable ? 'text-profit' : 'text-warning')}>
        {!slEnable && <AlertTriangle className="h-3 w-3 shrink-0" />}
        SL: {slEnable ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}
