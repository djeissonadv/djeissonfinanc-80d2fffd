import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTodayIso } from '@/hooks/useTodayIso';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { useFontesReceita } from '@/hooks/useFontesReceita';
import { MonthSelector } from '@/components/MonthSelector';
import { SmartInsightsCard } from '@/components/dashboard/SmartInsightsCard';
import { FinancialHealthCard } from '@/components/dashboard/FinancialHealthCard';
import { AiInsightsCard } from '@/components/dashboard/AiInsightsCard';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { TransactionRecord } from '@/lib/projection-engine';
import { detectSpendingTrends, detectAnomalies, detectRecurringCharges } from '@/lib/spending-patterns';
import { calculateFinancialHealth } from '@/lib/financial-health';
import { calculateIncomeCommitment } from '@/lib/income-commitment';
import { getMonthRange, formatCurrency } from '@/lib/format';
import { CATEGORIAS_CONFIG, getCategoriaColor } from '@/types/database.types';
import { useCategorias } from '@/hooks/useCategorias';

export default function AnalisesPage() {
  const { user } = useAuth();
  const { getParentForCategoria } = useCategorias();
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
      const { data } = await supabase
        .from('configuracoes')
        .select('*')
        .eq('user_id', user!.id)
        .single();
      return data;
    },
    enabled: !!user,
  });

  const reserva = config?.reserva_minima || 2000;

  // Current month transactions
  const { data: transacoesMes } = useQuery({
    queryKey: ['analises', 'transacoes-mes', user?.id, start, end, billingMonth],
    queryFn: async () => {
      const byCompetencia = await fetchAllRows(() => supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .eq('ignorar_dashboard', false)
        .eq('mes_competencia', billingMonth));

      const byDate = await fetchAllRows(() => supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .eq('ignorar_dashboard', false)
        .is('mes_competencia', null)
        .gte('data', start)
        .lte('data', end));

      const all = [...byCompetencia, ...byDate];
      const seen = new Set<string>();
      return all.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
    },
    enabled: !!user,
  });

  // All transactions for pattern analysis (last 12 months)
  const { data: allTransactions, isLoading } = useQuery({
    queryKey: ['analises', 'all-transacoes', user?.id],
    queryFn: async () => {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const startDate = `${oneYearAgo.getFullYear()}-${String(oneYearAgo.getMonth() + 1).padStart(2, '0')}-01`;
      const data = await fetchAllRows<TransactionRecord>(() => supabase
        .from('transacoes')
        .select('data, mes_competencia, descricao, valor, tipo, categoria, categoria_id, parcela_atual, parcela_total, grupo_parcela, ignorar_dashboard, essencial, conta_id')
        .eq('user_id', user!.id)
        .gte('data', startDate));
      return data;
    },
    enabled: !!user,
  });

  // Saldo atual — mirrors Dashboard: all debit-account transactions up to today
  // (future-dated entries excluded), including ignorar_dashboard ones (fatura
  // payments are internal transfers but still move the bank balance).
  const { data: saldoAtual } = useQuery({
    queryKey: ['analises', 'saldo-total', user?.id, todayIso],
    queryFn: async () => {
      const { data: contasList } = await supabase.from('contas').select('id, saldo_inicial, tipo').eq('user_id', user!.id);
      if (!contasList?.length) return 0;
      const debitAccounts = contasList.filter(c => c.tipo === 'debito');
      let total = debitAccounts.reduce((s, c) => s + (c.saldo_inicial || 0), 0);
      for (const conta of debitAccounts) {
        const txs = await fetchAllRows<{ valor: number; tipo: string }>(() => supabase.from('transacoes').select('valor, tipo').eq('conta_id', conta.id).eq('user_id', user!.id).lte('data', todayIso));
        for (const t of txs) {
          total += t.tipo === 'receita' ? Number(t.valor) : -Number(t.valor);
        }
      }
      return total;
    },
    enabled: !!user,
  });

  // Saldo anterior — balance across debit accounts strictly before the selected
  // month's start. Same logic as Dashboard so the two pages agree.
  const { data: saldoAnterior } = useQuery({
    queryKey: ['analises', 'saldo-anterior', user?.id, start],
    queryFn: async () => {
      const { data: contasList } = await supabase.from('contas').select('id, saldo_inicial, tipo, data_abertura').eq('user_id', user!.id);
      if (!contasList?.length) return 0;
      const debitAccounts = contasList.filter(c => c.tipo === 'debito');
      let total = debitAccounts.reduce((s, c) => {
        if (!c.data_abertura || c.data_abertura < start) return s + (c.saldo_inicial || 0);
        return s;
      }, 0);
      for (const conta of debitAccounts) {
        const txs = await fetchAllRows<{ valor: number; tipo: string }>(() => supabase.from('transacoes').select('valor, tipo').eq('conta_id', conta.id).eq('user_id', user!.id).lt('data', start));
        for (const t of txs) {
          total += t.tipo === 'receita' ? Number(t.valor) : -Number(t.valor);
        }
      }
      return total;
    },
    enabled: !!user,
  });

  // Credit cards for pending faturas count
  const { data: contas } = useQuery({
    queryKey: ['contas', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('contas').select('*').eq('user_id', user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  const creditCards = contas?.filter(c => c.tipo === 'credito') || [];

  const totalDespesas = transacoesMes?.filter(t => t.tipo === 'despesa').reduce((s, t) => s + Number(t.valor), 0) || 0;
  const totalReceitas = transacoesMes?.filter(t => t.tipo === 'receita').reduce((s, t) => s + Number(t.valor), 0) || 0;
  const percentGasto = totalReceitas > 0 ? (totalDespesas / totalReceitas) * 100 : (totalDespesas > 0 ? 100 : 0);
  const totalEssencial = transacoesMes?.filter(t => t.tipo === 'despesa' && t.essencial).reduce((s, t) => s + Number(t.valor), 0) || 0;
  const totalNaoEssencial = totalDespesas - totalEssencial;
  const pctEssencial = totalDespesas > 0 ? (totalEssencial / totalDespesas) * 100 : 0;
  // Disponível no mês = saldo anterior + receitas do mês - despesas do mês.
  // (Mesma definição do Dashboard, sem o componente de contas a pagar/receber,
  // que não é carregado nesta página de análise.)
  const disponivel = (saldoAnterior || 0) + totalReceitas - totalDespesas;

  const categoryRanking = Object.entries(
    transacoesMes
      ?.filter(t => t.tipo === 'despesa')
      .reduce((acc, t) => {
        let catName = t.categoria;
        let catColor = getCategoriaColor(catName);
        if (t.categoria_id) {
          const parent = getParentForCategoria(t.categoria_id);
          if (parent) {
            catName = parent.nome;
            catColor = parent.cor || getCategoriaColor(catName);
          }
        }
        if (!acc[catName]) acc[catName] = { total: 0, color: catColor };
        acc[catName].total += Number(t.valor);
        return acc;
      }, {} as Record<string, { total: number; color: string }>) || {}
  )
    .map(([cat, { total, color }]) => ({ cat, total, color, pct: totalDespesas > 0 ? (total / totalDespesas) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2, 3].map(i => (
          <Card key={i}><CardContent className="p-6"><Skeleton className="h-32" /></CardContent></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Análises</h1>
        <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <AiInsightsCard context={{
          receita: receitaBase,
          totalDespesas,
          totalReceitas,
          disponivel,
          percentGasto,
          reserva,
          totalEssencial,
          totalNaoEssencial,
          pctEssencial,
          topCategorias: categoryRanking.slice(0, 5),
          parcelasAtivas: allTransactions?.filter(t => t.parcela_total && t.parcela_total > 1).length,
          faturasPendentes: 0,
          ...(allTransactions && allTransactions.length > 0 ? (() => {
            const trends = detectSpendingTrends(allTransactions);
            const anomalies = detectAnomalies(allTransactions);
            const recurring = detectRecurringCharges(allTransactions);
            const health = calculateFinancialHealth({ transactions: allTransactions, receitaBase, reservaMinima: reserva, saldoAtual: saldoAtual || 0 });
            const commitment = calculateIncomeCommitment({ transactions: allTransactions, receitaBase });
            return {
              spendingTrends: trends.filter(t => t.tendencia !== 'estavel').slice(0, 5),
              anomalies: anomalies.slice(0, 3),
              recurringCharges: recurring.slice(0, 10),
              healthScore: health.score,
              healthNivel: health.nivel,
              commitmentAvg: commitment.resumo.mediaComprometimento,
              commitmentTrend: commitment.resumo.tendencia,
            };
          })() : {}),
        }} />

        {allTransactions && allTransactions.length > 0 && (
          <SmartInsightsCard
            transactions={allTransactions}
            receitaBase={receitaBase}
          />
        )}

        {allTransactions && allTransactions.length > 0 && (
          <FinancialHealthCard
            transactions={allTransactions}
            receitaBase={receitaBase}
            reservaMinima={reserva}
            saldoAtual={saldoAtual || 0}
          />
        )}
      </div>
    </div>
  );
}
