import { addMonthsYM } from './format';
import { formatMonthShort } from './analytics-engine';

export interface MesFolga {
  mes: string;            // YYYY-MM
  label: string;          // Jun/26
  parcelas: number;       // parcelas do cartão projetadas (conhecidas, com piso de reposição)
  comprasCasa: number;    // parcela das compras da casa (0 antes de mudar / depois de acabar)
  baseFixa: number;       // dia a dia (+ financiamento depois da mudança)
  comprometimento: number;
  folga: number;          // renda − comprometimento
  mudou: boolean;         // já é a situação NOVA (pós-mudança)?
  comprasCasaAtiva: boolean;
}

export interface ParamsProjecaoFolga {
  renda: number;
  /** Parte fixa ANTES de mudar: dia a dia com aluguel, sem financiamento, sem quitações. */
  baseFixaAtual: number;
  /** Parte fixa DEPOIS: dia a dia − aluguel − quitações + financiamento. */
  baseFixaNova: number;
  /** Parcelas de cartão CONHECIDAS por competência (YYYY-MM → soma). */
  parcelasPorMes: Record<string, number>;
  /** Piso de reposição: parcelas novas que sempre aparecem (São João etc.). */
  reposicao: number;
  comprasCasaParcela: number;
  comprasCasaMeses: number;
  mesAtual: string;          // YYYY-MM (início do gráfico)
  /** Daqui a quantos meses a mudança acontece (0 = já). */
  mesesAteMudanca: number;
  nMeses: number;
}

/**
 * Projeta a FOLGA mês a mês cobrindo a TRANSIÇÃO da mudança:
 *  - antes da mudança: situação atual (aluguel, dívidas ainda ativas);
 *  - a partir da mudança: financiamento no lugar do aluguel, quitações aplicadas,
 *    e as compras da casa entrando por N meses;
 *  - parcelas que TERMINAM aliviam; a reposição segura um piso realista.
 */
export function projetarFolga(p: ParamsProjecaoFolga): MesFolga[] {
  const out: MesFolga[] = [];
  for (let i = 0; i < p.nMeses; i++) {
    const mes = addMonthsYM(p.mesAtual, i);
    const conhecidas = p.parcelasPorMes[mes] || 0;
    const parcelas = Math.round(Math.max(conhecidas, p.reposicao) * 100) / 100;

    const mudou = i >= p.mesesAteMudanca;
    const baseFixa = mudou ? p.baseFixaNova : p.baseFixaAtual;

    // Compras da casa: contam por comprasCasaMeses a partir do mês da mudança.
    const idxAposMudanca = i - p.mesesAteMudanca;
    const comprasCasaAtiva = mudou && idxAposMudanca < p.comprasCasaMeses;
    const comprasCasa = comprasCasaAtiva ? p.comprasCasaParcela : 0;

    const comprometimento = Math.round((baseFixa + parcelas + comprasCasa) * 100) / 100;
    out.push({
      mes,
      label: formatMonthShort(mes),
      parcelas,
      comprasCasa,
      baseFixa,
      comprometimento,
      folga: Math.round((p.renda - comprometimento) * 100) / 100,
      mudou,
      comprasCasaAtiva,
    });
  }
  return out;
}
