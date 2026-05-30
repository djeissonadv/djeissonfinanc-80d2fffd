import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency, getMonthName, toLocalIso } from '@/lib/format';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { useFontesReceita } from '@/hooks/useFontesReceita';
import { buildDebtPlan, jurosEvitadosQuitando, type DebtItem } from '@/lib/debt-strategy';
import { DebtStrategyCard } from '@/components/dividas/DebtStrategyCard';
import { DeepAnalysisCard } from '@/components/analytics/ClaudeAnalysisCards';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Landmark,
  AlertTriangle,
  TrendingDown,
  CalendarCheck2,
  Wallet,
  CreditCard,
  ShoppingBag,
  Building2,
  Target,
  Flame,
  Snowflake,
} from 'lucide-react';

// ─── helpers ────────────────────────────────────────────────────────────────

function addMonths(yyyyMM: string, n: number): string {
  const [y, m] = yyyyMM.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMes(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number);
  return `${getMonthName(m - 1)}/${String(y).slice(2)}`;
}

function fmtMesFull(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number);
  return `${getMonthName(m - 1)}/${y}`;
}

// ─── contrato metadata ───────────────────────────────────────────────────────

interface ContratoMeta {
  nome: string;
  color: string;
  taxaAno?: number; // % ao ano
  parcelaTotal?: number;
}

const CONTRATO_META: Record<string, ContratoMeta> = {
  C5A9200110:   { nome: 'Sicredi C5A9200110', color: '#3b82f6', parcelaTotal: 48 },
  C5A9304161:   { nome: 'Sicredi C5A9304161', color: '#8b5cf6', parcelaTotal: 36 },
  C5A9304811:   { nome: 'Sicredi C5A9304811', color: '#06b6d4', parcelaTotal: 30 },
  MP1240412639: { nome: 'Mercado Pago #1240412639', color: '#f59e0b', taxaAno: 130, parcelaTotal: 24 },
  C5A9203519:   { nome: 'Sicredi C5A9203519', color: '#10b981', parcelaTotal: 12 },
  C5A9304498:   { nome: 'Sicredi C5A9304498', color: '#ec4899', parcelaTotal: 12 },
};

// ─── types ───────────────────────────────────────────────────────────────────

interface Transacao {
  id: string;
  descricao: string;
  valor: number;
  tipo: string;
  parcela_atual: number | null;
  parcela_total: number | null;
  grupo_parcela: string | null;
  mes_competencia: string | null;
  data: string;
  categoria: string | null;
  conta_id: string;
  hash_transacao: string | null;
}

interface LoanContract {
  contratoKey: string;
  meta: ContratoMeta;
  parcelasRestantes: number;
  parcelasPagas: number;
  valorMensal: number;
  totalRestante: number;
  dataFim: string; // YYYY-MM
  progressPercent: number;
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; fill: string }[];
  label?: string;
}) => {
  if (!active || !payload || !payload.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="rounded-lg border bg-popover p-3 shadow-md text-sm min-w-[180px]">
      <p className="font-semibold mb-2">{label}</p>
      {payload.filter(p => p.value > 0).map((p) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span style={{ color: p.fill }}>{p.name}</span>
          <span className="font-medium">{formatCurrency(p.value)}</span>
        </div>
      ))}
      <div className="border-t mt-2 pt-2 flex justify-between font-bold">
        <span>Total</span>
        <span className="text-destructive">{formatCurrency(total)}</span>
      </div>
    </div>
  );
};

// ─── helpers: parcelamentos (credit card) ─────────────────────────────────────

function addMonthsStr(yyyyMM: string, months: number): string {
  return addMonths(yyyyMM, months);
}

function getGroupKey(tx: Transacao): string {
  if (tx.grupo_parcela) return tx.grupo_parcela;
  const isFatura = /parcela da fatura/i.test(tx.descricao);
  if (isFatura) {
    const match = tx.descricao.match(/fatura\s+de\s+(\w+)\/?(\d{4})?/i);
    const fatMonth = match ? (match[2] ? `${match[1]}/${match[2]}` : match[1]) : tx.descricao;
    return `fatura_parcelada_${fatMonth}_${tx.conta_id}`;
  }
  return `${tx.descricao}_${tx.parcela_total}_${tx.conta_id}`;
}

function cleanName(desc: string): string {
  return desc
    .replace(/^(MERCADOLIVRE\*|MERCADOPAGO\*|MP\*|EC\s?\*)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── component ───────────────────────────────────────────────────────────────

export default function DividasPage() {
  const { user } = useAuth();
  const today = new Date();
  const todayStr = toLocalIso(today);
  const currentYYYYMM = todayStr.slice(0, 7);

  // ── 1. Future loan installments (categoria=Empréstimos, data >= today, mes_competencia IS NULL)
  const { data: futureInstallments, isLoading: loadingFuture } = useQuery({
    queryKey: ['dividas-future', user?.id],
    queryFn: async () => {
      const data = await fetchAllRows<Transacao>(() => supabase
        .from('transacoes')
        .select('id, descricao, valor, tipo, data, conta_id, hash_transacao, parcela_atual, parcela_total, categoria, grupo_parcela, mes_competencia')
        .eq('user_id', user!.id)
        .eq('categoria', 'Empréstimos')
        .is('mes_competencia', null)
        .gte('data', todayStr)
        .order('data', { ascending: true }));
      return data;
    },
    enabled: !!user,
  });

  // ── 2. Credit card installments (parcelamentos)
  const { data: parcelamentosTx, isLoading: loadingParc } = useQuery({
    queryKey: ['dividas-parcelamentos', user?.id],
    queryFn: async () => {
      const data = await fetchAllRows<Transacao>(() => supabase
        .from('transacoes')
        .select('id, descricao, valor, tipo, parcela_atual, parcela_total, grupo_parcela, mes_competencia, data, categoria, conta_id, hash_transacao')
        .eq('user_id', user!.id)
        .eq('tipo', 'despesa')
        .not('parcela_total', 'is', null)
        .gt('parcela_total', 1));
      return data;
    },
    enabled: !!user,
  });

  // ── 3. Loan contracts derived from future installments
  const loanContracts = useMemo((): LoanContract[] => {
    if (!futureInstallments || futureInstallments.length === 0) return [];

    // Group by contract key (hash prefix)
    const byContract = new Map<string, Transacao[]>();
    for (const tx of futureInstallments) {
      const key = tx.hash_transacao?.split('_')[0] || 'unknown';
      if (!byContract.has(key)) byContract.set(key, []);
      byContract.get(key)!.push(tx);
    }

    const result: LoanContract[] = [];
    for (const [key, txs] of byContract) {
      if (txs.length === 0) continue;
      const sorted = [...txs].sort((a, b) => a.data.localeCompare(b.data));
      const valorMensal = sorted[0].valor;
      const parcelasRestantes = sorted.length;
      const totalRestante = sorted.reduce((s, t) => s + t.valor, 0);
      const dataFim = sorted[sorted.length - 1].data.slice(0, 7);
      const meta = CONTRATO_META[key] || { nome: key, color: '#6b7280' };
      const parcelaTotal = meta.parcelaTotal || (sorted[0].parcela_total || parcelasRestantes);
      const parcelaAtual = sorted[0].parcela_atual || 1;
      const progressPercent = Math.round(((parcelaAtual - 1) / parcelaTotal) * 100);

      result.push({
        contratoKey: key,
        meta,
        parcelasRestantes,
        parcelasPagas: parcelaAtual - 1,
        valorMensal,
        totalRestante,
        dataFim,
        progressPercent,
      });
    }

    return result.sort((a, b) => b.totalRestante - a.totalRestante);
  }, [futureInstallments]);

  // ── 4. Monthly loan chart data (from future installments)
  const loanChartData = useMemo(() => {
    if (!futureInstallments || futureInstallments.length === 0) return [];

    // Collect all months from current to last installment
    const lastMonth = futureInstallments.reduce((last, tx) => {
      const m = tx.data.slice(0, 7);
      return m > last ? m : last;
    }, currentYYYYMM);

    const months: string[] = [];
    let m = currentYYYYMM;
    while (m <= lastMonth) {
      months.push(m);
      m = addMonths(m, 1);
    }

    // Build chart rows
    return months.map((month) => {
      const row: Record<string, string | number> = { mes: fmtMes(month), mesFull: month };
      let total = 0;

      for (const tx of futureInstallments) {
        if (tx.data.slice(0, 7) !== month) continue;
        const key = tx.hash_transacao?.split('_')[0] || 'unknown';
        const meta = CONTRATO_META[key] || { nome: key, color: '#6b7280' };
        const nomeCurto = meta.nome.replace('Sicredi ', '').replace(' #1240412639', '');
        row[nomeCurto] = (Number(row[nomeCurto] || 0)) + tx.valor;
        total += tx.valor;
      }

      row['_total'] = total;
      return row;
    });
  }, [futureInstallments, currentYYYYMM]);

  // ── 5. Contract keys for chart bars (each gets a Bar)
  const chartContratos = useMemo(() => {
    return loanContracts.map(c => ({
      key: c.meta.nome.replace('Sicredi ', '').replace(' #1240412639', ''),
      color: c.meta.color,
    }));
  }, [loanContracts]);

  // ── 6. Parcelamentos (credit card) processing
  const debtGroups = useMemo(() => {
    if (!parcelamentosTx || parcelamentosTx.length === 0) return [];

    const grouped = new Map<string, Transacao[]>();
    for (const tx of parcelamentosTx) {
      const descLower = tx.descricao.toLowerCase();
      if (
        descLower.includes('crédito por parcelamento') ||
        descLower.includes('credito por parcelamento') ||
        /pagamento\s+(d[ae]\s+)?fatura/.test(descLower) ||
        tx.categoria === 'Empréstimos'
      ) continue;

      const key = getGroupKey(tx);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(tx);
    }

    const result = [];
    for (const [key, txs] of grouped) {
      const latest = txs.reduce((a, b) => (a.parcela_atual || 0) >= (b.parcela_atual || 0) ? a : b);
      const parcelaAtual = latest.parcela_atual || 0;
      const parcelaTotal = latest.parcela_total || 0;
      const remaining = Math.max(0, parcelaTotal - parcelaAtual);
      const valorNum = Math.abs(Number(latest.valor));
      if (remaining === 0 || !valorNum) continue;

      const mesComp = latest.mes_competencia || latest.data.slice(0, 7);
      const mesTermino = addMonthsStr(mesComp, remaining);
      const isFatura = /parcela da fatura/i.test(latest.descricao);
      const match = latest.descricao.match(/fatura\s+de\s+(\w+)\/?(\d{4})?/i);
      const fatMonth = match ? (match[2] ? `${match[1]}/${match[2]}` : match[1]) : undefined;

      result.push({
        key,
        displayName: isFatura ? `Fatura de ${fatMonth || 'N/A'}` : cleanName(latest.descricao),
        descricao: latest.descricao,
        parcelaAtual,
        parcelaTotal,
        valorMensal: valorNum,
        parcelasRestantes: remaining,
        valorRestante: valorNum * remaining,
        mesTermino,
        progressPercent: Math.round((parcelaAtual / parcelaTotal) * 100),
        isFatura,
        categoria: latest.categoria,
      });
    }

    return result.sort((a, b) => b.valorRestante - a.valorRestante);
  }, [parcelamentosTx]);

  // ── 7. Summary numbers
  const totalDebtRestante = loanContracts.reduce((s, c) => s + c.totalRestante, 0);
  const totalMensalEmprestimos = loanContracts.reduce((s, c) => s + c.valorMensal, 0);
  const totalMensalParcelamentos = debtGroups.reduce((s, d) => s + d.valorMensal, 0);
  const mesesAteFim = loanContracts.length > 0
    ? Math.max(...loanContracts.map(c => {
        const [fy, fm] = c.dataFim.split('-').map(Number);
        const [cy, cm] = currentYYYYMM.split('-').map(Number);
        return (fy - cy) * 12 + (fm - cm);
      }))
    : 0;

  const isLoading = loadingFuture || loadingParc;

  // ── peak month
  const peakMonth = useMemo(() => {
    if (loanChartData.length === 0) return null;
    return loanChartData.reduce((peak, row) => (Number(row['_total']) > Number(peak['_total']) ? row : peak));
  }, [loanChartData]);

  // ── 8. Plano de saída das dívidas (estratégia)
  const { receitaBase } = useFontesReceita();
  const debtItems = useMemo((): DebtItem[] => [
    ...loanContracts.map(c => ({
      id: c.contratoKey,
      nome: c.meta.nome,
      valorMensal: c.valorMensal,
      parcelasRestantes: c.parcelasRestantes,
      valorRestante: c.totalRestante,
      mesFim: c.dataFim,
      taxaAno: c.meta.taxaAno,
      tipo: 'emprestimo' as const,
    })),
    ...debtGroups.map(d => ({
      id: d.key,
      nome: d.displayName,
      valorMensal: d.valorMensal,
      parcelasRestantes: d.parcelasRestantes,
      valorRestante: d.valorRestante,
      mesFim: d.mesTermino,
      taxaAno: undefined,
      tipo: d.isFatura ? ('fatura' as const) : ('compra' as const),
    })),
  ], [loanContracts, debtGroups]);

  const debtPlan = useMemo(() => buildDebtPlan(debtItems, receitaBase, currentYYYYMM), [debtItems, receitaBase, currentYYYYMM]);
  const mesLiberdadeLabel = debtPlan.mesLiberdade ? fmtMesFull(debtPlan.mesLiberdade) : '—';

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <h1 className="text-2xl font-bold">Dívidas & Empréstimos</h1>
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    );
  }

  const faturaDebts = debtGroups.filter(d => d.isFatura);
  const purchaseDebts = debtGroups.filter(d => !d.isFatura);

  return (
    <div className="space-y-8 animate-fade-in pb-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Dívidas & Empréstimos</h1>
        <p className="text-sm text-muted-foreground">
          {debtPlan.mesLiberdade
            ? `Visão completa do compromisso financeiro até ${mesLiberdadeLabel}`
            : 'Visão completa do seu compromisso financeiro'}
        </p>
      </div>

      {/* Alert banner */}
      {loanContracts.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-sm text-destructive">
                  Dívida total mapeada: {formatCurrency(totalDebtRestante)} em {loanContracts.length} contratos
                </p>
                {peakMonth && (
                  <p className="text-xs text-muted-foreground">
                    Pico de comprometimento em <strong>{peakMonth.mes}</strong>:{' '}
                    <strong className="text-destructive">{formatCurrency(Number(peakMonth['_total']))}/mês</strong>{' '}
                    só em empréstimos — sem contar cartão, moradia, alimentação.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Mercado Pago tem taxa de <strong className="text-amber-600">130% a.a. (6,75% a.m.)</strong> — prioridade máxima de quitação.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Landmark className="h-3.5 w-3.5" /> Dívida total
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xl font-bold text-destructive">{formatCurrency(totalDebtRestante)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{loanContracts.length} contratos ativos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" /> Empréstimos/mês
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xl font-bold text-destructive">{formatCurrency(totalMensalEmprestimos)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">mês atual</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" /> Parcelamentos/mês
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xl font-bold">{formatCurrency(totalMensalParcelamentos)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{debtGroups.length} parcelamentos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <CalendarCheck2 className="h-3.5 w-3.5" /> Último contrato
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xl font-bold">{mesesAteFim} <span className="text-sm font-normal text-muted-foreground">meses</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">até {mesLiberdadeLabel}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── PLANO DE SAÍDA ── */}
      {debtItems.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Plano de saída das dívidas</h2>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {/* Prioridade de ataque (avalanche) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Flame className="h-4 w-4 text-destructive" /> Ordem de ataque
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground -mt-1">
                  Ataque primeiro a dívida mais cara (mais juros), mantendo o mínimo das outras.
                </p>
                {debtPlan.ordemAtaque.slice(0, 4).map((a, i) => (
                  <div key={a.item.id} className="flex items-start gap-2 text-sm">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="font-medium leading-tight truncate">{a.item.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.motivo} · {formatCurrency(a.item.valorRestante)} restante
                        {a.jurosEvitaveis > 0 && ` · quitar à vista evita ~${formatCurrency(a.jurosEvitaveis)}`}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Liberdade + bola de neve */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Snowflake className="h-4 w-4 text-cyan-500" /> Efeito bola de neve
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="bg-muted/50 rounded-lg p-2.5 space-y-0.5 text-sm">
                  {debtPlan.comprometimentoRenda !== null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Dívidas vs. renda</span>
                      <span className={`font-medium ${debtPlan.comprometimentoRenda > 40 ? 'text-destructive' : debtPlan.comprometimentoRenda > 30 ? 'text-amber-600' : 'text-green-600'}`}>
                        {debtPlan.comprometimentoRenda.toFixed(0)}% ({formatCurrency(debtPlan.totalMensal)}/mês)
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Livre de dívidas em</span>
                    <span className="font-medium">{mesLiberdadeLabel} ({debtPlan.mesesAteLiberdade}m)</span>
                  </div>
                  {debtPlan.jurosEvitaveis > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Juros evitáveis (quitação à vista)</span>
                      <span className="font-medium text-green-600">{formatCurrency(debtPlan.jurosEvitaveis)}</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Conforme cada dívida acaba, jogue o valor liberado na próxima:</p>
                {debtPlan.liberacoes.slice(0, 3).map((l, i) => (
                  <div key={`${l.nome}-${i}`} className="flex items-center justify-between text-sm">
                    <span className="truncate text-muted-foreground">{fmtMesFull(l.mes)} · {l.nome} acaba</span>
                    <span className="font-medium text-green-600 shrink-0 ml-2">+{formatCurrency(l.valorLiberado)}/mês</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {(() => {
            const debtCtx = {
              rendaMensal: receitaBase,
              totalRestante: debtPlan.totalRestante,
              totalMensal: debtPlan.totalMensal,
              comprometimentoRenda: debtPlan.comprometimentoRenda,
              mesLiberdade: mesLiberdadeLabel,
              mesesAteLiberdade: debtPlan.mesesAteLiberdade,
              jurosEvitaveis: debtPlan.jurosEvitaveis,
              dividas: debtPlan.ordemAtaque.map(a => ({
                nome: a.item.nome,
                valorMensal: a.item.valorMensal,
                parcelasRestantes: a.item.parcelasRestantes,
                valorRestante: a.item.valorRestante,
                taxaAno: a.item.taxaAno ?? null,
              })),
            };
            return (
              <div className="grid gap-4 md:grid-cols-2">
                <DebtStrategyCard context={debtCtx} />
                <DeepAnalysisCard
                  mode="dividas_strategy"
                  title="Plano detalhado — Claude"
                  description="Ordem de ataque, custo de adiar, efeito bola de neve, ação deste mês"
                  buttonLabel="Montar plano com Claude"
                  context={debtCtx}
                />
              </div>
            );
          })()}
        </div>
      )}

      {/* ── GRÁFICO DE BARRAS EMPILHADAS ── */}
      {loanChartData.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Comprometimento mensal por contrato</h2>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            Cada cor representa um contrato. Barras menores = contratos encerrando.
          </p>
          <Card>
            <CardContent className="p-4">
              <div className="w-full overflow-x-auto">
                <div style={{ minWidth: Math.max(loanChartData.length * 38, 400) }}>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart
                      data={loanChartData}
                      margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
                      barSize={28}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.4} />
                      <XAxis
                        dataKey="mes"
                        tick={{ fontSize: 10 }}
                        interval={loanChartData.length > 24 ? 2 : 1}
                        angle={-45}
                        textAnchor="end"
                        height={48}
                      />
                      <YAxis
                        tickFormatter={(v) => `R$${(v / 1000).toFixed(v >= 1000 ? 1 : 0)}k`}
                        tick={{ fontSize: 10 }}
                        width={52}
                      />
                      <ReTooltip content={<CustomTooltip />} />
                      <Legend
                        wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                        formatter={(value) => value}
                      />
                      {chartContratos.map(c => (
                        <Bar
                          key={c.key}
                          dataKey={c.key}
                          stackId="emprestimos"
                          fill={c.color}
                          name={c.key}
                          radius={chartContratos[chartContratos.length - 1].key === c.key ? [3, 3, 0, 0] : undefined}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── CONTRATOS INDIVIDUAIS ── */}
      {loanContracts.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Contratos de empréstimo</h2>
            <Badge variant="secondary">{loanContracts.length}</Badge>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {loanContracts.map(c => {
              const isMP = c.contratoKey === 'MP1240412639';
              return (
                <Card
                  key={c.contratoKey}
                  className={isMP ? 'border-amber-300 dark:border-amber-700' : ''}
                >
                  <CardContent className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full shrink-0 mt-0.5"
                            style={{ backgroundColor: c.meta.color }}
                          />
                          <p className="font-semibold text-sm leading-tight">{c.meta.nome}</p>
                        </div>
                        {isMP && (
                          <p className="text-xs text-amber-600 font-medium mt-0.5 ml-4">
                            ⚠️ 130% a.a. — quitar primeiro
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {c.parcelasRestantes}x restantes
                      </Badge>
                    </div>

                    {/* Values */}
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Parcela mensal</p>
                        <p className="font-semibold">{formatCurrency(c.valorMensal)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total restante</p>
                        <p className="font-semibold text-destructive">{formatCurrency(c.totalRestante)}</p>
                      </div>
                    </div>

                    {/* Progress */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{c.parcelasPagas} pagas</span>
                        <span>termina {fmtMesFull(c.dataFim)}</span>
                      </div>
                      <Progress
                        value={c.progressPercent}
                        className="h-2"
                        style={{ '--progress-color': c.meta.color } as React.CSSProperties}
                      />
                      <p className="text-right text-[10px] text-muted-foreground">{c.progressPercent}% quitado</p>
                    </div>

                    {/* Savings hint for MP */}
                    {isMP && (
                      <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-700 dark:text-amber-400">
                        Quitar hoje economiza ~<strong>{formatCurrency(jurosEvitadosQuitando(c.valorMensal, c.parcelasRestantes, c.meta.taxaAno))}</strong> em juros ({c.meta.taxaAno}% a.a. sobre {c.parcelasRestantes}x)
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TABELA MENSAL DETALHADA ── */}
      {loanChartData.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Cronograma mensal</h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium">Mês</th>
                      {loanContracts.map(c => (
                        <th key={c.contratoKey} className="px-3 py-3 text-right font-medium text-xs">
                          <span style={{ color: c.meta.color }}>●</span>{' '}
                          {c.meta.nome.replace('Sicredi ', '').replace(' #1240412639', '')}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loanChartData.map((row, i) => {
                      const isCurrentMonth = row.mesFull === currentYYYYMM;
                      const prevTotal = i > 0 ? Number(loanChartData[i - 1]['_total']) : Number(row['_total']);
                      const dropped = prevTotal > 0 && Number(row['_total']) < prevTotal * 0.9;
                      return (
                        <tr
                          key={String(row.mesFull)}
                          className={`border-b last:border-0 ${
                            isCurrentMonth
                              ? 'bg-primary/5 font-medium'
                              : dropped
                              ? 'bg-green-50 dark:bg-green-950/20'
                              : ''
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            {row.mes}
                            {isCurrentMonth && (
                              <span className="ml-2 text-xs text-primary">(atual)</span>
                            )}
                            {dropped && i > 0 && (
                              <span className="ml-2 text-xs text-green-600">↓ alívio</span>
                            )}
                          </td>
                          {loanContracts.map(c => {
                            const nomeCurto = c.meta.nome.replace('Sicredi ', '').replace(' #1240412639', '');
                            const val = Number(row[nomeCurto] || 0);
                            return (
                              <td key={c.contratoKey} className="px-3 py-2.5 text-right text-muted-foreground text-xs">
                                {val > 0 ? formatCurrency(val) : '—'}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2.5 text-right font-semibold">
                            {formatCurrency(Number(row['_total']))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── PARCELAMENTOS DE FATURA ── */}
      {faturaDebts.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-warning" />
            <h2 className="text-lg font-semibold">Parcelamentos de fatura</h2>
            <Badge variant="destructive">{faturaDebts.length}</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {faturaDebts.map(d => (
              <Card key={d.key} className="border-warning/30">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">{d.displayName}</p>
                    <Badge variant="outline">{d.parcelaAtual}/{d.parcelaTotal}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Mensal</span>
                    <span className="font-medium">{formatCurrency(d.valorMensal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Restante ({d.parcelasRestantes}x)</span>
                    <span className="font-medium text-destructive">{formatCurrency(d.valorRestante)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Termina</span>
                    <span>{fmtMesFull(d.mesTermino)}</span>
                  </div>
                  <Progress value={d.progressPercent} className="h-2" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── COMPRAS PARCELADAS ── */}
      {purchaseDebts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Compras parceladas</h2>
            <Badge variant="secondary">{purchaseDebts.length}</Badge>
          </div>
          <div className="space-y-2">
            {purchaseDebts.map(d => (
              <Card key={d.key}>
                <CardContent className="p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm" title={d.descricao}>{d.displayName}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-xs">{d.parcelaAtual}/{d.parcelaTotal}</Badge>
                        <span>termina {fmtMesFull(d.mesTermino)}</span>
                        {d.categoria && d.categoria !== 'Outros' && <span>· {d.categoria}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-right shrink-0">
                      <div>
                        <p className="text-xs text-muted-foreground">Mensal</p>
                        <p className="font-medium text-sm">{formatCurrency(d.valorMensal)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Restante</p>
                        <p className="font-medium text-sm text-destructive">{formatCurrency(d.valorRestante)}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {loanContracts.length === 0 && debtGroups.length === 0 && !isLoading && (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center justify-center text-center">
            <Landmark className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h3 className="text-lg font-medium">Nenhuma dívida encontrada</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Importe seus extratos OFX ou lançamentos manuais para ver aqui.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
