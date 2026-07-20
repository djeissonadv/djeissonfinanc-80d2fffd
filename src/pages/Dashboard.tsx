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

  // Base ÚNICA pro ranking e pro essenciais: soma de TODAS as despesas do mês
  // (mesmas que alimentam as categorias). Antes o % usava totalDespesas (só
  // realizado) com numerador incluindo pendentes → os % não fechavam 100%.
  const totalDespesasMes = Object.values(categorias).reduce((s, c) => s + c.total, 0);

  const categoryRanking = Object.entries(categorias)
    .map(([cat, { total, essencial, color }]) => ({ cat, total, essencial, color, pct: totalDespesasMes > 0 ? (total / totalDespesasMes) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);

  const totalEssencial = transacoesMes?.filter(t => t.tipo === 'despesa' && t.essencial).reduce((s, t) => s + Number(t.valor), 0) || 0;
  const totalNaoEssencial = Math.max(0, totalDespesasMes - totalEssencial);
  const pctEssencial = totalDespesasMes > 0 ? (totalEssencial / totalDespesasMes) * 100 : 0;

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

  const nomeMesAtual = `${getMonthName(month)} de ${year}`;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{nomeMesAtual}</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
          <Button size="sm" onClick={() => setManualOpen(true)} className="h-8 gap-1.5">
            <Plus className="h-4 w-4" />
            Lançar
          </Button>
        </div>
      </div>

      {/* HERO — sem card: o número É o design. Envolvê-lo numa caixa só
          adiciona moldura e o iguala às outras seções; solto na página ele
          domina sozinho, que é o papel dele. Responde a pergunta-âncora
          ("quanto posso gastar?") antes de qualquer outra coisa. */}
      <section>
        {semContaDebito ? (
          <>
            <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground font-medium">Saldo</p>
            <p className="num-hero text-4xl md:text-5xl mt-1.5 text-muted-foreground">—</p>
            <p className="text-sm text-muted-foreground mt-2">
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
            <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground font-medium">
              Disponível pra gastar
            </p>
            <p className={`num-hero text-5xl md:text-6xl mt-1.5 ${(disponivelHoje ?? 0) >= 0 ? 'text-primary' : 'text-destructive'}`}>
              {formatCurrency(disponivelHoje ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Saldo atual de <span className="tabular font-medium text-foreground">{formatCurrency(saldoAtual ?? 0)}</span>
              {impactoVenc.impactoLiquido !== 0 && (
                <> {impactoVenc.impactoLiquido < 0 ? '−' : '+'} {formatCurrency(Math.abs(impactoVenc.impactoLiquido))} previstos em 30d</>
              )}
            </p>

            {/* Proporção entrou/saiu — conta a história do mês numa linha só,
                sem exigir que o olho compare dois números. */}
            {(totalReceitas > 0 || totalDespesas > 0) && (
              <div className="mt-4 flex h-1 rounded-full overflow-hidden bg-secondary/60">
                <div
                  className="bg-success"
                  style={{ width: `${(totalReceitas / Math.max(1, totalReceitas + totalDespesas)) * 100}%` }}
                />
                <div
                  className="bg-destructive/70"
                  style={{ width: `${(totalDespesas / Math.max(1, totalReceitas + totalDespesas)) * 100}%` }}
                />
              </div>
            )}
          </>
        )}

        {/* Resumos clicáveis — sem pílula: fundo, borda e blur em cada um
            criavam quatro blocos competindo com o número herói. Ponto de cor
            + rótulo já identificam, e o hover dá o alvo de clique. */}
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <ResumoItem
            cor="bg-success"
            rotulo="Entrou"
            valor={formatCurrency(totalReceitas)}
            variacao={varReceitas}
            variacaoBoaSeSobe
            onClick={() => navigate('/transacoes?tipo=receita')}
          />
          <ResumoItem
            cor="bg-destructive/70"
            rotulo="Saiu"
            valor={formatCurrency(totalDespesas)}
            variacao={varDespesas}
            onClick={() => navigate('/transacoes?tipo=despesa')}
          />
          {(totalDespesasPendentes > 0 || totalReceitasPendentes > 0) && (
            <ResumoItem
              cor="bg-warning"
              rotulo="Pendentes"
              valor={[
                totalReceitasPendentes > 0 ? `+${formatCurrency(totalReceitasPendentes)}` : null,
                totalDespesasPendentes > 0 ? `−${formatCurrency(totalDespesasPendentes)}` : null,
              ].filter(Boolean).join(' / ')}
              onClick={() => navigate('/transacoes?status=pendente')}
            />
          )}
          {(totalAPagar > 0 || totalAReceber > 0) && (
            <ResumoItem
              cor="bg-warning"
              rotulo="A pagar/receber"
              valor={formatCurrency(totalAPagar + totalAReceber)}
              onClick={() => navigate('/a-pagar-receber')}
            />
          )}
        </div>
      </section>

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

      {/* Métricas do mês — faixa dividida por hairlines em vez de 3 cards.
          Três caixas lado a lado pra três números criam 3 bordas, 3 fundos e
          3 sombras pra informação que é a mesma coisa vista de ângulos
          diferentes. A faixa agrupa visualmente e some como moldura. */}
      <section className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/60 border-y border-border/60">
        <button
          type="button"
          onClick={() => navigate('/transacoes?tipo=despesa')}
          className="text-left py-3 sm:pr-4 hover:bg-secondary/25 transition-colors sm:first:pl-0 px-0 sm:px-4"
        >
          <p className="text-2xs uppercase tracking-wider text-muted-foreground">Gastos do mês</p>
          <p className="num-display text-2xl mt-1 tabular">{formatCurrency(totalDespesasComPrev)}</p>
          {totalDespesasPendentes > 0 && (
            <p className="text-2xs text-muted-foreground tabular mt-0.5">
              {formatCurrency(totalDespesas)} pago · +{formatCurrency(totalDespesasPendentes)} previsto
            </p>
          )}
          <div className="mt-2 space-y-1">
            <Progress value={Math.min(percentGasto, 100)} className="h-1" />
            <p className="text-2xs text-muted-foreground">
              {percentGasto.toFixed(0)}% da receita
            </p>
          </div>
        </button>

        <div className="py-3 px-0 sm:px-4">
          <p className="text-2xs uppercase tracking-wider text-muted-foreground">Disponível no mês</p>
          <p className={`num-display text-2xl mt-1 tabular ${disponivel >= 0 ? 'text-foreground' : 'text-destructive'}`}>
            {formatCurrency(disponivel)}
          </p>
          <p className="text-2xs text-muted-foreground mt-0.5">
            {(saldoAnterior || 0) >= 0 ? '+' : ''}{formatCurrency(saldoAnterior || 0)} do mês anterior
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/transacoes')}
          className="text-left py-3 px-0 sm:px-4 sm:pr-0 hover:bg-secondary/25 transition-colors"
        >
          <p className="text-2xs uppercase tracking-wider text-muted-foreground">Transações</p>
          <p className="num-display text-2xl mt-1 tabular">{transacoesMes?.length || 0}</p>
          <p className="text-2xs text-muted-foreground mt-0.5">
            {transacoesMes?.filter(t => t.tipo === 'receita').length || 0} entradas · {transacoesMes?.filter(t => t.tipo === 'despesa').length || 0} saídas
          </p>
        </button>
      </section>

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

/**
 * Item de resumo do herói (Entrou / Saiu / Pendentes / A pagar-receber).
 *
 * Substituiu a classe `.pill` — que dava fundo, borda e blur a cada item.
 * Quatro pílulas ao lado do número principal viravam quatro blocos
 * competindo com ele. Aqui o ponto de cor identifica e o hover marca o alvo
 * de clique, sem moldura.
 */
function ResumoItem({
  cor, rotulo, valor, variacao, variacaoBoaSeSobe, onClick,
}: {
  cor: string;
  rotulo: string;
  valor: string;
  /** Variação % vs mês anterior. */
  variacao?: number | null;
  /** Em receita, subir é bom; em despesa, é ruim. */
  variacaoBoaSeSobe?: boolean;
  onClick: () => void;
}) {
  const mostraVar = variacao != null && Math.abs(variacao) >= 1;
  const subiu = (variacao ?? 0) >= 0;
  const bom = variacaoBoaSeSobe ? subiu : !subiu;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-2 text-left -mx-1.5 px-1.5 py-0.5 rounded-md hover:bg-secondary/40 transition-colors"
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${cor}`} />
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <span className="text-sm font-medium tabular">{valor}</span>
      {mostraVar && (
        <span className={`text-2xs tabular ${bom ? 'text-success' : 'text-destructive'}`}>
          {subiu ? '↑' : '↓'}{Math.abs(variacao!).toFixed(0)}%
        </span>
      )}
    </button>
  );
}
