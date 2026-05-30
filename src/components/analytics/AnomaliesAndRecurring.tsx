import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/format';
import { AlertTriangle, Repeat } from 'lucide-react';
import type { SpendingAnomaly, RecurringCharge } from '@/lib/spending-patterns';

// ---------------------------------------------------------------------------
// Anomalias detectadas pelo spending-patterns. Cards individuais com cor, mês,
// excesso vs média.
// ---------------------------------------------------------------------------
interface AnomaliesListProps {
  anomalies: SpendingAnomaly[];
  maxItems?: number;
}

export function AnomaliesList({ anomalies, maxItems = 5 }: AnomaliesListProps) {
  const top = anomalies.slice(0, maxItems);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Anomalias
        </CardTitle>
        <CardDescription>Gastos atípicos vs média da própria categoria</CardDescription>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhuma anomalia significativa nos últimos meses.</div>
        ) : (
          <div className="space-y-2">
            {top.map((a, i) => (
              <div
                key={`${a.categoria}-${a.mes}-${i}`}
                className="flex items-start justify-between gap-3 rounded-md border border-amber-200/50 bg-amber-50 dark:bg-amber-950/20 p-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{a.categoria}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.mes} • média R$ {a.media.toFixed(0)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold">{formatCurrency(a.valor)}</div>
                  <Badge variant="outline" className="text-xs mt-0.5 border-amber-300">
                    +{formatCurrency(a.excesso)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Assinaturas/cobranças recorrentes. Lista pequenas com soma destacada — fácil
// identificar candidatas a cortar (gastos que repetem sem o usuário perceber).
// ---------------------------------------------------------------------------
interface RecurringChargesListProps {
  charges: RecurringCharge[];
  maxItems?: number;
}

export function RecurringChargesList({ charges, maxItems = 10 }: RecurringChargesListProps) {
  const top = charges.slice(0, maxItems);
  const totalMensal = top.reduce((s, c) => s + c.valor, 0);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Repeat className="h-4 w-4 text-primary" />
          Cobranças recorrentes
        </CardTitle>
        <CardDescription>
          {top.length} itens • total mensal estimado{' '}
          <span className="font-semibold text-foreground">{formatCurrency(totalMensal)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhuma cobrança recorrente detectada (precisa &gt; 3 meses).</div>
        ) : (
          <div className="divide-y">
            {top.map((c, i) => (
              <div key={`${c.descricao}-${i}`} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.descricao}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.categoria || 'sem categoria'} • {c.frequencia}m, último {c.ultimoMes}
                  </div>
                </div>
                <div className="text-sm font-semibold tabular-nums shrink-0">{formatCurrency(c.valor)}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
