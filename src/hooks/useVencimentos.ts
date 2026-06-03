/**
 * Hook compartilhado pra "próximos vencimentos".
 *
 * Usado por:
 *  - ProximosVencimentos (widget visual)
 *  - Dashboard hero (cálculo de "Disponível pra gastar hoje")
 *
 * React Query dedup a mesma queryKey, então 2 consumers = 1 round-trip.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTodayIso } from '@/hooks/useTodayIso';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { construirVencimentos, calcularImpactoVencimentos, type Vencimento } from '@/lib/vencimentos';

/**
 * @param ateNDias Janela em dias no futuro (default 30). Atrasados sempre entram.
 * @param extras Vencimentos adicionais pré-calculados (ex: faturas de cartão).
 *   O Dashboard usa isso pra injetar faturas próximas — ProximosVencimentos
 *   também aceita o mesmo array via prop pra ficar consistente.
 */
export function useVencimentos(ateNDias = 30, extras: Vencimento[] = []) {
  const { user } = useAuth();
  const todayIso = useTodayIso();

  // Janela ampla nas queries; filtro fino fica em construirVencimentos.
  const { inicioRange, fimRange } = useMemo(() => {
    const [y, m, d] = todayIso.split('-').map(Number);
    const inicio = new Date(Date.UTC(y, m - 1, d - 90)).toISOString().slice(0, 10);
    const fim = new Date(Date.UTC(y, m - 1, d + 31)).toISOString().slice(0, 10);
    return { inicioRange: inicio, fimRange: fim };
  }, [todayIso]);

  // Pendentes em transações. Filtra pago=false client-side pra resiliência.
  const { data: txsPendentes, isLoading: loadingTxs, isError: errorTxs } = useQuery({
    queryKey: ['vencimentos', 'transacoes', user?.id, inicioRange, fimRange],
    queryFn: async () => {
      const data = await fetchAllRows<{ id: string; descricao: string; valor: number; tipo: string; data: string; categoria: string | null; pago: boolean | null }>(
        () => supabase
          .from('transacoes')
          .select('id, descricao, valor, tipo, data, categoria, pago')
          .eq('user_id', user!.id)
          .gte('data', inicioRange)
          .lte('data', fimRange)
      );
      return data.filter(t => t.pago === false);
    },
    enabled: !!user,
  });

  const { data: cprPendentes, isLoading: loadingCpr, isError: errorCpr } = useQuery({
    queryKey: ['vencimentos', 'cpr', user?.id, inicioRange, fimRange],
    queryFn: async () => {
      // fetchAllRows pra evitar truncar em 1000 linhas se user tiver muitos
      // boletos/assinaturas geradas em batch.
      return await fetchAllRows<{ id: string; descricao: string; valor: number; tipo: string; data_vencimento: string | null; categoria: string | null; pago: boolean }>(() => supabase
        .from('contas_pagar_receber')
        .select('id, descricao, valor, tipo, data_vencimento, categoria, pago')
        .eq('user_id', user!.id)
        .eq('pago', false)
        .gte('data_vencimento', inicioRange)
        .lte('data_vencimento', fimRange));
    },
    enabled: !!user,
  });

  const vencimentos = useMemo(() => {
    const base = construirVencimentos(txsPendentes || [], (cprPendentes || []) as any, todayIso, ateNDias);
    // Mergeia extras (faturas de cartão) e re-ordena por dias até vencer.
    return [...base, ...extras].sort((a, b) => a.diasAteVencer - b.diasAteVencer);
  }, [txsPendentes, cprPendentes, todayIso, ateNDias, extras]);

  const impacto = useMemo(() => calcularImpactoVencimentos(vencimentos), [vencimentos]);

  return {
    vencimentos,
    impacto,
    // Loading real: alguma query ainda em flight.
    isLoading: loadingTxs || loadingCpr,
    // Erro real: alguma query falhou. Componentes podem mostrar fallback
    // em vez de fingir que tá tudo em dia.
    isError: errorTxs || errorCpr,
  };
}
