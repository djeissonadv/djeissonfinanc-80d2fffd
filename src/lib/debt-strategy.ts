/**
 * Estratégia de saída de dívidas.
 *
 * Trabalha sobre dívidas já derivadas das transações (empréstimos + parcelamentos).
 * A taxa de juros (taxaAno) só é conhecida para alguns contratos; quando ausente,
 * cálculos que dependem de juros são omitidos em vez de inventados.
 */
import { calcTaxaMensal } from './sac-utils';

export interface DebtItem {
  id: string;
  nome: string;
  valorMensal: number;
  parcelasRestantes: number;
  valorRestante: number;
  mesFim: string; // YYYY-MM
  taxaAno?: number; // % ao ano, quando conhecida
  tipo: 'emprestimo' | 'fatura' | 'compra';
}

/** Valor presente das parcelas restantes — o que se pagaria para quitar hoje. */
export function valorPresenteDivida(parcela: number, n: number, taxaAno?: number): number {
  if (!taxaAno || taxaAno <= 0 || n <= 0) return parcela * n;
  const i = calcTaxaMensal(taxaAno);
  return (parcela * (1 - Math.pow(1 + i, -n))) / i;
}

/** Juros que se evita ao quitar hoje (soma das parcelas − valor presente). 0 se taxa desconhecida. */
export function jurosEvitadosQuitando(parcela: number, n: number, taxaAno?: number): number {
  if (!taxaAno || taxaAno <= 0) return 0;
  return Math.max(0, parcela * n - valorPresenteDivida(parcela, n, taxaAno));
}

function monthDiff(fromYYYYMM: string, toYYYYMM: string): number {
  const [fy, fm] = fromYYYYMM.split('-').map(Number);
  const [ty, tm] = toYYYYMM.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export interface AttackEntry {
  item: DebtItem;
  motivo: string;
  jurosEvitaveis: number;
}

export interface FreeUpEntry {
  mes: string; // YYYY-MM
  nome: string;
  valorLiberado: number;
}

export interface DebtPlan {
  totalRestante: number;
  totalMensal: number;
  comprometimentoRenda: number | null; // % da renda, null se renda desconhecida
  mesLiberdade: string | null; // YYYY-MM em que a última dívida acaba
  mesesAteLiberdade: number;
  jurosEvitaveis: number; // total evitável quitando agora as dívidas com taxa conhecida
  ordemAtaque: AttackEntry[];
  liberacoes: FreeUpEntry[]; // efeito bola-de-neve: quando cada dívida acaba e quanto libera
}

/**
 * Monta o plano de saída. `mesAtual` no formato YYYY-MM. `rendaMensal` <= 0 omite
 * o comprometimento de renda.
 */
export function buildDebtPlan(itens: DebtItem[], rendaMensal: number, mesAtual: string): DebtPlan {
  const totalRestante = itens.reduce((s, d) => s + d.valorRestante, 0);
  const totalMensal = itens.reduce((s, d) => s + d.valorMensal, 0);
  const comprometimentoRenda = rendaMensal > 0 ? (totalMensal / rendaMensal) * 100 : null;

  const mesLiberdade = itens.length
    ? itens.reduce((max, d) => (d.mesFim > max ? d.mesFim : max), itens[0].mesFim)
    : null;
  const mesesAteLiberdade = mesLiberdade ? Math.max(0, monthDiff(mesAtual, mesLiberdade)) : 0;

  const jurosEvitaveis = itens.reduce(
    (s, d) => s + jurosEvitadosQuitando(d.valorMensal, d.parcelasRestantes, d.taxaAno),
    0,
  );

  // Ordem de ataque (avalanche): taxa conhecida primeiro, da maior pra menor;
  // depois as sem taxa conhecida, do maior saldo pro menor.
  const comTaxa = itens.filter(d => d.taxaAno && d.taxaAno > 0).sort((a, b) => b.taxaAno! - a.taxaAno!);
  const semTaxa = itens.filter(d => !d.taxaAno || d.taxaAno <= 0).sort((a, b) => b.valorRestante - a.valorRestante);
  const ordemAtaque: AttackEntry[] = [
    ...comTaxa.map(d => ({
      item: d,
      motivo: `${d.taxaAno!.toFixed(0)}% a.a. — juro mais alto`,
      jurosEvitaveis: jurosEvitadosQuitando(d.valorMensal, d.parcelasRestantes, d.taxaAno),
    })),
    ...semTaxa.map(d => ({
      item: d,
      motivo: 'maior saldo (taxa não cadastrada)',
      jurosEvitaveis: 0,
    })),
  ];

  // Efeito bola-de-neve: a cada mês em que uma dívida acaba, libera o valor da parcela.
  const liberacoes: FreeUpEntry[] = itens
    .map(d => ({ mes: d.mesFim, nome: d.nome, valorLiberado: d.valorMensal }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  return {
    totalRestante,
    totalMensal,
    comprometimentoRenda,
    mesLiberdade,
    mesesAteLiberdade,
    jurosEvitaveis,
    ordemAtaque,
    liberacoes,
  };
}
