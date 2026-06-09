import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency, formatDate, getMonthRange, toLocalIso } from '@/lib/format';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { CATEGORIAS, CATEGORIAS_DESPESA, CATEGORIAS_RECEITA, CATEGORIAS_CONFIG, getCategoriaColor, getSubcategorias } from '@/types/database.types';
import { useCategorias } from '@/hooks/useCategorias';
import { CategoriaSelector } from '@/components/CategoriaSelector';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Trash2, Search, Download, Copy, EyeOff, Filter, ChevronDown, ChevronUp, Layers, CreditCard, Tag, Calendar } from 'lucide-react';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { Checkbox } from '@/components/ui/checkbox';
import { exportCSV, copyToClipboard } from '@/lib/export';
import { MonthSelector } from '@/components/MonthSelector';

export default function TransacoesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [filterCategoria, setFilterCategoria] = useState('all');
  const [filterSubcategoria, setFilterSubcategoria] = useState('all');
  const [filterTipo, setFilterTipo] = useState('all');
  const [filterEssencial, setFilterEssencial] = useState('all');
  const [filterConta, setFilterConta] = useState('all');
  const [filterPessoa, setFilterPessoa] = useState('all');
  const [search, setSearch] = useState('');
  const [editingTx, setEditingTx] = useState<any>(null);
  const [parcelaDelOpen, setParcelaDelOpen] = useState(false);
  // Reembolso no editor — vincula uma RECEITA nova a esta DESPESA marcando que
  // outra pessoa vai pagar parte/total. Estado inicial sai da própria transação
  // (se já tem reembolso vinculado, o toggle vem ligado).
  const [editReembolsoOn, setEditReembolsoOn] = useState(false);
  const [editReembolsoPessoa, setEditReembolsoPessoa] = useState('');
  const [editReembolsoValor, setEditReembolsoValor] = useState('');
  const [editContaReembolsoId, setEditContaReembolsoId] = useState('');
  const [showIgnoradas, setShowIgnoradas] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Período da query: 'mes' (default — só mês selecionado), '12m' (últimos 12 meses)
  // ou 'all' (histórico inteiro). Útil pra caçar parcelas específicas no histórico.
  const [periodo, setPeriodo] = useState<'mes' | '12m' | 'all'>('mes');
  const [filterPago, setFilterPago] = useState<'all' | 'pago' | 'pendente'>('all');
  const [groupBy, setGroupBy] = useState<'dia' | 'categoria' | 'parcelamento' | 'cartao'>('dia');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Read URL params on mount. Suporta drill-down vindo de Análises/Dashboard/
  // Dívidas: /transacoes?categoria=Saude&mes=2026-05&busca=oboticario etc.
  useEffect(() => {
    const cat = searchParams.get('categoria');
    const subcat = searchParams.get('subcategoria');
    const tipo = searchParams.get('tipo');
    const essencial = searchParams.get('essencial');
    const busca = searchParams.get('busca');
    const mes = searchParams.get('mes'); // YYYY-MM
    const conta = searchParams.get('conta');
    if (cat) setFilterCategoria(cat);
    if (subcat) setFilterSubcategoria(subcat);
    if (tipo) setFilterTipo(tipo);
    if (essencial) setFilterEssencial(essencial);
    if (busca) setSearch(busca);
    if (conta) setFilterConta(conta);
    if (mes && /^\d{4}-\d{2}$/.test(mes)) {
      const [y, m] = mes.split('-').map(Number);
      setYear(y);
      setMonth(m - 1);
    }
  }, [searchParams]);

  const { start, end } = getMonthRange(month, year);

  const { data: contas } = useQuery({
    queryKey: ['contas', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('contas').select('*').eq('user_id', user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  const billingMonth = `${year}-${String(month + 1).padStart(2, '0')}`;

  const { data: transacoes } = useQuery({
    queryKey: ['transacoes', user?.id, start, end, billingMonth, periodo],
    queryFn: async () => {
      // Modo "all" (histórico inteiro): sem filtro de data/competência. Pesado
      // mas necessário pra caçar transações específicas (parcela velha, etc).
      if (periodo === 'all') {
        return await fetchAllRows(() => supabase
          .from('transacoes')
          .select('*')
          .eq('user_id', user!.id)
          .order('data', { ascending: false }));
      }

      // Modo "12m": últimos 12 meses a partir de hoje. Cobre projeções futuras
      // de parcelas + retroativo do ano inteiro sem trazer tudo.
      if (periodo === '12m') {
        const hoje = new Date();
        const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 12, 1);
        const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 13, 0); // +12m projeção
        const inicioStr = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-01`;
        const fimStr = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, '0')}-${String(fim.getDate()).padStart(2, '0')}`;
        const inicioYM = inicioStr.slice(0, 7);
        const fimYM = fimStr.slice(0, 7);
        const byCompetencia = await fetchAllRows(() => supabase
          .from('transacoes')
          .select('*')
          .eq('user_id', user!.id)
          .gte('mes_competencia', inicioYM)
          .lte('mes_competencia', fimYM)
          .order('data', { ascending: false }));
        const byDate = await fetchAllRows(() => supabase
          .from('transacoes')
          .select('*')
          .eq('user_id', user!.id)
          .is('mes_competencia', null)
          .gte('data', inicioStr)
          .lte('data', fimStr)
          .order('data', { ascending: false }));
        const all = [...byCompetencia, ...byDate];
        const seen = new Set<string>();
        return all.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
      }

      // Modo "mes" (default): só o mês selecionado.
      // Credit card transactions are identified by mes_competencia (billing period).
      // Debit/cash transactions have mes_competencia = null and are filtered by data.
      const byCompetencia = await fetchAllRows(() => supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .eq('mes_competencia', billingMonth)
        .order('data', { ascending: false }));

      const byDate = await fetchAllRows(() => supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .is('mes_competencia', null)
        .gte('data', start)
        .lte('data', end)
        .order('data', { ascending: false }));

      // Merge and deduplicate by id
      const all = [...byCompetencia, ...byDate];
      const seen = new Set<string>();
      return all.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
    },
    enabled: !!user,
  });

  // Alterna pago/pendente em 1 click direto na linha (sem abrir editor).
  const togglePagoMutation = useMutation({
    mutationFn: async (tx: { id: string; pago: boolean }) => {
      const { error } = await supabase
        .from('transacoes')
        .update({ pago: !tx.pago })
        .eq('id', tx.id);
      if (error) throw error;
      return !tx.pago;
    },
    onSuccess: (novoStatus) => {
      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      toast({ title: novoStatus ? 'Marcada como paga' : 'Marcada como pendente' });
    },
    onError: (e: any) => toast({
      title: 'Erro ao atualizar status',
      description: e?.message?.slice(0, 200),
      variant: 'destructive',
    }),
  });

  const updateMutation = useMutation({
    mutationFn: async (tx: { id: string; categoria: string; categoria_id: string | null; subcategoria: string | null; essencial: boolean; ignorar_dashboard: boolean; pago: boolean }) => {
      // Edição simples e direta — só atualiza esta transação. Sem auto-
      // aprendizado, sem "aprender padrão", sem bulk-recategorizar similares.
      // A complexidade anterior gerava bugs ("por que minha despesa virou
      // Saúde sozinha?") sem ganho real — usuário categoriza uma por uma.
      const { error: upErr } = await supabase.from('transacoes').update({
        categoria: tx.categoria,
        categoria_id: tx.categoria_id,
        subcategoria: tx.subcategoria,
        essencial: tx.essencial,
        ignorar_dashboard: tx.ignorar_dashboard,
        pago: tx.pago,
      }).eq('id', tx.id);
      if (upErr) throw upErr;
    },
    onError: (e: any) => toast({
      title: 'Erro ao atualizar transação',
      description: e?.message?.slice(0, 200),
      variant: 'destructive',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      queryClient.invalidateQueries({ queryKey: ['contas'] });
      setEditingTx(null);
      toast({ title: 'Transação atualizada' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Antes de apagar a despesa, se ela tem reembolso vinculado, apaga a
      // receita correspondente — senão a receita órfã fica somando no Dashboard
      // como receita real. O FK self-ref SET NULL não cobre esse caso (só
      // limparia a coluna da despesa, mas a despesa já não existe mais).
      const { data: tx, error: fetchErr } = await supabase
        .from('transacoes')
        .select('reembolso_transacao_id')
        .eq('id', id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (tx?.reembolso_transacao_id) {
        await supabase
          .from('transacoes')
          .delete()
          .eq('id', tx.reembolso_transacao_id)
          .eq('user_id', user!.id);
      }
      const { error: delErr } = await supabase.from('transacoes').delete().eq('id', id);
      if (delErr) throw delErr;
    },
    onSuccess: () => {
      // Invalidar TUDO que depende de transações pra evitar tela estagnada
      // após excluir. Saldos e faturas também recalculam.
      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      queryClient.invalidateQueries({ queryKey: ['contas'] });
      toast({ title: 'Transação excluída' });
    },
    onError: (e: any) => toast({
      title: 'Erro ao excluir transação',
      description: e?.message?.slice(0, 200),
      variant: 'destructive',
    }),
  });

  // Exclusão de parcelamento por ESCOPO:
  //  - 'uma'        → só a parcela atual
  //  - 'a-vencer'   → a atual + todas as parcelas seguintes (parcela_atual >=)
  //  - 'todas'      → a série inteira (todo o grupo_parcela)
  const deleteParcelasMutation = useMutation({
    mutationFn: async ({ tx, escopo }: { tx: any; escopo: 'uma' | 'a-vencer' | 'todas' }) => {
      if (escopo === 'uma' || !tx.grupo_parcela) {
        const { error } = await supabase.from('transacoes').delete().eq('id', tx.id).eq('user_id', user!.id);
        if (error) throw error;
        return;
      }
      let q = supabase.from('transacoes').delete().eq('grupo_parcela', tx.grupo_parcela).eq('user_id', user!.id);
      if (escopo === 'a-vencer') {
        // Da parcela atual pra frente (mantém as já passadas/pagas)
        q = q.gte('parcela_atual', tx.parcela_atual || 1);
      }
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: (_d, { escopo }) => {
      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      queryClient.invalidateQueries({ queryKey: ['contas'] });
      toast({ title: escopo === 'uma' ? 'Parcela excluída' : escopo === 'a-vencer' ? 'Parcelas a vencer excluídas' : 'Parcelamento excluído' });
      setEditingTx(null);
    },
    onError: (e: any) => toast({ title: 'Erro ao excluir', description: e?.message?.slice(0, 200), variant: 'destructive' }),
  });

  // Quando abrir o editor, sincroniza os estados de reembolso com a transação.
  useEffect(() => {
    if (!editingTx) return;
    const temReembolso = !!editingTx.reembolso_transacao_id;
    setEditReembolsoOn(temReembolso);
    setEditReembolsoPessoa(editingTx.reembolso_pessoa || '');
    setEditReembolsoValor(editingTx.reembolso_valor ? String(editingTx.reembolso_valor) : '');
    if (!temReembolso) {
      // default: primeira conta de débito disponível
      const debito = contas?.find(c => c.tipo === 'debito');
      if (debito) setEditContaReembolsoId(debito.id);
    }
  }, [editingTx, contas]);

  // Cria/remove reembolso da despesa em edição. Roda em paralelo ao update
  // normal (categoria/essencial); chamado no onSubmit do form.
  const reembolsoMutation = useMutation({
    mutationFn: async () => {
      if (!editingTx || !user) return;
      const { criarReembolsoVinculado, removerReembolso } = await import('@/lib/reembolso');
      const temAtual = !!editingTx.reembolso_transacao_id;
      // 1) Caso A: já tinha e agora foi desligado → remove
      if (temAtual && !editReembolsoOn) {
        await removerReembolso(user.id, editingTx.id, editingTx.reembolso_transacao_id);
        return;
      }
      // 2) Caso B: novo OU edição → se já tinha, remove o antigo antes
      if (editReembolsoOn) {
        if (!editReembolsoPessoa.trim() || !Number(editReembolsoValor) || !editContaReembolsoId) {
          throw new Error('Preencha pessoa, valor e conta de destino');
        }
        if (temAtual) {
          await removerReembolso(user.id, editingTx.id, editingTx.reembolso_transacao_id);
        }
        await criarReembolsoVinculado({
          userId: user.id,
          despesaId: editingTx.id,
          despesaDescricao: editingTx.descricao,
          despesaData: editingTx.data,
          despesaConta: editingTx.conta_id,
          contaReceitaId: editContaReembolsoId,
          pessoa: editReembolsoPessoa.trim(),
          valor: Number(editReembolsoValor),
          pessoaTitular: editingTx.pessoa || 'Titular',
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      queryClient.invalidateQueries({ queryKey: ['contas'] });
    },
    onError: (e: any) => {
      toast({ title: 'Erro no reembolso', description: e?.message?.slice(0, 200), variant: 'destructive' });
    },
  });

  const handleFilterCategoria = (value: string) => {
    setFilterCategoria(value);
    if (value === 'all') {
      searchParams.delete('categoria');
    } else {
      searchParams.set('categoria', value);
    }
    setSearchParams(searchParams, { replace: true });
  };

  const filtered = useMemo(() => (transacoes?.filter(t => {
    if (!showIgnoradas && t.ignorar_dashboard) return false;
    if (filterCategoria !== 'all' && t.categoria !== filterCategoria) return false;
    if (filterSubcategoria !== 'all' && (t.subcategoria || '') !== filterSubcategoria) return false;
    if (filterTipo !== 'all' && t.tipo !== filterTipo) return false;
    if (filterEssencial === 'true' && !t.essencial) return false;
    if (filterEssencial === 'false' && t.essencial) return false;
    if (filterConta !== 'all' && t.conta_id !== filterConta) return false;
    if (filterPessoa !== 'all' && t.pessoa !== filterPessoa) return false;
    if (filterPago === 'pago' && t.pago === false) return false;
    if (filterPago === 'pendente' && t.pago !== false) return false;
    if (search && !t.descricao.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }) || []), [transacoes, showIgnoradas, filterCategoria, filterSubcategoria, filterTipo, filterEssencial, filterConta, filterPessoa, filterPago, search]);

  // Group filtered transactions by day
  const groupedByDay = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    for (const t of filtered) {
      if (!groups[t.data]) groups[t.data] = [];
      groups[t.data].push(t);
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  // Group filtered transactions by category
  const groupedByCategoria = useMemo(() => {
    const groups: Record<string, { categoria: string; total: number; count: number; transactions: typeof filtered }> = {};
    for (const t of filtered) {
      const cat = t.categoria || 'Outros';
      if (!groups[cat]) groups[cat] = { categoria: cat, total: 0, count: 0, transactions: [] };
      const valor = Number(t.valor);
      groups[cat].total += t.tipo === 'receita' ? valor : -valor;
      groups[cat].count += 1;
      groups[cat].transactions.push(t);
    }
    return Object.values(groups).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [filtered]);

  // Group filtered transactions by parcelamento (grupo_parcela)
  const groupedByParcelamento = useMemo(() => {
    const groups: Record<string, { key: string; descricao: string; total: number; count: number; transactions: typeof filtered; first: any; isParcela: boolean }> = {};
    const standalone: typeof filtered = [];

    for (const t of filtered) {
      if (t.grupo_parcela) {
        if (!groups[t.grupo_parcela]) {
          groups[t.grupo_parcela] = {
            key: t.grupo_parcela,
            descricao: t.descricao,
            total: 0,
            count: 0,
            transactions: [],
            first: t,
            isParcela: !!(t.parcela_atual && t.parcela_total),
          };
        }
        const valor = Number(t.valor);
        groups[t.grupo_parcela].total += t.tipo === 'receita' ? valor : -valor;
        groups[t.grupo_parcela].count += 1;
        groups[t.grupo_parcela].transactions.push(t);
      } else {
        standalone.push(t);
      }
    }

    // Sort each group's transactions by date asc (parcela 1 first)
    for (const g of Object.values(groups)) {
      g.transactions.sort((a, b) => a.data.localeCompare(b.data));
    }

    const groupArray = Object.values(groups).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    return { groups: groupArray, standalone };
  }, [filtered]);

  // Group filtered transactions by account/card
  const groupedByCartao = useMemo(() => {
    const groups: Record<string, { contaId: string; nome: string; tipo: string; total: number; count: number; transactions: typeof filtered }> = {};
    for (const t of filtered) {
      const key = t.conta_id || 'sem-conta';
      if (!groups[key]) {
        const conta = contas?.find(c => c.id === t.conta_id);
        groups[key] = {
          contaId: key,
          nome: conta?.nome || 'Sem conta',
          tipo: conta?.tipo || '',
          total: 0,
          count: 0,
          transactions: [],
        };
      }
      const valor = Number(t.valor);
      groups[key].total += t.tipo === 'receita' ? valor : -valor;
      groups[key].count += 1;
      groups[key].transactions.push(t);
    }
    // Sort each group's transactions by date desc
    for (const g of Object.values(groups)) {
      g.transactions.sort((a, b) => b.data.localeCompare(a.data));
    }
    return Object.values(groups).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [filtered, contas]);

  // Summary totals
  const totalReceitas = filtered.filter(t => t.tipo === 'receita').reduce((s, t) => s + Number(t.valor), 0);
  const totalDespesas = filtered.filter(t => t.tipo === 'despesa').reduce((s, t) => s + Number(t.valor), 0);

  // Filter out empty/null so we never render <SelectItem value=""> (Radix throws on it).
  const pessoas = useMemo(
    () => [...new Set((transacoes?.map(t => t.pessoa) || []).filter((p): p is string => !!p))],
    [transacoes],
  );
  const { getCategoriaById, getDisplayName, getColor } = useCategorias();

  const hasActiveFilters = filterCategoria !== 'all' || filterSubcategoria !== 'all' || filterTipo !== 'all' || filterEssencial !== 'all' || filterConta !== 'all' || filterPessoa !== 'all';

  const formatDayHeader = (dateStr: string) => {
    const date = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const isToday = dateStr === toLocalIso(today);
    const isYesterday = dateStr === toLocalIso(yesterday);

    const dayName = isToday ? 'Hoje' : isYesterday ? 'Ontem' : date.toLocaleDateString('pt-BR', { weekday: 'long' });
    const dayDate = date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });

    return { dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1), dayDate };
  };

  const renderTransactionRow = (t: any) => {
    const catColor = t.categoria_id ? getColor(t.categoria_id) : getCategoriaColor(t.categoria);
    const catName = t.categoria_id ? getDisplayName(t.categoria_id) : t.categoria;
    const contaNome = contas?.find(c => c.id === t.conta_id)?.nome;
    const txDate = new Date(t.data + 'T12:00:00');
    const isPendente = t.pago === false;

    return (
      <div
        key={t.id}
        className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer ${t.ignorar_dashboard ? 'opacity-50' : ''} ${isPendente ? 'border-l-2 border-warning/60' : ''}`}
        onClick={() => setEditingTx({ ...t, subcategoria: null })}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); togglePagoMutation.mutate({ id: t.id, pago: !isPendente }); }}
          title={isPendente ? 'Marcar como pago' : 'Marcar como pendente'}
          className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center hover:scale-105 transition-transform"
          style={{ backgroundColor: catColor + (isPendente ? '10' : '20') }}
        >
          <div
            className={`w-4 h-4 rounded-full ${isPendente ? 'ring-2 ring-warning ring-offset-2 ring-offset-background' : ''}`}
            style={{ backgroundColor: isPendente ? 'transparent' : catColor, border: isPendente ? `2px dashed ${catColor}` : 'none' }}
          />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {t.ignorar_dashboard && <EyeOff className="h-3 w-3 text-muted-foreground shrink-0" />}
            <span className={`text-sm font-medium truncate ${isPendente ? 'italic text-muted-foreground' : ''}`}>{t.descricao}</span>
            {isPendente && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-warning/40 text-warning shrink-0">
                Pendente
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground">
              {txDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </span>
            <span className="text-xs text-muted-foreground">
              {catName}{t.subcategoria ? <span className="opacity-70"> › {t.subcategoria}</span> : null}
            </span>
            {t.parcela_atual && t.parcela_total && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                {t.parcela_atual}/{t.parcela_total}
              </Badge>
            )}
            {/* Despesa com reembolso vinculado — sinaliza visualmente e mostra
                o valor que volta. Útil pra entender de cara qual parcela tem
                "alguém me paga" embutido. */}
            {t.reembolso_pessoa && t.reembolso_valor && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 border-green-300 text-green-700 dark:text-green-400"
                title={`${t.reembolso_pessoa} paga ${formatCurrency(Number(t.reembolso_valor))}`}
              >
                ↩ {t.reembolso_pessoa} · {formatCurrency(Number(t.reembolso_valor))}
              </Badge>
            )}
            {contaNome && (
              <span className="text-[10px] text-muted-foreground">{contaNome}</span>
            )}
            {t.pessoa && (
              <span className="text-[10px] text-muted-foreground">{t.pessoa}</span>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <span className={`text-sm font-semibold ${t.tipo === 'receita' ? 'text-success' : 'text-destructive'}`}>
            {t.tipo === 'receita' ? '+' : '-'}{formatCurrency(Number(t.valor))}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Transações</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { copyToClipboard({ transactions: filtered, contas: contas || [], month, year }).then(() => toast({ title: 'Copiado para área de transferência' })); }}>
            <Copy className="h-4 w-4 mr-1" />Copiar
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportCSV({ transactions: filtered, contas: contas || [], month, year })}>
            <Download className="h-4 w-4 mr-1" />CSV
          </Button>
          <Select value={periodo} onValueChange={(v) => setPeriodo(v as typeof periodo)}>
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mes">Mês selecionado</SelectItem>
              <SelectItem value="12m">Últimos 12 meses</SelectItem>
              <SelectItem value="all">Histórico completo</SelectItem>
            </SelectContent>
          </Select>
          {periodo === 'mes' && (
            <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Receitas</p>
            <p className="text-lg font-bold text-success">{formatCurrency(totalReceitas)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Despesas</p>
            <p className="text-lg font-bold text-destructive">{formatCurrency(totalDespesas)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Saldo</p>
            <p className={`text-lg font-bold ${totalReceitas - totalDespesas >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatCurrency(totalReceitas - totalDespesas)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search + filter toggle */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar transação..."
            aria-label="Buscar transação"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant={hasActiveFilters ? 'default' : 'outline'}
          size="icon"
          aria-label={showFilters ? 'Ocultar filtros' : 'Mostrar filtros'}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      {/* Group by selector */}
      <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 pb-1">
        <span className="text-xs text-muted-foreground shrink-0 mr-1">Agrupar:</span>
        <Button
          size="sm"
          variant={groupBy === 'dia' ? 'default' : 'outline'}
          className="h-7 px-2 text-xs gap-1 shrink-0"
          onClick={() => { setGroupBy('dia'); setExpandedGroups(new Set()); }}
        >
          <Calendar className="h-3 w-3" /> Dia
        </Button>
        <Button
          size="sm"
          variant={groupBy === 'categoria' ? 'default' : 'outline'}
          className="h-7 px-2 text-xs gap-1 shrink-0"
          onClick={() => { setGroupBy('categoria'); setExpandedGroups(new Set()); }}
        >
          <Tag className="h-3 w-3" /> Categoria
        </Button>
        <Button
          size="sm"
          variant={groupBy === 'parcelamento' ? 'default' : 'outline'}
          className="h-7 px-2 text-xs gap-1 shrink-0"
          onClick={() => { setGroupBy('parcelamento'); setExpandedGroups(new Set()); }}
        >
          <Layers className="h-3 w-3" /> Parcelamento
        </Button>
        <Button
          size="sm"
          variant={groupBy === 'cartao' ? 'default' : 'outline'}
          className="h-7 px-2 text-xs gap-1 shrink-0"
          onClick={() => { setGroupBy('cartao'); setExpandedGroups(new Set()); }}
        >
          <CreditCard className="h-3 w-3" /> Cartão/Conta
        </Button>
      </div>

      {/* Collapsible filters */}
      {showFilters && (
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Select value={filterCategoria} onValueChange={handleFilterCategoria}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas categorias</SelectItem>
                  {(filterTipo === 'receita' ? CATEGORIAS_RECEITA : filterTipo === 'despesa' ? CATEGORIAS_DESPESA : CATEGORIAS).map(c => (
                    <SelectItem key={c} value={c}>
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getCategoriaColor(c) }} />
                        {c}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterTipo} onValueChange={v => { setFilterTipo(v); if (v === 'all') { searchParams.delete('tipo'); } else { searchParams.set('tipo', v); } setSearchParams(searchParams, { replace: true }); }}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Receita/Despesa</SelectItem>
                  <SelectItem value="receita">Receitas</SelectItem>
                  <SelectItem value="despesa">Despesas</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterEssencial} onValueChange={v => { setFilterEssencial(v); if (v === 'all') { searchParams.delete('essencial'); } else { searchParams.set('essencial', v); } setSearchParams(searchParams, { replace: true }); }}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Essencial" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="true">Essenciais</SelectItem>
                  <SelectItem value="false">Dispensáveis</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterPago} onValueChange={(v) => setFilterPago(v as typeof filterPago)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos status</SelectItem>
                  <SelectItem value="pago">Pagos / Recebidos</SelectItem>
                  <SelectItem value="pendente">Pendentes</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterConta} onValueChange={setFilterConta}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Conta" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas contas</SelectItem>
                  {contas?.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterPessoa} onValueChange={setFilterPessoa}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pessoa" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas pessoas</SelectItem>
                  {pessoas.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-ignoradas"
                  checked={showIgnoradas}
                  onCheckedChange={(v) => setShowIgnoradas(!!v)}
                />
                <Label htmlFor="show-ignoradas" className="text-xs cursor-pointer">Ignoradas</Label>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active filter badges */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Filtros:</span>
          {filterTipo !== 'all' && (
            <Badge variant="secondary" className="cursor-pointer text-xs" onClick={() => { setFilterTipo('all'); searchParams.delete('tipo'); setSearchParams(searchParams, { replace: true }); }}>
              {filterTipo === 'receita' ? 'Receitas' : 'Despesas'} ✕
            </Badge>
          )}
          {filterCategoria !== 'all' && (
            <Badge variant="secondary" className="cursor-pointer text-xs" onClick={() => handleFilterCategoria('all')}>
              {filterCategoria} ✕
            </Badge>
          )}
          {filterSubcategoria !== 'all' && (
            <Badge variant="secondary" className="cursor-pointer text-xs" onClick={() => { setFilterSubcategoria('all'); searchParams.delete('subcategoria'); setSearchParams(searchParams, { replace: true }); }}>
              › {filterSubcategoria} ✕
            </Badge>
          )}
          {filterEssencial !== 'all' && (
            <Badge variant="secondary" className="cursor-pointer text-xs" onClick={() => { setFilterEssencial('all'); searchParams.delete('essencial'); setSearchParams(searchParams, { replace: true }); }}>
              {filterEssencial === 'true' ? 'Essenciais' : 'Dispensáveis'} ✕
            </Badge>
          )}
          {filterConta !== 'all' && (
            <Badge variant="secondary" className="cursor-pointer text-xs" onClick={() => setFilterConta('all')}>
              {contas?.find(c => c.id === filterConta)?.nome || 'Conta'} ✕
            </Badge>
          )}
          {filterPessoa !== 'all' && (
            <Badge variant="secondary" className="cursor-pointer text-xs" onClick={() => setFilterPessoa('all')}>
              {filterPessoa} ✕
            </Badge>
          )}
        </div>
      )}

      {/* Transaction list */}
      <div className="space-y-4">
        {groupBy === 'dia' && groupedByDay.map(([dateStr, txs]) => {
          const { dayName, dayDate } = formatDayHeader(dateStr);
          const dayTotal = txs.reduce((s, t) => s + (t.tipo === 'receita' ? Number(t.valor) : -Number(t.valor)), 0);

          return (
            <div key={dateStr}>
              {/* Day header */}
              <div className="flex items-center justify-between px-1 mb-2">
                <div>
                  <span className="text-sm font-semibold">{dayName}</span>
                  <span className="text-xs text-muted-foreground ml-2">{dayDate}</span>
                </div>
                <span className={`text-sm font-medium ${dayTotal >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {dayTotal >= 0 ? '+' : ''}{formatCurrency(dayTotal)}
                </span>
              </div>

              <Card>
                <CardContent className="p-0 divide-y divide-border">
                  {txs.map(t => renderTransactionRow(t))}
                </CardContent>
              </Card>
            </div>
          );
        })}

        {groupBy === 'categoria' && groupedByCategoria.map(g => {
          const isOpen = expandedGroups.has(`cat-${g.categoria}`);
          const catColor = getCategoriaColor(g.categoria);
          return (
            <Card key={g.categoria}>
              <button
                type="button"
                onClick={() => toggleGroup(`cat-${g.categoria}`)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                <div
                  className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center"
                  style={{ backgroundColor: catColor + '20' }}
                >
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: catColor }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold truncate">{g.categoria}</span>
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{g.count}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {isOpen ? 'Toque para recolher' : 'Toque para ver transações'}
                  </span>
                </div>
                <div className="text-right shrink-0 flex items-center gap-2">
                  <span className={`text-sm font-semibold ${g.total >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {g.total >= 0 ? '+' : ''}{formatCurrency(g.total)}
                  </span>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </button>
              {isOpen && (
                <CardContent className="p-0 border-t divide-y divide-border">
                  {g.transactions.map(t => renderTransactionRow(t))}
                </CardContent>
              )}
            </Card>
          );
        })}

        {groupBy === 'parcelamento' && (
          <>
            {groupedByParcelamento.groups.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 px-1">
                  Parcelamentos / Recorrências ({groupedByParcelamento.groups.length})
                </p>
                <Card>
                  <CardContent className="p-0 divide-y divide-border">
                    {groupedByParcelamento.groups.map(g => {
                      const key = `parc-${g.key}`;
                      const isOpen = expandedGroups.has(key);
                      const t = g.first;
                      const catColor = t.categoria_id ? getColor(t.categoria_id) : getCategoriaColor(t.categoria);
                      const contaNome = contas?.find(c => c.id === t.conta_id)?.nome;
                      const lastT = g.transactions[g.transactions.length - 1];
                      const firstDate = new Date(g.transactions[0].data + 'T12:00:00');
                      const lastDate = new Date(lastT.data + 'T12:00:00');
                      const baseDescricao = t.descricao.replace(/\s*\d{1,2}\/\d{1,2}\s*$/, '');

                      return (
                        <div key={g.key}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(key)}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                          >
                            <div
                              className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center"
                              style={{ backgroundColor: catColor + '20' }}
                            >
                              <Layers className="h-4 w-4" style={{ color: catColor }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium truncate">{baseDescricao}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                                  {g.count}x
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">
                                  {firstDate.toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' })}
                                  {' → '}
                                  {lastDate.toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' })}
                                </span>
                                {contaNome && (
                                  <span className="text-[10px] text-muted-foreground">{contaNome}</span>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0 flex items-center gap-2">
                              <div>
                                <span className={`text-sm font-semibold ${g.total >= 0 ? 'text-success' : 'text-destructive'}`}>
                                  {g.total >= 0 ? '+' : '-'}{formatCurrency(Math.abs(g.total))}
                                </span>
                                <p className="text-[10px] text-muted-foreground">
                                  {g.count}× {formatCurrency(Number(t.valor))}
                                </p>
                              </div>
                              {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                            </div>
                          </button>
                          {isOpen && (
                            <div className="border-t divide-y divide-border bg-muted/20">
                              {g.transactions.map(tx => renderTransactionRow(tx))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </div>
            )}
            {groupedByParcelamento.standalone.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 px-1">
                  Avulsas ({groupedByParcelamento.standalone.length})
                </p>
                <Card>
                  <CardContent className="p-0 divide-y divide-border">
                    {groupedByParcelamento.standalone.map(t => renderTransactionRow(t))}
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}

        {groupBy === 'cartao' && groupedByCartao.map(g => {
          const isOpen = expandedGroups.has(`conta-${g.contaId}`);
          const isCredito = g.tipo === 'credito';
          return (
            <Card key={g.contaId}>
              <button
                type="button"
                onClick={() => toggleGroup(`conta-${g.contaId}`)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center bg-muted">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold truncate">{g.nome}</span>
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                      {isCredito ? 'Cartão' : 'Conta'}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{g.count}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {isOpen ? 'Toque para recolher' : 'Toque para ver transações'}
                  </span>
                </div>
                <div className="text-right shrink-0 flex items-center gap-2">
                  <span className={`text-sm font-semibold ${g.total >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {g.total >= 0 ? '+' : ''}{formatCurrency(g.total)}
                  </span>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </button>
              {isOpen && (
                <CardContent className="p-0 border-t divide-y divide-border">
                  {g.transactions.map(t => renderTransactionRow(t))}
                </CardContent>
              )}
            </Card>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Nenhuma transação encontrada</p>
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingTx} onOpenChange={() => setEditingTx(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Editar Transação</DialogTitle>
          </DialogHeader>
          {editingTx && (
            <form onSubmit={(e) => {
              e.preventDefault();
              updateMutation.mutate({
                id: editingTx.id,
                categoria: editingTx.categoria,
                categoria_id: editingTx.categoria_id || null,
                subcategoria: editingTx.subcategoria || null,
                essencial: editingTx.essencial,
                ignorar_dashboard: editingTx.ignorar_dashboard || false,
                pago: editingTx.pago !== false, // default true se undefined
              });
              // Reembolso roda em paralelo — falha aqui não quebra o save da
              // categoria; o erro vira toast separado.
              const reembolsoMudou =
                !!editingTx.reembolso_transacao_id !== editReembolsoOn ||
                (editReembolsoOn && (
                  editReembolsoPessoa !== (editingTx.reembolso_pessoa || '') ||
                  Number(editReembolsoValor) !== Number(editingTx.reembolso_valor || 0)
                ));
              if (reembolsoMudou) reembolsoMutation.mutate();
            }} className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 min-w-0">
                <div
                  className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center"
                  style={{ backgroundColor: (editingTx.categoria_id ? getColor(editingTx.categoria_id) : getCategoriaColor(editingTx.categoria)) + '20' }}
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: editingTx.categoria_id ? getColor(editingTx.categoria_id) : getCategoriaColor(editingTx.categoria) }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium break-words">{editingTx.descricao}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(editingTx.data)} · {formatCurrency(Number(editingTx.valor))}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Categoria</Label>
                <CategoriaSelector
                  value={editingTx.categoria_id}
                  tipoFilter={editingTx.tipo}
                  onValueChange={(catId) => {
                    const cat = getCategoriaById(catId);
                    setEditingTx({
                      ...editingTx,
                      categoria_id: catId,
                      categoria: cat?.nome || editingTx.categoria,
                      subcategoria: null, // troca de categoria zera a sub
                      essencial: CATEGORIAS_CONFIG[cat?.nome || '']?.essencial ?? editingTx.essencial,
                    });
                  }}
                />
              </div>
              {/* Subcategoria — só aparece se a categoria tem subs definidas */}
              {getSubcategorias(editingTx.categoria).length > 0 && (
                <div className="space-y-2">
                  <Label>Subcategoria</Label>
                  <Select
                    value={editingTx.subcategoria || '__none__'}
                    onValueChange={(v) => setEditingTx({ ...editingTx, subcategoria: v === '__none__' ? null : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— sem subcategoria —</SelectItem>
                      {getSubcategorias(editingTx.categoria).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center justify-between">
                <Label>Essencial</Label>
                <Switch checked={editingTx.essencial} onCheckedChange={v => setEditingTx({ ...editingTx, essencial: v })} />
              </div>
              {/* Toggle pago/pendente (modelo Mobills). Antes só dava pra
                  alternar pelo bullet da linha — agora também no editor. */}
              <div className="flex items-center justify-between rounded-lg border p-3 min-w-0">
                <div className="min-w-0 flex-1">
                  <Label className="text-sm font-medium cursor-pointer">
                    {editingTx.tipo === 'receita' ? 'Já recebi' : 'Já paguei'}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {(editingTx.pago !== false)
                      ? 'Contabiliza no saldo da conta'
                      : 'Pendente — aparece em Próximos Vencimentos'}
                  </p>
                </div>
                <Switch
                  checked={editingTx.pago !== false}
                  onCheckedChange={v => setEditingTx({ ...editingTx, pago: v })}
                />
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3 min-w-0">
                <Checkbox
                  id="ignorar-dashboard"
                  checked={editingTx.ignorar_dashboard || false}
                  onCheckedChange={(v) => setEditingTx({ ...editingTx, ignorar_dashboard: !!v })}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <Label htmlFor="ignorar-dashboard" className="text-sm font-medium cursor-pointer">Ignorar no dashboard</Label>
                  <p className="text-xs text-muted-foreground">Não contabilizar nos totais</p>
                </div>
              </div>
              {/* Reembolso por outra pessoa — só aparece em despesa.
                  Se já tem reembolso vinculado, mostra info; senão, toggle pra
                  criar. Ao salvar, dispara reembolsoMutation. */}
              {editingTx.tipo === 'despesa' && (
                <div className="space-y-3 rounded-lg border p-3 min-w-0">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="edit-reembolso"
                      checked={editReembolsoOn}
                      onCheckedChange={(v) => {
                        const on = !!v;
                        setEditReembolsoOn(on);
                        if (on && !editReembolsoValor && editingTx.valor) {
                          setEditReembolsoValor(String(editingTx.valor));
                        }
                      }}
                      className="mt-0.5 shrink-0"
                    />
                    <Label htmlFor="edit-reembolso" className="cursor-pointer text-sm font-medium">
                      Outra pessoa paga (parte ou total) — cria receita
                    </Label>
                  </div>
                  {editReembolsoOn && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1 min-w-0">
                          <Label className="text-xs text-muted-foreground">Pessoa</Label>
                          <Input
                            value={editReembolsoPessoa}
                            onChange={(e) => setEditReembolsoPessoa(e.target.value)}
                            placeholder="Ex: Maiara"
                          />
                        </div>
                        <div className="space-y-1 min-w-0">
                          <Label className="text-xs text-muted-foreground">
                            Valor (de {formatCurrency(Number(editingTx.valor))})
                          </Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max={editingTx.valor}
                            value={editReembolsoValor}
                            onChange={(e) => setEditReembolsoValor(e.target.value)}
                            placeholder="0,00"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Receber em</Label>
                        <Select value={editContaReembolsoId} onValueChange={setEditContaReembolsoId}>
                          <SelectTrigger><SelectValue placeholder="Conta" /></SelectTrigger>
                          <SelectContent>
                            {contas?.filter((c: any) => c.tipo === 'debito').map((c: any) => (
                              <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {editingTx.reembolso_transacao_id ? (
                        <p className="text-xs text-amber-600">
                          ⚠️ Já existe uma receita de reembolso vinculada. Salvar VAI substituir pelos valores acima.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  type="submit"
                  disabled={updateMutation.isPending || reembolsoMutation.isPending}
                >
                  {updateMutation.isPending ? 'Salvando…' : 'Salvar'}
                </Button>
                {/* Parcelado → abre escolha de escopo. Não-parcelado → confirm simples. */}
                {editingTx.grupo_parcela && editingTx.parcela_total > 1 ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    aria-label="Excluir parcelamento"
                    onClick={() => setParcelaDelOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : (
                  <ConfirmDelete
                    onConfirm={() => {
                      deleteMutation.mutate(editingTx.id);
                      setEditingTx(null);
                    }}
                    title={`Excluir "${editingTx.descricao}"?`}
                    description={
                      editingTx.reembolso_transacao_id
                        ? 'A receita de reembolso vinculada também será removida automaticamente.'
                        : 'Esta transação será removida permanentemente.'
                    }
                    trigger={
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        aria-label="Excluir transação"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    }
                  />
                )}
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Escolha de escopo pra excluir parcelamento */}
      <Dialog open={parcelaDelOpen} onOpenChange={setParcelaDelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir parcelamento</DialogTitle>
          </DialogHeader>
          {editingTx && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                "{editingTx.descricao}" — parcela {editingTx.parcela_atual}/{editingTx.parcela_total}. O que você quer excluir?
              </p>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => { deleteParcelasMutation.mutate({ tx: editingTx, escopo: 'uma' }); setParcelaDelOpen(false); }}
                  disabled={deleteParcelasMutation.isPending}
                >
                  Só esta parcela ({editingTx.parcela_atual}/{editingTx.parcela_total})
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => { deleteParcelasMutation.mutate({ tx: editingTx, escopo: 'a-vencer' }); setParcelaDelOpen(false); }}
                  disabled={deleteParcelasMutation.isPending}
                >
                  Esta e as próximas (a vencer)
                </Button>
                <Button
                  variant="destructive"
                  className="w-full justify-start"
                  onClick={() => { deleteParcelasMutation.mutate({ tx: editingTx, escopo: 'todas' }); setParcelaDelOpen(false); }}
                  disabled={deleteParcelasMutation.isPending}
                >
                  Todas as {editingTx.parcela_total} parcelas (série inteira)
                </Button>
              </div>
              <Button variant="ghost" className="w-full" onClick={() => setParcelaDelOpen(false)}>
                Cancelar
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
