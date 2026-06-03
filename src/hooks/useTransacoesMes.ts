/**
 * SINGLE SOURCE OF TRUTH pra "transações do mês".
 *
 * ANTES: Dashboard, Análises, Projeções, Transacoes — cada um fazia sua versão
 * do merge entre `mes_competencia` (cartão de crédito) e `data` (débito).
 * Quando mudava regra (ex: ignorar_dashboard), tinha que mexer em 4 lugares.
 *
 * AGORA: TODA query mensal passa por aqui.
 *
 * Regra de competência:
 *  - Transações de cartão de crédito: filtradas por `mes_competencia` (período
 *    da fatura). A data da compra pode ser meses atrás em parcelas.
 *  - Transações de débito/dinheiro: `mes_competencia = null`, filtradas por
 *    `data` no range do mês.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { getMonthRange } from '@/lib/format';

export interface TransacaoRow {
  id: string;
  user_id: string;
  conta_id: string;
  data: string;
  descricao: string;
  descricao_normalizada?: string | null;
  valor: number;
  tipo: 'receita' | 'despesa';
  categoria: string;
  categoria_id?: string | null;
  essencial: boolean;
  ignorar_dashboard?: boolean | null;
  pago?: boolean | null;
  mes_competencia?: string | null;
  parcela_atual?: number | null;
  parcela_total?: number | null;
  hash_transacao?: string | null;
  pessoa?: string | null;
  reembolso_pessoa?: string | null;
  reembolso_valor?: number | null;
  reembolso_transacao_id?: string | null;
  origem_dados?: string | null;
  [key: string]: any;
}

interface Options {
  /** Filtra por `ignorar_dashboard = false` (padrão: false — traz tudo) */
  apenasVisivelDashboard?: boolean;
  /** Filtra apenas as que têm parcela_total preenchido */
  apenasParceladas?: boolean;
  /** Sobrescreve a key cache (use quando precisar isolar este consumo) */
  cachePrefix?: string;
}

/**
 * Busca as transações do mês — uma query, todos os consumers.
 *
 * @param month 0-11 (mes de competência, NÃO o mês civil)
 * @param year ano de 4 dígitos
 * @returns array de TransacaoRow, deduplicado por id.
 */
export function useTransacoesMes(
  month: number,
  year: number,
  opts: Options = {}
) {
  const { user } = useAuth();
  const { start, end } = getMonthRange(month, year);
  const billingMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
  const prefix = opts.cachePrefix || 'transacoes-mes';

  return useQuery({
    queryKey: [prefix, user?.id, billingMonth, opts.apenasVisivelDashboard ?? false, opts.apenasParceladas ?? false],
    queryFn: async () => {
      // Query A: transações com competência = billingMonth (cartão de crédito).
      let qComp = supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .eq('mes_competencia', billingMonth);
      if (opts.apenasVisivelDashboard) qComp = qComp.eq('ignorar_dashboard', false);
      if (opts.apenasParceladas) qComp = qComp.not('parcela_total', 'is', null);

      // Query B: transações sem competência (débito/dinheiro), filtra por data.
      let qData = supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .is('mes_competencia', null)
        .gte('data', start)
        .lte('data', end);
      if (opts.apenasVisivelDashboard) qData = qData.eq('ignorar_dashboard', false);
      if (opts.apenasParceladas) qData = qData.not('parcela_total', 'is', null);

      const [byCompetencia, byDate] = await Promise.all([
        fetchAllRows<TransacaoRow>(() => qComp),
        fetchAllRows<TransacaoRow>(() => qData),
      ]);

      // Merge + dedup por id (defensivo: paranoia caso uma tx tenha sido
      // alterada entre as duas queries paralelas).
      const all = [...byCompetencia, ...byDate];
      const seen = new Set<string>();
      return all.filter(t => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    },
    enabled: !!user,
  });
}

interface PeriodoOpts extends Options {
  /** Range YYYY-MM da competência (inclusivo nos 2 lados) */
  inicioComp: string;
  /** YYYY-MM final da competência */
  fimComp: string;
  /** Range YYYY-MM-DD da data (pra txs sem mes_competencia) */
  inicioData: string;
  fimData: string;
}

/**
 * Variante do useTransacoesMes pra ranges maiores que 1 mês (ex: ano todo
 * pra Parcelas Timeline). Mesma regra de merge byCompetencia + byDate,
 * mesma definição de "visível dashboard" / "parcelada".
 *
 * Existe pra parcelasAno do Dashboard não duplicar o padrão inline.
 */
export function useTransacoesPeriodo(opts: PeriodoOpts) {
  const { user } = useAuth();
  const prefix = opts.cachePrefix || 'transacoes-periodo';

  return useQuery({
    queryKey: [prefix, user?.id, opts.inicioComp, opts.fimComp, opts.inicioData, opts.fimData, opts.apenasVisivelDashboard ?? false, opts.apenasParceladas ?? false],
    queryFn: async () => {
      let qComp = supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .gte('mes_competencia', opts.inicioComp)
        .lte('mes_competencia', opts.fimComp);
      if (opts.apenasVisivelDashboard) qComp = qComp.eq('ignorar_dashboard', false);
      if (opts.apenasParceladas) qComp = qComp.not('parcela_total', 'is', null);

      let qData = supabase
        .from('transacoes')
        .select('*')
        .eq('user_id', user!.id)
        .is('mes_competencia', null)
        .gte('data', opts.inicioData)
        .lte('data', opts.fimData);
      if (opts.apenasVisivelDashboard) qData = qData.eq('ignorar_dashboard', false);
      if (opts.apenasParceladas) qData = qData.not('parcela_total', 'is', null);

      const [byCompetencia, byDate] = await Promise.all([
        fetchAllRows<TransacaoRow>(() => qComp),
        fetchAllRows<TransacaoRow>(() => qData),
      ]);

      const all = [...byCompetencia, ...byDate];
      const seen = new Set<string>();
      return all.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
    },
    enabled: !!user,
  });
}
