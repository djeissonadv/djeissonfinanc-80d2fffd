import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/format';
import { AlertTriangle, X, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { detectarDuplicatas, type DuplicataGrupo } from '@/lib/duplicatas';
import { ConfirmDelete } from '@/components/ConfirmDelete';

/**
 * Widget de alerta de duplicatas — aparece SÓ se tiver duplicata real.
 *
 * Antes a página Conciliação fazia isso (e mais). Removi a página e
 * concentrei aqui no Dashboard: zero clique pra descobrir; user vê
 * direto na home se tem duplicata pra resolver.
 *
 * Limita a janela de busca aos últimos 90 dias (cobre erro humano comum
 * de "lancei 2x" sem trazer histórico inteiro).
 */
export function DuplicatasAlert() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(false);

  const inicio = useMemo(() => {
    const dt = new Date();
    dt.setDate(dt.getDate() - 90);
    return dt.toISOString().slice(0, 10);
  }, []);

  const { data: txs } = useQuery({
    queryKey: ['duplicatas-source', user?.id, inicio],
    queryFn: async () => {
      return await fetchAllRows<{ id: string; descricao: string; descricao_normalizada: string | null; valor: number; data: string; hash_transacao: string | null; conta_id: string }>(() => supabase
        .from('transacoes')
        .select('id, descricao, descricao_normalizada, valor, data, hash_transacao, conta_id')
        .eq('user_id', user!.id)
        .gte('data', inicio));
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const grupos = useMemo(() => detectarDuplicatas(txs || []), [txs]);

  const apagar = useMutation({
    mutationFn: async (txId: string) => {
      const { error } = await supabase.from('transacoes').delete().eq('id', txId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['duplicatas-source'] });
      qc.invalidateQueries({ queryKey: ['transacoes'] });
      qc.invalidateQueries({ queryKey: ['saldos'] });
      qc.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast({ title: 'Duplicata removida' });
    },
    onError: (e: any) => toast({ title: 'Erro ao apagar', description: e?.message?.slice(0, 200), variant: 'destructive' }),
  });

  if (dismissed) return null;
  if (!grupos.length) return null;

  const totalDups = grupos.reduce((s, g) => s + g.txIds.length - 1, 0); // n-1 por grupo

  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-warning/15 p-2 shrink-0">
            <AlertTriangle className="h-4 w-4 text-warning" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-sm font-semibold">
                {totalDups} possível {totalDups === 1 ? 'duplicata' : 'duplicatas'} nos últimos 90 dias
              </p>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Dispensar alerta"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Mesma descrição + valor lançados duas (ou mais) vezes. Apague o duplicado pra manter saldo correto.
            </p>
            <DuplicatasList grupos={grupos.slice(0, 4)} onDelete={(id) => apagar.mutate(id)} />
            {grupos.length > 4 && (
              <button
                type="button"
                onClick={() => navigate('/transacoes')}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Ver os outros {grupos.length - 4} grupos →
              </button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ListProps {
  grupos: DuplicataGrupo[];
  onDelete: (txId: string) => void;
}

function DuplicatasList({ grupos, onDelete }: ListProps) {
  return (
    <div className="space-y-2">
      {grupos.map(g => (
        <div key={g.groupId} className="rounded-lg border bg-background/60 p-2.5">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-sm font-medium truncate">{g.descricao}</p>
            <Badge variant="outline" className="text-[10px] tabular shrink-0">
              {g.txIds.length}× {formatCurrency(g.valor)}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {g.txIds.slice(1).map(id => (
              <ConfirmDelete
                key={id}
                title="Apagar essa duplicata?"
                description="A transação será removida permanentemente. As outras do grupo continuam."
                onConfirm={() => onDelete(id)}
                trigger={
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-3 w-3" />
                    Apagar #{id.slice(0, 6)}
                  </Button>
                }
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
