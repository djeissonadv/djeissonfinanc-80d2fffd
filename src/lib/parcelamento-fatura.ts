import { addMonthsYM } from '@/lib/format';

export interface ParcelaFaturaPlano {
  idx: number;          // 1..N
  competencia: string;  // YYYY-MM da parcela (1ª = mês SEGUINTE ao billing)
  valor: number;        // valor da parcela (já com juros embutido)
}

export interface PlanoParcelamentoFatura {
  principal: number;        // valor financiado (= fatura sendo parcelada)
  numParcelas: number;
  valorParcela: number;
  totalParcelado: number;   // numParcelas × valorParcela (> principal por causa do juro)
  juros: number;            // totalParcelado − principal (custo do financiamento)
  parcelas: ParcelaFaturaPlano[];
}

/**
 * Plano de PARCELAMENTO (financiamento) da fatura.
 *
 * IMPORTANTE — corretude: o principal (as compras da fatura) JÁ foi contado
 * como gasto no mês em que foi comprado. Por isso as parcelas NÃO são novas
 * despesas de cartão (contaria o principal 2×) — elas representam o COMPROMISSO
 * futuro de quitar a fatura financiada e entram como "A pagar"
 * (contas_pagar_receber), não como transação de despesa.
 *
 * A 1ª parcela cai na fatura/mês SEGUINTE ao billing (padrão dos bancos).
 * Os juros entram embutidos no valor de cada parcela (o usuário copia a oferta
 * do banco: "12x de R$ 530"); aqui só calculamos o total e o juro implícito.
 */
export function planoParcelamentoFatura(
  billingPeriod: string,
  numParcelas: number,
  valorParcela: number,
  faturaTotal: number,
): PlanoParcelamentoFatura {
  const principal = Math.round(faturaTotal * 100) / 100;
  const N = Math.max(1, Math.floor(numParcelas));
  const vp = Math.round(valorParcela * 100) / 100;
  const parcelas: ParcelaFaturaPlano[] = [];
  for (let i = 1; i <= N; i++) {
    parcelas.push({ idx: i, competencia: addMonthsYM(billingPeriod, i), valor: vp });
  }
  const totalParcelado = Math.round(vp * N * 100) / 100;
  const juros = Math.round((totalParcelado - principal) * 100) / 100;
  return { principal, numParcelas: N, valorParcela: vp, totalParcelado, juros, parcelas };
}
