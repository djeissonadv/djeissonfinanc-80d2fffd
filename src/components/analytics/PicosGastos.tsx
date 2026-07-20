import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/format';
import { getCategoriaColor } from '@/types/database.types';
import { AlertTriangle, Flame } from 'lucide-react';
import { formatMonthShort } from '@/lib/analytics-engine';
import type { AnalisePicos, CategoriaPico, Volatilidade } from '@/lib/analytics-engine';

interface Props {
  data: AnalisePicos;
  onCategoriaClick?: (categoria: string, mes?: string) => void;
  /** Quantas categorias listar (default 8). */
  limite?: number;
}

const VOLATILIDADE_LABEL: Record<Volatilidade, string> = {
  estavel: 'estável',
  variavel: 'varia',
  irregular: 'irregular',
  pontual: 'pontual',
};

/**
 * "Maiores gastos" — onde o dinheiro foi nos últimos N meses e QUAIS meses
 * saíram fora da curva.
 *
 * Cada categoria mostra a série mensal como mini-barras; o mês que estourou
 * fica destacado com o excesso sobre o baseline dos outros meses. Responde
 * "gasto muito nisso?" e, principalmente, "foi sempre assim ou teve um mês que
 * fugiu?" — que é o que dá pra agir em cima.
 */
export function PicosGastos({ data, onCategoriaClick, limite = 8 }: Props) {
  if (data.mesesConsiderados === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="text-base font-semibold mb-1">Maiores gastos</h3>
          <p className="text-sm text-muted-foreground">
            Ainda não há meses completos pra analisar. Importe ou lance alguns meses
            e o painel aparece aqui.
          </p>
        </CardContent>
      </Card>
    );
  }

  const top = data.categorias.slice(0, limite);
  const maxTotal = top[0]?.total || 1;

  // Todos os picos da janela, do maior excesso pro menor.
  const todosPicos = data.categorias
    .flatMap((c) => c.picos.map((p) => ({ ...p, categoria: c.categoria })))
    .sort((a, b) => b.excesso - a.excesso);

  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Maiores gastos</h3>
            <p className="text-xs text-muted-foreground">
              Últimos {data.mesesConsiderados} meses completos ·{' '}
              {formatMonthShort(data.meses[0])} a {formatMonthShort(data.meses[data.meses.length - 1])}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-bold tabular leading-none">{formatCurrency(data.mediaMensal)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">média/mês</p>
          </div>
        </div>

        {/* Total por mês — dá o contexto de qual mês foi pesado no geral */}
        <div className="flex items-end gap-1.5 mb-4">
          {data.totalPorMes.map((m) => {
            const maxMes = Math.max(...data.totalPorMes.map((x) => x.valor), 1);
            const h = Math.max(8, Math.round((m.valor / maxMes) * 100));
            const acima = m.valor > data.mediaMensal * 1.15;
            return (
              <div key={m.mes} className="flex-1 min-w-0">
                <div className="h-14 flex items-end">
                  <div
                    className={`w-full rounded-t transition-colors ${acima ? 'bg-destructive/70' : 'bg-primary/40'}`}
                    style={{ height: `${h}%` }}
                    title={`${formatMonthShort(m.mes)}: ${formatCurrency(m.valor)}`}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground text-center mt-1 truncate">
                  {formatMonthShort(m.mes)}
                </p>
                <p className={`text-[10px] text-center tabular truncate ${acima ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                  {formatCurrency(m.valor)}
                </p>
              </div>
            );
          })}
        </div>

        {/* Resumo do excesso — a linha mais acionável do painel */}
        {data.excessoTotal > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 mb-4">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-xs">
              <span className="font-semibold tabular text-destructive">{formatCurrency(data.excessoTotal)}</span>
              <span className="text-muted-foreground">
                {' '}acima do normal em {todosPicos.length} {todosPicos.length === 1 ? 'ocorrência' : 'ocorrências'}
              </span>
            </p>
          </div>
        )}

        {/* Ranking com série mensal inline */}
        <div className="space-y-3">
          {top.map((c) => (
            <LinhaCategoria
              key={c.categoria}
              c={c}
              maxTotal={maxTotal}
              onClick={onCategoriaClick}
            />
          ))}
        </div>

        {/* Meses fora da curva, ranqueados */}
        {todosPicos.length > 0 && (
          <div className="mt-5 pt-4 border-t">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              Meses fora da curva
            </p>
            <div className="space-y-1.5">
              {todosPicos.slice(0, 6).map((p) => (
                <button
                  key={`${p.categoria}-${p.mes}`}
                  type="button"
                  onClick={() => onCategoriaClick?.(p.categoria, p.mes)}
                  className="w-full flex items-center justify-between gap-2 text-left rounded-lg px-2 py-1.5 hover:bg-secondary/60 transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Flame className="h-3.5 w-3.5 text-destructive shrink-0" />
                    <span className="text-sm truncate">{p.categoria}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {formatMonthShort(p.mes)}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="text-sm tabular font-medium">{formatCurrency(p.valor)}</span>
                    <span className="text-[11px] text-destructive tabular ml-1.5">
                      +{formatCurrency(p.excesso)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              "Fora da curva" = pelo menos 30% acima da média dos outros meses da janela.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinhaCategoria({
  c,
  maxTotal,
  onClick,
}: {
  c: CategoriaPico;
  maxTotal: number;
  onClick?: (categoria: string, mes?: string) => void;
}) {
  const cor = getCategoriaColor(c.categoria);
  const maxValorMes = Math.max(...c.meses.map((m) => m.valor), 1);
  const temPico = c.picos.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => onClick?.(c.categoria)}
        className="w-full text-left hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center justify-between gap-2 text-sm mb-1">
          <span className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cor }} />
            <span className="truncate">{c.categoria}</span>
            {temPico && <Flame className="h-3 w-3 text-destructive shrink-0" />}
            <span className="text-[10px] text-muted-foreground shrink-0">
              {VOLATILIDADE_LABEL[c.volatilidade]}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="tabular font-medium">{formatCurrency(c.media)}</span>
            <span className="text-[10px] text-muted-foreground">/mês</span>
          </span>
        </div>
      </button>

      {/* Barra de peso relativo + série mensal */}
      <div className="flex items-center gap-2">
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden flex-1">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(4, Math.round((c.total / maxTotal) * 100))}%`, backgroundColor: cor }}
          />
        </div>
        <div className="flex items-end gap-0.5 h-5 shrink-0" title="Série mensal">
          {c.meses.map((m) => (
            <button
              key={m.mes}
              type="button"
              onClick={() => onClick?.(c.categoria, m.mes)}
              className="w-2 rounded-sm hover:opacity-70 transition-opacity"
              style={{
                height: `${Math.max(12, Math.round((m.valor / maxValorMes) * 100))}%`,
                backgroundColor: m.acimaDoNormal ? 'hsl(var(--destructive))' : cor,
                opacity: m.acimaDoNormal ? 1 : 0.35,
              }}
              title={`${formatMonthShort(m.mes)}: ${formatCurrency(m.valor)}${
                m.acimaDoNormal ? ` (+${formatCurrency(m.excesso)} acima do normal)` : ''
              }`}
              aria-label={`${c.categoria} em ${formatMonthShort(m.mes)}: ${formatCurrency(m.valor)}`}
            />
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground tabular w-9 text-right shrink-0">
          {c.pctDoTotal.toFixed(0)}%
        </span>
      </div>

      {/* Contexto extra: comprometido em parcela / pico do mês */}
      {(c.pctParcela >= 30 || temPico) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-muted-foreground">
          {c.pctParcela >= 30 && (
            <span>{c.pctParcela.toFixed(0)}% é parcela ({formatCurrency(c.mediaParcela)}/mês)</span>
          )}
          {temPico && (
            <span className="text-destructive">
              {c.picos.map((p) => `${formatMonthShort(p.mes)} +${formatCurrency(p.excesso)}`).join(' · ')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
