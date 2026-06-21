import { Card, CardContent } from '@/components/ui/card';
import { Lightbulb, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { InsightFin } from '@/lib/insights-financeiros';

/**
 * "Insights pra você" — dicas acionáveis cruzando boas práticas com os gastos
 * reais. Cada card nasce de um padrão medido nos dados (sem IA genérica).
 */
export function InsightsFinanceiros({ insights }: { insights: InsightFin[] }) {
  if (!insights.length) return null;
  return (
    <Card>
      <CardContent className="p-5 md:p-6">
        <h3 className="text-base font-semibold">Insights pra você</h3>
        <p className="text-xs text-muted-foreground mb-4">Boas práticas cruzadas com seus gastos reais</p>
        <div className="space-y-3">
          {insights.map((i) => {
            const cfg = i.nivel === 'alerta'
              ? { Icon: AlertTriangle, cls: 'text-destructive', bg: 'bg-destructive/5 border-destructive/30' }
              : i.nivel === 'bom'
                ? { Icon: CheckCircle2, cls: 'text-success', bg: 'bg-success/5 border-success/30' }
                : { Icon: Lightbulb, cls: 'text-warning', bg: 'bg-warning/5 border-warning/30' };
            const Icon = cfg.Icon;
            return (
              <div key={i.id} className={`rounded-xl border p-3 ${cfg.bg}`}>
                <div className="flex items-start gap-2.5">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.cls}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{i.titulo}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{i.descricao}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
