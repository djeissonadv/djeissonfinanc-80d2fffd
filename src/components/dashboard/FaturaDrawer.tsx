import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency, getMonthName } from '@/lib/format';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PenLine, AlertTriangle, Calendar, Tag, Layers, ChevronDown, ChevronUp, DollarSign, ChevronLeft, ChevronRight } from 'lucide-react';
import { getCategoriaColor } from '@/types/database.types';
import { ManualTransactionModal } from '@/components/contas/ManualTransactionModal';
import { PaymentModal } from '@/components/contas/PaymentModal';
import { useFaturaAcumulada } from '@/hooks/useFaturaAcumulada';
import { isDevolution } from '@/lib/csv-parser';
import { getFaturaStatus, getFaturaTotalAPagar } from '@/lib/fatura-status';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardId: string;
  cardName: string;
  start: string; // ignorado se mês mudar internamente
  end: string;
  month: number;
  year: number;
}

/**
 * Drawer pra visualizar a fatura de um cartão. Permite:
 * - Navegar entre meses (setas <- / ->)
 * - Ver resumo (saldo anterior + despesas + pagamentos + total a pagar)
 * - Listar transações agrupadas por data/categoria/parcelamento
 * - Lançar transação manual
 * - Pagar fatura (delega pro PaymentModal — não tem Dialog próprio)
 */
export function FaturaDrawer({ open, onOpenChange, cardId, cardName, month: initialMonth, year: initialYear }: Props) {
  const { user } = useAuth();
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);
  const [manualTxOpen, setManualTxOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<'data' | 'categoria' | 'parcelamento'>('data');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const billingPeriod = `${year}-${String(month + 1).padStart(2, '0')}`;

  // Reset interno quando o drawer reabre com mês diferente vindo da prop
  useMemo(() => {
    if (open) {
      setMonth(initialMonth);
      setYear(initialYear);
    }
  }, [open, initialMonth, initialYear]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const { data: faturaAcumulada } = useFaturaAcumulada(open ? [cardId] : [], billingPeriod);
  const acumulado = faturaAcumulada?.[cardId];

  // Transações do mês (pra listagem detalhada — separado do hook).
  const { data: transacoes } = useQuery({
    queryKey: ['fatura-detail', cardId, billingPeriod],
    queryFn: async () => {
      const { data: byPeriod } = await supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .eq('conta_id', cardId)
        .eq('mes_competencia', billingPeriod)
        .order('data', { ascending: false });
      return byPeriod || [];
    },
    enabled: open && !!user,
  });

  const despesas = (transacoes || []).filter(t => t.tipo === 'despesa' && !t.ignorar_dashboard);
  const estornos = (transacoes || []).filter(t => t.tipo === 'receita' && isDevolution(t.descricao));

  const porCategoria = despesas.reduce((acc, t) => {
    const cat = t.categoria || 'Outros';
    acc[cat] = (acc[cat] || 0) + Number(t.valor);
    return acc;
  }, {} as Record<string, number>);
  const catRanking = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);

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

  const despesasPorParcelamento = useMemo(() => {
    const groups: Record<string, { key: string; descricao: string; total: number; count: number; items: typeof despesas; first: any }> = {};
    const standalone: typeof despesas = [];
    for (const t of despesas) {
      if (t.grupo_parcela) {
        if (!groups[t.grupo_parcela]) {
          groups[t.grupo_parcela] = { key: t.grupo_parcela, descricao: t.descricao, total: 0, count: 0, items: [], first: t };
        }
        groups[t.grupo_parcela].total += Number(t.valor);
        groups[t.grupo_parcela].count += 1;
        groups[t.grupo_parcela].items.push(t);
      } else {
        standalone.push(t);
      }
    }
    return { groups: Object.values(groups).sort((a, b) => b.total - a.total), standalone };
  }, [despesas]);

  const status = acumulado ? getFaturaStatus(acumulado) : null;
  const totalAPagar = acumulado ? getFaturaTotalAPagar(acumulado) : 0;

  const renderTxRow = (t: any) => (
    <div key={t.id} className="flex items-center justify-between py-1.5 text-sm border-b border-border/50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs shrink-0 tabular">
            {new Date(t.data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
          </span>
          <span className="truncate">{t.descricao}</span>
        </div>
        <span className="text-xs text-muted-foreground">{t.categoria}</span>
      </div>
      <span className="font-medium text-destructive shrink-0 ml-2 tabular">{formatCurrency(Number(t.valor))}</span>
    </div>
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between">
              <span>{cardName}</span>
              {status && (
                <Badge variant="outline" className={`text-xs ${status.className}`}>
                  {status.emoji} {status.label}
                </Badge>
              )}
            </SheetTitle>
            <div className="flex items-center gap-2 pt-1">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={prevMonth}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-sm font-medium min-w-[120px] text-center tabular">
                {getMonthName(month)} {year}
              </span>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={nextMonth}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            {/* Ações */}
            <div className="grid grid-cols-2 gap-2">
              {totalAPagar > 0 && (
                <Button size="sm" onClick={() => setPaymentOpen(true)} className="text-xs">
                  <DollarSign className="h-3 w-3 mr-1" /> Pagar fatura
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setManualTxOpen(true)}
                className={`text-xs ${totalAPagar > 0 ? '' : 'col-span-2'}`}
              >
                <PenLine className="h-3 w-3 mr-1" /> Lançamento manual
              </Button>
            </div>

            {/* Resumo acumulado */}
            {acumulado && (
              <div className="rounded-2xl border bg-secondary/30 p-3 space-y-1.5">
                {acumulado.saldoAnterior > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Saldo anterior
                    </span>
                    <span className="font-semibold text-warning tabular">{formatCurrency(acumulado.saldoAnterior)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Despesas do mês</span>
                  <span className="font-medium tabular">{formatCurrency(acumulado.despesasMes)}</span>
                </div>
                {acumulado.pagamentosMes > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Pagamentos</span>
                    <span className="font-medium text-success tabular">-{formatCurrency(acumulado.pagamentosMes)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between text-sm font-bold">
                  <span>Total a pagar</span>
                  <span className={`tabular ${totalAPagar > 0 ? 'text-destructive' : 'text-success'}`}>
                    {formatCurrency(totalAPagar)}
                  </span>
                </div>
              </div>
            )}

            <Separator />

            {/* Toggle de agrupamento */}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">Transações</p>
              <div className="flex items-center gap-1">
                <Button size="sm" variant={groupBy === 'data' ? 'default' : 'outline'} className="h-6 px-1.5 text-[10px] gap-1" onClick={() => { setGroupBy('data'); setExpandedGroups(new Set()); }}>
                  <Calendar className="h-3 w-3" /> Data
                </Button>
                <Button size="sm" variant={groupBy === 'categoria' ? 'default' : 'outline'} className="h-6 px-1.5 text-[10px] gap-1" onClick={() => { setGroupBy('categoria'); setExpandedGroups(new Set()); }}>
                  <Tag className="h-3 w-3" /> Categoria
                </Button>
                <Button size="sm" variant={groupBy === 'parcelamento' ? 'default' : 'outline'} className="h-6 px-1.5 text-[10px] gap-1" onClick={() => { setGroupBy('parcelamento'); setExpandedGroups(new Set()); }}>
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
                    <button type="button" onClick={() => toggleGroup(`cat-${g.categoria}`)} className="w-full flex items-center gap-2 py-2 hover:bg-muted/30 transition-colors text-left">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: catColor }} />
                      <span className="text-sm font-medium flex-1 truncate">{g.categoria}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{g.count}</Badge>
                      <span className="text-sm font-semibold text-destructive tabular">{formatCurrency(g.total)}</span>
                      {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                    {isOpen && <div className="pl-4 pb-1 bg-muted/10">{g.items.map(t => renderTxRow(t))}</div>}
                  </div>
                );
              })}

              {groupBy === 'parcelamento' && (
                <>
                  {despesasPorParcelamento.groups.length > 0 && (
                    <>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase mt-1">Parcelamentos</p>
                      {despesasPorParcelamento.groups.map(g => {
                        const isOpen = expandedGroups.has(`parc-${g.key}`);
                        const t = g.first;
                        const baseDescricao = t.descricao.replace(/\s*\d{1,2}\/\d{1,2}\s*$/, '');
                        return (
                          <div key={g.key} className="border-b border-border/50">
                            <button type="button" onClick={() => toggleGroup(`parc-${g.key}`)} className="w-full flex items-center gap-2 py-2 hover:bg-muted/30 transition-colors text-left">
                              <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium truncate block">{baseDescricao}</span>
                                <span className="text-[10px] text-muted-foreground">{g.count}× nesta fatura · {t.categoria}</span>
                              </div>
                              <span className="text-sm font-semibold text-destructive tabular">{formatCurrency(g.total)}</span>
                              {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                            </button>
                            {isOpen && <div className="pl-4 pb-1 bg-muted/10">{g.items.map(it => renderTxRow(it))}</div>}
                          </div>
                        );
                      })}
                    </>
                  )}
                  {despesasPorParcelamento.standalone.length > 0 && (
                    <>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase mt-2">Compras avulsas</p>
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
                      <span className="font-medium tabular">{formatCurrency(val)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ManualTransactionModal
        open={manualTxOpen}
        onOpenChange={setManualTxOpen}
        contaId={cardId}
        contaNome={cardName}
        contaTipo="credito"
        defaultMesCompetencia={billingPeriod}
      />

      <PaymentModal
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        contaId={cardId}
        contaNome={cardName}
        faturaTotal={totalAPagar}
        month={month}
        year={year}
      />
    </>
  );
}
