import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isFaturaPayment, isDevolution, isSaldoAnteriorFatura } from '@/lib/csv-parser';
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
  despesasMes: number;      // current month expenses
  pagamentosMes: number;    // current month payments
  totalAPagar: number;      // saldoAnterior + despesasMes - pagamentosMes
  historico: FaturaMes[];   // monthly breakdown
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
      if (cardIds.length === 0) return {} as Record<string, FaturaAcumulada>;

      // Fetch ALL transactions for these cards (including ignorar_dashboard
      // since fatura payments are marked as internal transfers but still
      // need to be counted for card balance calculation).
      // Pagina além do limite de 1000 do PostgREST: este é o histórico ALL-TIME
      // do cartão (necessário pro rollover de saldoAnterior), logo é justamente a
      // query com maior chance de estourar 1000 linhas e truncar o saldo devido.
      const allTxs = await fetchAllRows<CardTxRow>(() => supabase
        .from('transacoes')
        .select('conta_id, tipo, valor, descricao, data, mes_competencia')
        .eq('user_id', user!.id)
        .in('conta_id', cardIds));

      const result: Record<string, FaturaAcumulada> = {};

      for (const cardId of cardIds) {
        const cardTxs = (allTxs || []).filter(t => t.conta_id === cardId);

        // Group transactions by billing period
        // Use mes_competencia when available, fall back to YYYY-MM from data
        const byPeriod: Record<string, { despesas: number; pagamentos: number }> = {};

        for (const t of cardTxs) {
          // "Saldo anterior da fatura" é artefato de rollover — este hook já
          // acumula o saldo dos meses anteriores (saldoAnterior abaixo), então
          // contar essa linha como despesa duplicaria o mês anterior inteiro.
          if (isSaldoAnteriorFatura(t.descricao)) continue;

          const periodo = t.mes_competencia || t.data.substring(0, 7);
          if (!byPeriod[periodo]) byPeriod[periodo] = { despesas: 0, pagamentos: 0 };

          if (t.tipo === 'despesa') {
            byPeriod[periodo].despesas += Number(t.valor);
          }

          // Detect payments (receita that are fatura payments)
          if (isFaturaPayment(t.descricao)) {
            byPeriod[periodo].pagamentos += Math.abs(Number(t.valor));
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
            saldoAnterior += saldo;
          }
        }

        // Floor saldo anterior at 0 — can't owe negative from previous months
        // (overpayment doesn't carry as credit to next month in this model)
        saldoAnterior = Math.max(0, saldoAnterior);

        const currentPeriod = byPeriod[billingMonth] || { despesas: 0, pagamentos: 0 };

        result[cardId] = {
          saldoAnterior,
          despesasMes: currentPeriod.despesas,
          pagamentosMes: currentPeriod.pagamentos,
          totalAPagar: saldoAnterior + currentPeriod.despesas - currentPeriod.pagamentos,
          historico: historico.filter(h => h.periodo <= billingMonth),
        };
      }

      return result;
    },
    enabled: !!user && cardIds.length > 0,
  });
}
