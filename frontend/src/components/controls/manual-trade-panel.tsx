import { useMemo, useState } from 'react';
import { LoaderCircle, ShieldAlert, Target, TrendingDown, TrendingUp } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn, formatCurrency } from '@/lib/utils';
import type { ManualOpenTradeInput } from '@/types/state';

interface ManualTradePanelProps {
  pending: Record<string, boolean>;
  onOpenTrade: (payload: ManualOpenTradeInput) => Promise<unknown>;
}

interface ManualTradeFormState {
  asset: string;
  direction: 'LONG' | 'SHORT';
  entry: string;
  tp: string;
  sl: string;
  leverage: string;
  marginType: 'isolated' | 'cross';
}

const initialState: ManualTradeFormState = {
  asset: '',
  direction: 'LONG',
  entry: '',
  tp: '',
  sl: '',
  leverage: '',
  marginType: 'isolated',
};

function toPositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function ManualTradePanel({ pending, onOpenTrade }: ManualTradePanelProps) {
  const [form, setForm] = useState<ManualTradeFormState>(initialState);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const parsed = useMemo(() => {
    const asset = form.asset.trim().toUpperCase();
    const entry = toPositiveNumber(form.entry);
    const tp = toPositiveNumber(form.tp);
    const sl = toPositiveNumber(form.sl);
    const leverage = toPositiveNumber(form.leverage);

    return {
      asset,
      entry,
      tp,
      sl,
      leverage,
      isValid: Boolean(asset && entry && tp && sl && leverage),
    };
  }, [form]);

  const isSubmitting = Boolean(pending.open_manual);

  const handleChange = <K extends keyof ManualTradeFormState>(key: K, value: ManualTradeFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!parsed.isValid || !parsed.entry || !parsed.tp || !parsed.sl || !parsed.leverage) return;

    await onOpenTrade({
      asset: parsed.asset,
      direction: form.direction,
      entry: parsed.entry,
      tp: parsed.tp,
      sl: parsed.sl,
      leverage: parsed.leverage,
      marginType: form.marginType,
    });

    setConfirmOpen(false);
    setForm(initialState);
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Trade Manual
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Ativo</span>
              <Input
                value={form.asset}
                onChange={(event) => handleChange('asset', event.target.value)}
                placeholder="SOL"
                maxLength={12}
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Margem</span>
              <select
                value={form.marginType}
                onChange={(event) => handleChange('marginType', event.target.value as 'isolated' | 'cross')}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <option value="isolated">Isolated</option>
                <option value="cross">Cross</option>
              </select>
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant={form.direction === 'LONG' ? 'success' : 'secondary'}
              className="justify-start"
              onClick={() => handleChange('direction', 'LONG')}
            >
              <TrendingUp className="h-4 w-4" />
              Long
            </Button>
            <Button
              type="button"
              variant={form.direction === 'SHORT' ? 'danger' : 'secondary'}
              className="justify-start"
              onClick={() => handleChange('direction', 'SHORT')}
            >
              <TrendingDown className="h-4 w-4" />
              Short
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Entrada</span>
              <Input
                type="number"
                min="0"
                step="any"
                value={form.entry}
                onChange={(event) => handleChange('entry', event.target.value)}
                placeholder="150.25"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Leverage</span>
              <Input
                type="number"
                min="0"
                step="any"
                value={form.leverage}
                onChange={(event) => handleChange('leverage', event.target.value)}
                placeholder="5"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Take Profit</span>
              <Input
                type="number"
                min="0"
                step="any"
                value={form.tp}
                onChange={(event) => handleChange('tp', event.target.value)}
                placeholder="165"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Stop Loss</span>
              <Input
                type="number"
                min="0"
                step="any"
                value={form.sl}
                onChange={(event) => handleChange('sl', event.target.value)}
                placeholder="145"
              />
            </label>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Resumo</span>
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium uppercase',
                form.direction === 'LONG' ? 'bg-profit/10 text-profit' : 'bg-loss/10 text-loss'
              )}>
                {form.direction}
              </span>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <span>Ativo: {parsed.asset || '—'}</span>
              <span>Leverage: {parsed.leverage ? `${parsed.leverage}x` : '—'}</span>
              <span>Entrada: {parsed.entry ? formatCurrency(parsed.entry) : '—'}</span>
              <span>TP: {parsed.tp ? formatCurrency(parsed.tp) : '—'}</span>
              <span>SL: {parsed.sl ? formatCurrency(parsed.sl) : '—'}</span>
              <span>Margem: {form.marginType}</span>
            </div>
          </div>

          <Button
            className="w-full gap-2"
            disabled={!parsed.isValid || isSubmitting}
            onClick={() => setConfirmOpen(true)}
          >
            {isSubmitting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldAlert className="h-4 w-4" />
            )}
            Revisar e Abrir Ordem
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Abertura Manual</AlertDialogTitle>
            <AlertDialogDescription>
              Revise os parâmetros antes de enviar a ordem. A execução passará pelo backend de risco atual.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <span><strong>Ativo:</strong> {parsed.asset}</span>
              <span><strong>Lado:</strong> {form.direction}</span>
              <span><strong>Entrada:</strong> {parsed.entry ? formatCurrency(parsed.entry) : '—'}</span>
              <span><strong>Leverage:</strong> {parsed.leverage ? `${parsed.leverage}x` : '—'}</span>
              <span><strong>TP:</strong> {parsed.tp ? formatCurrency(parsed.tp) : '—'}</span>
              <span><strong>SL:</strong> {parsed.sl ? formatCurrency(parsed.sl) : '—'}</span>
              <span><strong>Margem:</strong> {form.marginType}</span>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">Cancelar</Button>
            </AlertDialogCancel>
            <Button className="gap-2" disabled={isSubmitting || !parsed.isValid} onClick={() => void handleSubmit()}>
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
              Confirmar Ordem
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
