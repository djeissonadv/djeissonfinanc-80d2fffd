import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTodayIso } from '@/hooks/useTodayIso';
import { useTransacoes12m } from '@/hooks/useTransacoes12m';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { useFontesReceita } from '@/hooks/useFontesReceita';
import { MonthSelector } from '@/components/MonthSelector';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { TransactionRecord } from '@/lib/projection-engine';
import {
  detectSpendingTrends,
  detectAnomalies,
  detectRecurringCharges,
} from '@/lib/spending-patterns';
import { calculateFinancialHealth } from '@/lib/financial-health';
import { calculateIncomeCommitment } from '@/lib/income-commitment';
import { getMonthRange, formatCurrency } from '@/lib/format';
import {
  buildMonthlyFlow,
  buildCategoryComposition,
  computeMonthlyKpis,
  comparePeriods,
} from '@/lib/analytics-engine';
import { KpiHeroStrip } from '@/components/analytics/KpiHeroStrip';
import { CashflowChart } from '@/components/analytics/CashflowChart';
import { CategoryComposition } from '@/components/analytics/CategoryComposition';
import { TrendsList } from '@/components/analytics/TrendsList';
import {
  AnomaliesList,
  RecurringChargesList,
} from '@/components/analytics/AnomaliesAndRecurring';
import {
  DeepAnalysisCard,
  AskClaudeCard,
} from '@/components/analytics/ClaudeAnalysisCards';

/**
 * Página Análises — reformada.
 *
 * Layout:
 *   1. Header: título + month selector
 *   2. Hero KPIs: saldo livre / poupança / score / destaque
 *   3. Charts grid: fluxo de caixa (2 cols) + composição categorias (1 col)
 *   4. Insights grid: tendências + anomalias + recorrentes
 *   5. Claude grid: análise profunda + Q&A
 *
 * Toda computação pesada é memoizada e o contexto pro Claude vem pronto.
 */
export default function AnalisesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const { start, end } = getMonthRange(month, year);
  const billingMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
  const todayIso = useTodayIso();

  const { receitaBase } = useFontesReceita();

  const { data: config } = useQuery({
    queryKey: ['config', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('configuracoes').select('*').eq('user_id', user!.id).single();
      return data;
    },
    enabled: !!user,
  });
  const reserva = config?.reserva_minima || 2000;

  // Últimos 12 meses — usa hook compartilhado com Projeções/Planejamento/Dívidas
  // pra evitar refetch ao trocar de tab (cache 2min).
  const { data: allTransactions, isLoading } = useTransacoes12m();

  // Saldo atual — visão de bolso.
  const { data: saldoAtual } = useQuery({
    queryKey: ['analises', 'saldo-total', user?.id, todayIso],
    queryFn: async () => {
      const { data: contasList } = await supabase
        .from('contas')
        .select('id, saldo_inicial, tipo')
        .eq('user_id', user!.id);
      if (!contasList?.length) return 0;
      const debitAccounts = contasList.filter((c) => c.tipo === 'debito');
      let total = debitAccounts.reduce((s, c) => s + (c.saldo_inicial || 0), 0);
      const ids = debitAccounts.map((c) => c.id);
      if (ids.length) {
        const txs = await fetchAllRows<{ valor: number; tipo: string }>(() =>
          supabase
            .from('transacoes')
            .select('valor, tipo')
            .in('conta_id', ids)
            .eq('user_id', user!.id)
            .neq('categoria', 'Saldo Inicial')
            .lte('data', todayIso),
        );
        for (const t of txs) total += t.tipo === 'receita' ? Number(t.valor) : -Number(t.valor);
      }
      return total;
    },
    enabled: !!user,
  });

  // ---------------------------------------------------------------------
  // Memos pesados — fluxo 12m, kpis mês, composição, padrões, health
  // ---------------------------------------------------------------------
  // Passamos todayIso pra filtrar parcelas/recorrentes FUTURAS gravadas no
  // banco — KPIs/charts de Análises devem refletir o REALIZADO, não projeção
  // (que tem página própria em Projeções).
  const flow12 = useMemo(
    () => (allTransactions ? buildMonthlyFlow(allTransactions, 12, todayIso) : []),
    [allTransactions, todayIso],
  );
  const periodCompare = useMemo(() => comparePeriods(flow12, 3), [flow12]);

  const kpisMes = useMemo(
    () => (allTransactions ? computeMonthlyKpis(allTransactions, billingMonth, todayIso) : null),
    [allTransactions, billingMonth, todayIso],
  );

  const composition = useMemo(
    () => (allTransactions ? buildCategoryComposition(allTransactions, billingMonth) : []),
    [allTransactions, billingMonth],
  );

  const trends = useMemo(
    () => (allTransactions ? detectSpendingTrends(allTransactions) : []),
    [allTransactions],
  );
  const anomalies = useMemo(
    () => (allTransactions ? detectAnomalies(allTransactions) : []),
    [allTransactions],
  );
  const recurring = useMemo(
    () => (allTransactions ? detectRecurringCharges(allTransactions) : []),
    [allTransactions],
  );

  const health = useMemo(() => {
    if (!allTransactions) return null;
    return calculateFinancialHealth({
      transactions: allTransactions,
      receitaBase,
      reservaMinima: reserva,
      saldoAtual: saldoAtual || 0,
    });
  }, [allTransactions, receitaBase, reserva, saldoAtual]);

  const commitment = useMemo(
    () => (allTransactions ? calculateIncomeCommitment({ transactions: allTransactions, receitaBase }) : null),
    [allTransactions, receitaBase],
  );

  // Destaque do mês (top categoria) — vai pro KPI hero. Clicar leva pra
  // Transações filtradas por essa categoria + mês atual.
  const destaque = composition[0]
    ? {
        titulo: `Maior gasto: ${composition[0].categoria}`,
        valor: formatCurrency(composition[0].valor),
        onClick: () => {
          const params = new URLSearchParams({
            categoria: composition[0].categoria,
            mes: billingMonth,
            tipo: 'despesa',
          });
          navigate(`/transacoes?${params.toString()}`);
        },
      }
    : undefined;

  // ---------------------------------------------------------------------
  // Contextos pro Claude (montados uma vez, reusados nos cards)
  // ---------------------------------------------------------------------
  const deepCtx = useMemo(
    () => ({
      receitaBase,
      saldoAtual: saldoAtual || 0,
      reservaMinima: reserva,
      healthScore: health?.score,
      healthNivel: health?.nivel,
      monthlySummary: flow12.map((f) => ({
        mes: f.label,
        receita: f.receita,
        despesa: f.despesa,
        sobra: f.sobra,
      })),
      totalDespesa3m: periodCompare?.despesaRecente,
      totalDespesa3mPrev: periodCompare?.despesaAnterior,
      topCategories: composition.slice(0, 8).map((s) => ({
        cat: s.categoria,
        total: s.valor,
        pct: s.pct,
      })),
      spendingTrends: trends.filter((t) => t.tendencia !== 'estavel').slice(0, 8),
      anomalies: anomalies.slice(0, 5),
      recurringCharges: recurring.slice(0, 8),
      parcelasAtivas: kpisMes?.parcelasMes,
      commitmentAvg: commitment?.resumo.mediaComprometimento,
    }),
    [receitaBase, saldoAtual, reserva, health, flow12, periodCompare, composition, trends, anomalies, recurring, kpisMes, commitment],
  );

  const askCtx = useMemo(
    () => ({
      receitaBase,
      saldoAtual: saldoAtual || 0,
      despesaMes: kpisMes?.despesa,
      receitaMes: kpisMes?.receita,
      healthScore: health?.score,
      topCategories: composition.slice(0, 6).map((s) => ({ cat: s.categoria, total: s.valor })),
      parcelasAtivas: kpisMes?.parcelasMes,
      commitmentAvg: commitment?.resumo.mediaComprometimento,
      // Envia também os 12 meses completos pra Claude conseguir responder
      // perguntas como "quanto sobrou em fev?" sem cair em "não tenho esse dado".
      monthlyFlow: flow12.map((f) => ({ mes: f.label, receita: f.receita, despesa: f.despesa, sobra: f.sobra })),
    }),
    [receitaBase, saldoAtual, kpisMes, health, composition, commitment, flow12],
  );

  if (isLoading || !allTransactions) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-16" /></CardContent></Card>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="md:col-span-2"><CardContent className="p-6"><Skeleton className="h-64" /></CardContent></Card>
          <Card><CardContent className="p-6"><Skeleton className="h-64" /></CardContent></Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Análises</h1>
          <p className="text-sm text-muted-foreground">Visão profunda dos últimos 12 meses + IA por Claude</p>
        </div>
        <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
      </div>

      {/* 1. Hero KPIs */}
      <KpiHeroStrip
        saldoLivreMes={kpisMes?.saldoLivre || 0}
        taxaPoupanca={kpisMes?.taxaPoupanca || 0}
        healthScore={health?.score || 0}
        healthNivel={health?.nivel || '—'}
        destaqueMes={destaque}
      />

      {/* 2. Charts: fluxo 12m + composição categorias */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <CashflowChart
            flow={flow12}
            description={
              periodCompare
                ? `3 últimos vs 3 anteriores: receita ${periodCompare.deltaReceita >= 0 ? '+' : ''}${periodCompare.deltaReceita.toFixed(0)}% · despesa ${periodCompare.deltaDespesa >= 0 ? '+' : ''}${periodCompare.deltaDespesa.toFixed(0)}%`
                : undefined
            }
          />
        </div>
        <CategoryComposition slices={composition} description={`Despesas do mês ${billingMonth} (clique pra ver lançamentos)`} drillDownMes={billingMonth} />
      </div>

      {/* 3. Insights: tendências + anomalias + recorrentes */}
      <div className="grid gap-4 md:grid-cols-3">
        <TrendsList trends={trends} drillDownMes={billingMonth} />
        <AnomaliesList anomalies={anomalies} />
        <RecurringChargesList charges={recurring} />
      </div>

      {/* 4. IA Claude — análise profunda + Q&A */}
      <div className="grid gap-4 md:grid-cols-2">
        <DeepAnalysisCard
          context={deepCtx}
          mode="analises_deep_analysis"
          title="Análise profunda — Claude Sonnet"
          description="Tese, riscos, oportunidades e ação imediata a partir dos seus 12 meses"
          buttonLabel="Gerar análise"
        />
        <AskClaudeCard baseContext={askCtx} />
      </div>
    </div>
  );
}
