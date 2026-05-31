import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTodayIso } from '@/hooks/useTodayIso';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, getMonthName } from '@/lib/format';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PenLine, AlertTriangle, Calendar, Tag, Layers, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import { getCategoriaColor } from '@/types/database.types';
import { ManualTransactionModal } from '@/components/contas/ManualTransactionModal';
import { useFaturaAcumulada } from '@/hooks/useFaturaAcumulada';
import { isDevolution, generateHash } from '@/lib/csv-parser';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardId: string;
  cardName: string;
  start: string;
  end: string;
  month: number;
  year: number;
}

export function FaturaDrawer({ open, onOpenChange, cardId, cardName, start, end, month, year }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const todayIso = useTodayIso();
  const billingPeriod = `${year}-${String(month + 1).padStart(2, '0')}`;
  const [manualTxOpen, setManualTxOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<'data' | 'categoria' | 'parcelamento'>('data');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [pagamentoOpen, setPagamentoOpen] = useState(false);
  const [pagContaId, setPagContaId] = useState<string>('');
  const [pagData, setPagData] = useState<string>(todayIso);
  const [pagValor, setPagValor] = useState<string>('');

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const { data: faturaAcumulada } = useFaturaAcumulada(
    open ? [cardId] : [],
    billingPeriod
  );
  const acumulado = faturaAcumulada?.[cardId];

  const { data: transacoes } = useQuery({
    queryKey: ['fatura-detail', cardId, billingPeriod],
    queryFn: async () => {
      // Get by billing period first (no ignorar_dashboard filter — fatura
      // view needs to show payment entries for accurate balance tracking)
      const { data: byPeriod } = await supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .eq('conta_id', cardId)
        .eq('mes_competencia', billingPeriod)
        .order('data', { ascending: false });

      // Fallback for old imports without mes_competencia
      const { data: byDate } = await supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .eq('conta_id', cardId)
        .is('mes_competencia', null)
        .gte('data', start)
        .lte('data', end)
        .order('data', { ascending: false });
      
      return [...(byPeriod || []), ...(byDate || [])];
    },
    enabled: open && !!user,
  });

  // Contas de débito (CC) pra escolher de onde sai o pagamento da fatura.
  const { data: contasDebito } = useQuery({
    queryKey: ['contas-debito', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('contas')
        .select('id, nome')
        .eq('user_id', user!.id)
        .eq('tipo', 'debito')
        .order('nome');
      return data || [];
    },
    enabled: open && !!user,
  });

  // Mutation: cria a transação de baixa da fatura na conta corrente escolhida.
  // Descrição "Pag Fat Deb Cc - {Card}" — sufixo com nome do cartão é o que o
  // regex `isConciliacaoPayment` exige (diferencia do lado interno do extrato
  // do próprio cartão, que vem sem sufixo). Marcamos como ignorar_dashboard
  // pra não dobrar despesa (a fatura JÁ aparece como despesa via cartão).
  const baixaMutation = useMutation({
    mutationFn: async ({ contaId, data, valor }: { contaId: string; data: string; valor: number }) => {
      const descricao = `Pag Fat Deb Cc - ${cardName}`;
      const hash = generateHash(data, descricao, valor, '') + '_baixa_' + cardId.slice(0, 8);
      const { error } = await supabase.from('transacoes').insert({
        user_id: user!.id,
        conta_id: contaId,
        data,
        descricao,
        descricao_normalizada: descricao.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(),
        valor,
        tipo: 'despesa',
        categoria: 'Operação bancária',
        essencial: true,
        hash_transacao: hash,
        pessoa: '',
        mes_competencia: billingPeriod,
        ignorar_dashboard: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Fatura marcada como paga' });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-detail'] });
      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setPagamentoOpen(false);
    },
    onError: (e: any) => {
      toast({ title: 'Erro ao registrar baixa', description: String(e?.message || e), variant: 'destructive' });
    },
  });

  const abrirBaixa = () => {
    const sugerido = (acumulado?.totalAPagar || acumulado?.valorFatura || 0);
    setPagValor(sugerido.toFixed(2));
    setPagData(todayIso);
    // Pre-seleciona a primeira conta débito (geralmente a CC principal).
    if (!pagContaId && contasDebito && contasDebito.length > 0) {
      setPagContaId(contasDebito[0].id);
    }
    setPagamentoOpen(true);
  };

  const despesas = transacoes?.filter(t => t.tipo === 'despesa') || [];
  const estornos = transacoes?.filter(t => t.tipo === 'receita' && isDevolution(t.descricao)) || [];
  const totalDespesas = despesas.reduce((s, t) => s + Number(t.valor), 0);
  const totalEstornos = estornos.reduce((s, t) => s + Math.abs(Number(t.valor)), 0);
  const total = totalDespesas - totalEstornos;

  const porCategoria = despesas.reduce((acc, t) => {
    const cat = t.categoria || 'Outros';
    acc[cat] = (acc[cat] || 0) + Number(t.valor);
    return acc;
  }, {} as Record<string, number>);

  const catRanking = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);

  // Group expenses by category
  const despesasPorCategoria = useMemo(() => {
    const groups: Record<string, { categoria: string; total: number; count: number; items: typeof despesas }> = {};
    for (const t of despesas) {
      const cat = t.categoria || 'Outros';
      if (!groups[cat]) groups[cat] = { categoria: cat, total: 0, count: 0, items: [] };
      groups[cat].total += Number(t.valor);
      groups[cat].count += 1;
      groups[cat].items.push(t);
    }
    return Object.values(groups).sort((a, b) => b.total - a.total);
  }, [despesas]);

  // Group expenses by parcelamento (grupo_parcela)
  const despesasPorParcelamento = useMemo(() => {
    const groups: Record<string, { key: string; descricao: string; total: number; count: number; items: typeof despesas; first: any }> = {};
    const standalone: typeof despesas = [];
    for (const t of despesas) {
      if (t.grupo_parcela) {
        if (!groups[t.grupo_parcela]) {
          groups[t.grupo_parcela] = {
            key: t.grupo_parcela,
            descricao: t.descricao,
            total: 0,
            count: 0,
            items: [],
            first: t,
          };
        }
        groups[t.grupo_parcela].total += Number(t.valor);
        groups[t.grupo_parcela].count += 1;
        groups[t.grupo_parcela].items.push(t);
      } else {
        standalone.push(t);
      }
    }
    const groupArray = Object.values(groups).sort((a, b) => b.total - a.total);
    return { groups: groupArray, standalone };
  }, [despesas]);

  const renderTxRow = (t: any) => (
    <div key={t.id} className="flex items-center justify-between py-1.5 text-sm border-b border-border/50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs shrink-0">
            {new Date(t.data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
          </span>
          <span className="truncate">{t.descricao}</span>
        </div>
        <span className="text-xs text-muted-foreground">{t.categoria}</span>
      </div>
      <span className="font-medium text-destructive shrink-0 ml-2">{formatCurrency(Number(t.valor))}</span>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Fatura {cardName} — {getMonthName(month)}/{year}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs"
            onClick={() => setManualTxOpen(true)}
          >
            <PenLine className="h-3 w-3 mr-1" /> Adicionar Lançamento Manual
          </Button>

          {/* Resumo acumulado */}
          {acumulado && (
            <Card className="border-border/50">
              <CardContent className="p-3 space-y-1.5">
                {acumulado.saldoAnterior > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Saldo anterior (acumulado)
                    </span>
                    <span className="font-semibold text-warning">{formatCurrency(acumulado.saldoAnterior)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Fatura do mês</span>
                  <span className="font-medium">{formatCurrency(acumulado.valorFatura)}</span>
                </div>
                {acumulado.pagamentosMes > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Pagamentos</span>
                    <span className="font-medium text-success">-{formatCurrency(acumulado.pagamentosMes)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between text-sm font-bold">
                  <span>Total a pagar</span>
                  <span className={acumulado.totalAPagar > 0 ? 'text-destructive' : 'text-success'}>
                    {formatCurrency(Math.max(0, acumulado.totalAPagar))}
                  </span>
                </div>
                {acumulado.totalAPagar > 0 && (
                  <Button
                    size="sm"
                    className="w-full mt-2 text-xs"
                    onClick={abrirBaixa}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Marcar como paga
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Histórico de meses anteriores com saldo */}
          {acumulado && acumulado.saldoAnterior > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Meses anteriores com saldo pendente</p>
                {acumulado.historico
                  .filter(h => h.periodo < billingPeriod && h.saldo > 0)
                  .map(h => {
                    const [y, m] = h.periodo.split('-').map(Number);
                    return (
                      <div key={h.periodo} className="flex justify-between text-xs py-1 border-b border-border/30">
                        <span className="text-muted-foreground">{getMonthName(m - 1)}/{y}</span>
                        <span>
                          <span className="text-muted-foreground mr-2">
                            {formatCurrency(h.despesas)} - {formatCurrency(h.pagamentos)}
                          </span>
                          <span className="font-medium text-warning">= {formatCurrency(h.saldo)}</span>
                        </span>
                      </div>
                    );
                  })}
              </div>
            </>
          )}

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Transações do mês</p>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={groupBy === 'data' ? 'default' : 'outline'}
                className="h-6 px-1.5 text-[10px] gap-1"
                onClick={() => { setGroupBy('data'); setExpandedGroups(new Set()); }}
              >
                <Calendar className="h-3 w-3" /> Data
              </Button>
              <Button
                size="sm"
                variant={groupBy === 'categoria' ? 'default' : 'outline'}
                className="h-6 px-1.5 text-[10px] gap-1"
                onClick={() => { setGroupBy('categoria'); setExpandedGroups(new Set()); }}
              >
                <Tag className="h-3 w-3" /> Categoria
              </Button>
              <Button
                size="sm"
                variant={groupBy === 'parcelamento' ? 'default' : 'outline'}
                className="h-6 px-1.5 text-[10px] gap-1"
                onClick={() => { setGroupBy('parcelamento'); setExpandedGroups(new Set()); }}
              >
                <Layers className="h-3 w-3" /> Parcelas
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            {despesas.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma transação nesta fatura</p>
            )}

            {groupBy === 'data' && despesas.map(t => renderTxRow(t))}

            {groupBy === 'categoria' && despesasPorCategoria.map(g => {
              const isOpen = expandedGroups.has(`cat-${g.categoria}`);
              const catColor = getCategoriaColor(g.categoria);
              return (
                <div key={g.categoria} className="border-b border-border/50">
                  <button
                    type="button"
                    onClick={() => toggleGroup(`cat-${g.categoria}`)}
                    className="w-full flex items-center gap-2 py-2 hover:bg-muted/30 transition-colors text-left"
                  >
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: catColor }} />
                    <span className="text-sm font-medium flex-1 truncate">{g.categoria}</span>
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{g.count}</Badge>
                    <span className="text-sm font-semibold text-destructive">{formatCurrency(g.total)}</span>
                    {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                  {isOpen && (
                    <div className="pl-4 pb-1 bg-muted/10">
                      {g.items.map(t => renderTxRow(t))}
                    </div>
                  )}
                </div>
              );
            })}

            {groupBy === 'parcelamento' && (
              <>
                {despesasPorParcelamento.groups.length > 0 && (
                  <>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase mt-1">
                      Parcelamentos
                    </p>
                    {despesasPorParcelamento.groups.map(g => {
                      const isOpen = expandedGroups.has(`parc-${g.key}`);
                      const t = g.first;
                      const baseDescricao = t.descricao.replace(/\s*\d{1,2}\/\d{1,2}\s*$/, '');
                      return (
                        <div key={g.key} className="border-b border-border/50">
                          <button
                            type="button"
                            onClick={() => toggleGroup(`parc-${g.key}`)}
                            className="w-full flex items-center gap-2 py-2 hover:bg-muted/30 transition-colors text-left"
                          >
                            <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium truncate block">{baseDescricao}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {g.count}× nesta fatura · {t.categoria}
                              </span>
                            </div>
                            <span className="text-sm font-semibold text-destructive">{formatCurrency(g.total)}</span>
                            {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                          </button>
                          {isOpen && (
                            <div className="pl-4 pb-1 bg-muted/10">
                              {g.items.map(it => renderTxRow(it))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
                {despesasPorParcelamento.standalone.length > 0 && (
                  <>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase mt-2">
                      Compras avulsas
                    </p>
                    {despesasPorParcelamento.standalone.map(t => renderTxRow(t))}
                  </>
                )}
              </>
            )}
          </div>

          {catRanking.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Por categoria</p>
                {catRanking.map(([cat, val]) => (
                  <div key={cat} className="flex justify-between text-sm py-0.5">
                    <span>{cat}</span>
                    <span className="font-medium">{formatCurrency(val)}</span>
                  </div>
                ))}
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-sm">
                <span>Total da fatura</span>
                <span className="text-destructive">{formatCurrency(total)}</span>
              </div>
            </>
          )}
        </div>

        <ManualTransactionModal
          open={manualTxOpen}
          onOpenChange={setManualTxOpen}
          contaId={cardId}
          contaNome={cardName}
          contaTipo="credito"
          defaultMesCompetencia={billingPeriod}
        />

        <Dialog open={pagamentoOpen} onOpenChange={setPagamentoOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Marcar fatura como paga</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <p className="text-xs text-muted-foreground">
                Lança a baixa na sua conta corrente como "Pag Fat Deb Cc - {cardName}".
                A fatura do cartão fica como conciliada (não duplica despesa).
              </p>
              <div className="space-y-1">
                <Label htmlFor="conta-pag" className="text-xs">Conta de débito</Label>
                <Select value={pagContaId} onValueChange={setPagContaId}>
                  <SelectTrigger id="conta-pag">
                    <SelectValue placeholder="Escolha a conta" />
                  </SelectTrigger>
                  <SelectContent>
                    {(contasDebito || []).map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="data-pag" className="text-xs">Data do pagamento</Label>
                  <Input
                    id="data-pag"
                    type="date"
                    value={pagData}
                    onChange={(e) => setPagData(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="valor-pag" className="text-xs">Valor (R$)</Label>
                  <Input
                    id="valor-pag"
                    type="number"
                    step="0.01"
                    min="0"
                    value={pagValor}
                    onChange={(e) => setPagValor(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPagamentoOpen(false)}>Cancelar</Button>
              <Button
                disabled={!pagContaId || !pagData || !pagValor || Number(pagValor) <= 0 || baixaMutation.isPending}
                onClick={() => baixaMutation.mutate({
                  contaId: pagContaId,
                  data: pagData,
                  valor: Number(pagValor),
                })}
              >
                {baixaMutation.isPending ? 'Salvando...' : 'Confirmar baixa'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
