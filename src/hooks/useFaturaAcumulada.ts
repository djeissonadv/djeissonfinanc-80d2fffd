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

        // Sort periods chronologically — inclui também o billingMonth pra
        // garantir histórico completo mesmo quando o mês corrente não tem
        // movimentação ainda.
        const todosPeriodos = new Set<string>([...Object.keys(byPeriod), ...Object.keys(totalInformado)]);
        const sortedPeriods = Array.from(todosPeriodos).sort();

        // ── REGRA DEFINITIVA DA FATURA ────────────────────────────────────
        // O marcador do extrato é CUMULATIVO: já inclui saldo rolado +
        // juros + parcelamentos dos meses anteriores embutidos no número.
        // Pra evitar duplicação e ainda projetar meses sem extrato:
        //
        //   1. Procura o ÚLTIMO mês <= billingMonth que tem marcador (M).
        //   2. Se acharmos M E M == billingMonth: o marcador do próprio
        //      mês corrente já é a fatura líquida — saldoAnterior = 0,
        //      valorFatura = marker, totalAPagar = marker − conciliado_M.
        //   3. Se acharmos M < billingMonth: saldoAnterior parte do
        //      marker_M − conciliado_M, e a gente SOMA mês a mês as
        //      despesas brutas dos meses ENTRE M (exclusive) e billingMonth
        //      (exclusive), abatidas das conciliações de cada um.
        //   4. Se NÃO tem marker em nenhum mês <= billingMonth: cai no
        //      cálculo bruto — soma despesas − conciliações de todos os
        //      meses anteriores.
        // Isso garante: marker substitui histórico, nunca soma POR CIMA.
        const getFatura = (p: string) => totalInformado[p] != null
          ? totalInformado[p]
          : (byPeriod[p]?.despesas || 0);
        const getConciliado = (p: string) => byPeriod[p]?.conciliado || 0;
        const getPagamentos = (p: string) => byPeriod[p]?.pagamentos || 0;
        const getDespesas = (p: string) => byPeriod[p]?.despesas || 0;

        // Último mês ≤ billingMonth com marcador.
        const ultimoMarker = sortedPeriods
          .filter(p => p <= billingMonth && totalInformado[p] != null)
          .pop();

        let saldoAnterior = 0;
        if (ultimoMarker && ultimoMarker < billingMonth) {
          // Parte do saldo do último marker (já cumulativo até aquele mês)
          // − conciliações posteriores ao fechamento daquele mês.
          saldoAnterior = Math.max(0, totalInformado[ultimoMarker] - getConciliado(ultimoMarker));
          // Soma meses ENTRE ultimoMarker (exclusive) e billingMonth (exclusive).
          for (const periodo of sortedPeriods) {
            if (periodo <= ultimoMarker) continue;
            if (periodo >= billingMonth) break;
            saldoAnterior += Math.max(0, getDespesas(periodo) - getConciliado(periodo));
          }
        } else if (!ultimoMarker) {
          // Sem nenhum marker até o billingMonth → soma tudo bruto.
          for (const periodo of sortedPeriods) {
            if (periodo >= billingMonth) break;
            saldoAnterior += Math.max(0, getDespesas(periodo) - getConciliado(periodo));
          }
        }
        // (se ultimoMarker === billingMonth, saldoAnterior = 0 — marker do
        //  mês corrente é a fatura líquida)

        // Histórico (pra UI mostrar meses anteriores): usa fatura efetiva
        // de cada mês (marker quando há, bruto caso contrário) e os pagamentos
        // contabilizados daquele mês.
        const historico: FaturaMes[] = sortedPeriods.map(periodo => {
          const fatura = getFatura(periodo);
          const pag = getPagamentos(periodo);
          return { periodo, despesas: fatura, pagamentos: pag, saldo: fatura - pag };
        });

        const informado = totalInformado[billingMonth];
        const currentPeriod = byPeriod[billingMonth] || { despesas: 0, pagamentos: 0, conciliado: 0 };

        // FATURA ENCERRADA PELO EMISSOR: se há marker no mês SEGUINTE ao
        // billingMonth, a fatura corrente foi resolvida pelo emissor — não
        // importa COMO (pagou integral, parcelou, ou rolou pro próximo). O
        // marker do mês N+1 já é a verdade definitiva e inclui o que sobrou
        // de N. Caso típico: extrato de março traz "Pagamento da fatura de
        // fevereiro" + "Crédito por parcelamento", abatendo fevereiro
        // inteira. O marker de março R$ 3.210,30 é o líquido depois disso.
        const proxMes = sortedPeriods.find(p => p > billingMonth && totalInformado[p] != null);
        const encerradaPeloEmissor = !!proxMes && informado != null;

        // Total a pagar do mês corrente:
        // - Encerrada pelo emissor: 0 (já resolvida via marker do próximo mês).
        // - Com marker: marker − conciliações.
        // - Sem marker: saldoAnterior + despesas brutas − conciliações.
        const totalAPagar = encerradaPeloEmissor
          ? 0
          : informado != null
            ? Math.max(0, informado - currentPeriod.conciliado)
            : saldoAnterior + currentPeriod.despesas - currentPeriod.conciliado;

        result[cardId] = {
          saldoAnterior: informado != null ? 0 : saldoAnterior,
          despesasMes: currentPeriod.despesas,
          // Pagamentos "efetivos" do mês: se encerrada pelo emissor, considera
          // o valor da fatura como pago (pra UI mostrar "Pagamentos: -R$ X");
          // senão soma só conciliação manual.
          pagamentosMes: encerradaPeloEmissor
            ? (informado || currentPeriod.despesas)
            : currentPeriod.conciliado,
          totalAPagar,
          historico: historico.filter(h => h.periodo <= billingMonth),
          // Valor da fatura: marker manda; senão projeta (saldoAnterior + bruto).
          valorFatura: informado != null
            ? informado
            : saldoAnterior + currentPeriod.despesas,
        };
      }

      return result;
    },
    enabled: !!user && cardIds.length > 0,
  });
}
