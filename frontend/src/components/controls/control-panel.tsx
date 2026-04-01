import { LoaderCircle, Pause, Play, Power, AlertTriangle, Zap } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface ControlPanelProps {
  paused: boolean;
  autoTrading: boolean;
  pending: Record<string, boolean>;
  onPause: () => Promise<unknown>;
  onResume: () => Promise<unknown>;
  onAutotrading: (enabled: boolean) => Promise<unknown>;
  onCloseAll: () => Promise<unknown>;
}

export function ControlPanel({
  paused,
  autoTrading,
  pending,
  onPause,
  onResume,
  onAutotrading,
  onCloseAll,
}: ControlPanelProps) {
  const isBusy = Object.values(pending).some(Boolean);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Controle Operacional
          </CardTitle>
          <div className={cn(
            'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
            paused
              ? 'bg-warning/10 text-warning'
              : 'bg-profit/10 text-profit'
          )}>
            <span className={cn(
              'h-1.5 w-1.5 rounded-full',
              paused ? 'bg-warning' : 'bg-profit'
            )} />
            {paused ? 'Pausado' : 'Ativo'}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bot Control */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="secondary"
            className="justify-start gap-2"
            disabled={paused || isBusy}
            onClick={() => void onPause()}
          >
            {pending.pause ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
            Pausar Bot
          </Button>
          <Button
            className="justify-start gap-2"
            disabled={!paused || isBusy}
            onClick={() => void onResume()}
          >
            {pending.resume ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Retomar Bot
          </Button>
        </div>

        {/* Auto Trading Toggle */}
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium">Auto-Trading</p>
              <p className="text-xs text-muted-foreground">
                Motor de execucao automatica de ordens
              </p>
            </div>
            <div className="flex items-center gap-2">
              {pending.autotrading && (
                <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              <Switch
                checked={autoTrading}
                disabled={isBusy}
                onCheckedChange={(checked) => void onAutotrading(checked)}
              />
            </div>
          </div>
        </div>

        {/* Emergency Close All */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="danger"
              className="w-full justify-between"
              disabled={isBusy}
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Fechar Todas as Posicoes
              </span>
              {pending.close_all && (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Confirmar Fechamento Global
              </AlertDialogTitle>
              <AlertDialogDescription>
                Esta acao encerrara todas as posicoes abertas. Use apenas em
                cenarios de contingencia ou reducao imediata de risco.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              Revise o estado do mercado antes de confirmar.
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button variant="secondary">Cancelar</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="danger"
                  onClick={() => void onCloseAll()}
                  className="gap-2"
                >
                  <Power className="h-4 w-4" />
                  Confirmar
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

// Compact version for tabs header
export function CompactControls({
  paused,
  autoTrading,
  pending,
  onPause,
  onResume,
  onAutotrading,
}: Omit<ControlPanelProps, 'onCloseAll'>) {
  const isBusy = Object.values(pending).some(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <span className="text-xs text-muted-foreground">Bot:</span>
        <Button
          variant={paused ? 'default' : 'secondary'}
          size="sm"
          className="h-7 gap-1.5 px-2"
          disabled={!paused || isBusy}
          onClick={() => void onResume()}
        >
          {pending.resume ? (
            <LoaderCircle className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          <span className="sr-only sm:not-sr-only">Retomar</span>
        </Button>
        <Button
          variant={!paused ? 'default' : 'secondary'}
          size="sm"
          className="h-7 gap-1.5 px-2"
          disabled={paused || isBusy}
          onClick={() => void onPause()}
        >
          {pending.pause ? (
            <LoaderCircle className="h-3 w-3 animate-spin" />
          ) : (
            <Pause className="h-3 w-3" />
          )}
          <span className="sr-only sm:not-sr-only">Pausar</span>
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <span className="text-xs text-muted-foreground">Auto:</span>
        <Switch
          checked={autoTrading}
          disabled={isBusy}
          onCheckedChange={(checked) => void onAutotrading(checked)}
        />
        {pending.autotrading && (
          <LoaderCircle className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
