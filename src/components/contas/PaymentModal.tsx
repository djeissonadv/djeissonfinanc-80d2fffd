import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency } from '@/lib/format';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { generateHash, isFaturaPayment } from '@/lib/csv-parser';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contaId: string;
  contaNome: string;
  faturaTotal: number;
  month: number;
  year: number;
}

export function PaymentModal({ open, onOpenChange, contaId, contaNome, faturaTotal, month, year }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'total' | 'parcial_parcelar' | 'parcial_acumular'>('total');
  const [valorPago, setValorPago] = useState(0);
  const [parcelas, setParcelas] = useState(2);
  const [valorParcelaCustom, setValorParcelaCustom] = useState<string>(''); // string pra permitir vazio
  const [submitting, setSubmitting] = useState(false);
  const [contaOrigem, setContaOrigem] = useState<string>('');

  const pessoaNome = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Titular';
  const restante = useMemo(() => Math.max(0, faturaTotal - valorPago), [faturaTotal, valorPago]);
  // Valor da parcela: usa o que o user digitou (pra embutir juros do parcelamento do
  // cartão). Quando vazio, cai no rateio simples (restante / N) só pra orientar.
  const valorParcelaAuto = useMemo(() => parcelas > 0 ? restante / parcelas : 0, [restante, parcelas]);
  const valorParcela = useMemo(() => {
    const v = parseFloat(valorParcelaCustom);
    return !isNaN(v) && v > 0 ? v : valorParcelaAuto;
  }, [valorParcelaCustom, valorParcelaAuto]);
  const totalParcelado = useMemo(() => valorParcela * parcelas, [valorParcela, parcelas]);
  const juros = useMemo(() => totalParcelado - restante, [totalParcelado, restante]);

  // Fetch debit accounts for payment origin selection
  const { data: contasDebito } = useQuery({
    queryKey: ['contas-debito', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('contas')
        .select('id, nome')
        .eq('user_id', user!.id)
        .eq('tipo', 'debito');
      return data || [];
    },
    enabled: !!user && open,
  });

  // Auto-select first debit account if only one exists
  const effectiveContaOrigem = contaOrigem || (contasDebito?.length === 1 ? contasDebito[0].id : '');

  const handleConfirm = async () => {
    if (!user) return;
    setSubmitting(true);

    try {
      const baseDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const valorPagamento = mode === 'total' ? faturaTotal : valorPago;
      const billingPeriod = `${year}-${String(month + 1).padStart(2, '0')}`;

      // Create the installment group up front so the payment row links to the same group
      // as its future parcelas (when partial). This keeps the payment and the parcelamento
      // visibly tied together in the UI.
      const grupo_parcela =
        mode === 'parcial_parcelar' && restante > 0 && parcelas > 0 ? crypto.randomUUID() : null;

      // Create payment transaction on credit card account (receita = reduces card debt)
      const paymentHash = generateHash(baseDate, `Pagamento fatura ${contaNome}`, valorPagamento, pessoaNome);
      const { data: paymentData, error: paymentError } = await supabase.from('transacoes').insert({
        user_id: user.id,
        conta_id: contaId,
        data: baseDate,
        descricao: `Pag Fat Deb Cc - ${contaNome}`,
        valor: valorPagamento,
        categoria: 'Pagamento Fatura',
        tipo: 'receita',
        essencial: true,
        hash_transacao: paymentHash,
        pessoa: pessoaNome,
        mes_competencia: billingPeriod,
        ignorar_dashboard: true,
        grupo_parcela,
      }).select('id').single();

      if (paymentError) throw paymentError;

      // Create corresponding debit transaction on the origin debit account (despesa = money leaving).
      // ANTES, checa se o débito desse pagamento JÁ existe na conta de origem —
      // tipicamente importado do extrato OFX/PDF (ex: "PAGTO FATURA", "Pagamento de
      // fatura"). Se já existe, NÃO cria de novo (senão o pagamento conta em dobro
      // na conta corrente). Casa por: pagamento de fatura + valor ~igual + data
      // dentro de ~45 dias do período.
      let debitoDuplicado = false;
      if (effectiveContaOrigem) {
        const { data: candidatos } = await supabase
          .from('transacoes')
          .select('descricao, valor, data')
          .eq('user_id', user.id)
          .eq('conta_id', effectiveContaOrigem)
          .eq('tipo', 'despesa')
          .gte('valor', valorPagamento - 0.5)
          .lte('valor', valorPagamento + 0.5);
        const base = new Date(baseDate + 'T00:00:00').getTime();
        debitoDuplicado = (candidatos || []).some((t) => {
          if (!isFaturaPayment(t.descricao)) return false;
          const dt = new Date((t.data as string) + 'T00:00:00').getTime();
          const dias = Math.abs(dt - base) / 86400000;
          return dias <= 45;
        });

        if (!debitoDuplicado) {
          const debitHash = generateHash(baseDate, `Pag Fat Deb Cc - ${contaNome}`, valorPagamento, pessoaNome) + '_deb';
          await supabase.from('transacoes').insert({
            user_id: user.id,
            conta_id: effectiveContaOrigem,
            data: baseDate,
            descricao: `Pag Fat Deb Cc - ${contaNome}`,
            valor: valorPagamento,
            categoria: 'Pagamento Fatura',
            tipo: 'despesa',
            essencial: true,
            hash_transacao: debitHash,
            pessoa: pessoaNome,
            mes_competencia: billingPeriod,
            ignorar_dashboard: true,
          });
        }
      }

      // If partial + parcelar, create future installments for remaining (linked to the same grupo_parcela)
      if (mode === 'parcial_parcelar' && restante > 0 && parcelas > 0 && grupo_parcela) {
        // ABATIMENTO DA FATURA ATUAL: ao parcelar, o emissor considera a
        // fatura corrente como FECHADA — o restante vira dívida futura
        // (parcelas). Pra refletir isso, lança uma "receita" no cartão no
        // mês atual no valor do restante, com descrição "Pag Fat Deb Cc -
        // {Cartão} (parcelado em Nx)" — bate o regex isConciliacaoPayment
        // e abate o total a pagar da fatura. Não tem contrapartida na CC
        // (não saiu dinheiro real — é só rearranjo contábil).
        const abatHash = generateHash(baseDate, `Pag Fat Deb Cc - ${contaNome} (parcelado)`, restante, pessoaNome) + '_abat';
        await supabase.from('transacoes').insert({
          user_id: user.id,
          conta_id: contaId,
          data: baseDate,
          descricao: `Pag Fat Deb Cc - ${contaNome} (parcelado em ${parcelas}x)`,
          valor: restante,
          categoria: 'Parcelamento Fatura',
          tipo: 'receita',
          essencial: true,
          hash_transacao: abatHash,
          pessoa: pessoaNome,
          mes_competencia: billingPeriod,
          ignorar_dashboard: true,
          grupo_parcela,
        });

        const installments = [];
        for (let i = 1; i <= parcelas; i++) {
          const d = new Date(year, month + i, 1);
          const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
          const hash = generateHash(isoDate, `Parcelamento fatura ${contaNome}`, valorParcela, pessoaNome) + `_p${i}`;
          installments.push({
            user_id: user.id,
            conta_id: contaId,
            data: isoDate,
            descricao: `Parcelamento fatura ${contaNome} (${i}/${parcelas})`,
            valor: valorParcela,
            categoria: 'Parcelamento',
            tipo: 'despesa',
            essencial: true,
            parcela_atual: i,
            parcela_total: parcelas,
            grupo_parcela,
            hash_transacao: hash,
            pessoa: pessoaNome,
          });
        }
        const { error: installError } = await supabase.from('transacoes').insert(installments);
        if (installError) {
          // Rollback: delete the payment if installments fail
          await supabase.from('transacoes').delete().eq('id', paymentData.id);
          throw installError;
        }
      }

      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['faturas'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      const titleByMode = {
        total: 'Pagamento total registrado',
        parcial_parcelar: 'Pagamento parcial + parcelamento registrado',
        parcial_acumular: 'Pagamento parcial registrado — restante acumula na próxima fatura',
      } as const;
      toast({
        title: titleByMode[mode],
        description: debitoDuplicado
          ? 'O débito já constava no extrato da conta (importado) — não foi duplicado.'
          : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast({ title: 'Erro ao registrar pagamento', variant: 'destructive' });
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Registrar Pagamento — {contaNome}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); handleConfirm(); }} className="space-y-4">
          <div className="p-3 rounded-lg bg-muted text-center">
            <p className="text-sm text-muted-foreground">Fatura atual</p>
            <p className="text-xl font-bold text-destructive">{formatCurrency(faturaTotal)}</p>
          </div>

          {/* Conta de origem */}
          {contasDebito && contasDebito.length > 1 && (
            <div className="space-y-2">
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

          <RadioGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <div className="flex items-center space-x-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50" onClick={() => setMode('total')}>
              <RadioGroupItem value="total" id="total" />
              <Label htmlFor="total" className="cursor-pointer flex-1">
                Pagar total ({formatCurrency(faturaTotal)})
              </Label>
            </div>
            <div className="flex items-center space-x-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50" onClick={() => setMode('parcial_parcelar')}>
              <RadioGroupItem value="parcial_parcelar" id="parcial_parcelar" />
              <Label htmlFor="parcial_parcelar" className="cursor-pointer flex-1">
                Pagar parcial + parcelar restante
              </Label>
            </div>
            <div className="flex items-center space-x-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50" onClick={() => setMode('parcial_acumular')}>
              <RadioGroupItem value="parcial_acumular" id="parcial_acumular" />
              <Label htmlFor="parcial_acumular" className="cursor-pointer flex-1">
                Pagar parcial + acumular restante na próxima fatura
              </Label>
            </div>
          </RadioGroup>

          {(mode === 'parcial_parcelar' || mode === 'parcial_acumular') && (
            <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
              <div className="space-y-2">
                <Label>Valor pago agora (R$)</Label>
                <Input
                  type="number"
                  min={0}
                  max={faturaTotal}
                  value={valorPago || ''}
                  onChange={(e) => setValorPago(Number(e.target.value))}
                />
              </div>
              <div className="p-2 rounded bg-muted text-sm">
                Restante: <strong className="text-destructive">{formatCurrency(restante)}</strong>
              </div>

              {mode === 'parcial_parcelar' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label>Parcelar em</Label>
                      <Select value={String(parcelas)} onValueChange={(v) => setParcelas(Number(v))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 23 }, (_, i) => i + 2).map(n => (
                            <SelectItem key={n} value={String(n)}>{n}x</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Valor de cada parcela (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder={valorParcelaAuto.toFixed(2)}
                        value={valorParcelaCustom}
                        onChange={(e) => setValorParcelaCustom(e.target.value)}
                      />
                    </div>
                  </div>
                  {restante > 0 && (
                    <div className="p-2 rounded bg-accent/10 border border-accent/20 text-sm text-center space-y-0.5">
                      <div>
                        {parcelas}x de <strong>{formatCurrency(valorParcela)}</strong> = <strong>{formatCurrency(totalParcelado)}</strong>
                      </div>
                      {juros > 0.01 && (
                        <div className="text-xs text-muted-foreground">
                          Juros embutidos: <strong className="text-warning">{formatCurrency(juros)}</strong>
                        </div>
                      )}
                      {juros < -0.01 && (
                        <div className="text-xs text-muted-foreground">
                          Desconto: <strong className="text-success">{formatCurrency(-juros)}</strong>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {mode === 'parcial_acumular' && restante > 0 && (
                <div className="p-2 rounded bg-accent/10 border border-accent/20 text-xs text-muted-foreground">
                  O restante de <strong className="text-foreground">{formatCurrency(restante)}</strong> vai
                  aparecer como <strong>saldo anterior</strong> na fatura do próximo mês.
                  Se o emissor cobrar juros sobre o saldo rolado, eles vão refletir
                  no marcador da fatura quando você importar o próximo extrato.
                </div>
              )}
            </div>
          )}

          <Button
            className="w-full"
            type="submit"
            disabled={submitting || ((mode === 'parcial_parcelar' || mode === 'parcial_acumular') && (valorPago <= 0 || valorPago >= faturaTotal)) || (!effectiveContaOrigem && (contasDebito?.length || 0) > 0)}
          >
            {submitting ? 'Registrando...' : 'Confirmar Pagamento'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
