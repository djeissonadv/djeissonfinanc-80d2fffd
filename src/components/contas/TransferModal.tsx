import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRight } from 'lucide-react';
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
  /** Pré-seleciona conta de origem (opcional) */
  contaOrigemId?: string;
}

/**
 * Transferência entre contas próprias do usuário.
 *
 * Cria 2 transações ATÔMICAS com `ignorar_dashboard=true`:
 *  - DESPESA na conta origem (categoria "Transferência entre contas")
 *  - RECEITA na conta destino (mesma categoria)
 *
 * Como ambas são ignoradas no Dashboard/Análises, não inflam totais.
 * Mas afetam o saldo de cada conta individualmente — exatamente o que
 * representa transferência interna.
 *
 * Caso típico: tirar dinheiro do Sicredi pra Nubank, ou Nubank Conta
 * pra Mercado Pago.
 */
export function TransferModal({ open, onOpenChange, contaOrigemId: defaultOrigem }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const todayIso = useTodayIso();

  const [valor, setValor] = useState<string>('');
  const [origemId, setOrigemId] = useState<string>(defaultOrigem || '');
  const [destinoId, setDestinoId] = useState<string>('');
  const [data, setData] = useState<string>(todayIso);
  const [descricao, setDescricao] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setData(todayIso);
      setValor('');
      setDescricao('');
      if (defaultOrigem) setOrigemId(defaultOrigem);
    }
  }, [open, todayIso, defaultOrigem]);

  const pessoaNome = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Titular';

  // Todas as contas (débito + crédito — pode transferir pagando cartão também,
  // mas o normal é débito↔débito). Filtramos no select.
  const { data: contas } = useQuery({
    queryKey: ['contas-transfer', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('contas')
        .select('id, nome, tipo')
        .eq('user_id', user!.id)
        .order('nome');
      return data || [];
    },
    enabled: open && !!user,
  });

  const contaOrigem = contas?.find(c => c.id === origemId);
  const contaDestino = contas?.find(c => c.id === destinoId);
  const valorNum = Number(valor) || 0;

  const handleConfirm = async () => {
    if (!user) return;
    if (!valorNum || valorNum <= 0) return;
    if (!origemId || !destinoId) return;
    if (origemId === destinoId) {
      toast({ title: 'Conta de origem e destino são iguais', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const runId = crypto.randomUUID().slice(0, 8);
      const baseDesc = descricao.trim() || `Transferência ${contaOrigem?.nome} → ${contaDestino?.nome}`;

      // DESPESA na origem
      const hashOut = generateHash(data, baseDesc, valorNum, pessoaNome) + '_tf_' + runId + '_o';
      const { error: errOut } = await supabase.from('transacoes').insert({
        user_id: user.id,
        conta_id: origemId,
        data,
        descricao: baseDesc,
        descricao_normalizada: baseDesc.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().substring(0, 50),
        valor: valorNum,
        tipo: 'despesa',
        categoria: 'Transferência entre contas',
        essencial: false,
        hash_transacao: hashOut,
        pessoa: pessoaNome,
        ignorar_dashboard: true,
      });
      if (errOut) throw errOut;

      // RECEITA no destino
      const hashIn = generateHash(data, baseDesc, valorNum, pessoaNome) + '_tf_' + runId + '_d';
      const { error: errIn } = await supabase.from('transacoes').insert({
        user_id: user.id,
        conta_id: destinoId,
        data,
        descricao: baseDesc,
        descricao_normalizada: baseDesc.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().substring(0, 50),
        valor: valorNum,
        tipo: 'receita',
        categoria: 'Transferência entre contas',
        essencial: false,
        hash_transacao: hashIn,
        pessoa: pessoaNome,
        ignorar_dashboard: true,
      });
      if (errIn) {
        // Rollback da despesa pra não deixar a transferência meio criada
        await supabase.from('transacoes').delete().eq('hash_transacao', hashOut);
        throw errIn;
      }

      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });

      toast({
        title: 'Transferência registrada',
        description: `${formatCurrency(valorNum)} de ${contaOrigem?.nome} → ${contaDestino?.nome}`,
      });
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      toast({
        title: 'Erro ao transferir',
        description: String(err?.message || err).slice(0, 200),
        variant: 'destructive',
      });
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Transferência entre contas</DialogTitle>
          <DialogDescription>
            Move dinheiro entre suas contas próprias. Não conta como receita nem despesa real — só ajusta o saldo das duas contas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); handleConfirm(); }} className="space-y-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">De</Label>
              <Select value={origemId} onValueChange={setOrigemId}>
                <SelectTrigger><SelectValue placeholder="Origem" /></SelectTrigger>
                <SelectContent>
                  {(contas || []).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground mb-2.5" />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Para</Label>
              <Select value={destinoId} onValueChange={setDestinoId}>
                <SelectTrigger><SelectValue placeholder="Destino" /></SelectTrigger>
                <SelectContent>
                  {(contas || []).filter(c => c.id !== origemId).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Descrição (opcional)</Label>
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder={contaOrigem && contaDestino ? `Transferência ${contaOrigem.nome} → ${contaDestino.nome}` : 'Ex: Reserva pra fatura'}
            />
          </div>

          <Button
            className="w-full"
            type="submit"
            disabled={submitting || !valorNum || !origemId || !destinoId || origemId === destinoId}
          >
            {submitting ? 'Transferindo...' : valorNum > 0 ? `Transferir ${formatCurrency(valorNum)}` : 'Transferir'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
