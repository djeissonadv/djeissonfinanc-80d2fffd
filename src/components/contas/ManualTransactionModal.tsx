import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { generateHash } from '@/lib/csv-parser';
import { autoCategorizarTransacao } from '@/lib/auto-categorize';
import { toLocalIso } from '@/lib/format';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When omitted, the modal lets the user pick an account. */
  contaId?: string;
  contaNome?: string;
  contaTipo?: 'credito' | 'debito';
  defaultMesCompetencia?: string; // YYYY-MM for credit cards
  defaultTipo?: 'despesa' | 'receita';
}

export function ManualTransactionModal({
  open, onOpenChange, contaId, contaNome, contaTipo, defaultMesCompetencia, defaultTipo,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [tipo, setTipo] = useState<'despesa' | 'receita'>(defaultTipo || 'despesa');
  // toLocalIso (não toISOString): no fuso BR, à noite o toISOString() avança pro
  // dia seguinte, defaultando a data pra "amanhã" e deixando a transação fora do
  // saldo (que filtra <= hoje) até a data chegar.
  const [data, setData] = useState(toLocalIso(new Date()));
  const [essencial, setEssencial] = useState(false);
  const [selectedContaId, setSelectedContaId] = useState<string>(contaId || '');
  const [recorrente, setRecorrente] = useState(false);
  const [meses, setMeses] = useState('12');
  const [submitting, setSubmitting] = useState(false);

  const pessoaNome = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Titular';

  // Reset selected account when contaId changes (passed in from parent)
  useEffect(() => {
    if (contaId) setSelectedContaId(contaId);
  }, [contaId]);

  // Fetch accounts list when needed (no contaId provided)
  const { data: contas } = useQuery({
    queryKey: ['contas-for-manual-tx', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('contas')
        .select('id, nome, tipo')
        .eq('user_id', user!.id)
        .order('nome');
      return data || [];
    },
    enabled: !!user && open && !contaId,
  });

  const contaSelecionada = contas?.find(c => c.id === selectedContaId);
  const effectiveContaTipo: 'credito' | 'debito' | undefined =
    contaTipo || (contaSelecionada?.tipo as 'credito' | 'debito' | undefined);
  const effectiveContaNome = contaNome || contaSelecionada?.nome || '';
  const isCredito = effectiveContaTipo === 'credito';

  const handleSubmit = async () => {
    if (!user || !descricao || !valor || !data || !selectedContaId) return;
    setSubmitting(true);

    try {
      const valorNum = Number(valor);
      const autoCat = autoCategorizarTransacao(descricao);
      const mesesNum = recorrente ? Math.max(1, Math.min(60, parseInt(meses) || 1)) : 1;
      const grupoRec = recorrente ? crypto.randomUUID() : null;

      // Build N rows (1 if not recurring, N if recurring)
      const baseDate = new Date(data + 'T00:00:00');
      const rows = [];
      for (let i = 0; i < mesesNum; i++) {
        const d = new Date(baseDate);
        d.setMonth(d.getMonth() + i);
        const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const mesComp = isCredito
          ? (defaultMesCompetencia && i === 0
              ? defaultMesCompetencia
              : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
          : null;

        const hashSeed = recorrente
          ? `${grupoRec}_${i}`
          : `${descricao}_${valorNum}_${isoDate}`;
        const hash = generateHash(isoDate, descricao, valorNum, pessoaNome) + '_manual_' + hashSeed.substring(0, 12);

        rows.push({
          user_id: user.id,
          conta_id: selectedContaId,
          data: isoDate,
          descricao,
          descricao_normalizada: descricao.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(),
          valor: valorNum,
          tipo,
          categoria: autoCat || 'Outros',
          essencial,
          hash_transacao: hash,
          pessoa: pessoaNome,
          mes_competencia: mesComp,
          grupo_parcela: grupoRec,
          observacoes: recorrente ? `Recorrente ${i + 1}/${mesesNum}` : null,
        });
      }

      const { error } = await supabase.from('transacoes').insert(rows);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['faturas'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-detail'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });

      toast({
        title: recorrente
          ? `${mesesNum} lançamentos recorrentes adicionados`
          : 'Lançamento adicionado',
      });

      // Reset form
      setDescricao('');
      setValor('');
      setTipo(defaultTipo || 'despesa');
      setEssencial(false);
      setRecorrente(false);
      setMeses('12');
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast({ title: 'Erro ao adicionar lançamento', variant: 'destructive' });
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>
            Novo Lançamento{effectiveContaNome ? ` — ${effectiveContaNome}` : ''}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4">
          {!contaId && (
            <div className="space-y-2">
              <Label>Conta</Label>
              <Select value={selectedContaId} onValueChange={setSelectedContaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma conta" />
                </SelectTrigger>
                <SelectContent>
                  {contas?.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome} ({c.tipo === 'credito' ? 'Cartão' : 'Conta'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Descrição</Label>
            <Input
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              placeholder="Ex: Aluguel, Internet, Salário..."
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={valor}
                onChange={e => setValor(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v: 'despesa' | 'receita') => setTipo(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="despesa">Despesa</SelectItem>
                  <SelectItem value="receita">Receita</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Data{isCredito ? ' da compra' : ''}</Label>
            <Input
              type="date"
              value={data}
              onChange={e => setData(e.target.value)}
            />
          </div>

          {defaultMesCompetencia && (
            <p className="text-xs text-muted-foreground">
              Competência: {defaultMesCompetencia}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="essencial"
              checked={essencial}
              onCheckedChange={(v) => setEssencial(!!v)}
            />
            <Label htmlFor="essencial" className="cursor-pointer text-sm font-normal">
              Marcar como essencial
            </Label>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="recorrente"
                checked={recorrente}
                onCheckedChange={(v) => setRecorrente(!!v)}
              />
              <Label htmlFor="recorrente" className="cursor-pointer text-sm font-medium">
                Repetir todos os meses
              </Label>
            </div>
            {recorrente && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Por quantos meses?</Label>
                <Input
                  type="number"
                  min="1"
                  max="60"
                  value={meses}
                  onChange={e => setMeses(e.target.value)}
                  placeholder="12"
                />
                <p className="text-xs text-muted-foreground">
                  Serão criados {Math.max(1, Math.min(60, parseInt(meses) || 1))} lançamentos
                  iguais, um por mês a partir da data informada.
                </p>
              </div>
            )}
          </div>

          <Button
            className="w-full"
            type="submit"
            disabled={submitting || !descricao || !valor || !selectedContaId}
          >
            {submitting ? 'Adicionando...' : 'Adicionar Lançamento'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
