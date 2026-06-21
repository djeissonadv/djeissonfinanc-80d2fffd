import { addMonthsYM } from './format';
import { formatMonthShort } from './analytics-engine';

export interface MesFolga {
  mes: string;            // YYYY-MM
  label: string;          // Jun/26
  parcelas: number;       // parcelas do cartão projetadas (conhecidas, com piso de reposição)
  comprasCasa: number;    // parcela das compras da casa (0 depois de acabar)
  baseFixa: number;       // dia a dia ajustado + financiamento (constante)
  comprometimento: number;
  folga: number;          // renda − comprometimento
  comprasCasaAtiva: boolean;
}

export interface ParamsProjecaoFolga {
  renda: number;
  /** Dia a dia + financiamento − aluguel − quitações: a parte FIXA de todo mês. */
  baseFixaMensal: number;
  /** Parcelas de cartão CONHECIDAS por competência (YYYY-MM → soma). */
  parcelasPorMes: Record<string, number>;
  /** Piso de reposição: parcelas novas que aparecem todo mês (São João etc.).
   *  Quando as parcelas conhecidas caem abaixo disso, usa-se o piso (porque
   *  novas vão aparecer). Evita a projeção cair pra zero de forma irreal. */
  reposicao: number;
  comprasCasaParcela: number;
  comprasCasaMeses: number;
  mesInicio: string;      // YYYY-MM
  nMeses: number;
}

/**
 * Projeta a FOLGA mês a mês na situação nova (pós-mudança).
 *
 * Combina o que a calculadora antiga não fazia:
 *  - parcelas que TERMINAM → o comprometimento cai conforme os parcelamentos acabam;
 *  - reposição de parcelas NOVAS → um piso que reflete as parcelas que sempre
 *    aparecem (não cai pra zero);
 *  - compras da casa que acabam depois de N parcelas → alívio extra lá na frente.
 */
export function projetarFolga(p: ParamsProjecaoFolga): MesFolga[] {
  const out: MesFolga[] = [];
  for (let i = 0; i < p.nMeses; i++) {
    const mes = addMonthsYM(p.mesInicio, i);
    const conhecidas = p.parcelasPorMes[mes] || 0;
    const parcelas = Math.round(Math.max(conhecidas, p.reposicao) * 100) / 100;
    const comprasCasaAtiva = i < p.comprasCasaMeses;
    const comprasCasa = comprasCasaAtiva ? p.comprasCasaParcela : 0;
    const comprometimento = Math.round((p.baseFixaMensal + parcelas + comprasCasa) * 100) / 100;
    out.push({
      mes,
      label: formatMonthShort(mes),
      parcelas,
      comprasCasa,
      baseFixa: p.baseFixaMensal,
      comprometimento,
      folga: Math.round((p.renda - comprometimento) * 100) / 100,
      comprasCasaAtiva,
    });
  }
  return out;
}
