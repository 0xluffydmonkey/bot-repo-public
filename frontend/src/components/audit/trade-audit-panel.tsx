import { useState } from 'react';
import { FileSearch, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, type TradeAuditResult } from '@/api/client';

type AuditRow = Record<string, unknown>;

function KVList({ data }: { data: AuditRow }) {
  return (
    <div className="space-y-1 font-mono text-xs">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="flex gap-3">
          <span className="w-36 shrink-0 truncate text-muted-foreground">{k}</span>
          <span className="break-all">{String(v ?? '—')}</span>
        </div>
      ))}
    </div>
  );
}

function AuditSection({ title, rows }: { title: string; rows: AuditRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title}{' '}
          <span className="font-normal text-muted-foreground">({rows.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum registro.</p>
        ) : (
          <div className="space-y-4">
            {rows.map((row, i) => (
              <div key={i} className="border-b border-border pb-4 last:border-0 last:pb-0">
                <KVList data={row} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TradeAuditPanel() {
  const [ref, setRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TradeAuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFetch = async () => {
    const trimmed = ref.trim();
    if (!trimmed) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const data = await api.getTradeAudit(trimmed);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="h-4 w-4" />
            Auditoria de Trade
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input
              className="font-mono text-xs"
              placeholder="bot_trade_ref (UUID)"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleFetch(); }}
            />
            <Button
              size="sm"
              disabled={loading || !ref.trim()}
              onClick={() => void handleFetch()}
            >
              {loading
                ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                : 'Buscar'}
            </Button>
          </div>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <>
          {/* Trade */}
          <Card>
            <CardHeader><CardTitle>Trade</CardTitle></CardHeader>
            <CardContent>
              {result.trade
                ? <KVList data={result.trade} />
                : <p className="text-xs text-muted-foreground">Nenhum registro.</p>}
            </CardContent>
          </Card>

          <AuditSection title="Eventos"           rows={result.events} />
          <AuditSection title="Ordens"            rows={result.orders} />
          <AuditSection title="Snapshots de Saldo" rows={result.balance_snapshots} />
          <AuditSection title="Decisões de Sinal" rows={result.signal_decisions} />
        </>
      )}
    </div>
  );
}
