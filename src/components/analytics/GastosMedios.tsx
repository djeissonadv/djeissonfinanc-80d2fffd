import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/format';
import { getCategoriaColor } from '@/types/database.types';
import { TrendingUp } from 'lucide-react';
import type { GastosMedios as GastosMediosData } from '@/lib/analytics-engine';

interface Props {
  data: GastosMediosData;
  onCategoriaClick?: (categoria: string) => void;
}

/**
 * "Raio-X de gastos" — média mensal por categoria nos últimos meses completos
 * + projeção do próximo mês. Responde "onde gasto mais" e "quanto devo esperar
 * gastar mês que vem". Base da Calculadora da Casa.
 */
export function GastosMedios({ data, onCategoriaClick }: Props) {
  if (data.mesesConsiderados === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <h3 className="text-base font-semibold mb-1">Raio-X de gastos</h3>
          <p className="text-sm text-muted-foreground">
            Ainda não há meses completos com gastos pra calcular a média. Lance ou
            importe alguns meses e a média aparece aqui.
          </p>
        </CardContent>
      </Card>
    );
  }

  const top = data.categorias.slice(0, 8);
  const maxMedia = top[0]?.media || 1;

  return (
    <Card>
      <CardContent className="p-5 md:p-6">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-base font-semibold">Raio-X de gastos</h3>
            <p className="text-xs text-muted-foreground">
              Média dos últimos {data.mesesConsiderados} {data.mesesConsiderados === 1 ? 'mês completo' : 'meses completos'}
            </p>
          </div>
          <TrendingUp className="h-5 w-5 text-muted-foreground shrink-0" />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-xl bg-secondary/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Média mensal</p>
            <p className="text-xl font-bold tabular mt-0.5">{formatCurrency(data.mediaMensal)}</p>
          </div>
          <div className="rounded-xl bg-primary/10 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Projeção próximo mês</p>
            <p className="text-xl font-bold tabular mt-0.5 text-primary">{formatCurrency(data.projecaoProximoMes)}</p>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground mb-2 uppercase tracking-wider">Onde você mais gasta</p>
        <div className="space-y-2.5">
          {top.map((c) => {
            const cor = getCategoriaColor(c.categoria);
            const pctBar = Math.max(4, Math.round((c.media / maxMedia) * 100));
            return (
              <button
                key={c.categoria}
                type="button"
                onClick={() => onCategoriaClick?.(c.categoria)}
                className="w-full text-left hover:opacity-80 transition-opacity"
                title={`Aparece em ${c.mesesComGasto} de ${data.mesesConsiderados} meses`}
              >
                <div className="flex items-center justify-between text-sm mb-1 gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cor }} />
                    <span className="truncate">{c.categoria}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{c.pctDaMedia.toFixed(0)}%</span>
                  </span>
                  <span className="tabular font-medium shrink-0">
                    {formatCurrency(c.media)}<span className="text-[10px] text-muted-foreground">/mês</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pctBar}%`, backgroundColor: cor }} />
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
