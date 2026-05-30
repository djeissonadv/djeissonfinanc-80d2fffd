import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatCurrency } from '@/lib/format';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { CategoryTrend } from '@/lib/spending-patterns';

interface TrendsListProps {
  trends: CategoryTrend[];
  title?: string;
  description?: string;
  maxItems?: number;
}

/**
 * Categorias com mudança significativa entre os últimos 3 meses e os 3 anteriores.
 * Subindo em vermelho (alerta), descendo em verde (boa), estável escondido.
 */
export function TrendsList({
  trends,
  title = 'O que mudou',
  description = 'Categorias com variação relevante (3 últimos vs 3 anteriores)',
  maxItems = 6,
}: TrendsListProps) {
  const filtered = trends.filter((t) => t.tendencia !== 'estavel').slice(0, maxItems);

  if (filtered.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Nenhuma variação relevante por categoria — gastos estáveis.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {filtered.map((t) => {
            const up = t.tendencia === 'subindo';
            return (
              <div key={t.categoria} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  {up
                    ? <TrendingUp className="h-4 w-4 text-red-600 shrink-0" />
                    : <TrendingDown className="h-4 w-4 text-green-600 shrink-0" />
                  }
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{t.categoria}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatCurrency(t.mediaAnterior)} → {formatCurrency(t.mediaRecente)}
                    </div>
                  </div>
                </div>
                <div className={`text-sm font-semibold tabular-nums ${up ? 'text-red-600' : 'text-green-600'}`}>
                  {up ? '+' : ''}{t.variacao.toFixed(0)}%
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
