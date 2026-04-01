import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const toneMap = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  warning: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200',
  danger: 'border-red-500/30 bg-red-500/10 text-red-200',
  neutral: 'border-border bg-background/70 text-muted-foreground',
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
};

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: keyof typeof toneMap }) {
  return <Badge className={cn('capitalize', toneMap[tone])}>{label}</Badge>;
}
