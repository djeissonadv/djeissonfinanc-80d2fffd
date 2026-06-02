import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency } from '@/lib/format';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTodayIso } from '@/hooks/useTodayIso';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { generateHash } from '@/lib/csv-parser';

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

  const [valor, setValor] = useState<string>('');
  const [contaOrigem, setContaOrigem] = useState<string>('');
  const [data, setData] = useState<string>(todayIso);
  const [submitting, setSubmitting] = useState(false);

  // Pré-preenche o valor com a fatura total quando o modal abre
  useEffect(() => {
    if (open) {
      setValor(faturaTotal > 0 ? faturaTotal.toFixed(2) : '');
      setData(todayIso);
    }
  }, [open, faturaTotal, todayIso]);

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
    const valorNum = Number(valor);
    if (!valorNum || valorNum <= 0) return;
    if (!effectiveContaOrigem) return;

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
      if (errCC) throw errCC;

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

  const valorNum = Number(valor) || 0;
  const restante = Math.max(0, faturaTotal - valorNum);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Pagar fatura — {contaNome}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); handleConfirm(); }} className="space-y-4">
          <div className="p-3 rounded-xl bg-muted text-center">
            <p className="text-sm text-muted-foreground">Total da fatura</p>
            <p className="text-2xl font-bold tabular text-destructive">{formatCurrency(faturaTotal)}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Valor a pagar</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={faturaTotal * 1.5}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
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
        </form>
      </DialogContent>
    </Dialog>
  );
}
