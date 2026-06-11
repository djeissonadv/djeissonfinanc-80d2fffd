import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CalendarClock, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { dataNoMesCompetencia } from '@/lib/format';

interface QuickRow {
  id: string;
  data: string;
  mes_competencia: string | null;
}

/**
 * Correção one-time: lançamentos rápidos de cartão antigos gravavam a DATA
 * como "hoje", variando só o mês de competência (fatura). Isso jogava compras
 * de faturas passadas todas pra data de hoje na timeline.
 *
 * Este alerta detecta os lançamentos rápidos cujo mês da data ≠ mês da fatura
 * e oferece um botão pra realinhar a data dentro do mês da competência
 * (mantém o dia, com clamp no último dia do mês). Some sozinho quando zera.
 *
 * Identifica lançamento rápido pelo marcador '_quick_' no hash_transacao.
 */
export function QuickDateFixAlert() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(false);

  const { data: rows } = useQuery({
    queryKey: ['quick-date-fix', user?.id],
    queryFn: async () => {
      return await fetchAllRows<QuickRow>(() => supabase
        .from('transacoes')
        .select('id, data, mes_competencia')
        .eq('user_id', user!.id)
        .like('hash_transacao', '%quick%')
        .not('mes_competencia', 'is', null));
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  // Desalinhados: o mês da data difere do mês da competência (fatura).
  const desalinhados = useMemo(
    () => (rows || []).filter(r => r.mes_competencia && r.data.slice(0, 7) !== r.mes_competencia),
    [rows],
  );

  const corrigir = useMutation({
    mutationFn: async () => {
      // Atualiza um a um (cada linha tem destino diferente). Mantém o dia,
      // clampado no último dia do mês da competência.
      for (const r of desalinhados) {
        const dia = Number(r.data.slice(8, 10)) || 1;
        const novaData = dataNoMesCompetencia(r.mes_competencia!, dia);
        const { error } = await supabase.from('transacoes').update({ data: novaData }).eq('id', r.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quick-date-fix'] });
      qc.invalidateQueries({ queryKey: ['transacoes'] });
      qc.invalidateQueries({ queryKey: ['saldos'] });
      qc.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast({ title: 'Datas corrigidas', description: `${desalinhados.length} lançamento(s) realinhado(s) ao mês da fatura.` });
    },
    onError: (e: any) => toast({ title: 'Erro ao corrigir datas', description: e?.message?.slice(0, 200), variant: 'destructive' }),
  });

  if (dismissed) return null;
  if (!desalinhados.length) return null;

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/15 p-2 shrink-0">
            <CalendarClock className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-sm font-semibold">
                {desalinhados.length} lançamento{desalinhados.length === 1 ? '' : 's'} rápido{desalinhados.length === 1 ? '' : 's'} com data na "fatura errada"
              </p>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Dispensar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Foram lançados com a data de hoje em vez do mês da fatura. Realinhar coloca a data dentro do mês de competência (mantém o dia).
            </p>
            <Button
              size="sm"
              onClick={() => corrigir.mutate()}
              disabled={corrigir.isPending}
              className="h-8 text-xs"
            >
              {corrigir.isPending ? 'Corrigindo…' : `Corrigir ${desalinhados.length} data${desalinhados.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
