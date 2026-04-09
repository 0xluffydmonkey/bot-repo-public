import { useMemo, useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowDownUp,
  ArrowUpDown,
  Filter,
  LoaderCircle,
  Search,
  X,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn, formatCurrency, formatDateTime, formatNumber, formatPercent } from '@/lib/utils';
import type { Position } from '@/types/state';

interface PositionsTableProps {
  positions: Position[];
  pending: Record<string, boolean>;
  onCloseAsset: (asset: string, venue?: string) => Promise<unknown>;
  onUpdateTpSl: (payload: { asset: string; tp?: number | null; sl?: number | null }) => Promise<unknown>;
  compact?: boolean;
}

type SortKey = 'asset' | 'pnl' | 'exposure' | 'risk';
type SortDirection = 'asc' | 'desc';

const riskColors: Record<string, string> = {
  critical: 'bg-loss/10 text-loss border-loss/20',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  medium: 'bg-warning/10 text-warning border-warning/20',
  low: 'bg-profit/10 text-profit border-profit/20',
};

const sideColors: Record<string, string> = {
  long: 'text-profit',
  short: 'text-loss',
};

export function PositionsTable({
  positions,
  pending,
  onCloseAsset,
  onUpdateTpSl,
  compact = false,
}: PositionsTableProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('exposure');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [sideFilter, setSideFilter] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [closeTarget, setCloseTarget] = useState<Position | null>(null);
  const [tpslTarget, setTpslTarget] = useState<Position | null>(null);
  const [tpValue, setTpValue] = useState('');
  const [slValue, setSlValue] = useState('');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return [...positions]
      .filter((p) => {
        if (normalizedSearch && !p.asset.toLowerCase().includes(normalizedSearch)) {
          return false;
        }
        if (sideFilter && p.side?.toLowerCase() !== sideFilter) {
          return false;
        }
        if (riskFilter && p.risk !== riskFilter) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        let comparison = 0;
        if (sortKey === 'asset') {
          comparison = a.asset.localeCompare(b.asset);
        } else if (sortKey === 'pnl') {
          comparison = (a.pnl ?? 0) - (b.pnl ?? 0);
        } else if (sortKey === 'exposure') {
          comparison = (a.exposure ?? 0) - (b.exposure ?? 0);
        } else if (sortKey === 'risk') {
          const riskOrder = { critical: 4, high: 3, medium: 2, low: 1 };
          comparison =
            (riskOrder[a.risk as keyof typeof riskOrder] ?? 0) -
            (riskOrder[b.risk as keyof typeof riskOrder] ?? 0);
        }
        return sortDir === 'asc' ? comparison : -comparison;
      });
  }, [positions, search, sortKey, sortDir, sideFilter, riskFilter]);

  const uniqueSides = useMemo(
    () => [...new Set(positions.map((p) => p.side?.toLowerCase()).filter(Boolean))],
    [positions]
  );

  const uniqueRisks = useMemo(
    () => [...new Set(positions.map((p) => p.risk).filter(Boolean))],
    [positions]
  );

  const hasActiveFilters = sideFilter || riskFilter;

  const clearFilters = () => {
    setSideFilter(null);
    setRiskFilter(null);
    setSearch('');
  };

  const openTpSlDialog = (position: Position) => {
    setTpslTarget(position);
    setTpValue(position.takeProfit != null ? String(position.takeProfit) : '');
    setSlValue(position.stopLoss != null ? String(position.stopLoss) : '');
  };

  const submitTpSl = async () => {
    if (!tpslTarget) return;

    const tp = tpValue.trim() === '' ? null : Number(tpValue);
    const sl = slValue.trim() === '' ? null : Number(slValue);
    const hasInvalidTp = tp != null && (!Number.isFinite(tp) || tp <= 0);
    const hasInvalidSl = sl != null && (!Number.isFinite(sl) || sl <= 0);

    if (hasInvalidTp || hasInvalidSl) return;

    await onUpdateTpSl({
      asset: tpslTarget.asset,
      tp,
      sl,
    });

    setTpslTarget(null);
  };

  const confirmClose = async () => {
    if (!closeTarget) return;
    await onCloseAsset(closeTarget.asset, closeTarget.venue);
    setCloseTarget(null);
  };

  const SortHeader = ({
    label,
    sortKeyName,
    className,
  }: {
    label: string;
    sortKeyName: SortKey;
    className?: string;
  }) => (
    <button
      type="button"
      onClick={() => handleSort(sortKeyName)}
      className={cn(
        'flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors',
        className
      )}
    >
      {label}
      {sortKey === sortKeyName ? (
        sortDir === 'asc' ? (
          <ArrowUpDown className="h-3 w-3" />
        ) : (
          <ArrowDownUp className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-30" />
      )}
    </button>
  );

  if (compact) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Posicoes Ativas ({positions.length})</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhuma posicao aberta
            </p>
          ) : (
            <div className="space-y-2">
              {positions.slice(0, 5).map((position) => {
                const isProfitable = (position.pnl ?? 0) >= 0;
                return (
                  <div
                    key={position.asset}
                    className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-medium">{position.asset}</span>
                      <Badge
                        variant="outline"
                        className={cn('text-[10px] uppercase', sideColors[position.side?.toLowerCase() ?? ''])}
                      >
                        {position.side}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      {isProfitable ? (
                        <TrendingUp className="h-3 w-3 text-profit" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-loss" />
                      )}
                      <span
                        className={cn(
                          'font-mono text-sm',
                          isProfitable ? 'text-profit' : 'text-loss'
                        )}
                      >
                        {formatCurrency(position.pnl)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {positions.length > 5 && (
                <p className="pt-1 text-center text-xs text-muted-foreground">
                  +{positions.length - 5} mais posicoes
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              Posicoes
              <Badge variant="outline" className="font-mono">
                {filtered.length}
              </Badge>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar ativo..."
                  className="h-8 w-[180px] pl-8 text-sm"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="h-3.5 w-3.5" />
                Filtros
                {hasActiveFilters && (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[10px] font-medium text-background">
                    {(sideFilter ? 1 : 0) + (riskFilter ? 1 : 0)}
                  </span>
                )}
              </Button>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={clearFilters}
                >
                  <X className="h-3 w-3" />
                  Limpar
                </Button>
              )}
            </div>
          </div>


          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Lado:</span>
                    {uniqueSides.map((side) => (
                      <Button
                        key={side}
                        variant={sideFilter === side ? 'default' : 'secondary'}
                        size="sm"
                        className="h-6 px-2 text-xs capitalize"
                        onClick={() => setSideFilter(sideFilter === side ? null : side ?? null)}
                      >
                        {side}
                      </Button>
                    ))}
                  </div>
                  <div className="h-4 w-px bg-border" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Risco:</span>
                    {uniqueRisks.map((risk) => (
                      <Button
                        key={risk}
                        variant={riskFilter === risk ? 'default' : 'secondary'}
                        size="sm"
                        className="h-6 px-2 text-xs capitalize"
                        onClick={() => setRiskFilter(riskFilter === risk ? null : risk ?? null)}
                      >
                        {risk}
                      </Button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardHeader>

        <CardContent>
          <div className="overflow-hidden rounded-md border border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-3 py-2 text-left">
                      <SortHeader label="Ativo" sortKeyName="asset" />
                    </th>
                    <th className="px-3 py-2 text-left">
                      <span className="text-xs font-medium text-muted-foreground">Lado</span>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <span className="text-xs font-medium text-muted-foreground">Qtd</span>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <span className="text-xs font-medium text-muted-foreground">Entrada</span>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <span className="text-xs font-medium text-muted-foreground">Atual</span>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <SortHeader label="PnL" sortKeyName="pnl" className="justify-end" />
                    </th>
                    <th className="px-3 py-2 text-right">
                      <SortHeader label="Exposicao" sortKeyName="exposure" className="justify-end" />
                    </th>
                    <th className="px-3 py-2 text-center">
                      <SortHeader label="Risco" sortKeyName="risk" className="justify-center" />
                    </th>
                    <th className="px-3 py-2 text-right">
                      <span className="text-xs font-medium text-muted-foreground">Acao</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                        Nenhuma posicao encontrada
                      </td>
                    </tr>
                  ) : (
                    filtered.map((position) => {
                      const busy = pending[`close:${position.asset}`];
                      const tpSlBusy = pending[`tpsl:${position.asset}`];
                      const isProfitable = (position.pnl ?? 0) >= 0;
                      return (
                        <tr
                          key={position.asset}
                          className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-3 py-2">
                            <div className="flex flex-col">
                              <span className="font-mono font-medium">{position.asset}</span>
                              {position.venue && (
                                <span className="text-[10px] uppercase text-muted-foreground">{position.venue}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] uppercase',
                                sideColors[position.side?.toLowerCase() ?? '']
                              )}
                            >
                              {position.side ?? '-'}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                            {formatNumber(position.quantity)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                            {formatCurrency(position.entryPrice)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatCurrency(position.currentPrice)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex flex-col items-end">
                              <span
                                className={cn(
                                  'font-mono font-medium',
                                  isProfitable ? 'text-profit' : 'text-loss'
                                )}
                              >
                                {formatCurrency(position.pnl)}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatPercent(position.pnlPct)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatCurrency(position.exposure)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-[10px] capitalize',
                                  riskColors[position.risk ?? ''] ?? 'bg-muted text-muted-foreground'
                                )}
                              >
                                {position.risk ?? 'n/d'}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">
                                TP {position.takeProfit != null ? formatCurrency(position.takeProfit) : '—'}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                SL {position.stopLoss != null ? formatCurrency(position.stopLoss) : '—'}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={tpSlBusy}
                                onClick={() => openTpSlDialog(position)}
                              >
                                {tpSlBusy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : 'TP/SL'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs hover:bg-destructive/10 hover:text-destructive"
                                disabled={busy}
                                onClick={() => setCloseTarget(position)}
                              >
                                {busy ? (
                                  <LoaderCircle className="h-3 w-3 animate-spin" />
                                ) : (
                                  'Fechar'
                                )}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {positions.length > 0 && (
            <p className="mt-2 text-right text-xs text-muted-foreground">
              Atualizado: {formatDateTime(positions[0]?.updatedAt)}
            </p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(closeTarget)} onOpenChange={(open) => !open && setCloseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar fechamento</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação enviará um close manual para a posição selecionada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <span><strong>Ativo:</strong> {closeTarget?.asset ?? '—'}</span>
              <span><strong>Venue:</strong> {closeTarget?.venue ?? 'ativa'}</span>
              <span><strong>Lado:</strong> {closeTarget?.side ?? '—'}</span>
              <span><strong>Exposição:</strong> {formatCurrency(closeTarget?.exposure)}</span>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">Cancelar</Button>
            </AlertDialogCancel>
            <Button
              variant="danger"
              disabled={!closeTarget || pending[`close:${closeTarget.asset}`]}
              onClick={() => void confirmClose()}
            >
              Confirmar Close
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(tpslTarget)} onOpenChange={(open) => !open && setTpslTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Atualizar TP/SL</AlertDialogTitle>
            <AlertDialogDescription>
              Ajuste os níveis da posição selecionada e confirme para enviar a atualização.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Take Profit</span>
              <Input
                type="number"
                min="0"
                step="any"
                value={tpValue}
                onChange={(event) => setTpValue(event.target.value)}
                placeholder="Manter atual"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Stop Loss</span>
              <Input
                type="number"
                min="0"
                step="any"
                value={slValue}
                onChange={(event) => setSlValue(event.target.value)}
                placeholder="Manter atual"
              />
            </label>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <span>Ativo: {tpslTarget?.asset ?? '—'}</span>
              <span>Venue: {tpslTarget?.venue ?? 'ativa'}</span>
              <span>TP atual: {tpslTarget?.takeProfit != null ? formatCurrency(tpslTarget.takeProfit) : '—'}</span>
              <span>SL atual: {tpslTarget?.stopLoss != null ? formatCurrency(tpslTarget.stopLoss) : '—'}</span>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">Cancelar</Button>
            </AlertDialogCancel>
            <Button
              disabled={
                !tpslTarget ||
                pending[`tpsl:${tpslTarget.asset}`] ||
                (tpValue.trim() === '' && slValue.trim() === '') ||
                (tpValue.trim() !== '' && (!Number.isFinite(Number(tpValue)) || Number(tpValue) <= 0)) ||
                (slValue.trim() !== '' && (!Number.isFinite(Number(slValue)) || Number(slValue) <= 0))
              }
              onClick={() => void submitTpSl()}
            >
              {tpslTarget && pending[`tpsl:${tpslTarget.asset}`] ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              Confirmar TP/SL
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
