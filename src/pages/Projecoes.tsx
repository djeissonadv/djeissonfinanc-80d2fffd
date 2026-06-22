import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency, getMonthName } from '@/lib/format';
import { generateProjections, type MonthProjection } from '@/lib/projection-engine';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { TrendingUp, Lock, Activity, Pencil, X, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { IncomeCommitmentChart } from '@/components/dashboard/IncomeCommitmentChart';
import { ParcelasTimeline } from '@/components/dashboard/ParcelasTimeline';
import { useTransacoesPeriodo } from '@/hooks/useTransacoesMes';
import { RecorrentesProjecao } from '@/components/projecoes/RecorrentesProjecao';
import { DeepAnalysisCard } from '@/components/analytics/ClaudeAnalysisCards';
import { toast } from 'sonner';
import { useFontesReceita } from '@/hooks/useFontesReceita';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

const TYPE_ICON: Record<string, React.ReactNode> = {
  fixo: <Lock className="h-3 w-3" />,
  parcela: <Lock className="h-3 w-3" />,
  estimado: <Activity className="h-3 w-3" />,
  manual: <Pencil className="h-3 w-3" />,
};

const TYPE_LABEL: Record<string, string> = {
  fixo: 'Fixo',
  parcela: 'Parcela',
  estimado: 'Estimado',
  manual: 'Manual',
};

export default function ProjecoesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  // Cenário "quitar empréstimos pós-venda do apto" — toggle no topo da página.
  // Quando ligado, parcelas futuras de categoria=Empréstimos a partir do mês
  // selecionado são removidas da projeção. localStorage pra persistir entre
  // navegações.
  const [quitacaoOn, setQuitacaoOn] = useState(() =>
    localStorage.getItem('projecoes_quitacao_on') === '1',
  );
  const [quitacaoMes, setQuitacaoMes] = useState(
    () => localStorage.getItem('projecoes_quitacao_mes') || '2026-08',
  );

  // Fetch all transactions
  const { data: transactions, isLoading: loadingTx } = useQuery({
    queryKey: ['projecoes-transacoes', user?.id],
    queryFn: async () => {
      // CRÍTICO: filtrar ignorar_dashboard=false — projeções sem isso
      // incluem pagamentos de fatura, transferências entre cônjuges,
      // markers de extrato → infla todas as categorias projetadas.
      const data = await fetchAllRows(() => supabase
        .from('transacoes')
        .select('data, descricao, valor, tipo, categoria, categoria_id, parcela_atual, parcela_total, grupo_parcela, ignorar_dashboard, essencial, conta_id')
        .eq('user_id', user!.id)
        .eq('ignorar_dashboard', false)
        .gte('data', `${new Date().getFullYear() - 1}-01-01`));
      return data;
    },
    enabled: !!user,
  });

  // Parcelas (atuais + projetadas) dos próximos anos — alimenta o timeline de
  // "parcelas que terminam" (folga futura). Mesmo hook SSOT do Dashboard.
  const anoBaseParc = new Date().getFullYear();
  const { data: parcelasFuturas } = useTransacoesPeriodo({
    inicioComp: `${anoBaseParc}-01`,
    fimComp: `${anoBaseParc + 3}-12`,
    inicioData: `${anoBaseParc}-01-01`,
    fimData: `${anoBaseParc + 3}-12-31`,
    apenasVisivelDashboard: true,
    apenasParceladas: true,
    cachePrefix: 'parcelas-proj',
  });

  // Fetch manual overrides
  const { data: overrides } = useQuery({
    queryKey: ['projecoes-manuais', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('projecoes_manuais')
        .select('*')
        .eq('user_id', user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  // Save manual override
  const saveMutation = useMutation({
    mutationFn: async ({ mes, categoria_nome, valor }: { mes: string; categoria_nome: string; valor: number }) => {
      const { error } = await supabase
        .from('projecoes_manuais')
        .upsert({
          user_id: user!.id,
          mes,
          categoria_nome,
          tipo: 'despesa',
          valor,
        }, { onConflict: 'user_id,mes,categoria_nome,tipo' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projecoes-manuais'] });
      toast.success('Projeção atualizada');
      setEditingCell(null);
    },
    onError: () => toast.error('Erro ao salvar projeção'),
  });

  // Delete manual override
  const deleteMutation = useMutation({
    mutationFn: async ({ mes, categoria_nome }: { mes: string; categoria_nome: string }) => {
      const { error } = await supabase
        .from('projecoes_manuais')
        .delete()
        .eq('user_id', user!.id)
        .eq('mes', mes)
        .eq('categoria_nome', categoria_nome)
        .eq('tipo', 'despesa');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projecoes-manuais'] });
      toast.success('Projeção manual removida');
    },
  });

  const { receitaBase } = useFontesReceita();

  // Lê reserva mínima das Configurações pra passar pro Claude (antes ficava
  // hardcoded 2000 e Claude analisava contra o número errado).
  const { data: config } = useQuery({
    queryKey: ['config', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('configuracoes').select('reserva_minima').eq('user_id', user!.id).maybeSingle();
      return data;
    },
    enabled: !!user,
  });
  const reservaMinima = Number(config?.reserva_minima) || 2000;

  const projections = useMemo(() => {
    if (!transactions) return [];
    const manualOvr = (overrides || []).map(o => ({
      mes: o.mes,
      categoria_nome: o.categoria_nome,
      tipo: o.tipo,
      valor: Number(o.valor),
      descricao: o.descricao,
    }));
    // Aplica simulação de quitação: remove parcelas FUTURAS de Empréstimos a
    // partir do mês selecionado. Tudo que já foi pago (data passada) fica como
    // tá. Categoria 'Empréstimos' cobre os carnês Sicredi + pagamentos MP.
    const txInput = quitacaoOn
      ? transactions.filter((t: any) => {
          const isEmprestimo = t.categoria === 'Empréstimos';
          const mesTx = (t.mes_competencia || t.data?.slice(0, 7) || '');
          return !(isEmprestimo && mesTx >= quitacaoMes);
        })
      : transactions;
    return generateProjections(txInput, receitaBase, manualOvr);
  }, [transactions, receitaBase, overrides, quitacaoOn, quitacaoMes]);

  // Get all unique categories across projections
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of projections) {
      for (const c of p.categorias) {
        cats.add(c.categoria);
      }
    }
    return Array.from(cats).sort();
  }, [projections]);

  // Chart data: accumulated balance
  const chartData = useMemo(() => {
    let accumulated = 0;
    return projections.map(p => {
      accumulated += p.saldoMes;
      const [y, m] = p.mes.split('-');
      return {
        mes: `${getMonthName(parseInt(m) - 1)}/${y.slice(2)}`,
        saldo: p.saldoMes,
        acumulado: accumulated,
        despesas: p.totalDespesas,
        receitas: p.totalReceitas,
      };
    });
  }, [projections]);

  const formatMonth = (mes: string) => {
    const [y, m] = mes.split('-');
    return `${getMonthName(parseInt(m) - 1)}/${y.slice(2)}`;
  };

  const getCellValue = (projection: MonthProjection, cat: string): { valor: number; tipo: string } | null => {
    const items = projection.categorias.filter(c => c.categoria === cat);
    if (items.length === 0) return null;
    const total = items.reduce((s, c) => s + c.valor, 0);
    // Priority: manual > fixo > parcela > estimado
    const tipo = items.find(i => i.tipo === 'manual')?.tipo 
      || items.find(i => i.tipo === 'fixo')?.tipo 
      || items.find(i => i.tipo === 'parcela')?.tipo 
      || 'estimado';
    return { valor: total, tipo };
  };

  const handleStartEdit = (mes: string, cat: string, currentValue: number) => {
    setEditingCell(`${mes}|${cat}`);
    setEditValue(currentValue.toFixed(2).replace('.', ','));
  };

  const handleSaveEdit = (mes: string, cat: string) => {
    const valor = parseFloat(editValue.replace(/\./g, '').replace(',', '.'));
    if (isNaN(valor) || valor < 0) {
      toast.error('Valor inválido');
      return;
    }
    saveMutation.mutate({ mes, categoria_nome: cat, valor });
  };

  const handleKeyDown = (e: React.KeyboardEvent, mes: string, cat: string) => {
    if (e.key === 'Enter') handleSaveEdit(mes, cat);
    if (e.key === 'Escape') setEditingCell(null);
  };

  const toggleCategory = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  if (loadingTx) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="h-6 w-6" />
          Projeções Financeiras
        </h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-1"><Lock className="h-3 w-3" /> Fixo</div>
          <div className="flex items-center gap-1"><Activity className="h-3 w-3" /> Estimado</div>
          <div className="flex items-center gap-1"><Pencil className="h-3 w-3" /> Manual</div>
        </div>
      </div>

      {/* Folga futura — parcelas por mês + quanto LIBERA quando cada parcelamento
          termina. É a resposta a "qual nosso comprometimento nos meses seguintes". */}
      {parcelasFuturas && parcelasFuturas.length > 0 && (
        <div className="space-y-4">
          <ParcelasTimeline parcelas={parcelasFuturas} />
        </div>
      )}

      <RecorrentesProjecao />

      {/* Cenário "quitação total dos empréstimos" — útil pra simular o impacto
          da venda do apartamento (entrada Caixa) sendo usada pra liquidar os
          contratos. Quando ligado, parcelas FUTURAS de categoria=Empréstimos a
          partir do mês selecionado somem da projeção. Mostra de cara quanto
          sobra de saldo livre adicional. */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <input
                id="quitacao-toggle"
                type="checkbox"
                checked={quitacaoOn}
                onChange={(e) => {
                  const v = e.target.checked;
                  setQuitacaoOn(v);
                  localStorage.setItem('projecoes_quitacao_on', v ? '1' : '0');
                }}
                className="h-4 w-4 shrink-0"
              />
              <label htmlFor="quitacao-toggle" className="text-sm cursor-pointer">
                <span className="font-medium">Simular quitação total dos empréstimos</span>
                <span className="text-muted-foreground"> a partir de</span>
              </label>
              <input
                type="month"
                value={quitacaoMes}
                onChange={(e) => {
                  setQuitacaoMes(e.target.value);
                  localStorage.setItem('projecoes_quitacao_mes', e.target.value);
                }}
                disabled={!quitacaoOn}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                aria-label="Mês da quitação"
              />
            </div>
            {quitacaoOn && (
              <Badge variant="outline" className="text-xs">
                Empréstimos somem da projeção a partir de {quitacaoMes}
              </Badge>
            )}
          </div>
          {quitacaoOn && (
            <p className="text-xs text-muted-foreground mt-2 ml-7">
              Use isso pra ver o impacto da venda do apartamento sendo usada pra
              liquidar contratos. Compare o saldo acumulado do chart abaixo com/sem
              o toggle.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Análise Claude do cenário projetado — só roda sob demanda (clique do user) */}
      <DeepAnalysisCard
        mode="projecoes_scenario"
        title="Análise Claude do cenário"
        description="Veredito, fragilidades e ajustes pra fortalecer a projeção"
        buttonLabel="Analisar cenário"
        context={{
          receitaBase,
          despesaMediaMensal:
            projections.length > 0
              ? projections.slice(0, 6).reduce((s, p) => s + p.totalDespesas, 0) / Math.min(6, projections.length)
              : 0,
          saldoInicial: chartData[0]?.acumulado || 0,
          reservaMinima,
          projecaoMensal: chartData.slice(0, 12).map((c) => ({
            mes: c.mes,
            saldoLivre: c.saldo,
            saldoAcumulado: c.acumulado,
          })),
        }}
      />

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Evolução do Saldo Acumulado</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <ReTooltip
                  formatter={(value: number, name: string) => [
                    formatCurrency(value),
                    name === 'acumulado' ? 'Saldo Acumulado' : name === 'saldo' ? 'Saldo do Mês' : name
                  ]}
                />
                <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="acumulado" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="saldo" stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Projection Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Projeção Mensal por Categoria</CardTitle>
          <p className="text-xs text-muted-foreground">Clique em qualquer valor para editar manualmente</p>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="w-full">
            <div className="min-w-[800px]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="sticky left-0 bg-card z-10 text-left p-2 w-[160px] font-medium">Categoria</th>
                    {projections.map(p => (
                      <th key={p.mes} className="text-right p-2 font-medium min-w-[100px]">
                        {formatMonth(p.mes)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allCategories.map(cat => (
                    <tr key={cat} className="border-b hover:bg-muted/30">
                      <td className="sticky left-0 bg-card z-10 p-2 font-medium">
                        <button
                          className="flex items-center gap-1 text-left"
                          onClick={() => toggleCategory(cat)}
                        >
                          {expandedCats.has(cat) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          {cat}
                        </button>
                      </td>
                      {projections.map(p => {
                        const cell = getCellValue(p, cat);
                        const cellKey = `${p.mes}|${cat}`;
                        const isEditing = editingCell === cellKey;
                        const isManual = cell?.tipo === 'manual';

                        if (isEditing) {
                          return (
                            <td key={p.mes} className="p-1">
                              <div className="flex items-center gap-0.5">
                                <Input
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onKeyDown={e => handleKeyDown(e, p.mes, cat)}
                                  className="h-6 text-xs w-[70px] px-1"
                                  autoFocus
                                />
                                <button onClick={() => handleSaveEdit(p.mes, cat)} className="text-primary">
                                  <Check className="h-3 w-3" />
                                </button>
                                <button onClick={() => setEditingCell(null)} className="text-muted-foreground">
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          );
                        }

                        return (
                          <td
                            key={p.mes}
                            className="p-2 text-right cursor-pointer hover:bg-muted/50 transition-colors group"
                            onClick={() => cell && handleStartEdit(p.mes, cat, cell.valor)}
                          >
                            {cell ? (
                              <div className="flex items-center justify-end gap-1">
                                <span className="opacity-0 group-hover:opacity-60 transition-opacity">
                                  {TYPE_ICON[cell.tipo]}
                                </span>
                                <span className={isManual ? 'text-primary font-medium' : ''}>
                                  {formatCurrency(cell.valor)}
                                </span>
                                {isManual && (
                                  <button
                                    onClick={e => { e.stopPropagation(); deleteMutation.mutate({ mes: p.mes, categoria_nome: cat }); }}
                                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* Totals */}
                  <tr className="border-t-2 font-medium bg-muted/20">
                    <td className="sticky left-0 bg-muted/20 z-10 p-2 text-destructive">Total Despesas</td>
                    {projections.map(p => (
                      <td key={p.mes} className="p-2 text-right text-destructive">
                        {formatCurrency(p.totalDespesas)}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-muted/20">
                    <td className="sticky left-0 bg-muted/20 z-10 p-2 text-success font-medium">Receita</td>
                    {projections.map(p => (
                      <td key={p.mes} className="p-2 text-right text-success font-medium">
                        {formatCurrency(p.totalReceitas)}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-muted/20 border-t">
                    <td className="sticky left-0 bg-muted/20 z-10 p-2 font-bold">Saldo do Mês</td>
                    {projections.map(p => (
                      <td key={p.mes} className={`p-2 text-right font-bold ${p.saldoMes >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {formatCurrency(p.saldoMes)}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-muted/30">
                    <td className="sticky left-0 bg-muted/30 z-10 p-2 font-bold">Saldo Acumulado</td>
                    {projections.reduce((acc, p, i) => {
                      const prev = i > 0 ? acc[i - 1].acum : 0;
                      const acum = prev + p.saldoMes;
                      acc.push({ mes: p.mes, acum });
                      return acc;
                    }, [] as { mes: string; acum: number }[]).map(({ mes, acum }) => (
                      <td key={mes} className={`p-2 text-right font-bold ${acum >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {formatCurrency(acum)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Income Commitment Projection */}
      {transactions && transactions.length > 0 && (
        <IncomeCommitmentChart
          transactions={transactions}
          receitaBase={receitaBase}
        />
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Média Mensal Projetada</p>
            <p className="text-xl font-bold text-destructive">
              {projections.length > 0 ? formatCurrency(projections.reduce((s, p) => s + p.totalDespesas, 0) / projections.length) : '—'}
            </p>
            <p className="text-xs text-muted-foreground">de despesas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              {projections.length > 0
                ? (() => {
                    const ultimo = projections[projections.length - 1].mes; // YYYY-MM
                    const [ano, mes] = ultimo.split('-');
                    return `Saldo Projetado ${getMonthName(Number(mes) - 1)}/${ano.slice(2)}`;
                  })()
                : 'Saldo Projetado'}
            </p>
            {projections.length > 0 ? (() => {
              const total = projections.reduce((s, p) => s + p.saldoMes, 0);
              return (
                <>
                  <p className={`text-xl font-bold ${total >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {formatCurrency(total)}
                  </p>
                  <p className="text-xs text-muted-foreground">acumulado</p>
                </>
              );
            })() : <p className="text-xl font-bold">—</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Meses com Saldo Negativo</p>
            <p className="text-xl font-bold text-destructive">
              {projections.filter(p => p.saldoMes < 0).length}
            </p>
            <p className="text-xs text-muted-foreground">de {projections.length} meses</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
