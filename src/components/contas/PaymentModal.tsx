import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, getMonthName, addMonthsYM } from '@/lib/format';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTodayIso } from '@/hooks/useTodayIso';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { generateHash } from '@/lib/csv-parser';
import { planoParcelamentoFatura } from '@/lib/parcelamento-fatura';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contaId: string;
  contaNome: string;
  faturaTotal: number;
  month: number;
  year: number;
}

/**
 * Pagar fatura — fluxo único.
 *
 * O user digita o valor pago e escolhe a conta de origem (CC).
 * Sistema cria 2 transações ambas com ignorar_dashboard=true:
 *  - DESPESA na CC (dinheiro saiu)
 *  - RECEITA no cartão (fatura abatida pelo mesmo valor)
 *
 * Pra fatura parcial: lança 2x esse fluxo (pagou R$ 800 hoje, pagou
 * R$ 500 mês que vem, etc). Sistema soma os pagamentos automaticamente.
 *
 * Pra parcelamento no app do MP: você lança um pagamento da 1ª parcela
 * agora. As próximas parcelas serão importadas como despesas do cartão
 * quando o extrato seguinte chegar — ou você lança manual via "Compra
 * parcelada" do Novo Lançamento.
 */
export function PaymentModal({ open, onOpenChange, contaId, contaNome, faturaTotal, month, year }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const todayIso = useTodayIso();

  const [valor, setValor] = useState<number>(0);
  const [contaOrigem, setContaOrigem] = useState<string>('');
  const [data, setData] = useState<string>(todayIso);
  const [submitting, setSubmitting] = useState(false);
  // Modo: pagar agora (à vista/parcial) ou parcelar a fatura inteira (financiar).
  const [modo, setModo] = useState<'pagar' | 'parcelar' | 'acumular'>('pagar');
  const [numParcelas, setNumParcelas] = useState<number>(12);
  const [valorParcela, setValorParcela] = useState<number>(0);
  const [entrada, setEntrada] = useState<number>(0);

  // Pré-preenche o valor com a fatura total quando o modal ABRE.
  // Arredonda a 2 casas: faturaTotal vem de soma de floats (ex:
  // 1235.7999999999997) e iria cru pro banco no caminho de 1 clique.
  // Deps só [open]: se a fatura refetchar com o modal aberto, NÃO
  // sobrescreve o valor que o usuário já digitou (pagamento parcial).
  useEffect(() => {
    if (open) {
      setValor(faturaTotal > 0 ? Math.round(faturaTotal * 100) / 100 : 0);
      setData(todayIso);
      setModo('pagar');
      setNumParcelas(12);
      setValorParcela(0);
      setEntrada(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pessoaNome = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Titular';
  const billingPeriod = `${year}-${String(month + 1).padStart(2, '0')}`;

  // Lista de contas de débito pra escolher origem do pagamento
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
    enabled: !!user && open,
  });

  // Auto-seleciona se há só uma conta débito
  const effectiveContaOrigem = contaOrigem || (contasDebito?.length === 1 ? contasDebito[0].id : '');

  const handleConfirm = async () => {
    if (!user) return;
    const valorNum = valor;
    if (!valorNum || valorNum <= 0) return;
    if (!effectiveContaOrigem) return;
    // Teto de overpayment (antes era o max= do input type=number, que o
    // MoneyInput não tem): 150% da fatura. Bloqueia o typo clássico de
    // digitar um zero a mais — pagamento maior que isso não é pagamento.
    if (faturaTotal > 0 && valorNum > faturaTotal * 1.5) {
      toast({
        title: 'Valor muito acima da fatura',
        description: `Você digitou ${formatCurrency(valorNum)} pra uma fatura de ${formatCurrency(faturaTotal)}. Confira o valor.`,
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const runId = crypto.randomUUID().slice(0, 8);

      // 1) RECEITA no cartão (abate fatura). Descrição "Pag Fat Deb Cc - X"
      //    pra ficar legível no histórico. ignorar_dashboard=true (não vira
      //    "receita real" — é transferência interna).
      const descCartao = `Pag Fat Deb Cc - ${contaNome}`;
      const hashCartao = generateHash(data, descCartao, valorNum, pessoaNome) + '_pay_' + runId + '_c';
      const { error: errCartao } = await supabase.from('transacoes').insert({
        user_id: user.id,
        conta_id: contaId,
        data,
        descricao: descCartao,
        descricao_normalizada: descCartao.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(),
        valor: valorNum,
        tipo: 'receita',
        categoria: 'Pagamento Fatura',
        essencial: true,
        hash_transacao: hashCartao,
        pessoa: pessoaNome,
        mes_competencia: billingPeriod,
        ignorar_dashboard: true,
        pago: true,
      });
      if (errCartao) throw errCartao;

      // 2) DESPESA na CC (dinheiro saiu). Mesma descrição.
      const descCC = `Pag Fat Deb Cc - ${contaNome}`;
      const hashCC = generateHash(data, descCC, valorNum, pessoaNome) + '_pay_' + runId + '_d';
      const { error: errCC } = await supabase.from('transacoes').insert({
        user_id: user.id,
        conta_id: effectiveContaOrigem,
        data,
        descricao: descCC,
        descricao_normalizada: descCC.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(),
        valor: valorNum,
        tipo: 'despesa',
        categoria: 'Pagamento Fatura',
        essencial: true,
        hash_transacao: hashCC,
        pessoa: pessoaNome,
        mes_competencia: null,
        ignorar_dashboard: true,
        pago: true,
      });
      if (errCC) {
        // Rollback: tira a receita criada no passo 1 pra não deixar a fatura
        // abatida no banco sem o débito real na CC. Mesma estrutura do TransferModal.
        await supabase.from('transacoes').delete().eq('hash_transacao', hashCartao);
        throw errCC;
      }

      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });

      toast({ title: 'Pagamento registrado', description: `${formatCurrency(valorNum)} debitado de ${contasDebito?.find(c => c.id === effectiveContaOrigem)?.nome || 'sua conta'}` });
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      toast({ title: 'Erro ao registrar pagamento', description: String(err?.message || err).slice(0, 200), variant: 'destructive' });
    }
    setSubmitting(false);
  };

  // PARCELAR a fatura inteira (financiar). O principal das compras JÁ foi
  // contado como gasto no mês delas — então NÃO criamos novas despesas (seria
  // contagem dupla). Em vez disso:
  //  1) abatemos a fatura atual (receita ignorar_dashboard=true → some do "a pagar")
  //  2) criamos as N parcelas em contas_pagar_receber ("A pagar"), que aparecem
  //     nos Próximos Vencimentos mas NÃO entram em "Gastos do mês" nem no saldo.
  const plano = planoParcelamentoFatura(billingPeriod, numParcelas, valorParcela, faturaTotal, entrada);
  // Entrada exige conta de origem (sai dinheiro real agora).
  const entradaPrecisaConta = plano.entrada > 0 && !effectiveContaOrigem;

  const handleParcelar = async () => {
    if (!user) return;
    if (plano.principal <= 0 || plano.numParcelas < 1 || plano.valorParcela <= 0) return;
    if (entradaPrecisaConta) return;

    setSubmitting(true);
    try {
      const runId = crypto.randomUUID().slice(0, 8);
      const inseridos: string[] = []; // hashes pra rollback

      // 1) Abate a fatura atual INTEIRA (entrada + financiado): some do "a pagar".
      const descAbate = `Parcelamento da fatura (${plano.numParcelas}x${plano.entrada > 0 ? ' c/ entrada' : ''})`;
      const hashAbate = generateHash(todayIso, descAbate, plano.principal, pessoaNome) + '_parcfat_' + runId;
      const { error: errAbate } = await supabase.from('transacoes').insert({
        user_id: user.id,
        conta_id: contaId,
        data: todayIso,
        descricao: descAbate,
        descricao_normalizada: descAbate.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(),
        valor: plano.principal,
        tipo: 'receita',
        categoria: 'Pagamento Fatura',
        essencial: true,
        hash_transacao: hashAbate,
        pessoa: pessoaNome,
        mes_competencia: billingPeriod,
        ignorar_dashboard: true,
        pago: true,
      });
      if (errAbate) throw errAbate;
      inseridos.push(hashAbate);

      // 1b) ENTRADA: dinheiro que sai AGORA da conta de débito (perna real).
      //     ignorar_dashboard=true (é pagamento de fatura, não vira gasto novo).
      if (plano.entrada > 0) {
        const descEnt = `Entrada parcelamento fatura - ${contaNome}`;
        const hashEnt = generateHash(todayIso, descEnt, plano.entrada, pessoaNome) + '_parcfat_' + runId + '_e';
        const { error: errEnt } = await supabase.from('transacoes').insert({
          user_id: user.id,
          conta_id: effectiveContaOrigem,
          data: todayIso,
          descricao: descEnt,
          descricao_normalizada: descEnt.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(),
          valor: plano.entrada,
          tipo: 'despesa',
          categoria: 'Pagamento Fatura',
          essencial: true,
          hash_transacao: hashEnt,
          pessoa: pessoaNome,
          mes_competencia: null,
          ignorar_dashboard: true,
          pago: true,
        });
        if (errEnt) {
          await supabase.from('transacoes').delete().in('hash_transacao', inseridos);
          throw errEnt;
        }
        inseridos.push(hashEnt);
      }

      // 2) Parcelas (do valor FINANCIADO) como "A pagar" — não recontam o principal.
      const mesOrigem = `${getMonthName(month).toLowerCase()}/${String(year).slice(2)}`;
      const rows = plano.parcelas.map(p => ({
        user_id: user.id,
        tipo: 'pagar' as const,
        descricao: `Parcela fatura ${contaNome} ${mesOrigem} (${p.idx}/${plano.numParcelas})`,
        valor: p.valor,
        mes: p.competencia,
        data_vencimento: `${p.competencia}-10`,
        categoria: 'Pagamento Fatura',
        pago: false,
      }));
      const { error: errPR } = await supabase.from('contas_pagar_receber').insert(rows);
      if (errPR) {
        // Rollback: tira abatimento + entrada pra não deixar a fatura "paga"
        // (e a entrada debitada) sem as parcelas correspondentes.
        await supabase.from('transacoes').delete().in('hash_transacao', inseridos);
        throw errPR;
      }

      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['contas-pagar-receber'] });
      queryClient.invalidateQueries({ queryKey: ['vencimentos'] });

      toast({ title: 'Fatura parcelada', description: `${plano.numParcelas}x de ${formatCurrency(plano.valorParcela)} — 1ª parcela na fatura seguinte.` });
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      toast({ title: 'Erro ao parcelar fatura', description: String(err?.message || err).slice(0, 200), variant: 'destructive' });
    }
    setSubmitting(false);
  };

  // ACUMULAR p/ a próxima fatura: a fatura atual fica QUITADA (abatida) e o valor
  // vira um "A pagar" no mês seguinte. Sem juros (= parcelar em 1x). O principal
  // já foi contado como gasto, então NÃO criamos despesa nova (contas_pagar_receber
  // não entra em "Gastos do mês" nem no saldo).
  const ymLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return `${getMonthName(m - 1).toLowerCase()}/${String(y).slice(2)}`;
  };
  const proxComp = addMonthsYM(billingPeriod, 1);
  const principalAcum = Math.round(faturaTotal * 100) / 100;

  const handleAcumular = async () => {
    if (!user || principalAcum <= 0) return;
    setSubmitting(true);
    try {
      const runId = crypto.randomUUID().slice(0, 8);
      const descAbate = `Fatura ${ymLabel(billingPeriod)} acumulada p/ próxima`;
      const hashAbate = generateHash(todayIso, descAbate, principalAcum, pessoaNome) + '_acum_' + runId;
      const { error: errAbate } = await supabase.from('transacoes').insert({
        user_id: user.id,
        conta_id: contaId,
        data: todayIso,
        descricao: descAbate,
        descricao_normalizada: descAbate.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(),
        valor: principalAcum,
        tipo: 'receita',
        categoria: 'Pagamento Fatura',
        essencial: true,
        hash_transacao: hashAbate,
        pessoa: pessoaNome,
        mes_competencia: billingPeriod,
        ignorar_dashboard: true,
        pago: true,
      });
      if (errAbate) throw errAbate;

      const { error: errPR } = await supabase.from('contas_pagar_receber').insert({
        user_id: user.id,
        tipo: 'pagar' as const,
        descricao: `Fatura ${contaNome} ${ymLabel(billingPeriod)} (acumulada)`,
        valor: principalAcum,
        mes: proxComp,
        data_vencimento: `${proxComp}-10`,
        categoria: 'Pagamento Fatura',
        pago: false,
      });
      if (errPR) {
        await supabase.from('transacoes').delete().eq('hash_transacao', hashAbate);
        throw errPR;
      }

      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['contas-pagar-receber'] });
      queryClient.invalidateQueries({ queryKey: ['vencimentos'] });

      toast({ title: 'Fatura acumulada', description: `${formatCurrency(principalAcum)} jogado pra fatura de ${ymLabel(proxComp)}.` });
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      toast({ title: 'Erro ao acumular fatura', description: String(err?.message || err).slice(0, 200), variant: 'destructive' });
    }
    setSubmitting(false);
  };

  const valorNum = valor;
  const restante = Math.max(0, faturaTotal - valorNum);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Pagar fatura — {contaNome}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); modo === 'pagar' ? handleConfirm() : modo === 'parcelar' ? handleParcelar() : handleAcumular(); }} className="space-y-4">
          <div className="p-3 rounded-xl bg-muted text-center">
            <p className="text-sm text-muted-foreground">Total da fatura</p>
            <p className="text-2xl font-bold tabular text-destructive">{formatCurrency(faturaTotal)}</p>
          </div>

          {/* Toggle: pagar agora · parcelar (financiar) · acumular (rolar p/ próxima) */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-muted">
            <button
              type="button"
              onClick={() => setModo('pagar')}
              className={`h-8 rounded-md text-xs font-medium transition-colors ${modo === 'pagar' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Pagar agora
            </button>
            <button
              type="button"
              onClick={() => setModo('parcelar')}
              className={`h-8 rounded-md text-xs font-medium transition-colors ${modo === 'parcelar' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Parcelar
            </button>
            <button
              type="button"
              onClick={() => setModo('acumular')}
              className={`h-8 rounded-md text-xs font-medium transition-colors ${modo === 'acumular' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Acumular
            </button>
          </div>

          {modo === 'parcelar' ? (
            <>
              <div className="space-y-1">
                <Label>Entrada (opcional)</Label>
                <MoneyInput value={entrada} onChange={setEntrada} placeholder="0,00" autoFocus />
                <p className="text-[11px] text-muted-foreground">
                  Valor que você paga à vista agora. O restante ({formatCurrency(plano.financiado)}) é financiado.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Nº de parcelas</Label>
                  <Input
                    type="number"
                    min={1}
                    max={36}
                    inputMode="numeric"
                    value={numParcelas}
                    onChange={(e) => setNumParcelas(Math.max(1, Math.min(36, parseInt(e.target.value) || 1)))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Valor de cada parcela</Label>
                  <MoneyInput value={valorParcela} onChange={setValorParcela} placeholder="0,00" />
                </div>
              </div>

              {/* Conta de origem da ENTRADA (só quando há entrada — sai dinheiro real) */}
              {plano.entrada > 0 && contasDebito && contasDebito.length > 1 && (
                <div className="space-y-1">
                  <Label>Entrada sai de qual conta?</Label>
                  <Select value={effectiveContaOrigem} onValueChange={setContaOrigem}>
                    <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                    <SelectContent>
                      {contasDebito.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {plano.entrada > 0 && contasDebito && contasDebito.length === 1 && (
                <p className="text-xs text-muted-foreground">
                  Entrada sai de: <span className="font-medium">{contasDebito[0].nome}</span>
                </p>
              )}

              {plano.valorParcela > 0 && (
                <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
                  {plano.entrada > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Entrada (à vista)</span>
                      <span className="tabular">{formatCurrency(plano.entrada)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{plano.numParcelas}× de {formatCurrency(plano.valorParcela)}</span>
                    <span className="tabular font-medium">{formatCurrency(plano.totalParcelado)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total a desembolsar</span>
                    <span className="tabular font-medium">{formatCurrency(plano.totalDesembolsado)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Juros embutidos</span>
                    <span className={`tabular ${plano.juros > 0 ? 'text-warning' : plano.juros < 0 ? 'text-success' : ''}`}>
                      {plano.juros >= 0 ? '+' : ''}{formatCurrency(plano.juros)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground pt-1">
                    1ª parcela na fatura seguinte. As {plano.numParcelas} parcelas entram em "A pagar" — a fatura
                    atual fica quitada e o principal não conta de novo nos gastos.
                  </p>
                </div>
              )}

              <Button
                className="w-full"
                type="submit"
                disabled={submitting || plano.valorParcela <= 0 || plano.numParcelas < 1 || faturaTotal <= 0 || entradaPrecisaConta}
              >
                {submitting ? 'Parcelando...' : `Parcelar em ${plano.numParcelas}x`}
              </Button>
            </>
          ) : modo === 'acumular' ? (
            <>
              <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fatura de {ymLabel(billingPeriod)} fica</span>
                  <span className="font-medium text-success">quitada</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vira "A pagar" em {ymLabel(proxComp)}</span>
                  <span className="tabular font-medium text-warning">{formatCurrency(principalAcum)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground pt-1">
                  Joga a fatura inteira pra próxima, sem juros. Aparece em "A pagar" e nos
                  Próximos Vencimentos. O principal não conta de novo nos gastos.
                </p>
              </div>

              <Button
                className="w-full"
                type="submit"
                disabled={submitting || faturaTotal <= 0}
              >
                {submitting ? 'Acumulando...' : `Acumular p/ fatura de ${ymLabel(proxComp)}`}
              </Button>
            </>
          ) : (
          <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Valor a pagar</Label>
              <MoneyInput
                value={valor}
                onChange={setValor}
                placeholder="0,00"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>Data</Label>
              <Input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
          </div>

          {restante > 0.01 && valorNum > 0 && (
            <div className="p-2 rounded-lg bg-muted/50 text-sm text-center">
              Restante após esse pagamento: <strong className="tabular text-warning">{formatCurrency(restante)}</strong>
            </div>
          )}
          {valorNum > faturaTotal + 0.01 && (
            <div className="p-2 rounded-lg bg-warning/10 border border-warning/30 text-xs">
              Você está pagando <strong>{formatCurrency(valorNum - faturaTotal)}</strong> a mais que a fatura.
              O sistema permite, mas confere se é o que você quer.
            </div>
          )}

          {contasDebito && contasDebito.length > 1 && (
            <div className="space-y-1">
              <Label>Pagar com qual conta?</Label>
              <Select value={effectiveContaOrigem} onValueChange={setContaOrigem}>
                <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                <SelectContent>
                  {contasDebito.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {contasDebito && contasDebito.length === 1 && (
            <p className="text-xs text-muted-foreground">
              Conta de origem: <span className="font-medium">{contasDebito[0].nome}</span>
            </p>
          )}

          <Button
            className="w-full"
            type="submit"
            disabled={submitting || !valorNum || valorNum <= 0 || !effectiveContaOrigem}
          >
            {submitting ? 'Registrando...' : 'Confirmar pagamento'}
          </Button>
          </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
