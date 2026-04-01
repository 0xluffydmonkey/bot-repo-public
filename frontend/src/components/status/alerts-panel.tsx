import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface AlertItem {
  id?: string;
  title: string;
  description?: string;
  severity: 'info' | 'success' | 'warning' | 'error' | 'critical';
}

const severityConfig = {
  info: {
    icon: Info,
    bg: 'bg-info/10',
    border: 'border-info/20',
    text: 'text-info',
    badge: 'bg-info/20 text-info border-info/30',
  },
  success: {
    icon: CheckCircle,
    bg: 'bg-profit/10',
    border: 'border-profit/20',
    text: 'text-profit',
    badge: 'bg-profit/20 text-profit border-profit/30',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-warning/10',
    border: 'border-warning/20',
    text: 'text-warning',
    badge: 'bg-warning/20 text-warning border-warning/30',
  },
  error: {
    icon: XCircle,
    bg: 'bg-loss/10',
    border: 'border-loss/20',
    text: 'text-loss',
    badge: 'bg-loss/20 text-loss border-loss/30',
  },
  critical: {
    icon: XCircle,
    bg: 'bg-loss/15',
    border: 'border-loss/30',
    text: 'text-loss',
    badge: 'bg-loss/30 text-loss border-loss/40',
  },
};

interface AlertsPanelProps {
  alerts: AlertItem[];
  compact?: boolean;
}

export function AlertsPanel({ alerts, compact = false }: AlertsPanelProps) {
  if (compact) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Alertas</CardTitle>
            {alerts.length > 0 && (
              <Badge variant="outline" className="font-mono text-xs">
                {alerts.length}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-profit/20 bg-profit/5 p-3 text-sm text-profit">
              <CheckCircle className="h-4 w-4" />
              Sistema operando normalmente
            </div>
          ) : (
            <div className="space-y-2">
              {alerts.slice(0, 3).map((alert, index) => {
                const config = severityConfig[alert.severity];
                const Icon = config.icon;
                return (
                  <div
                    key={alert.id ?? `${alert.title}-${index}`}
                    className={cn(
                      'flex items-start gap-2 rounded-md border p-2',
                      config.bg,
                      config.border
                    )}
                  >
                    <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', config.text)} />
                    <p className="text-xs">{alert.title}</p>
                  </div>
                );
              })}
              {alerts.length > 3 && (
                <p className="text-center text-xs text-muted-foreground">
                  +{alerts.length - 3} mais alertas
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            Alertas Operacionais
            {alerts.length > 0 && (
              <Badge variant="outline" className="font-mono">
                {alerts.length}
              </Badge>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.length === 0 ? (
          <div className="flex items-center gap-3 rounded-md border border-profit/20 bg-profit/5 p-4">
            <CheckCircle className="h-5 w-5 text-profit" />
            <div>
              <p className="text-sm font-medium text-profit">
                Sistema operando normalmente
              </p>
              <p className="text-xs text-muted-foreground">
                Nenhum alerta critico no momento
              </p>
            </div>
          </div>
        ) : (
          alerts.map((alert, index) => {
            const config = severityConfig[alert.severity];
            const Icon = config.icon;
            return (
              <div
                key={alert.id ?? `${alert.title}-${index}`}
                className={cn(
                  'rounded-md border p-3',
                  config.bg,
                  config.border
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', config.text)} />
                    <div>
                      <p className="text-sm font-medium">{alert.title}</p>
                      {alert.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {alert.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className={cn('text-[10px] capitalize', config.badge)}>
                    {alert.severity}
                  </Badge>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
