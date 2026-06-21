import { useState, useMemo } from 'react';
import { usePersistedMonth } from '@/hooks/usePersistedMonth';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTodayIso } from '@/hooks/useTodayIso';
import { getMonthRange, formatCurrency, getMonthName } from '@/lib/format';
import { getCategoriaColor } from '@/types/database.types';
import { useCategorias } from '@/hooks/useCategorias';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, BarChart3, ChevronDown, ChevronUp, CreditCard } from 'lucide-react';
import { MonthSelector } from '@/components/MonthSelector';
import { ParcelasTimeline } from '@/components/dashboard/ParcelasTimeline';
import { FaturaDrawer } from '@/components/dashboard/FaturaDrawer';
import { ProximosVencimentos } from '@/components/dashboard/ProximosVencimentos';
import { QuickDateFixAlert } from '@/components/dashboard/QuickDateFixAlert';
import { ManualTransactionModal } from '@/components/contas/ManualTransactionModal';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useFontesReceita } from '@/hooks/useFontesReceita';
import { useFaturaAcumulada } from '@/hooks/useFaturaAcumulada';
import { CardFatura } from '@/components/CardFatura';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { calcularSaldoTotal } from '@/lib/saldo';
import { eRealizada, ePendente } from '@/lib/transacao-filters';
import { useTransacoesMes, useTransacoesPeriodo } from '@/hooks/useTransacoesMes';
import { useVencimentos } from '@/hooks/useVencimentos';
import { buildVencimentosFatura } from '@/lib/vencimentos';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { getParentForCategoria } = useCategorias();
  const now = new Date();
  const { month, year, setMonth, setYear } = usePersistedMonth();
  const [categoriasExpanded, setCategoriasExpanded] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const { start, end } = getMonthRange(month, year);

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

  const billingMonth = `${year}-${String(month + 1).padStart(2, '0')}`;

  // Transações do mês visíveis no Dashboard (exclui transferência interna e
  // pagamento de fatura via ignorar_dashboard=false). Único caminho — query
  // unificada em useTransacoesMes.
  const { data: transacoesMes, isLoading } = useTransacoesMes(month, year, {
    apenasVisivelDashboard: true,
    cachePrefix: 'dashboard',
  });

  // Credit card invoice data
  const { data: contas } = useQuery({
    queryKey: ['contas', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('contas').select('*').eq('user_id', user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  // Memoizados pra estabilizar referência — sem isso, cada render gera novo
  // array, derrubando o useMemo de vencimentosFatura e recalculando vencimentos
  // em 2 consumers (hero + widget) a cada render.
  const creditCards = useMemo(() => contas?.filter(c => c.tipo === 'credito') || [], [contas]);
  const cardIds = useMemo(() => creditCards.map(c => c.id), [creditCards]);

  const { data: faturaAcumulada } = useFaturaAcumulada(cardIds, billingMonth);

  // Parcelas do ano todo — usa useTransacoesPeriodo (mesma SSOT do useTransacoesMes,
  // só com range maior). Antes duplicava o padrão inline.
  const { data: parcelasAno } = useTransacoesPeriodo({
    inicioComp: `${year}-01`,
    fimComp: `${year}-12`,
    inicioData: `${year}-01-01`,
    fimData: `${year}-12-31`,
    apenasVisivelDashboard: true,
    apenasParceladas: true,
    cachePrefix: 'parcelas-ano',
  });

  // Current balance across accounts
  // Today's ISO date (auto-refreshes across midnight / on tab focus) — used to
  // exclude future-dated transactions (projected salary, installments scheduled
  // for upcoming months, etc.) so saldo reflects money actually landed.
  const todayIso = useTodayIso();
  const { data: saldoAtual } = useQuery({
    queryKey: ['dashboard', 'saldo-total', user?.id, todayIso],
    queryFn: async () => {
      const { data: contasList } = await supabase.from('contas').select('id, saldo_inicial, tipo, data_abertura').eq('user_id', user!.id);
      if (!contasList?.length) return null; // user sem nenhuma conta — Hero mostra guidance
      const debitAccounts = contasList.filter(c => c.tipo === 'debito');
      // Sem conta débito = não dá pra calcular "saldo bancário". Retorna null
      // pra Hero exibir CTA "Cadastre uma conta corrente" em vez de R$ 0,00
      // (que engana quem só tem cartões cadastrados).
      if (!debitAccounts.length) return null;
      const debitIds = debitAccounts.map(c => c.id);
      const txs = await fetchAllRows<{ conta_id: string; valor: number; tipo: string; pago?: boolean; categoria?: string; ignorar_dashboard?: boolean }>(() => supabase
        .from('transacoes')
        .select('conta_id, valor, tipo, pago, categoria, ignorar_dashboard')
        .in('conta_id', debitIds)
        .eq('user_id', user!.id)
        .lte('data', todayIso));
      return calcularSaldoTotal(debitAccounts, txs);
    },
    enabled: !!user,
  });

  // Saldo anterior = balance across debit accounts strictly BEFORE the current billing month's start.
  const { data: saldoAnterior } = useQuery({
    queryKey: ['dashboard', 'saldo-anterior', user?.id, start],
    queryFn: async () => {
      const { data: contasList } = await supabase.from('contas').select('id, saldo_inicial, tipo, data_abertura').eq('user_id', user!.id);
      if (!contasList?.length) return 0;
      const debitAccounts = contasList.filter(c => c.tipo === 'debito');
      const debitIds = debitAccounts.map(c => c.id);
      if (!debitIds.length) {
        return debitAccounts
          .filter(c => !c.data_abertura || c.data_abertura < start)
          .reduce((s, c) => s + (c.saldo_inicial || 0), 0);
      }
      const txs = await fetchAllRows<{ conta_id: string; valor: number; tipo: string; pago?: boolean; categoria?: string; ignorar_dashboard?: boolean }>(() => supabase
        .from('transacoes')
        .select('conta_id, valor, tipo, pago, categoria, ignorar_dashboard')
        .in('conta_id', debitIds)
        .eq('user_id', user!.id)
        .lt('data', start));
      // Saldo inicial só conta se conta foi aberta ESTRITAMENTE antes do mês —
      // usa cutoffExclusive=true em vez do hack contasAjustadas anterior.
      return calcularSaldoTotal(debitAccounts, txs, { cutoffDate: start, cutoffExclusive: true });
    },
    enabled: !!user,
  });

  const { receitaBase } = useFontesReceita();
  const reserva = config?.reserva_minima || 2000;

  // Realizado vs pendente — usa predicates centrais (lib/transacao-filters)
  // pra garantir mesmo critério em todo lugar.
  const totalDespesas = transacoesMes?.filter(t => t.tipo === 'despesa' && eRealizada(t)).reduce((s, t) => s + Number(t.valor), 0) || 0;
  const totalReceitas = transacoesMes?.filter(t => t.tipo === 'receita' && eRealizada(t)).reduce((s, t) => s + Number(t.valor), 0) || 0;
  const totalDespesasPendentes = transacoesMes?.filter(t => t.tipo === 'despesa' && ePendente(t)).reduce((s, t) => s + Number(t.valor), 0) || 0;
  const totalReceitasPendentes = transacoesMes?.filter(t => t.tipo === 'receita' && ePendente(t)).reduce((s, t) => s + Number(t.valor), 0) || 0;

  // Comparativo com mês anterior — totais do mês passado pra mostrar
  // "↑ 12% vs mês passado" estilo Mobills.
  const mesAnterior = month === 0
    ? { month: 11, year: year - 1 }
    : { month: month - 1, year };
  // Reusa o mesmo hook centralizado pro mês anterior — mesma regra de
  // competência aplicada simétrica, sem risco de divergência.
  const { data: txsMesAnt } = useTransacoesMes(mesAnterior.month, mesAnterior.year, {
    apenasVisivelDashboard: true,
    cachePrefix: 'dashboard-anterior',
  });
  const totaisMesAnt = useMemo(() => {
    if (!txsMesAnt) return { receitas: 0, despesas: 0 };
    const receitas = txsMesAnt.filter(t => t.tipo === 'receita' && eRealizada(t)).reduce((s, t) => s + Number(t.valor), 0);
    const despesas = txsMesAnt.filter(t => t.tipo === 'despesa' && eRealizada(t)).reduce((s, t) => s + Number(t.valor), 0);
    return { receitas, despesas };
  }, [txsMesAnt]);
  // Calcula variação % vs mês anterior. Null se não tem base de comparação.
  const variacao = (atual: number, anterior: number): number | null => {
    if (!anterior || anterior === 0) return null;
    return ((atual - anterior) / anterior) * 100;
  };
  const varReceitas = variacao(totalReceitas, totaisMesAnt?.receitas || 0);
  const varDespesas = variacao(totalDespesas, totaisMesAnt?.despesas || 0);

  // Orçamento por categoria — busca metas planejadas pra mostrar progresso
  // visual no Dashboard estilo Mobills. Mostra só as categorias com meta > 0.
  const { data: planejamento } = useQuery({
    queryKey: ['dashboard', 'planejamento', user?.id, billingMonth],
    queryFn: async () => {
      // Coluna real é `valor_planejado` (não `valor`). Antes usava `valor`
      // e a query 400ava silenciosamente — o card de orçamento nunca aparecia.
      const { data } = await supabase
        .from('planejamento_categorias')
        .select('categoria_nome, valor_planejado')
        .eq('user_id', user!.id)
        .eq('mes', billingMonth)
        .gt('valor_planejado', 0);
      return data || [];
    },
    enabled: !!user,
  });
  // Calcula o gasto real por categoria pra cruzar com a meta
  const gastoPorCategoria = useMemo(() => {
    const m: Record<string, number> = {};
    (transacoesMes || []).forEach(t => {
      if (t.tipo !== 'despesa') return;
      const cat = t.categoria || 'Outros';
      m[cat] = (m[cat] || 0) + Number(t.valor);
    });
    return m;
  }, [transacoesMes]);
  const orcamentosComProgresso = useMemo(() => {
    return (planejamento || [])
      .map(p => ({
        categoria: p.categoria_nome,
        meta: Number(p.valor_planejado),
        gasto: gastoPorCategoria[p.categoria_nome] || 0,
        pct: ((gastoPorCategoria[p.categoria_nome] || 0) / Number(p.valor_planejado)) * 100,
      }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 6);
  }, [planejamento, gastoPorCategoria]);

  // Contas a pagar/receber pendentes do mês
  const { data: contasPR } = useQuery({
    queryKey: ['dashboard', 'contas-pr', user?.id, billingMonth],
    queryFn: async () => {
      const { data } = await supabase
        .from('contas_pagar_receber')
        .select('*')
        .eq('user_id', user!.id)
        .eq('mes', billingMonth)
        .eq('pago', false);
      return data || [];
    },
    enabled: !!user,
  });

  const totalAPagar = (contasPR || []).filter((c: any) => c.tipo === 'pagar').reduce((s: number, c: any) => s + Number(c.valor), 0);
  const totalAReceber = (contasPR || []).filter((c: any) => c.tipo === 'receber').reduce((s: number, c: any) => s + Number(c.valor), 0);

  // Vencimentos de fatura: cartões com totalAPagar > 0 e dia_vencimento
  // dentro da janela de 30d. Calculado aqui pra reusar contas + faturaAcumulada
  // que já estão em cache (React Query dedup).
  const vencimentosFatura = useMemo(
    () => buildVencimentosFatura(creditCards, faturaAcumulada || {}, todayIso, 30),
    [creditCards, faturaAcumulada, todayIso]
  );
  // Vencimentos dos próximos 30 dias — usado pra calcular "Disponível pra
  // gastar hoje". Inclui faturas de cartão (Mobills-like): se Black vence em
  // 8d com R$ 3k, o headline já subtrai isso.
  const { impacto: impactoVenc } = useVencimentos(30, vencimentosFatura);
  // "Disponível pra gastar hoje" = saldo atual − despesas pendentes próximas
  // + receitas pendentes próximas. Quando saldoAtual é null (sem conta
  // débito) NÃO calcula — Hero mostra CTA em vez disso.
  const disponivelHoje = saldoAtual != null ? saldoAtual + impactoVenc.impactoLiquido : null;
  const semContaDebito = saldoAtual === null;

  // Disponível no mês = saldo anterior + receitas REALIZADAS - despesas REALIZADAS.
  // MESMA definição da página Análises (antes o Dashboard somava a receber e
  // subtraía a pagar, dando um número diferente sob o mesmo rótulo). "A pagar"/"a
  // receber" continuam como contexto informativo no subtítulo, mas não entram no
  // headline — "disponível" é o que já se realizou, não a projeção de fim de mês.
  const disponivel = (saldoAnterior || 0) + totalReceitas - totalDespesas;
  // Totais REAIS pro mês: somando realizado + previsto. O card "Gastos do mês"
  // tem que enxergar o que JÁ pagou + o que VAI pagar (parcelas futuras,
  // contas pendentes). Antes mostrava só realizado e escondia compromisso.
  const totalDespesasComPrev = totalDespesas + totalDespesasPendentes;
  const totalReceitasComPrev = totalReceitas + totalReceitasPendentes;
  const percentGasto = totalReceitasComPrev > 0
    ? (totalDespesasComPrev / totalReceitasComPrev) * 100
    : (totalDespesasComPrev > 0 ? 100 : 0);

  const categorias = transacoesMes
    ?.filter(t => t.tipo === 'despesa')
    .reduce((acc, t) => {
      // Group by parent category when categoria_id is available
      let catName = t.categoria;
      let catColor = getCategoriaColor(catName);
      if (t.categoria_id) {
        const parent = getParentForCategoria(t.categoria_id);
        if (parent) {
          catName = parent.nome;
          catColor = parent.cor || getCategoriaColor(catName);
        }
      }
      if (!acc[catName]) acc[catName] = { total: 0, essencial: t.essencial, color: catColor };
      acc[catName].total += Number(t.valor);
      return acc;
    }, {} as Record<string, { total: number; essencial: boolean; color: string }>) || {};

  const categoryRanking = Object.entries(categorias)
    .map(([cat, { total, essencial, color }]) => ({ cat, total, essencial, color, pct: totalDespesas > 0 ? (total / totalDespesas) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);

  const totalEssencial = transacoesMes?.filter(t => t.tipo === 'despesa' && t.essencial).reduce((s, t) => s + Number(t.valor), 0) || 0;
  const totalNaoEssencial = totalDespesas - totalEssencial;
  const pctEssencial = totalDespesas > 0 ? (totalEssencial / totalDespesas) * 100 : 0;

  const [faturaDrawer, setFaturaDrawer] = useState<{ open: boolean; cardId: string; cardName: string }>({ open: false, cardId: '', cardName: '' });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}><CardContent className="p-6"><Skeleton className="h-32" /></CardContent></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setManualOpen(true)}
            className="gap-1.5 rounded-full"
          >
            <Plus className="h-4 w-4" />
            Novo Lançamento
          </Button>
          <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
        </div>
      </div>

      {/* HERO — "Disponível pra gastar hoje" como headline (resposta direta à
          pergunta-âncora). Saldo atual fica em pill secundária.
          Se user não cadastrou conta corrente, mostra CTA em vez de R$ 0,00. */}
      <Card className="overflow-hidden">
        <CardContent className="p-5 md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              {semContaDebito ? (
                <>
                  <p className="text-sm text-muted-foreground uppercase tracking-wider">Saldo</p>
                  <p className="num-hero text-3xl md:text-4xl text-muted-foreground">—</p>
                  <p className="text-sm text-muted-foreground">
                    Você ainda não cadastrou uma conta corrente.{' '}
                    <button
                      type="button"
                      onClick={() => navigate('/contas')}
                      className="text-primary underline hover:no-underline"
                    >
                      Cadastrar agora →
                    </button>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Disponível pra gastar</p>
                  <p className={`num-hero text-4xl md:text-5xl ${(disponivelHoje ?? 0) >= 0 ? 'text-primary' : 'text-destructive'}`}>
                    {formatCurrency(disponivelHoje ?? 0)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Saldo atual de <span className="tabular font-medium text-foreground">{formatCurrency(saldoAtual ?? 0)}</span>
                    {impactoVenc.impactoLiquido !== 0 && (
                      <> {impactoVenc.impactoLiquido < 0 ? '−' : '+'} {formatCurrency(Math.abs(impactoVenc.impactoLiquido))} previstos em 30d</>
                    )}
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate('/transacoes?tipo=receita')}
                className="pill"
              >
                <span className="h-2 w-2 rounded-full bg-primary" />
                <span className="text-xs text-muted-foreground">Receitas</span>
                <span className="text-sm font-semibold tabular">{formatCurrency(totalReceitas)}</span>
                {varReceitas != null && Math.abs(varReceitas) >= 1 && (
                  <span className={`text-[10px] font-medium tabular ${varReceitas >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {varReceitas >= 0 ? '↑' : '↓'} {Math.abs(varReceitas).toFixed(0)}%
                  </span>
                )}
              </button>
              <button
                onClick={() => navigate('/transacoes?tipo=despesa')}
                className="pill"
              >
                <span className="h-2 w-2 rounded-full bg-destructive" />
                <span className="text-xs text-muted-foreground">Despesas</span>
                <span className="text-sm font-semibold tabular">{formatCurrency(totalDespesas)}</span>
                {varDespesas != null && Math.abs(varDespesas) >= 1 && (
                  <span className={`text-[10px] font-medium tabular ${varDespesas <= 0 ? 'text-success' : 'text-destructive'}`}>
                    {varDespesas >= 0 ? '↑' : '↓'} {Math.abs(varDespesas).toFixed(0)}%
                  </span>
                )}
              </button>
              {(totalDespesasPendentes > 0 || totalReceitasPendentes > 0) && (
                <button
                  onClick={() => navigate('/transacoes?status=pendente')}
                  className="pill"
                  title="Lançamentos com status pendente neste mês"
                >
                  <span className="h-2 w-2 rounded-full bg-warning" />
                  <span className="text-xs text-muted-foreground">Pendentes</span>
                  <span className="text-sm font-semibold tabular">
                    {totalReceitasPendentes > 0 && `+${formatCurrency(totalReceitasPendentes)}`}
                    {totalReceitasPendentes > 0 && totalDespesasPendentes > 0 && ' / '}
                    {totalDespesasPendentes > 0 && `-${formatCurrency(totalDespesasPendentes)}`}
                  </span>
                </button>
              )}
              {(totalAPagar > 0 || totalAReceber > 0) && (
                <button
                  onClick={() => navigate('/a-pagar-receber')}
                  className="pill"
                >
                  <span className="h-2 w-2 rounded-full bg-warning" />
                  <span className="text-xs text-muted-foreground">A pagar/receber</span>
                  <span className="text-sm font-semibold tabular">{formatCurrency(totalAPagar + totalAReceber)}</span>
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Faturas dos cartões — logo abaixo do "Disponível pra gastar", porque
          é o que mais pesa no dia a dia (resposta direta a "quanto devo nos
          cartões?"). */}
      {creditCards.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {creditCards.map(card => {
            const fatura = faturaAcumulada?.[card.id] || { saldoAnterior: 0, despesasMes: 0, pagamentosMes: 0, totalAPagar: 0, valorFatura: 0 };
            return (
              <CardFatura
                key={card.id}
                cardId={card.id}
                cardName={card.nome}
                diaVencimento={card.dia_vencimento}
                month={month}
                fatura={fatura}
                onCardClick={() => setFaturaDrawer({ open: true, cardId: card.id, cardName: card.nome })}
                compact
              />
            );
          })}
        </div>
      )}

      {/* Métricas secundárias em grid de 3 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="cursor-pointer hover-lift group" onClick={() => navigate('/transacoes?tipo=despesa')}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Gastos do mês</p>
            <p className="num-display text-2xl md:text-3xl text-foreground">{formatCurrency(totalDespesasComPrev)}</p>
            {totalDespesasPendentes > 0 && (
              <p className="text-[11px] text-muted-foreground tabular mt-0.5">
                {formatCurrency(totalDespesas)} pago · +{formatCurrency(totalDespesasPendentes)} previsto
              </p>
            )}
            <div className="mt-2.5 space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{percentGasto.toFixed(0)}% da receita</span>
                <span className="tabular">{formatCurrency(totalReceitasComPrev)} entr.</span>
              </div>
              <Progress value={Math.min(percentGasto, 100)} className="h-1.5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Disponível no mês</p>
            <p className={`num-display text-2xl md:text-3xl ${disponivel >= 0 ? 'text-primary' : 'text-destructive'}`}>
              {formatCurrency(disponivel)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {(saldoAnterior || 0) >= 0 ? '+' : ''}{formatCurrency(saldoAnterior || 0)} do mês anterior
            </p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover-lift" onClick={() => navigate('/transacoes')}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Transações</p>
            <p className="num-display text-2xl md:text-3xl text-foreground">{transacoesMes?.length || 0}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {transacoesMes?.filter(t => t.tipo === 'receita').length || 0} entradas · {transacoesMes?.filter(t => t.tipo === 'despesa').length || 0} saídas
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Correção one-time: lançamentos rápidos antigos com data=hoje em vez do
          mês da fatura. Some sozinho quando não há mais o que corrigir. */}
      <QuickDateFixAlert />

      {/* Próximos vencimentos — widget que responde "o que sai/cai nos
          próximos dias?". Inclui transações pendentes + contas_pagar_receber
          + faturas de cartão prestes a vencer. */}
      <ProximosVencimentos saldoAtual={saldoAtual ?? undefined} vencimentosExtras={vencimentosFatura} />

      {/* Orçamento por categoria — progresso visual estilo Mobills.
          Top 6 categorias com meta planejada, ordenadas por % consumido. */}
      {orcamentosComProgresso.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Orçamento do mês</p>
                <p className="text-sm font-medium mt-0.5">Acompanhamento por categoria</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/planejamento')}
                className="text-xs rounded-full"
              >
                Editar metas
              </Button>
            </div>
            <div className="space-y-3">
              {orcamentosComProgresso.map(item => {
                const pctClamped = Math.min(item.pct, 100);
                const overBudget = item.pct > 100;
                const aproximando = item.pct >= 80 && item.pct <= 100;
                const barClass = overBudget
                  ? 'bg-destructive'
                  : aproximando
                    ? 'bg-warning'
                    : 'bg-primary';
                return (
                  <button
                    key={item.categoria}
                    type="button"
                    onClick={() => navigate(`/transacoes?categoria=${encodeURIComponent(item.categoria)}&mes=${billingMonth}&tipo=despesa`)}
                    className="w-full text-left rounded-xl p-3 bg-secondary/30 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium truncate">{item.categoria}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs tabular text-muted-foreground">
                          {formatCurrency(item.gasto)} / {formatCurrency(item.meta)}
                        </span>
                        <span className={`text-xs font-semibold tabular ${overBudget ? 'text-destructive' : aproximando ? 'text-warning' : 'text-muted-foreground'}`}>
                          {item.pct.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                        style={{ width: `${pctClamped}%` }}
                      />
                      {overBudget && (
                        <div
                          className="h-full -mt-1.5 rounded-full bg-destructive/40"
                          style={{ width: `${Math.min(item.pct - 100, 30)}%` }}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Ranking de Categorias</h3>
            </div>
            {categoryRanking.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma despesa este mês</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                  {(categoriasExpanded ? categoryRanking : categoryRanking.slice(0, 8)).map(({ cat, total, pct, color }) => (
                    <button
                      key={cat}
                      className="flex items-center justify-between w-full hover:bg-muted/50 rounded-md px-1.5 py-1 -mx-1.5 transition-colors cursor-pointer text-left min-w-0"
                      onClick={() => navigate(`/transacoes?categoria=${encodeURIComponent(cat)}&mes=${billingMonth}&tipo=despesa`)}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-sm truncate">{cat}</span>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <span className="text-sm font-medium tabular">{formatCurrency(total)}</span>
                        <span className="text-xs text-muted-foreground ml-1.5">{pct.toFixed(0)}%</span>
                      </div>
                    </button>
                  ))}
                </div>
                {categoryRanking.length > 8 && (
                  <button
                    onClick={() => setCategoriasExpanded(!categoriasExpanded)}
                    className="mt-2 w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 border-t"
                  >
                    {categoriasExpanded
                      ? <>Mostrar menos <ChevronUp className="h-3.5 w-3.5" /></>
                      : <>Ver todas ({categoryRanking.length}) <ChevronDown className="h-3.5 w-3.5" /></>}
                  </button>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <ParcelasTimeline parcelas={parcelasAno || []} />


        <Card className="md:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Essenciais vs Não-Essenciais</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-2">
              <button
                type="button"
                className="cursor-pointer hover:bg-muted/50 rounded-md px-1.5 py-1 -mx-1.5 transition-colors text-left"
                onClick={() => navigate('/transacoes?essencial=true')}
              >
                <p className="text-xs text-muted-foreground">Essenciais · {pctEssencial.toFixed(0)}% <span className="opacity-60">(meta 70%)</span></p>
                <p className="text-lg font-bold tabular text-success">{formatCurrency(totalEssencial)}</p>
              </button>
              <button
                type="button"
                className="cursor-pointer hover:bg-muted/50 rounded-md px-1.5 py-1 -mx-1.5 transition-colors text-left"
                onClick={() => navigate('/transacoes?essencial=false')}
              >
                <p className="text-xs text-muted-foreground">Não-essenciais · {(100 - pctEssencial).toFixed(0)}% <span className="opacity-60">(meta 30%)</span></p>
                <p className="text-lg font-bold tabular text-warning">{formatCurrency(totalNaoEssencial)}</p>
              </button>
            </div>
            <div className="relative h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-success/50 rounded-full transition-all"
                style={{ width: `${pctEssencial}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <FaturaDrawer
        open={faturaDrawer.open}
        onOpenChange={(open) => setFaturaDrawer(prev => ({ ...prev, open }))}
        cardId={faturaDrawer.cardId}
        cardName={faturaDrawer.cardName}
        start={start}
        end={end}
        month={month}
        year={year}
      />

      <ManualTransactionModal
        open={manualOpen}
        onOpenChange={setManualOpen}
      />
    </div>
  );
}
