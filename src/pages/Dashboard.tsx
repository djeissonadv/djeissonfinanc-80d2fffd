import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTodayIso } from '@/hooks/useTodayIso';
import { getMonthRange, formatCurrency, getMonthName } from '@/lib/format';
import { CATEGORIAS_CONFIG, getCategoriaColor } from '@/types/database.types';
import { useCategorias } from '@/hooks/useCategorias';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, BarChart3, ChevronDown, ChevronUp, CreditCard } from 'lucide-react';
import { MonthSelector } from '@/components/MonthSelector';
import { ParcelasTimeline } from '@/components/dashboard/ParcelasTimeline';
import { FaturaDrawer } from '@/components/dashboard/FaturaDrawer';
import { ManualTransactionModal } from '@/components/contas/ManualTransactionModal';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useFontesReceita } from '@/hooks/useFontesReceita';
import { useFaturaAcumulada } from '@/hooks/useFaturaAcumulada';
import { fetchAllRows } from '@/lib/supabase-fetch';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { getParentForCategoria, getCategoriaById, getColor: getCatColor } = useCategorias();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
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

  const { data: transacoesMes, isLoading } = useQuery({
    queryKey: ['dashboard', 'transacoes-mes', user?.id, start, end, billingMonth],
    queryFn: async () => {
      // Fetch transactions by mes_competencia (credit card billing period) AND by data range
      // (for debit/cash transactions that don't have mes_competencia).
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

      // Merge and deduplicate by id
      const all = [...byCompetencia, ...byDate];
      const seen = new Set<string>();
      return all.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
    },
    enabled: !!user,
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

  const creditCards = contas?.filter(c => c.tipo === 'credito') || [];
  const cardIds = creditCards.map(c => c.id);

  const { data: faturaAcumulada } = useFaturaAcumulada(cardIds, billingMonth);

  const { data: parcelasAno } = useQuery({
    queryKey: ['dashboard', 'parcelas-ano', user?.id, year],
    queryFn: async () => {
      // Use mes_competencia (billing period) when available, falling back to data (purchase date).
      // For credit card transactions, mes_competencia is the correct field — data is the original
      // purchase date which can be months/years before the billing period.
      const withCompetencia = await fetchAllRows(() => supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .eq('ignorar_dashboard', false)
        .not('parcela_total', 'is', null)
        .gte('mes_competencia', `${year}-01`)
        .lte('mes_competencia', `${year}-12`));

      const withoutCompetencia = await fetchAllRows(() => supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .eq('ignorar_dashboard', false)
        .not('parcela_total', 'is', null)
        .is('mes_competencia', null)
        .gte('data', `${year}-01-01`)
        .lte('data', `${year}-12-31`));

      return [...withCompetencia, ...withoutCompetencia];
    },
    enabled: !!user,
  });

  // Current balance across accounts
  // Today's ISO date (auto-refreshes across midnight / on tab focus) — used to
  // exclude future-dated transactions (projected salary, installments scheduled
  // for upcoming months, etc.) so saldo reflects money actually landed.
  const todayIso = useTodayIso();
  const { data: saldoAtual } = useQuery({
    queryKey: ['dashboard', 'saldo-total', user?.id, todayIso],
    queryFn: async () => {
      const { data: contasList } = await supabase.from('contas').select('id, saldo_inicial, tipo').eq('user_id', user!.id);
      if (!contasList?.length) return 0;
      const debitAccounts = contasList.filter(c => c.tipo === 'debito');
      let total = debitAccounts.reduce((s, c) => s + (c.saldo_inicial || 0), 0);
      const debitIds = debitAccounts.map(c => c.id);
      if (debitIds.length) {
        // Single query across all debit accounts (no N+1). Include ALL transactions
        // up to today for accurate balance (fatura payments are internal transfers
        // but still move the bank balance). Future-dated entries are excluded.
        const txs = await fetchAllRows<{ valor: number; tipo: string }>(() => supabase.from('transacoes').select('valor, tipo').in('conta_id', debitIds).eq('user_id', user!.id).neq('categoria', 'Saldo Inicial').lte('data', todayIso));
        for (const t of txs) {
          total += t.tipo === 'receita' ? Number(t.valor) : -Number(t.valor);
        }
      }
      return total;
    },
    enabled: !!user,
  });

  // Saldo anterior = balance across debit accounts strictly BEFORE the current billing month's start.
  // Uses the same all-transactions logic as saldoAtual (including ignorar_dashboard) to stay symmetric.
  const { data: saldoAnterior } = useQuery({
    queryKey: ['dashboard', 'saldo-anterior', user?.id, start],
    queryFn: async () => {
      const { data: contasList } = await supabase.from('contas').select('id, saldo_inicial, tipo, data_abertura').eq('user_id', user!.id);
      if (!contasList?.length) return 0;
      const debitAccounts = contasList.filter(c => c.tipo === 'debito');
      // Only count opening balance if account was opened before the current month
      let total = debitAccounts.reduce((s, c) => {
        if (!c.data_abertura || c.data_abertura < start) return s + (c.saldo_inicial || 0);
        return s;
      }, 0);
      const debitIds = debitAccounts.map(c => c.id);
      if (debitIds.length) {
        const txs = await fetchAllRows<{ valor: number; tipo: string }>(() => supabase
          .from('transacoes')
          .select('valor, tipo')
          .in('conta_id', debitIds)
          .eq('user_id', user!.id)
          .neq('categoria', 'Saldo Inicial')
          .lt('data', start));
        for (const t of txs) {
          total += t.tipo === 'receita' ? Number(t.valor) : -Number(t.valor);
        }
      }
      return total;
    },
    enabled: !!user,
  });

  const { receitaBase } = useFontesReceita();
  const reserva = config?.reserva_minima || 2000;

  const totalDespesas = transacoesMes?.filter(t => t.tipo === 'despesa').reduce((s, t) => s + Number(t.valor), 0) || 0;
  const totalReceitas = transacoesMes?.filter(t => t.tipo === 'receita').reduce((s, t) => s + Number(t.valor), 0) || 0;

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

  // Disponível no mês = saldo anterior + receitas REALIZADAS - despesas REALIZADAS.
  // MESMA definição da página Análises (antes o Dashboard somava a receber e
  // subtraía a pagar, dando um número diferente sob o mesmo rótulo). "A pagar"/"a
  // receber" continuam como contexto informativo no subtítulo, mas não entram no
  // headline — "disponível" é o que já se realizou, não a projeção de fim de mês.
  const disponivel = (saldoAnterior || 0) + totalReceitas - totalDespesas;
  const percentGasto = totalReceitas > 0 ? (totalDespesas / totalReceitas) * 100 : (totalDespesas > 0 ? 100 : 0);

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
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setManualOpen(true)}
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            Novo Lançamento
          </Button>
          <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => navigate('/transacoes?tipo=receita')}>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Receitas do Mês</p>
            <p className="text-2xl font-bold text-success">{formatCurrency(totalReceitas)}</p>
            <p className="text-xs text-muted-foreground">{transacoesMes?.filter(t => t.tipo === 'receita').length || 0} transações</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => navigate('/transacoes?tipo=despesa')}>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Despesas</p>
            <p className="text-2xl font-bold text-destructive">{formatCurrency(totalDespesas)}</p>
            <p className="text-xs text-muted-foreground">{percentGasto.toFixed(1)}% da receita</p>
            <Progress value={Math.min(percentGasto, 100)} className="mt-2" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Saldo Atual</p>
            <p className={`text-2xl font-bold ${(saldoAtual || 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatCurrency(saldoAtual || 0)}
            </p>
            <p className="text-xs text-muted-foreground">Todas as contas</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => navigate('/planejamento')}>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Disponível no Mês</p>
            <p className={`text-2xl font-bold ${disponivel >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatCurrency(disponivel)}
            </p>
            <p className="text-xs text-muted-foreground">
              {(saldoAnterior || 0) >= 0 ? '+' : ''}{formatCurrency(saldoAnterior || 0)} anterior
              {/* "A pagar / a receber" linkam pra página dedicada de gestão. Antes
                  o número aparecia mas o user não tinha onde clicar pra gerenciar. */}
              {(totalAPagar > 0 || totalAReceber > 0) && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); navigate('/a-pagar-receber'); }}
                    className="underline-offset-2 hover:underline text-foreground/70"
                  >
                    {totalAPagar > 0 && `${formatCurrency(totalAPagar)} a pagar`}
                    {totalAPagar > 0 && totalAReceber > 0 && ' · '}
                    {totalAReceber > 0 && `${formatCurrency(totalAReceber)} a receber`}
                  </button>
                </>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Credit Card Invoices */}
      {creditCards.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {creditCards.map(card => {
            const fatura = faturaAcumulada?.[card.id];
            const saldoAnt = fatura?.saldoAnterior || 0;
            const despesasMes = fatura?.despesasMes || 0;
            const pagMes = fatura?.pagamentosMes || 0;
            const totalAPagarCard = fatura?.totalAPagar || 0;

            const status = totalAPagarCard <= 0
              ? { label: 'Paga', emoji: '🟢', color: '#10b981' }
              : pagMes > 0
                ? { label: 'Parcialmente paga', emoji: '🟡', color: '#f59e0b' }
                : despesasMes <= 0 && saldoAnt <= 0
                  ? { label: 'Sem fatura', emoji: '', color: '#9ca3af' }
                  : { label: 'Em aberto', emoji: '🔴', color: '#ef4444' };

            return (
              <Card key={card.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setFaturaDrawer({ open: true, cardId: card.id, cardName: card.nome })}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{card.nome}</span>
                    <Badge
                      variant="outline"
                      className="ml-auto text-xs"
                      style={{ borderColor: status.color, color: status.color }}
                    >
                      {status.emoji} {status.label}
                    </Badge>
                  </div>
                  {card.dia_vencimento && (
                    <p className="text-xs text-muted-foreground mb-2">
                      Vence dia {card.dia_vencimento} · {String(card.dia_vencimento).padStart(2, '0')}/{String(month + 1).padStart(2, '0')}
                    </p>
                  )}
                  {saldoAnt > 0 && (
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Saldo anterior</span>
                      <span className="text-warning font-medium">{formatCurrency(saldoAnt)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Fatura do mês</span>
                    <span className="font-medium">{formatCurrency(despesasMes)}</span>
                  </div>
                  {pagMes > 0 && (
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Pagamentos</span>
                      <span className="text-success font-medium">-{formatCurrency(pagMes)}</span>
                    </div>
                  )}
                  {(saldoAnt > 0 || pagMes > 0) && (
                    <div className="border-t border-border/50 mt-1 pt-1" />
                  )}
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-muted-foreground">Total a pagar</span>
                    <span className={`text-lg font-bold ${totalAPagarCard > 0 ? 'text-destructive' : 'text-success'}`}>
                      {formatCurrency(Math.max(0, totalAPagarCard))}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Ranking de Categorias
            </CardTitle>
          </CardHeader>
          <CardContent>
            {categoryRanking.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma despesa este mês</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  {(categoriasExpanded ? categoryRanking : categoryRanking.slice(0, 8)).map(({ cat, total, pct, color }) => (
                    <button
                      key={cat}
                      className="flex items-center justify-between w-full hover:bg-muted/50 rounded-lg p-2 -m-2 transition-colors cursor-pointer text-left min-w-0"
                      onClick={() => navigate(`/transacoes?categoria=${encodeURIComponent(cat)}&mes=${billingMonth}&tipo=despesa`)}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-sm font-medium truncate">{cat}</span>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <span className="text-sm font-medium">{formatCurrency(total)}</span>
                        <span className="text-xs text-muted-foreground ml-2">{pct.toFixed(0)}%</span>
                      </div>
                    </button>
                  ))}
                </div>
                {categoryRanking.length > 8 && (
                  <button
                    onClick={() => setCategoriasExpanded(!categoriasExpanded)}
                    className="mt-4 w-full flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors py-2 border-t"
                  >
                    {categoriasExpanded ? (
                      <>
                        Mostrar menos <ChevronUp className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        Ver todas ({categoryRanking.length}) <ChevronDown className="h-4 w-4" />
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <ParcelasTimeline parcelas={parcelasAno || []} />


        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Essenciais vs Não-Essenciais
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div
                className="cursor-pointer hover:bg-muted/50 rounded-lg p-2 -m-2 transition-colors"
                onClick={() => navigate('/transacoes?essencial=true')}
              >
                <p className="text-sm text-muted-foreground">Essenciais</p>
                <p className="text-xl font-bold text-success">{formatCurrency(totalEssencial)}</p>
                <p className="text-xs text-muted-foreground">{pctEssencial.toFixed(0)}% (meta: 70%)</p>
              </div>
              <div
                className="cursor-pointer hover:bg-muted/50 rounded-lg p-2 -m-2 transition-colors"
                onClick={() => navigate('/transacoes?essencial=false')}
              >
                <p className="text-sm text-muted-foreground">Não-essenciais</p>
                <p className="text-xl font-bold text-warning">{formatCurrency(totalNaoEssencial)}</p>
                <p className="text-xs text-muted-foreground">{(100 - pctEssencial).toFixed(0)}% (meta: 30%)</p>
              </div>
            </div>
            <div className="relative h-4 rounded-full bg-muted overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-foreground/20 rounded-full transition-all"
                style={{ width: `${pctEssencial}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-xs text-muted-foreground">Essenciais</span>
              <span className="text-xs text-muted-foreground">Não-essenciais</span>
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
