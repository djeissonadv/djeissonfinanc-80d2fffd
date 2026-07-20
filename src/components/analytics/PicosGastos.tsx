import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/format';
import { getCategoriaColor } from '@/types/database.types';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Flame, ChevronRight, ArrowUpRight } from 'lucide-react';
import { formatMonthShort, lancamentosPorMes } from '@/lib/analytics-engine';
import type {
  AnalisePicos, CategoriaPico, Volatilidade,
} from '@/lib/analytics-engine';
import type { TransactionRecord } from '@/lib/projection-engine';

interface Props {
  data: AnalisePicos;
  /** Base pro detalhe de lançamentos ao expandir uma categoria. */
  transactions: TransactionRecord[];
  /** Meses disponíveis (YYYY-MM) pro seletor de período. */
  mesesDisponiveis: string[];
  inicio: string;
  fim: string;
  onRangeChange: (inicio: string, fim: string) => void;
  onCategoriaClick?: (categoria: string, mes?: string) => void;
  limite?: number;
}

const VOLATILIDADE_LABEL: Record<Volatilidade, string> = {
  estavel: 'estável',
  variavel: 'varia',
  irregular: 'irregular',
  pontual: 'pontual',
};

/**
 * "Maiores gastos" — onde o dinheiro foi no período escolhido e QUAIS meses
 * saíram fora da curva.
 *
 * O período é escolhido pelo usuário (não fixo): um mês com importação
 * incompleta distorce toda a média, então ele precisa poder cortá-lo fora.
 * Clicar numa categoria abre o detalhe: totais por mês + os lançamentos que
 * formam cada total.
 */
export function PicosGastos({
  data, transactions, mesesDisponiveis, inicio, fim, onRangeChange,
  onCategoriaClick, limite = 8,
}: Props) {
  const [aberta, setAberta] = useState<string | null>(null);

  const seletor = (
    <RangeSelector
      meses={mesesDisponiveis}
      inicio={inicio}
      fim={fim}
      onChange={onRangeChange}
    />
  );

  if (data.mesesConsiderados === 0) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <h3 className="text-base font-semibold">Maiores gastos</h3>
            {mesesDisponiveis.length > 0 && seletor}
          </div>
          <p className="text-sm text-muted-foreground">
            Nenhum gasto no período selecionado. Ajuste o intervalo acima ou
            importe os lançamentos desses meses.
          </p>
        </CardContent>
      </Card>
    );
  }

  const top = data.categorias.slice(0, limite);
  const maxTotal = top[0]?.total || 1;
  const maxMes = Math.max(...data.totalPorMes.map((x) => x.valor), 1);

  const todosPicos = data.categorias
    .flatMap((c) => c.picos.map((p) => ({ ...p, categoria: c.categoria })))
    .sort((a, b) => b.excesso - a.excesso);

  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        {/* Cabeçalho + seletor de período */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-tight">Maiores gastos</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.mesesConsiderados} {data.mesesConsiderados === 1 ? 'mês' : 'meses'} ·{' '}
              média {formatCurrency(data.mediaMensal)}/mês
            </p>
          </div>
          {seletor}
        </div>

        {/* Total por mês */}
        <div className="flex items-end gap-1.5 mb-4">
          {data.totalPorMes.map((m) => {
            const h = Math.max(8, Math.round((m.valor / maxMes) * 100));
            const acima = m.valor > data.mediaMensal * 1.15;
            return (
              <div key={m.mes} className="flex-1 min-w-0">
                <div className="h-12 flex items-end">
                  <div
                    className={`w-full rounded-t ${acima ? 'bg-destructive/70' : 'bg-primary/40'}`}
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

        <div className="divide-y divide-border/60 -mx-1">
          {top.map((c) => (
            <LinhaCategoria
              key={c.categoria}
              c={c}
              maxTotal={maxTotal}
              meses={data.meses}
              transactions={transactions}
              aberta={aberta === c.categoria}
              onToggle={() => setAberta(aberta === c.categoria ? null : c.categoria)}
              onVerLancamentos={onCategoriaClick}
            />
          ))}
        </div>

        {todosPicos.length > 0 && (
          <div className="mt-4 pt-3 border-t">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Meses fora da curva
            </p>
            <div className="space-y-0.5">
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
                  <span className="text-right shrink-0 whitespace-nowrap">
                    <span className="text-sm tabular font-medium">{formatCurrency(p.valor)}</span>
                    <span className="text-[11px] text-destructive tabular ml-1.5">
                      +{formatCurrency(p.excesso)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              "Fora da curva" = 30%+ acima da mediana dos outros meses do período.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function RangeSelector({
  meses, inicio, fim, onChange,
}: {
  meses: string[];
  inicio: string;
  fim: string;
  onChange: (inicio: string, fim: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <Select
        value={inicio}
        onValueChange={(v) => onChange(v, v > fim ? v : fim)}
      >
        <SelectTrigger className="h-7 w-[92px] text-xs px-2" aria-label="Mês inicial">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {meses.map((m) => (
            <SelectItem key={m} value={m} className="text-xs">{formatMonthShort(m)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">a</span>
      <Select
        value={fim}
        onValueChange={(v) => onChange(v < inicio ? v : inicio, v)}
      >
        <SelectTrigger className="h-7 w-[92px] text-xs px-2" aria-label="Mês final">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {meses.map((m) => (
            <SelectItem key={m} value={m} className="text-xs">{formatMonthShort(m)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function LinhaCategoria({
  c, maxTotal, meses, transactions, aberta, onToggle, onVerLancamentos,
}: {
  c: CategoriaPico;
  maxTotal: number;
  meses: string[];
  transactions: TransactionRecord[];
  aberta: boolean;
  onToggle: () => void;
  onVerLancamentos?: (categoria: string, mes?: string) => void;
}) {
  const cor = getCategoriaColor(c.categoria);
  const maxValorMes = Math.max(...c.meses.map((m) => m.valor), 1);
  const temPico = c.picos.length > 0;

  // Só calcula o detalhe quando a linha abre.
  const detalhe = useMemo(
    () => (aberta ? lancamentosPorMes(transactions, c.categoria, meses) : []),
    [aberta, transactions, c.categoria, meses],
  );

  return (
    <div className="py-2.5 px-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberta}
        className="w-full text-left group"
      >
        <div className="flex items-center justify-between gap-2 text-sm mb-1.5">
          <span className="flex items-center gap-1.5 min-w-0">
            <ChevronRight
              className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${aberta ? 'rotate-90' : ''}`}
            />
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cor }} />
            <span className="truncate group-hover:underline">{c.categoria}</span>
            {temPico && <Flame className="h-3 w-3 text-destructive shrink-0" />}
            <span className="text-[10px] text-muted-foreground shrink-0">
              {VOLATILIDADE_LABEL[c.volatilidade]}
            </span>
          </span>
          <span className="shrink-0 text-right whitespace-nowrap">
            <span className="tabular font-medium">{formatCurrency(c.media)}</span>
            <span className="text-[10px] text-muted-foreground">/mês</span>
          </span>
        </div>
      </button>

      <div className="flex items-center gap-2 pl-5">
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden flex-1">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(4, Math.round((c.total / maxTotal) * 100))}%`, backgroundColor: cor }}
          />
        </div>
        <div className="flex items-end gap-0.5 h-5 shrink-0">
          {c.meses.map((m) => (
            <button
              key={m.mes}
              type="button"
              onClick={() => onVerLancamentos?.(c.categoria, m.mes)}
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

      {!aberta && (c.pctParcela >= 30 || temPico) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 pl-5 text-[10px] text-muted-foreground">
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

      {aberta && (
        <Detalhe
          c={c}
          detalhe={detalhe}
          cor={cor}
          onVerLancamentos={onVerLancamentos}
        />
      )}
    </div>
  );
}

function Detalhe({
  c, detalhe, cor, onVerLancamentos,
}: {
  c: CategoriaPico;
  detalhe: ReturnType<typeof lancamentosPorMes>;
  cor: string;
  onVerLancamentos?: (categoria: string, mes?: string) => void;
}) {
  const [mesAberto, setMesAberto] = useState<string | null>(
    // abre já no mês do pico, que é o que interessa olhar
    c.picos[0]?.mes ?? null,
  );

  return (
    <div className="mt-3 ml-5 rounded-lg bg-secondary/30 p-3 space-y-3">
      {/* Resumo da categoria */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
          <p className="text-sm font-semibold tabular">{formatCurrency(c.total)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Média</p>
          <p className="text-sm font-semibold tabular">{formatCurrency(c.media)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Parcela</p>
          <p className="text-sm font-semibold tabular">{c.pctParcela.toFixed(0)}%</p>
        </div>
      </div>

      {/* Totais por mês — clicar abre os lançamentos daquele mês */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Totais por mês
        </p>
        <div className="space-y-0.5">
          {c.meses.map((m) => {
            const temItens = detalhe.some((d) => d.mes === m.mes);
            const aberto = mesAberto === m.mes;
            return (
              <div key={m.mes}>
                <button
                  type="button"
                  disabled={!temItens}
                  onClick={() => setMesAberto(aberto ? null : m.mes)}
                  className={`w-full flex items-center justify-between gap-2 rounded px-2 py-1 text-xs transition-colors ${
                    temItens ? 'hover:bg-background/60' : 'opacity-50 cursor-default'
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <ChevronRight
                      className={`h-3 w-3 shrink-0 transition-transform ${aberto ? 'rotate-90' : ''} ${temItens ? '' : 'invisible'}`}
                    />
                    <span>{formatMonthShort(m.mes)}</span>
                    {m.acimaDoNormal && (
                      <span className="text-[10px] text-destructive whitespace-nowrap">
                        +{formatCurrency(m.excesso)} vs normal
                      </span>
                    )}
                  </span>
                  <span className={`tabular font-medium shrink-0 ${m.acimaDoNormal ? 'text-destructive' : ''}`}>
                    {formatCurrency(m.valor)}
                  </span>
                </button>

                {aberto && (
                  <ul className="mt-0.5 mb-1.5 ml-4 space-y-0.5 border-l pl-2.5" style={{ borderColor: `${cor}55` }}>
                    {detalhe.find((d) => d.mes === m.mes)?.itens.map((it, i) => (
                      <li key={`${it.data}-${i}`} className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="flex items-baseline gap-1.5 min-w-0">
                          <span className="text-muted-foreground tabular shrink-0">
                            {it.data.slice(8, 10)}/{it.data.slice(5, 7)}
                          </span>
                          <span className="truncate">{it.descricao}</span>
                          {it.parcela && (
                            <span className="text-[9px] text-muted-foreground shrink-0 whitespace-nowrap">
                              {it.parcela}
                            </span>
                          )}
                        </span>
                        <span className="tabular shrink-0">{formatCurrency(it.valor)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onVerLancamentos?.(c.categoria)}
        className="flex items-center gap-1 text-[11px] text-primary hover:underline"
      >
        Ver todos em Transações <ArrowUpRight className="h-3 w-3" />
      </button>
    </div>
  );
}
