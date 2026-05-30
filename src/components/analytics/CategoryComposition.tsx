import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatCurrency } from '@/lib/format';
import { getCategoriaColor } from '@/types/database.types';
import type { CategorySlice } from '@/lib/analytics-engine';

interface CategoryCompositionProps {
  slices: CategorySlice[];
  title?: string;
  description?: string;
  maxItems?: number;
}

/**
 * Lista categorias do mês ordenadas, com barra de % e valor. Mais legível
 * que pie chart pra orçamento doméstico — vê numa olhada onde está o dreno.
 */
export function CategoryComposition({
  slices,
  title = 'Onde está o dinheiro',
  description = 'Composição das despesas do período',
  maxItems = 10,
}: CategoryCompositionProps) {
  const top = slices.slice(0, maxItems);

  if (top.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Sem despesas no período.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        {top.map((s) => (
          <div key={s.categoria} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: getCategoriaColor(s.categoria) }}
                />
                <span className="font-medium">{s.categoria}</span>
              </span>
              <span className="text-muted-foreground">
                <span className="font-mono font-semibold text-foreground">{formatCurrency(s.valor)}</span>
                <span className="ml-2 text-xs">{s.pct.toFixed(1)}%</span>
              </span>
            </div>
            <Progress
              value={s.pct}
              className="h-1.5"
              style={{
                // sobrescreve cor da barra via CSS var (shadcn Progress respeita)
                ['--progress-foreground' as any]: getCategoriaColor(s.categoria),
              }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
