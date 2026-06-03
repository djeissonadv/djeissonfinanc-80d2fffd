import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTransacoesMes, useTransacoesPeriodo } from '@/hooks/useTransacoesMes';
import { calcularSaldoTotal } from '@/lib/saldo';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { MonthSelector } from '@/components/MonthSelector';
import { formatCurrency, getMonthName, toLocalIso } from '@/lib/format';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { BudgetReviewCard } from '@/components/planejamento/BudgetReviewCard';
import { DeepAnalysisCard } from '@/components/analytics/ClaudeAnalysisCards';
import { monthPace, projetarFimMes, buildBudgetAlerts, compute503020, suggestMeta } from '@/lib/budget-insights';
import { useToast } from '@/hooks/use-toast';
import {
  Target, TrendingUp, TrendingDown, Minus, Save, Lightbulb,
  Plus, Trash2, AlertCircle, Wallet, CheckCircle2, ChevronDown, ChevronUp, AlertTriangle, PiggyBank,
} from 'lucide-react';

// ─── helpers ──────────────────────────────────────────────────────────────────

function getProgressColor(pct: number) {
  if (pct > 100) return 'bg-destructive';
  if (pct > 80) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function getProgressBg(pct: number) {
  if (pct > 100) return 'bg-destructive/10 border-destructive/30';
  if (pct > 80) return 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800';
  return '';
}

// ─── component ────────────────────────────────────────────────────────────────

export default function PlanejamentoPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const now = new Date();
  // Fuso BR (UTC-3): usar toLocalIso/getMonthRange em vez de toISOString(), que
  // converte pra UTC e desloca o dia ±1 perto da meia-noite — corrompendo o
  // saldo (lte 'data') e o range do mês.
  const todayStr = toLocalIso(now);
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const billingMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
  const isFutureMonth = billingMonth > todayStr.slice(0, 7);

  const [editingMetas, setEditingMetas] = useState<Record<string, string>>({});
  const [showFontes, setShowFontes] = useState(false);
  const [newFontDesc, setNewFontDesc] = useState('');
  const [newFontValor, setNewFontValor] = useState('');

  // ── 1. Saldo atual das contas (até hoje) — usa lib/saldo (SSOT). ──────────
  const { data: saldoAtual } = useQuery({
    queryKey: ['planejamento-saldo', user?.id, todayStr],
    queryFn: async () => {
      const { data: contas } = await supabase
        .from('contas').select('id, saldo_inicial, tipo, data_abertura').eq('user_id', user!.id);
      if (!contas?.length) return 0;
      const debito = contas.filter(c => c.tipo === 'debito');
      const debitIds = debito.map((c: any) => c.id);
      if (!debitIds.length) return debito.reduce((s: number, c: any) => s + (c.saldo_inicial || 0), 0);
      const txs = await fetchAllRows<{ conta_id: string; valor: number; tipo: string; pago?: boolean; categoria?: string; ignorar_dashboard?: boolean }>(() => supabase
        .from('transacoes').select('conta_id, valor, tipo, pago, categoria, ignorar_dashboard')
        .in('conta_id', debitIds).eq('user_id', user!.id)
        .lte('data', todayStr));
      return calcularSaldoTotal(debito, txs);
    },
    enabled: !!user,
  });

  // ── 2. Transações do mês — usa useTransacoesMes (SSOT). ───────────────────
  const { data: txMes } = useTransacoesMes(month, year, {
    apenasVisivelDashboard: true,
    cachePrefix: 'planejamento-mes',
  });

  // ── 3. Metas salvas ──────────────────────────────────────────────────────
  const { data: planejamento } = useQuery({
    queryKey: ['planejamento-metas', user?.id, billingMonth],
    queryFn: async () => {
      const { data } = await supabase
        .from('planejamento_categorias').select('*')
        .eq('user_id', user!.id).eq('mes', billingMonth);
      return (data || []) as any[];
    },
    enabled: !!user,
  });

  // ── 4. Fontes de receita ─────────────────────────────────────────────────
  const { data: fontesReceita } = useQuery({
    queryKey: ['fontes-receita', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('fontes_receita').select('*')
        .eq('user_id', user!.id).order('created_at');
      return (data || []) as any[];
    },
    enabled: !!user,
  });

  const addFonteMutation = useMutation({
    mutationFn: async ({ descricao, valor }: { descricao: string; valor: number }) => {
      const { error } = await supabase.from('fontes_receita')
        .insert({ user_id: user!.id, nome: descricao, valor, ativo: true });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fontes-receita'] });
      setNewFontDesc(''); setNewFontValor('');
      toast({ title: 'Fonte de receita adicionada' });
    },
  });

  const deleteFonteMutation = useMutation({
    mutationFn: async (id: string) => { await supabase.from('fontes_receita').delete().eq('id', id); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fontes-receita'] }),
  });

  const toggleFonteMutation = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      await supabase.from('fontes_receita').update({ ativo }).eq('id', id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fontes-receita'] }),
  });

  // ── 5. Médias do ano — usa useTransacoesPeriodo (SSOT). ───────────────────
  const { data: txAnoRaw } = useTransacoesPeriodo({
    inicioComp: `${year}-01`,
    fimComp: `${year}-12`,
    inicioData: `${year}-01-01`,
    fimData: `${year}-12-31`,
    apenasVisivelDashboard: true,
    cachePrefix: 'planejamento-ano',
  });
  // Filtra só despesas (o hook traz tudo — filtro fica client-side)
  const txAno = useMemo(
    () => (txAnoRaw || []).filter(t => t.tipo === 'despesa'),
    [txAnoRaw]
  );

  // ── computed ───────────────────────────────────────────────────────────────

  const receitaEsperada = useMemo(
    () => (fontesReceita || []).filter((f: any) => f.ativo).reduce((s: number, f: any) => s + Number(f.valor), 0),
    [fontesReceita]
  );

  const receitaMes = useMemo(
    () => (txMes || []).filter(t => t.tipo === 'receita').reduce((s, t) => s + Number(t.valor), 0),
    [txMes]
  );

  const despesaMes = useMemo(
    () => (txMes || []).filter(t => t.tipo === 'despesa').reduce((s, t) => s + Number(t.valor), 0),
    [txMes]
  );

  const saldoMes = receitaMes - despesaMes;

  // Category data with metas and trends
  const categoryData = useMemo(() => {
    if (!txMes) return [];

    // Gasto do mês por categoria
    const gastoMesCat: Record<string, number> = {};
    for (const t of txMes) {
      if (t.tipo !== 'despesa') continue;
      const cat = t.categoria || 'Outros';
      gastoMesCat[cat] = (gastoMesCat[cat] || 0) + Number(t.valor);
    }

    // Médias do ano por categoria
    const mediasCat: Record<string, { total: number; meses: Set<string> }> = {};
    for (const t of (txAno || [])) {
      const m = t.mes_competencia || t.data?.slice(0, 7);
      if (!m || m > billingMonth) continue;
      const cat = t.categoria || 'Outros';
      if (!mediasCat[cat]) mediasCat[cat] = { total: 0, meses: new Set() };
      mediasCat[cat].total += Number(t.valor);
      mediasCat[cat].meses.add(m);
    }

    // Merge: categories from both gastoMes and metas
    const allCats = new Set([
      ...Object.keys(gastoMesCat),
      ...(planejamento || []).map((p: any) => p.categoria_nome),
    ]);

    const result = Array.from(allCats).map(cat => {
      const gastoMes = gastoMesCat[cat] || 0;
      const mediaInfo = mediasCat[cat];
      const numMeses = mediaInfo ? mediaInfo.meses.size : 0;
      const media = mediaInfo && numMeses > 0 ? mediaInfo.total / numMeses : 0;
      // ← FIX: use categoria_nome (not categoria)
      const metaEntry = (planejamento || []).find((p: any) => p.categoria_nome === cat);
      const meta: number | null = metaEntry ? Number(metaEntry.valor_planejado) : null;
      const metaId: string | null = metaEntry?.id || null;

      return { categoria: cat, gastoMes, media, numMeses, meta, metaId };
    });

    // Sort: categories with meta first (by % of meta), then by gasto
    return result.sort((a, b) => {
      const aHasMeta = a.meta !== null;
      const bHasMeta = b.meta !== null;
      if (aHasMeta && !bHasMeta) return -1;
      if (!aHasMeta && bHasMeta) return 1;
      return b.gastoMes - a.gastoMes;
    });
  }, [txMes, txAno, planejamento, billingMonth]);

  const totalPlanejado = categoryData.reduce((s, c) => s + (c.meta || 0), 0);

  // ── inteligência: ritmo, 50/30/20, alertas ─────────────────────────────────
  const pace = useMemo(() => monthPace(year, month, new Date()), [year, month]);
  const essenciaisMes = useMemo(
    () => (txMes || []).filter(t => t.tipo === 'despesa' && (t as any).essencial).reduce((s, t) => s + Number(t.valor), 0),
    [txMes],
  );
  const naoEssenciaisMes = despesaMes - essenciaisMes;
  const receitaPlanej = receitaEsperada > 0 ? receitaEsperada : receitaMes;
  const regra = useMemo(() => compute503020(receitaPlanej, essenciaisMes, naoEssenciaisMes), [receitaPlanej, essenciaisMes, naoEssenciaisMes]);
  const alertas = useMemo(
    () => buildBudgetAlerts(categoryData.map(c => ({ categoria: c.categoria, gastoMes: c.gastoMes, media: c.media, meta: c.meta })), pace),
    [categoryData, pace],
  );
  const despesaProjetada = projetarFimMes(despesaMes, pace);
  const sobraProjetada = receitaPlanej - despesaProjetada;

  const aplicarMetasPelaMedia = async () => {
    if (!user) return;
    const alvos = categoryData.filter(c => c.meta == null && c.media > 0);
    if (alvos.length === 0) { toast({ title: 'Nenhuma categoria sem meta com histórico' }); return; }
    const rows = alvos.map(c => ({ user_id: user.id, categoria_nome: c.categoria, valor_planejado: suggestMeta(c.media), mes: billingMonth }));
    const { error } = await supabase.from('planejamento_categorias').upsert(rows, { onConflict: 'user_id,categoria_nome,mes' });
    if (error) toast({ title: 'Erro ao aplicar metas', variant: 'destructive' });
    else {
      queryClient.invalidateQueries({ queryKey: ['planejamento-metas'] });
      toast({ title: `${rows.length} metas definidas pela média histórica` });
    }
  };

  // ── save/delete meta ──────────────────────────────────────────────────────

  const saveMeta = async (categoria: string, valor: number) => {
    if (!user || !valor || isNaN(valor)) return;
    const { error } = await supabase.from('planejamento_categorias').upsert(
      { user_id: user.id, categoria_nome: categoria, valor_planejado: valor, mes: billingMonth },
      { onConflict: 'user_id,categoria_nome,mes' }
    );
    if (error) toast({ title: 'Erro ao salvar meta', variant: 'destructive' });
    else {
      queryClient.invalidateQueries({ queryKey: ['planejamento-metas'] });
      setEditingMetas(prev => { const n = { ...prev }; delete n[categoria]; return n; });
    }
  };

  const deleteMeta = async (id: string, categoria: string) => {
    await supabase.from('planejamento_categorias').delete().eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['planejamento-metas'] });
    setEditingMetas(prev => { const n = { ...prev }; delete n[categoria]; return n; });
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in pb-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Planejamento</h1>
          <p className="text-sm text-muted-foreground">Orçamento e metas por categoria</p>
        </div>
        <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
      </div>

      {/* ── Resumo do mês ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <p className="text-xs text-muted-foreground">Saldo nas contas</p>
            <p className={`text-xl font-bold mt-0.5 ${(saldoAtual || 0) >= 0 ? 'text-foreground' : 'text-destructive'}`}>
              {formatCurrency(saldoAtual || 0)}
            </p>
            <p className="text-[10px] text-muted-foreground">saldo real hoje</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <p className="text-xs text-muted-foreground">Receita {getMonthName(month)}</p>
            <p className="text-xl font-bold mt-0.5 text-emerald-600">{formatCurrency(receitaMes)}</p>
            <p className="text-[10px] text-muted-foreground">entrou no mês</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <p className="text-xs text-muted-foreground">Despesas {getMonthName(month)}</p>
            <p className="text-xl font-bold mt-0.5 text-destructive">{formatCurrency(despesaMes)}</p>
            {totalPlanejado > 0 && (
              <p className="text-[10px] text-muted-foreground">
                planejado: {formatCurrency(totalPlanejado)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className={`border-2 ${saldoMes >= 0 ? 'border-emerald-200 dark:border-emerald-800' : 'border-destructive/40'}`}>
          <CardContent className="pt-4 pb-4 px-4">
            <p className="text-xs text-muted-foreground">Resultado do mês</p>
            <p className={`text-xl font-bold mt-0.5 ${saldoMes >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
              {saldoMes >= 0 ? '+' : ''}{formatCurrency(saldoMes)}
            </p>
            <p className="text-[10px] text-muted-foreground">receita − despesas</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Saúde do orçamento (50/30/20) + Projeção ── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><PiggyBank className="h-4 w-4" /> Regra 50/30/20</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {receitaPlanej <= 0 ? (
              <p className="text-xs text-muted-foreground">Configure a receita esperada do mês para ver a regra.</p>
            ) : (
              [
                { label: 'Essenciais', val: regra.essenciais, pct: regra.pctEssenciais, alvoPct: 50, alvo: regra.alvoEssenciais, color: 'bg-blue-500' },
                { label: 'Não-essenciais', val: regra.naoEssenciais, pct: regra.pctNaoEssenciais, alvoPct: 30, alvo: regra.alvoNaoEssenciais, color: 'bg-amber-500' },
                { label: 'Sobra / poupança', val: regra.poupanca, pct: regra.pctPoupanca, alvoPct: 20, alvo: regra.alvoPoupanca, color: 'bg-emerald-500' },
              ].map(r => {
                const acima = r.label !== 'Sobra / poupança' && r.pct > r.alvoPct;
                const abaixo = r.label === 'Sobra / poupança' && r.pct < r.alvoPct;
                return (
                  <div key={r.label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{r.label} <span className="text-[10px]">(meta {r.alvoPct}%)</span></span>
                      <span className={`font-medium ${acima || abaixo ? 'text-amber-600' : ''}`}>{r.pct.toFixed(0)}% · {formatCurrency(r.val)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${r.color}`} style={{ width: `${Math.max(0, Math.min(100, r.pct))}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><TrendingDown className="h-4 w-4" /> Projeção do mês</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Gasto até agora</span><span className="font-medium">{formatCurrency(despesaMes)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Projeção fim do mês</span><span className="font-medium">{formatCurrency(despesaProjetada)}</span></div>
            <div className="border-t pt-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Sobra projetada</span><span className={`font-bold ${sobraProjetada >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>{formatCurrency(sobraProjetada)}</span></div>
            </div>
            <p className="text-[10px] text-muted-foreground">{pace.isMesCorrente ? `no ritmo do dia ${pace.diaAtual}/${pace.diasMes}` : 'mês fechado (valor real)'}</p>
            <Button variant="outline" size="sm" className="w-full gap-1.5 mt-1" onClick={aplicarMetasPelaMedia}>
              <Lightbulb className="h-3.5 w-3.5" /> Definir metas pela média histórica
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Alertas ── */}
      {alertas.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Alertas do orçamento ({alertas.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {alertas.slice(0, 6).map((a, i) => (
              <div key={`${a.categoria}-${i}`} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${a.severidade === 'alto' ? 'bg-destructive' : 'bg-amber-500'}`} />
                <span>
                  <span className="font-medium">{a.categoria}</span>{' '}
                  {a.tipo === 'estourou' && <span className="text-muted-foreground">estourou a meta — gastou {formatCurrency(a.gastoMes)} de {formatCurrency(a.meta || 0)}</span>}
                  {a.tipo === 'vai_estourar' && <span className="text-muted-foreground">no ritmo atual fecha em {formatCurrency(a.projecao)} (meta {formatCurrency(a.meta || 0)})</span>}
                  {a.tipo === 'acima_media' && <span className="text-muted-foreground">{formatCurrency(a.gastoMes)} este mês vs média de {formatCurrency(a.media)}</span>}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Resumo IA (Gemini, rápido) + análise profunda (Claude, sob demanda) ── */}
      {(() => {
        const reviewCtx = {
          receita: receitaPlanej,
          despesaMes,
          despesaProjetada,
          sobraProjetada,
          essenciais: essenciaisMes,
          naoEssenciais: naoEssenciaisMes,
          pctEssenciais: regra.pctEssenciais,
          pctPoupanca: regra.pctPoupanca,
          mesCorrente: pace.isMesCorrente,
          alertas: alertas.slice(0, 8).map(a => ({
            categoria: a.categoria,
            tipo: a.tipo,
            gastoMes: a.gastoMes,
            projecao: a.projecao,
            meta: a.meta,
            media: a.media,
          })),
          categorias: categoryData.slice(0, 12).map(c => ({
            categoria: c.categoria, gastoMes: c.gastoMes, media: c.media, meta: c.meta,
          })),
        };
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <BudgetReviewCard context={reviewCtx} />
            <DeepAnalysisCard
              mode="planejamento_review"
              title="Revisão profunda — Claude"
              description="Onde o orçamento está estourando, o que cortar, regra 50/30/20"
              buttonLabel="Revisar com Claude"
              context={reviewCtx}
            />
          </div>
        );
      })()}

      {/* ── Fontes de receita (colapsável) ── */}
      <Card>
        <button
          className="w-full flex items-center justify-between p-4"
          onClick={() => setShowFontes(v => !v)}
        >
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Receita esperada do mês</span>
            {receitaEsperada > 0 && (
              <Badge variant="secondary" className="text-xs">{formatCurrency(receitaEsperada)}</Badge>
            )}
          </div>
          {showFontes ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {showFontes && (
          <CardContent className="pt-0 space-y-3">
            <p className="text-xs text-muted-foreground">
              Configure as fontes certas de entrada (salário, freelance, aluguel recebido…). Não afeta os números do Dashboard — é só para o planejamento.
            </p>

            <div className="space-y-2">
              {(fontesReceita || []).map((f: any) => (
                <div key={f.id} className={`flex items-center justify-between p-3 rounded-lg border ${f.ativo ? '' : 'opacity-50'}`}>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleFonteMutation.mutate({ id: f.id, ativo: !f.ativo })}
                      className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${f.ativo ? 'border-emerald-500 bg-emerald-500' : 'border-muted-foreground'}`}
                    >
                      {f.ativo && <CheckCircle2 className="h-3 w-3 text-white" />}
                    </button>
                    <span className={`text-sm ${!f.ativo ? 'line-through text-muted-foreground' : ''}`}>{f.nome || f.descricao}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-emerald-600">{formatCurrency(f.valor)}</span>
                    <ConfirmDelete
                      onConfirm={() => deleteFonteMutation.mutate(f.id)}
                      title={`Excluir "${f.nome || f.descricao}"?`}
                      description="Esta fonte de receita será removida e deixará de compor sua renda. Esta ação não pode ser desfeita."
                      trigger={
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      }
                    />
                  </div>
                </div>
              ))}

              {(!fontesReceita || fontesReceita.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-2">Nenhuma fonte configurada</p>
              )}
            </div>

            <div className="flex gap-2">
              <Input placeholder="Ex: Salário, Freelance…" value={newFontDesc} onChange={e => setNewFontDesc(e.target.value)} className="flex-1 h-9 text-sm" />
              <Input type="number" placeholder="Valor" value={newFontValor} onChange={e => setNewFontValor(e.target.value)} className="w-28 h-9 text-sm" />
              <Button size="sm" className="h-9" disabled={!newFontDesc || !newFontValor}
                onClick={() => addFonteMutation.mutate({ descricao: newFontDesc, valor: Number(newFontValor) })}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {receitaEsperada > 0 && (
              <div className={`rounded-lg p-3 text-sm ${receitaEsperada >= despesaMes ? 'bg-emerald-50 dark:bg-emerald-950/20' : 'bg-destructive/5'}`}>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Esperado entrar</span>
                  <span className="font-medium text-emerald-600">{formatCurrency(receitaEsperada)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Despesas planejadas</span>
                  <span className="font-medium text-destructive">{formatCurrency(totalPlanejado || despesaMes)}</span>
                </div>
                <div className="flex justify-between border-t mt-2 pt-2 font-semibold">
                  <span>Margem prevista</span>
                  <span className={receitaEsperada - (totalPlanejado || despesaMes) >= 0 ? 'text-emerald-600' : 'text-destructive'}>
                    {formatCurrency(receitaEsperada - (totalPlanejado || despesaMes))}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── Orçamento por categoria ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5" />
            Orçamento por Categoria — {getMonthName(month)}/{year}
          </CardTitle>
          {isFutureMonth && (
            <p className="text-xs text-muted-foreground">Mês futuro — valores baseados em parcelas e lançamentos já comprometidos.</p>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {categoryData.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">
              Nenhuma despesa encontrada para {getMonthName(month)}/{year}
            </p>
          )}

          {categoryData.map(cat => {
            const editing = editingMetas[cat.categoria];
            const pctMeta = cat.meta ? Math.round((cat.gastoMes / cat.meta) * 100) : null;
            const trendPct = cat.media > 0 ? Math.round(((cat.gastoMes - cat.media) / cat.media) * 100) : 0;
            const showTrend = cat.media > 0 && Math.abs(trendPct) > 15 && !isFutureMonth;

            return (
              <div
                key={cat.categoria}
                className={`p-3 rounded-lg border space-y-2 ${cat.meta !== null ? getProgressBg(pctMeta || 0) : ''}`}
              >
                {/* Row 1: name + valores */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium text-sm truncate">{cat.categoria}</span>
                    {cat.meta !== null && pctMeta !== null && pctMeta > 100 && (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm shrink-0">
                    {cat.meta !== null ? (
                      <span className={`font-bold ${pctMeta && pctMeta > 100 ? 'text-destructive' : ''}`}>
                        {formatCurrency(cat.gastoMes)} <span className="text-muted-foreground font-normal">/ {formatCurrency(cat.meta)}</span>
                      </span>
                    ) : (
                      <span className="font-semibold">{formatCurrency(cat.gastoMes)}</span>
                    )}
                    {cat.media > 0 && !isFutureMonth && (
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        média {formatCurrency(cat.media)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {cat.meta !== null && pctMeta !== null && (
                  <div className="space-y-1">
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${getProgressColor(pctMeta)}`}
                        style={{ width: `${Math.min(pctMeta, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{pctMeta}% da meta usada</span>
                      <span>Sobra {formatCurrency(Math.max(0, cat.meta - cat.gastoMes))}</span>
                    </div>
                  </div>
                )}

                {/* Tendência */}
                {showTrend && (
                  <div className={`flex items-center gap-1 text-xs ${trendPct > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                    {trendPct > 0
                      ? <><TrendingUp className="h-3 w-3" /> {trendPct}% acima da média histórica</>
                      : <><TrendingDown className="h-3 w-3" /> {Math.abs(trendPct)}% abaixo da média histórica</>
                    }
                  </div>
                )}

                {/* Edição de meta */}
                <div className="flex items-center gap-2">
                  {editing !== undefined ? (
                    <>
                      <Input
                        type="number"
                        value={editing}
                        onChange={e => setEditingMetas(prev => ({ ...prev, [cat.categoria]: e.target.value }))}
                        className="h-8 w-32 text-sm"
                        placeholder="Limite R$"
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Enter' && editing) saveMeta(cat.categoria, Number(editing)); }}
                      />
                      <Button size="sm" variant="default" className="h-8 px-3 text-xs" onClick={() => { if (editing) saveMeta(cat.categoria, Number(editing)); }}>
                        <Save className="h-3 w-3 mr-1" /> Salvar
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setEditingMetas(prev => { const n = { ...prev }; delete n[cat.categoria]; return n; })}>
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
                        onClick={() => setEditingMetas(prev => ({ ...prev, [cat.categoria]: cat.meta?.toString() || Math.round(cat.media || cat.gastoMes).toString() }))}>
                        <Target className="h-3 w-3 mr-1" />
                        {cat.meta !== null ? 'Ajustar limite' : 'Definir limite'}
                      </Button>
                      {cat.meta !== null && cat.metaId && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteMeta(cat.metaId!, cat.categoria)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
