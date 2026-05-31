import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isFaturaPayment, isDevolution, isSaldoAnteriorFatura, isFaturaTotalMarker, isConciliacaoPayment } from '@/lib/csv-parser';
import { fetchAllRows } from '@/lib/supabase-fetch';

interface CardTxRow {
  conta_id: string;
  tipo: string;
  valor: number;
  descricao: string;
  data: string;
  mes_competencia: string | null;
}

interface FaturaMes {
  periodo: string; // YYYY-MM
  despesas: number;
  pagamentos: number;
  saldo: number; // despesas - pagamentos (what's owed this month alone)
}

interface FaturaAcumulada {
  saldoAnterior: number;    // unpaid from previous months
  despesasMes: number;      // current month expenses (bruto, sem marker)
  pagamentosMes: number;    // current month payments
  totalAPagar: number;      // saldoAnterior + despesasMes - pagamentosMes
  historico: FaturaMes[];   // monthly breakdown
  /** Valor REAL da fatura do mês, esteja ela paga ou não. Quando o extrato
   *  informa o "Total a pagar" via marcador (Sicredi Black, Nubank, MP),
   *  reflete esse número líquido. Sem marcador, cai no bruto despesasMes.
   *  Útil pra UI manter visível "fatura paga: R$ X" em vez de R$ 0,00. */
  valorFatura: number;
}

// Detection helpers moved to @/lib/csv-parser for reuse across parsers/hooks/pages.

/**
 * Hook that calculates accumulated credit card balances.
 * If a fatura isn't fully paid, the remaining balance rolls over to the next month.
 */
export function useFaturaAcumulada(cardIds: string[], billingMonth: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['fatura-acumulada', user?.id, cardIds.join(','), billingMonth],
    queryFn: async () => {
      if (typeof window !== 'undefined') {
        (window as any).__FATURA_DEBUG_STEPS = ['queryFn:start'];
      }
      if (cardIds.length === 0) return {} as Record<string, FaturaAcumulada>;

      // Fetch ALL transactions for these cards (including ignorar_dashboard
      // since fatura payments are marked as internal transfers but still
      // need to be counted for card balance calculation).
      // Pagina manualmente pra não depender de fetchAllRows (que estava
      // travando — investigando) e pra ter controle determinístico via order(id).
      if (typeof window !== 'undefined') (window as any).__FATURA_DEBUG_STEPS.push('antes-do-supabase-call');
      const allTxs: CardTxRow[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        if (typeof window !== 'undefined') (window as any).__FATURA_DEBUG_STEPS.push(`page-${from}-start`);
        const { data, error } = await supabase
          .from('transacoes')
          .select('conta_id, tipo, valor, descricao, data, mes_competencia')
          .eq('user_id', user!.id)
          .in('conta_id', cardIds)
          .order('id')
          .range(from, from + PAGE - 1);
        if (typeof window !== 'undefined') (window as any).__FATURA_DEBUG_STEPS.push(`page-${from}-done:${data?.length ?? 'null'}:err=${error ? String(error).slice(0, 50) : 'no'}`);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allTxs.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
        if (from > 50_000) break;
      }
      if (typeof window !== 'undefined') (window as any).__FATURA_DEBUG_STEPS.push(`total-rows:${allTxs.length}`);

      const result: Record<string, FaturaAcumulada> = {};

      for (const cardId of cardIds) {
        const cardTxs = (allTxs || []).filter(t => t.conta_id === cardId);

        // Group transactions by billing period
        // Use mes_competencia when available, fall back to YYYY-MM from data
        const byPeriod: Record<string, { despesas: number; pagamentos: number; conciliado: number }> = {};
        // "Total a pagar" informado pelo próprio extrato (marcador), por período.
        // Quando existe, é a FONTE DA VERDADE da fatura (ex: Mercado Pago rotativo,
        // onde a acumulação por mês conta o saldo carregado em dobro).
        const totalInformado: Record<string, number> = {};

        for (const t of cardTxs) {
          // Marcador do total informado: não é despesa — guarda pra sobrescrever.
          if (isFaturaTotalMarker(t.descricao)) {
            totalInformado[t.mes_competencia || t.data.substring(0, 7)] = Number(t.valor);
            continue;
          }
          // "Saldo anterior da fatura" é artefato de rollover — este hook já
          // acumula o saldo dos meses anteriores (saldoAnterior abaixo), então
          // contar essa linha como despesa duplicaria o mês anterior inteiro.
          if (isSaldoAnteriorFatura(t.descricao)) continue;

          const periodo = t.mes_competencia || t.data.substring(0, 7);
          if (!byPeriod[periodo]) byPeriod[periodo] = { despesas: 0, pagamentos: 0, conciliado: 0 };

          if (t.tipo === 'despesa') {
            byPeriod[periodo].despesas += Number(t.valor);
          }

          // Detect payments (receita que abatem a fatura). "Crédito por
          // parcelamento" é abatimento INTERNO não-caixa do parcelamento — não
          // conta como pagamento (senão reduz o "A pagar" sem ter saído dinheiro).
          if (isFaturaPayment(t.descricao) && !isCreditoParcelamento(t.descricao)) {
            byPeriod[periodo].pagamentos += Math.abs(Number(t.valor));
            // Pagamento EXPLÍCITO (conciliação/"Pagar fatura") — é o único que
            // abate quando há "Total informado", pois o marcador já é líquido.
            if (isConciliacaoPayment(t.descricao)) {
              byPeriod[periodo].conciliado += Math.abs(Number(t.valor));
            }
          }

          // Devolutions reduce despesas (valor is always stored positive; use abs for safety)
          if (isDevolution(t.descricao) && t.tipo === 'receita') {
            byPeriod[periodo].despesas -= Math.abs(Number(t.valor));
          }
        }

        // Sort periods chronologically
        const sortedPeriods = Object.keys(byPeriod).sort();

        // Calculate running balance up to (but not including) current billing month
        let saldoAnterior = 0;
        const historico: FaturaMes[] = [];

        for (const periodo of sortedPeriods) {
          const { despesas, pagamentos } = byPeriod[periodo];
          const saldo = despesas - pagamentos;

          historico.push({ periodo, despesas, pagamentos, saldo });

          if (periodo < billingMonth) {
            // Floor POR MÊS: não dá pra "dever negativo" de um mês (sobrepagamento
            // não vira crédito). Floorar o agregado deixava um mês pago a mais
            // cancelar outro em aberto, escondendo dívida real.
            saldoAnterior += Math.max(0, saldo);
          }
        }

        const currentPeriod = byPeriod[billingMonth] || { despesas: 0, pagamentos: 0, conciliado: 0 };

        // Se o extrato informou o "Total a pagar" deste período, ele MANDA: o
        // a pagar = total informado − pagamentos CONCILIADOS (explícitos). As
        // linhas de pagamento internas do extrato são ignoradas aqui porque o
        // marcador já é o líquido do extrato (e elas caem na competência errada).
        // Sem marcador, cai na acumulação antiga (saldoAnterior + mês − pago).
        const informado = totalInformado[billingMonth];

        // DEBUG TEMPORÁRIO (loga sempre em produção até confirmar a causa).
        // Usa console.error pra garantir que aparece mesmo com filtros default.
        console.error(`[FATURA_DEBUG ${cardId.slice(0, 8)}]`, JSON.stringify({
          billingMonth,
          informado: informado ?? null,
          tipo_informado: typeof informado,
          chavesMarker: Object.keys(totalInformado),
          markersBrutos: cardTxs
            .filter(t => isFaturaTotalMarker(t.descricao))
            .map(t => ({ mes: t.mes_competencia, data: t.data, valor: t.valor, valorNum: Number(t.valor) })),
          totalCardTxs: cardTxs.length,
          currentPeriodDespesas: currentPeriod.despesas,
          currentPeriodPagamentos: currentPeriod.pagamentos,
        }));

        const totalAPagar = informado != null
          ? Math.max(0, informado - currentPeriod.conciliado)
          : saldoAnterior + currentPeriod.despesas - currentPeriod.pagamentos;

        result[cardId] = {
          saldoAnterior: informado != null ? 0 : saldoAnterior,
          despesasMes: currentPeriod.despesas,
          pagamentosMes: currentPeriod.pagamentos,
          totalAPagar,
          historico: historico.filter(h => h.periodo <= billingMonth),
          // "Valor da fatura" do período = marcador quando houver (Sicredi
          // Black, Nubank, MP têm o "Total a pagar (informado pelo extrato)");
          // senão usa o bruto somado. Mantém o número visível na UI mesmo
          // quando a fatura já foi paga (despesasMes seria 0 em mês onde só
          // tem pagamentos, escondendo o valor original).
          valorFatura: informado != null ? informado : currentPeriod.despesas,
        };
      }

      return result;
    },
    enabled: !!user && cardIds.length > 0,
  });
}
