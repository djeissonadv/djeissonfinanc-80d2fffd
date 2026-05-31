import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTodayIso } from '@/hooks/useTodayIso';
import { formatCurrency } from '@/lib/format';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import { Plus, CreditCard, Banknote, DollarSign, CalendarDays, PenLine, Trash2 } from 'lucide-react';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { PaymentModal } from '@/components/contas/PaymentModal';
import { ManualTransactionModal } from '@/components/contas/ManualTransactionModal';
import { MonthSelector } from '@/components/MonthSelector';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useFaturaAcumulada } from '@/hooks/useFaturaAcumulada';
import { format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function getInvoiceStatus(fatura: number, pagamento: number): { label: string; color: string; variant: 'default' | 'destructive' | 'outline' | 'secondary' } {
  if (fatura <= 0) return { label: 'Sem fatura', color: '#9ca3af', variant: 'secondary' };
  // Use 1 cent tolerance for float rounding
  if (pagamento >= fatura - 0.01) return { label: 'Paga', color: '#10b981', variant: 'default' };
  if (pagamento > 0) return { label: 'Parcialmente paga', color: '#f59e0b', variant: 'outline' };
  return { label: 'Em aberto', color: '#ef4444', variant: 'destructive' };
}

export default function ContasPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editConta, setEditConta] = useState<any>(null);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'credito' | 'debito'>('debito');
  const [saldoInicial, setSaldoInicial] = useState(0);
  const [dataAbertura, setDataAbertura] = useState<Date>(new Date(2026, 0, 1));
  const [banco, setBanco] = useState('');
  const [codigoBanco, setCodigoBanco] = useState('');
  const [agencia, setAgencia] = useState('');
  const [numeroConta, setNumeroConta] = useState('');
  const [paymentConta, setPaymentConta] = useState<{ id: string; nome: string; fatura: number } | null>(null);
  const [manualTxConta, setManualTxConta] = useState<{ id: string; nome: string; tipo: 'credito' | 'debito'; mesCompetencia?: string } | null>(null);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());

  const { data: contas, isLoading: contasLoading } = useQuery({
    queryKey: ['contas', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('contas').select('*').eq('user_id', user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  // Today's ISO date (auto-refreshes across midnight / on tab focus) — used to
  // exclude future-dated transactions (projected salary, scheduled installments)
  // so each account's saldo reflects money actually landed.
  const todayIso = useTodayIso();
  const { data: saldos } = useQuery({
    queryKey: ['saldos', user?.id, todayIso],
    queryFn: async () => {
      const data = await fetchAllRows<{ conta_id: string; tipo: string; valor: number }>(() => supabase
        .from('transacoes')
        .select('conta_id, tipo, valor')
        .eq('user_id', user!.id)
        .neq('categoria', 'Saldo Inicial')
        .lte('data', todayIso));

      // Include ALL transactions up to today (even ignorar_dashboard) for accurate
      // account balances — fatura payments affect card/bank balances. Future-dated
      // entries (projected income, scheduled installments) are excluded.
      const saldoPorConta: Record<string, number> = {};
      data.forEach(t => {
        if (!saldoPorConta[t.conta_id]) saldoPorConta[t.conta_id] = 0;
        if (t.tipo === 'receita') saldoPorConta[t.conta_id] += Number(t.valor);
        else saldoPorConta[t.conta_id] -= Number(t.valor);
      });
      return saldoPorConta;
    },
    enabled: !!user,
  });

  // Dados da fatura dos cartões — MESMA fonte do Dashboard (useFaturaAcumulada),
  // que inclui o saldo que rolou de meses anteriores (saldoAnterior). Antes a
  // Contas somava só o mês corrente, então a "fatura" e o status (Paga/Em aberto)
  // divergiam do Dashboard quando havia saldo não pago acumulando.
  const billingPeriod = `${year}-${String(month + 1).padStart(2, '0')}`;
  const creditCardIds = (contas || []).filter((c: any) => c.tipo === 'credito').map((c: any) => c.id);
  const { data: faturaAcum } = useFaturaAcumulada(creditCardIds, billingPeriod);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const dataAberturaStr = format(dataAbertura, 'yyyy-MM-dd');
      const finalSaldo = tipo === 'credito' ? 0 : saldoInicial;

      if (editConta) {
        await supabase.from('contas').update({ nome, tipo, saldo_inicial: finalSaldo, data_abertura: dataAberturaStr, banco: banco || null, codigo_banco: codigoBanco || null, agencia: agencia || null, numero_conta: numeroConta || null }).eq('id', editConta.id);
      } else {
        const { error } = await supabase.from('contas').insert({ user_id: user!.id, nome, tipo, saldo_inicial: finalSaldo, data_abertura: dataAberturaStr, banco: banco || null, codigo_banco: codigoBanco || null, agencia: agencia || null, numero_conta: numeroConta || null }).select('id').single();
        if (error) throw error;
        // O saldo de abertura vive no campo `saldo_inicial` (somado uma única vez
        // no cálculo de saldo). NÃO criar transação "Saldo de Abertura" — isso
        // duplicava o valor, pois os cálculos de saldo já somam o campo + as transações.
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      setDialogOpen(false);
      resetForm();
      toast({ title: editConta ? 'Conta atualizada' : 'Conta criada' });
    },
  });

  // Count de transações da conta editada — alimenta o aviso de exclusão.
  // Não usa cache (precisa estar fresco a cada open do dialog).
  const { data: countDelete } = useQuery({
    queryKey: ['contas-count-delete', editConta?.id],
    queryFn: async () => {
      if (!editConta) return null;
      const { count, error } = await supabase
        .from('transacoes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .eq('conta_id', editConta.id);
      if (error) {
        console.warn('Erro contando transações:', error.message);
        return null;
      }
      return count ?? 0;
    },
    enabled: !!editConta && !!user,
    staleTime: 0,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!editConta) return;
      // Apaga as transações da conta primeiro (evita órfãs / violação de FK),
      // depois a própria conta. Ação destrutiva — protegida por ConfirmDelete.
      const { error: txErr } = await supabase
        .from('transacoes')
        .delete()
        .eq('user_id', user!.id)
        .eq('conta_id', editConta.id);
      if (txErr) throw txErr;
      const { error: cErr } = await supabase
        .from('contas')
        .delete()
        .eq('user_id', user!.id)
        .eq('id', editConta.id);
      if (cErr) throw cErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['faturas'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      setDialogOpen(false);
      resetForm();
      toast({ title: 'Conta excluída', description: 'A conta e suas transações foram removidas.' });
    },
    onError: (err: any) => {
      toast({ title: 'Erro ao excluir', description: err?.message || 'Tente novamente.', variant: 'destructive' });
    },
  });

  const resetForm = () => {
    setEditConta(null);
    setNome('');
    setTipo('debito');
    setSaldoInicial(0);
    setDataAbertura(new Date(2026, 0, 1));
    setBanco('');
    setCodigoBanco('');
    setAgencia('');
    setNumeroConta('');
  };

  const openEdit = (conta: any) => {
    setEditConta(conta);
    setNome(conta.nome);
    setTipo(conta.tipo);
    setSaldoInicial(conta.saldo_inicial);
    setDataAbertura(conta.data_abertura ? new Date(conta.data_abertura + 'T00:00:00') : new Date(2026, 0, 1));
    setBanco(conta.banco || '');
    setCodigoBanco(conta.codigo_banco || '');
    setAgencia(conta.agencia || '');
    setNumeroConta(conta.numero_conta || '');
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Contas</h1>
        <div className="flex items-center gap-2">
          <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
          <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Nova Conta
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Skeleton enquanto carrega — antes a página abria com "R$ 0,00" em todo
            cartão (flash alarmante: parece que zerou tudo). */}
        {contasLoading && !contas && (
          [1, 2, 3].map((i) => (
            <Card key={`skel-${i}`}><CardContent className="p-4 space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-24" />
            </CardContent></Card>
          ))
        )}
        {contas?.map(conta => {
          const saldoAtual = (conta.saldo_inicial || 0) + (saldos?.[conta.id] || 0);
          const isCredito = conta.tipo === 'credito';
          const acum = faturaAcum?.[conta.id];
          // Fatura total a pagar = saldo anterior + valor da fatura líquida do mês.
          // valorFatura usa o "Total informado" do extrato quando há (MP/Black/Nubank),
          // senão cai no bruto despesasMes. Mantém consistência com o card do Dashboard.
          const faturaTotal = (acum?.saldoAnterior || 0) + (acum?.valorFatura || 0);
          const pagamentoTotal = acum?.pagamentosMes || 0;
          const status = isCredito ? getInvoiceStatus(faturaTotal, pagamentoTotal) : null;

          return (
            <Card key={conta.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openEdit(conta)}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {isCredito ? (
                      <CreditCard className="h-5 w-5 text-accent" />
                    ) : (
                      <Banknote className="h-5 w-5 text-primary" />
                    )}
                    <span className="font-medium">{conta.nome}</span>
                  </div>
                  <Badge variant="outline" className="capitalize">{conta.tipo}</Badge>
                </div>

                {isCredito ? (
                  <>
                    <div className="mb-2">
                      <p className="text-sm text-muted-foreground">Fatura atual</p>
                      <p className="text-xl font-bold text-destructive">{formatCurrency(faturaTotal)}</p>
                    </div>
                    {status && (
                      <Badge
                        variant={status.variant}
                        className="text-xs"
                        style={status.variant === 'outline' ? { borderColor: status.color, color: status.color } : status.variant === 'default' ? { backgroundColor: status.color } : undefined}
                      >
                        {status.label === 'Paga' && '🟢 '}
                        {status.label === 'Em aberto' && '🔴 '}
                        {status.label === 'Parcialmente paga' && '🟡 '}
                        {status.label}
                      </Badge>
                    )}
                    {pagamentoTotal > 0 && pagamentoTotal < faturaTotal && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Pago: {formatCurrency(pagamentoTotal)} de {formatCurrency(faturaTotal)}
                      </p>
                    )}
                    <div className="flex gap-2 mt-2">
                      {faturaTotal > 0 && pagamentoTotal < faturaTotal && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 text-xs"
                          onClick={(e) => { e.stopPropagation(); setPaymentConta({ id: conta.id, nome: conta.nome, fatura: faturaTotal - pagamentoTotal }); }}
                        >
                          <DollarSign className="h-3 w-3 mr-1" /> Pagar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          const bp = `${year}-${String(month + 1).padStart(2, '0')}`;
                          setManualTxConta({ id: conta.id, nome: conta.nome, tipo: 'credito', mesCompetencia: bp });
                        }}
                      >
                        <PenLine className="h-3 w-3 mr-1" /> Lançamento
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-sm text-muted-foreground">Saldo atual</p>
                      <p className={`text-xl font-bold ${saldoAtual >= 0 ? 'text-primary' : 'text-destructive'}`}>
                        {formatCurrency(saldoAtual)}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Saldo inicial: {formatCurrency(conta.saldo_inicial)}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 w-full text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setManualTxConta({ id: conta.id, nome: conta.nome, tipo: 'debito' });
                      }}
                    >
                      <PenLine className="h-3 w-3 mr-1" /> Adicionar Lançamento
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editConta ? 'Editar Conta' : 'Nova Conta'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (nome) saveMutation.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Cartão Sicredi" />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={v => setTipo(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="debito">Débito</SelectItem>
                  <SelectItem value="credito">Crédito</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Banco</Label>
              <Select value={banco} onValueChange={(v) => {
                const banks: Record<string, string> = { 'Sicredi': '748', 'Itaú': '341', 'Bradesco': '237', 'Santander': '033', 'Caixa': '104', 'Banco do Brasil': '001', 'Nubank': '260', 'Inter': '077', 'Mercado Pago': '323' };
                setBanco(v);
                setCodigoBanco(banks[v] || '');
              }}>
                <SelectTrigger><SelectValue placeholder="Selecione o banco" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Sicredi">Sicredi (748)</SelectItem>
                  <SelectItem value="Itaú">Itaú (341)</SelectItem>
                  <SelectItem value="Bradesco">Bradesco (237)</SelectItem>
                  <SelectItem value="Santander">Santander (033)</SelectItem>
                  <SelectItem value="Caixa">Caixa (104)</SelectItem>
                  <SelectItem value="Banco do Brasil">Banco do Brasil (001)</SelectItem>
                  <SelectItem value="Nubank">Nubank (260)</SelectItem>
                  <SelectItem value="Inter">Inter (077)</SelectItem>
                  <SelectItem value="Mercado Pago">Mercado Pago (323)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Agência</Label>
                <Input value={agencia} onChange={e => setAgencia(e.target.value)} placeholder="0001" />
              </div>
              <div className="space-y-2">
                <Label>Nº Conta</Label>
                <Input value={numeroConta} onChange={e => setNumeroConta(e.target.value)} placeholder="885890" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Data de Abertura</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dataAbertura && "text-muted-foreground")}>
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {format(dataAbertura, "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dataAbertura} onSelect={(d) => d && setDataAbertura(d)} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>
            {tipo !== 'credito' && (
              <div className="space-y-2">
                <Label>Saldo Inicial (R$)</Label>
                <Input type="number" value={saldoInicial} onChange={e => setSaldoInicial(Number(e.target.value))} />
                <p className="text-xs text-muted-foreground">Saldo na data de abertura. Para cartões de crédito, sempre R$ 0,00.</p>
              </div>
            )}
            {tipo === 'credito' && (
              <p className="text-xs text-muted-foreground">Cartões de crédito não possuem saldo próprio.</p>
            )}
            <Button className="w-full" type="submit" disabled={!nome}>
              {editConta ? 'Salvar' : 'Criar'}
            </Button>
            {editConta && (
              <ConfirmDelete
                onConfirm={() => deleteMutation.mutate()}
                title={`Excluir "${editConta.nome}"?`}
                description={
                  countDelete === null
                    ? 'A conta/cartão e TODAS as transações ligadas a ela serão apagadas. Esta ação não pode ser desfeita.'
                    : countDelete === 0
                    ? 'A conta não tem transações vinculadas. Será apagada apenas a conta.'
                    : `Esta conta tem ${countDelete.toLocaleString('pt-BR')} transação${countDelete === 1 ? '' : 'ões'} vinculada${countDelete === 1 ? '' : 's'} que TAMBÉM serão apagadas. Esta ação não pode ser desfeita — considere editar o nome em vez de excluir, ou exportar via CSV antes.`
                }
                confirmLabel={countDelete && countDelete > 50 ? `Excluir conta + ${countDelete.toLocaleString('pt-BR')} transações` : 'Excluir conta'}
                trigger={
                  <Button type="button" variant="outline" className="w-full text-destructive hover:text-destructive" disabled={deleteMutation.isPending}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Excluir conta
                  </Button>
                }
              />
            )}
          </form>
        </DialogContent>
      </Dialog>

      {paymentConta && (
        <PaymentModal
          open={!!paymentConta}
          onOpenChange={(open) => { if (!open) setPaymentConta(null); }}
          contaId={paymentConta.id}
          contaNome={paymentConta.nome}
          faturaTotal={paymentConta.fatura}
          month={month}
          year={year}
        />
      )}

      {manualTxConta && (
        <ManualTransactionModal
          open={!!manualTxConta}
          onOpenChange={(open) => { if (!open) setManualTxConta(null); }}
          contaId={manualTxConta.id}
          contaNome={manualTxConta.nome}
          contaTipo={manualTxConta.tipo}
          defaultMesCompetencia={manualTxConta.mesCompetencia}
        />
      )}
    </div>
  );
}
