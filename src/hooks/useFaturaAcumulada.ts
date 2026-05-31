import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isFaturaPayment, isDevolution, isSaldoAnteriorFatura, isFaturaTotalMarker, isConciliacaoPayment, isCreditoParcelamento } from '@/lib/csv-parser';
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
      const allTxs = await fetchAllRows<CardTxRow>(() => supabase
        .from('transacoes')
        .select('conta_id, tipo, valor, descricao, data, mes_competencia')
        .eq('user_id', user!.id)
        .in('conta_id', cardIds));

      const result: Record<string, FaturaAcumulada> = {};

      for (const cardId of cardIds) {
        const cardTxs = allTxs.filter(t => t.conta_id === cardId);

        // Group transactions by billing period
        // Use mes_competencia when available, fall back to YYYY-MM from data
        const byPeriod: Record<string, { despesas: number; pagamentos: number; conciliado: number }> = {};
        // "Total a pagar" informado pelo próprio extrato (marcador), por período.
        // Quando existe, é a FONTE DA VERDADE da fatura (ex: Mercado Pago rotativo,
        // onde a acumulação por mês conta o saldo carregado em dobro).
        const totalInformado: Record<string, number> = {};

        for (const t of cardTxs) {
          // Marcador do total informado pelo extrato: usado como FATURA LÍQUIDA
          // do período quando presente (Sicredi Black, Nubank, MP).
          if (isFaturaTotalMarker(t.descricao)) {
            totalInformado[t.mes_competencia || t.data.substring(0, 7)] = Number(t.valor);
            continue;
          }
          // "Saldo anterior da fatura": artefato de rollover — duplicaria mês.
          if (isSaldoAnteriorFatura(t.descricao)) continue;

          // ── Política do app ───────────────────────────────────────────────
          // Pagamento de fatura é SEMPRE manual via botão "Marcar como paga"
          // (que cria "Pag Fat Deb Cc - {Cartão}" na CC, com sufixo).
          //
          // Tudo que vem da IMPORTAÇÃO do extrato — linhas internas de
          // pagamento da fatura ("Pag Fat Deb Cc" sem sufixo, "Pagamento da
          // fatura de X" do MP, "Pagamento recebido" do Nubank) e abatimentos
          // de parcelamento ("Crédito por parcelamento") — é IGNORADO no
          // cálculo. Evita dupla contagem com a baixa manual e mantém a UI
          // limpa. Parcelas de fatura parcelada são lançadas pelo user como
          // despesas normais nos meses futuros.
          if (isCreditoParcelamento(t.descricao)) continue;
          if (isFaturaPayment(t.descricao) && !isConciliacaoPayment(t.descricao)) continue;

          const periodo = t.mes_competencia || t.data.substring(0, 7);
          if (!byPeriod[periodo]) byPeriod[periodo] = { despesas: 0, pagamentos: 0, conciliado: 0 };

          if (t.tipo === 'despesa') {
            byPeriod[periodo].despesas += Number(t.valor);
          }

          // Único pagamento que abate: conciliação manual ("Pag Fat Deb Cc -
          // {Cartão}") gerada pelo botão "Marcar como paga".
          if (isConciliacaoPayment(t.descricao)) {
            byPeriod[periodo].conciliado += Math.abs(Number(t.valor));
            byPeriod[periodo].pagamentos += Math.abs(Number(t.valor));
          }

          // Devoluções reduzem despesas.
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
          // Fatura do período = marcador do extrato quando há (líquido já com
          // saldo rolado + juros embutidos do MP rotativo), senão soma bruta.
          // Usar só `despesas` aqui subestimava o saldo rolado quando o
          // marcador existia (caso típico do MP — marcador R$ 2.222 vs soma
          // bruta R$ 1.527, diferença = saldo + juros).
          const faturaPeriodo = totalInformado[periodo] ?? despesas;
          const saldo = faturaPeriodo - pagamentos;

          historico.push({ periodo, despesas: faturaPeriodo, pagamentos, saldo });

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
