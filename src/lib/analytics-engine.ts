/**
 * Analytics Engine — agregações reutilizadas pela página de Análises e pelo
 * contexto enviado pro Claude. Tudo aqui é pure (sem React/Supabase) — basta
 * passar TransactionRecord[] e configs.
 *
 * As funções consideram `ignorar_dashboard`/`mes_competencia` da mesma forma
 * que projection-engine/financial-health (consistência ENTRE engines).
 */

import type { TransactionRecord } from './projection-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function monthKey(t: TransactionRecord): string {
  return t.mes_competencia || t.data.substring(0, 7); // YYYY-MM
}

const MES_NOMES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

export function formatMonthShort(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  return `${MES_NOMES[Number(m) - 1] || '?'}/${y?.slice(-2) || ''}`;
}

// ---------------------------------------------------------------------------
// Fluxo de caixa: últimos N meses, agregando receita/despesa/sobra por mês.
// ---------------------------------------------------------------------------
export interface MonthFlow {
  mes: string;           // YYYY-MM
  label: string;         // Jan/26
  receita: number;
  despesa: number;
  sobra: number;
}

export function buildMonthlyFlow(
  transactions: TransactionRecord[],
  monthsBack = 12,
  todayIso?: string,
): MonthFlow[] {
  // Cutoff: tudo após hoje é PROJEÇÃO (parcelas futuras de empréstimo já
  // gravadas no banco, salários recorrentes do seed, etc.). No fluxo "realizado"
  // de Análises, isso distorce KPIs porque o app trata como "já aconteceu".
  // Análises passa useTodayIso(); se não passar, mantém o comportamento antigo.
  const cutoff = todayIso || null;

  const byMonth: Record<string, { receita: number; despesa: number }> = {};
  for (const t of transactions) {
    if (t.ignorar_dashboard) continue;
    if (cutoff && t.data > cutoff) continue;
    const k = monthKey(t);
    if (!byMonth[k]) byMonth[k] = { receita: 0, despesa: 0 };
    if (t.tipo === 'receita') byMonth[k].receita += Number(t.valor);
    else if (t.tipo === 'despesa') byMonth[k].despesa += Number(t.valor);
  }
  const ordered = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-monthsBack);
  return ordered.map(([mes, { receita, despesa }]) => ({
    mes,
    label: formatMonthShort(mes),
    receita: Math.round(receita * 100) / 100,
    despesa: Math.round(despesa * 100) / 100,
    sobra: Math.round((receita - despesa) * 100) / 100,
  }));
}

// ---------------------------------------------------------------------------
// Composição de categorias do mês corrente. Aceita um seletor de "qual mês"
// — passa `null` pra usar todos os meses presentes (top categorias all-time).
// ---------------------------------------------------------------------------
export interface SubSlice {
  subcategoria: string; // "Sem subcategoria" quando null
  valor: number;
  pct: number; // % dentro da categoria pai
}

export interface CategorySlice {
  categoria: string;
  valor: number;
  pct: number;
  subs: SubSlice[]; // breakdown por subcategoria (vazio se não há)
}

export function buildCategoryComposition(
  transactions: TransactionRecord[],
  targetMonth: string | null = null,
): CategorySlice[] {
  const filtered = transactions.filter((t) => {
    if (t.ignorar_dashboard) return false;
    if (t.tipo !== 'despesa') return false;
    if (targetMonth && monthKey(t) !== targetMonth) return false;
    return true;
  });
  const totals: Record<string, number> = {};
  const subTotals: Record<string, Record<string, number>> = {}; // cat → sub → valor
  let grandTotal = 0;
  for (const t of filtered) {
    const cat = t.categoria || 'Outros';
    const v = Number(t.valor);
    totals[cat] = (totals[cat] || 0) + v;
    grandTotal += v;
    const sub = ((t as any).subcategoria as string | null) || 'Sem subcategoria';
    (subTotals[cat] ||= {})[sub] = (subTotals[cat]?.[sub] || 0) + v;
  }
  return Object.entries(totals)
    .map(([categoria, valor]) => {
      const subsRaw = subTotals[categoria] || {};
      const subKeys = Object.keys(subsRaw);
      // Só expõe breakdown se houver subcategoria real (mais que só "Sem sub")
      const temSub = subKeys.some(k => k !== 'Sem subcategoria');
      const subs: SubSlice[] = temSub
        ? Object.entries(subsRaw)
            .map(([subcategoria, sv]) => ({
              subcategoria,
              valor: Math.round(sv * 100) / 100,
              pct: valor > 0 ? Math.round((sv / valor) * 10000) / 100 : 0,
            }))
            .sort((a, b) => b.valor - a.valor)
        : [];
      return {
        categoria,
        valor: Math.round(valor * 100) / 100,
        pct: grandTotal > 0 ? Math.round((valor / grandTotal) * 10000) / 100 : 0,
        subs,
      };
    })
    .sort((a, b) => b.valor - a.valor);
}

// ---------------------------------------------------------------------------
// Médias de gasto por categoria nos últimos N meses COMPLETOS + projeção do
// próximo mês. É a base do "raio-X de gastos" e da Calculadora da Casa.
//
// Regras de corretude:
//  - Só despesa realizada (ignorar_dashboard=false).
//  - Agrupa por competência (mes_competencia || mês da data).
//  - EXCLUI o mês corrente (incompleto) pra não puxar a média pra baixo.
//  - Divide pela quantidade de meses na janela (média mensal típica).
// ---------------------------------------------------------------------------
export interface CategoriaMedia {
  categoria: string;
  total: number;          // soma no período (janela)
  media: number;          // média mensal
  mesesComGasto: number;  // em quantos dos N meses houve gasto nessa categoria
  pctDaMedia: number;     // % da média mensal total
}

export interface GastosMedios {
  mesesConsiderados: number;       // N efetivo (≤ monthsBack)
  mediaMensal: number;             // média de despesa total por mês
  categorias: CategoriaMedia[];    // ordenadas por média desc
  projecaoProximoMes: number;      // projeção simples = média mensal
}

export function buildGastosMedios(
  transactions: TransactionRecord[],
  monthsBack = 6,
  todayIso?: string,
): GastosMedios {
  const mesAtual = (todayIso || '').substring(0, 7); // YYYY-MM ('' se não passar)
  const porMes: Record<string, Record<string, number>> = {}; // mes -> cat -> valor
  for (const t of transactions) {
    if (t.ignorar_dashboard) continue;
    if (t.tipo !== 'despesa') continue;
    const k = monthKey(t);
    // só meses ANTERIORES ao corrente (mês corrente é incompleto)
    if (mesAtual && k >= mesAtual) continue;
    const cat = t.categoria || 'Outros';
    (porMes[k] ||= {})[cat] = (porMes[k]?.[cat] || 0) + Number(t.valor);
  }
  const meses = Object.keys(porMes).sort().slice(-monthsBack);
  const n = meses.length;
  if (n === 0) {
    return { mesesConsiderados: 0, mediaMensal: 0, categorias: [], projecaoProximoMes: 0 };
  }
  const catTotais: Record<string, number> = {};
  let granTotal = 0;
  for (const m of meses) {
    for (const [cat, v] of Object.entries(porMes[m])) {
      catTotais[cat] = (catTotais[cat] || 0) + v;
      granTotal += v;
    }
  }
  const mediaMensal = Math.round((granTotal / n) * 100) / 100;
  const categorias: CategoriaMedia[] = Object.entries(catTotais)
    .map(([categoria, total]) => {
      const media = Math.round((total / n) * 100) / 100;
      const mesesComGasto = meses.filter((m) => porMes[m][categoria] != null).length;
      return {
        categoria,
        total: Math.round(total * 100) / 100,
        media,
        mesesComGasto,
        pctDaMedia: mediaMensal > 0 ? Math.round((media / mediaMensal) * 10000) / 100 : 0,
      };
    })
    .sort((a, b) => b.media - a.media);
  return { mesesConsiderados: n, mediaMensal, categorias, projecaoProximoMes: mediaMensal };
}

/**
 * Decompõe a média mensal de despesa em NÃO-parcela (dia a dia, aluguel, contas
 * fixas) vs PARCELA (parcelamentos de cartão). Usado pela Calculadora da Casa:
 * o dia a dia fica ~constante, as parcelas decaem (e têm reposição).
 */
export function mediasPorTipoParcela(
  transactions: TransactionRecord[],
  monthsBack = 6,
  todayIso?: string,
): { mediaNaoParcela: number; mediaParcela: number; mesesConsiderados: number } {
  const mesAtual = (todayIso || '').substring(0, 7);
  const naoParc: Record<string, number> = {};
  const parc: Record<string, number> = {};
  for (const t of transactions) {
    if (t.ignorar_dashboard || t.tipo !== 'despesa') continue;
    const k = monthKey(t);
    if (mesAtual && k >= mesAtual) continue;
    const ehParcela = (t.parcela_total ?? 0) > 1;
    (ehParcela ? parc : naoParc)[k] = ((ehParcela ? parc : naoParc)[k] || 0) + Number(t.valor);
  }
  const meses = [...new Set([...Object.keys(naoParc), ...Object.keys(parc)])].sort().slice(-monthsBack);
  const n = meses.length || 1;
  const soma = (m: Record<string, number>) => meses.reduce((s, k) => s + (m[k] || 0), 0);
  return {
    mediaNaoParcela: Math.round((soma(naoParc) / n) * 100) / 100,
    mediaParcela: Math.round((soma(parc) / n) * 100) / 100,
    mesesConsiderados: meses.length,
  };
}

// Categorias que NÃO são gasto real do dia a dia (internas/transferências) —
// fora da base da calculadora pra não inflar.
const CATEGORIAS_NAO_GASTO = new Set([
  'Pagamento Fatura', 'Transferência entre contas', 'Saldo Inicial',
  'Reembolsos', 'Devoluções',
]);

/**
 * Média mensal por categoria das despesas NÃO-parceladas (à vista / recorrentes)
 * dos últimos N meses completos. Base editável da Calculadora da Casa: o usuário
 * vê cada categoria e conserta a que estiver irreal — em vez de um total opaco.
 *
 * Separa as parcelas (que decaem) das despesas recorrentes (que ficam).
 */
export function mediaPorCategoriaNaoParcela(
  transactions: TransactionRecord[],
  monthsBack = 5,
  todayIso?: string,
): { categoria: string; media: number }[] {
  const mesAtual = (todayIso || '').substring(0, 7);
  const porMesCat: Record<string, Record<string, number>> = {};
  for (const t of transactions) {
    if (t.ignorar_dashboard || t.tipo !== 'despesa') continue;
    if ((t.parcela_total ?? 0) > 1) continue; // só NÃO-parcela
    const cat = t.categoria || 'Outros';
    if (CATEGORIAS_NAO_GASTO.has(cat)) continue;
    const k = monthKey(t);
    if (mesAtual && k >= mesAtual) continue;
    (porMesCat[k] ||= {})[cat] = (porMesCat[k]?.[cat] || 0) + Number(t.valor);
  }
  const meses = Object.keys(porMesCat).sort().slice(-monthsBack);
  const n = meses.length || 1;
  const catTotais: Record<string, number> = {};
  for (const m of meses) {
    for (const [c, v] of Object.entries(porMesCat[m])) catTotais[c] = (catTotais[c] || 0) + v;
  }
  return Object.entries(catTotais)
    .map(([categoria, total]) => ({ categoria, media: Math.round((total / n) * 100) / 100 }))
    .filter((c) => c.media > 0)
    .sort((a, b) => b.media - a.media);
}

/**
 * Reposição: valor médio mensal de parcelas que COMEÇAM (parcela_atual === 1).
 * É a taxa real de "parcelas novas que sempre aparecem" (São João etc.) — bem
 * menor que a média de TODAS as parcelas. Vira o piso da projeção.
 */
export function reposicaoParcelasNovas(
  transactions: TransactionRecord[],
  monthsBack = 5,
  todayIso?: string,
): number {
  const mesAtual = (todayIso || '').substring(0, 7);
  const porMes: Record<string, number> = {};
  for (const t of transactions) {
    if (t.ignorar_dashboard || t.tipo !== 'despesa') continue;
    if (t.parcela_atual !== 1) continue; // só as que começam
    const k = monthKey(t);
    if (mesAtual && k >= mesAtual) continue;
    porMes[k] = (porMes[k] || 0) + Number(t.valor);
  }
  const meses = Object.keys(porMes).sort().slice(-monthsBack);
  const n = meses.length || 1;
  const total = meses.reduce((s, k) => s + porMes[k], 0);
  return Math.round((total / n) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Análise de picos: maiores gastos numa janela curta (default 4 meses) com
// detecção de meses fora da curva.
//
// Detecção por BASELINE LEAVE-ONE-OUT com MEDIANA: cada mês é comparado com a
// mediana dos OUTROS meses da janela.
//
// Duas decisões importantes aqui:
//  1. Leave-one-out (excluir o próprio mês do baseline) evita que o pico infle
//     a referência e se esconda. Com N pequeno (4), um mês de R$ 2.000 contra
//     três de R$ 400 puxa a média geral pra 800 e "parece" só 2,5× a média;
//     contra os outros (400) ele aparece como 5× — a leitura correta.
//  2. MEDIANA e não média dos outros: com média, uma série em ALTA CONSTANTE
//     (218 → 427 → 465 → 496) marca o último mês como pico, porque os meses
//     iniciais baixos puxam a média pra baixo. Mas isso é tendência, não pico —
//     e tendência já tem detector próprio (spending-patterns). A mediana ignora
//     a cauda baixa e só dispara quando o mês realmente destoa dos demais.
//
// Um mês é pico quando cumpre as TRÊS condições (evita ruído):
//   1. valor >= baseline * LIMIAR_PICO  (30% acima do normal)
//   2. excesso >= PISO_EXCESSO          (R$ 80 — ignora variação trivial)
//   3. a categoria aparece em >1 mês OU o valor é relevante (gasto pontual alto)
// ---------------------------------------------------------------------------
const LIMIAR_PICO = 1.3;   // 30% acima do baseline
const PISO_EXCESSO = 80;   // R$ — abaixo disso não vale sinalizar

export interface MesValor {
  mes: string;             // YYYY-MM
  valor: number;
  baseline: number;        // média dos OUTROS meses da janela
  excesso: number;         // valor - baseline (só quando pico; senão 0)
  acimaDoNormal: boolean;
}

export type Volatilidade = 'pontual' | 'estavel' | 'variavel' | 'irregular';

export interface CategoriaPico {
  categoria: string;
  total: number;           // soma na janela
  media: number;           // média mensal na janela
  mediaParcela: number;    // quanto da média é parcela (comprometido)
  pctParcela: number;      // % da categoria que é parcela
  mesesComGasto: number;
  meses: MesValor[];       // série completa da janela (na ordem)
  picos: MesValor[];       // só os meses fora da curva
  excessoTotal: number;    // soma dos excessos — "quanto pagou a mais"
  volatilidade: Volatilidade;
  pctDoTotal: number;      // % do gasto total da janela
}

export interface AnalisePicos {
  meses: string[];              // janela efetiva, ordenada
  mesesConsiderados: number;
  totalPeriodo: number;
  mediaMensal: number;
  totalPorMes: { mes: string; valor: number }[];
  categorias: CategoriaPico[];  // ordenadas por total desc
  excessoTotal: number;         // soma de todos os excessos da janela
}

export function analisePicosGastos(
  transactions: TransactionRecord[],
  monthsBack = 4,
  todayIso?: string,
): AnalisePicos {
  const mesAtual = (todayIso || '').substring(0, 7);
  // mes -> cat -> { total, parcela }
  const porMesCat: Record<string, Record<string, { total: number; parcela: number }>> = {};

  for (const t of transactions) {
    if (t.ignorar_dashboard || t.tipo !== 'despesa') continue;
    const cat = t.categoria || 'Outros';
    if (CATEGORIAS_NAO_GASTO.has(cat)) continue;
    const k = monthKey(t);
    if (mesAtual && k >= mesAtual) continue; // mês corrente é incompleto
    const slot = ((porMesCat[k] ||= {})[cat] ||= { total: 0, parcela: 0 });
    const v = Number(t.valor);
    slot.total += v;
    if ((t.parcela_total ?? 0) > 1) slot.parcela += v;
  }

  const meses = Object.keys(porMesCat).sort().slice(-monthsBack);
  const n = meses.length;
  if (n === 0) {
    return {
      meses: [], mesesConsiderados: 0, totalPeriodo: 0, mediaMensal: 0,
      totalPorMes: [], categorias: [], excessoTotal: 0,
    };
  }

  // Universo de categorias presentes na janela.
  const cats = new Set<string>();
  for (const m of meses) for (const c of Object.keys(porMesCat[m])) cats.add(c);

  const totalPorMes = meses.map((mes) => ({
    mes,
    valor: round2(Object.values(porMesCat[mes]).reduce((s, x) => s + x.total, 0)),
  }));
  const totalPeriodo = round2(totalPorMes.reduce((s, x) => s + x.valor, 0));

  const categorias: CategoriaPico[] = [...cats].map((categoria) => {
    // Série na janela — mês sem gasto na categoria conta como 0 (é informação:
    // significa que naquele mês não houve esse gasto).
    const valores = meses.map((m) => porMesCat[m][categoria]?.total ?? 0);
    const total = valores.reduce((s, v) => s + v, 0);
    const media = total / n;
    const parcelaTotal = meses.reduce((s, m) => s + (porMesCat[m][categoria]?.parcela ?? 0), 0);
    const mesesComGasto = valores.filter((v) => v > 0).length;

    const serie: MesValor[] = valores.map((valor, i) => {
      // baseline leave-one-out: mediana dos OUTROS meses da janela
      const baseline = n > 1 ? mediana(valores.filter((_, j) => j !== i)) : valor;
      const excessoBruto = valor - baseline;
      const acimaDoNormal =
        n > 1 &&
        valor > 0 &&
        excessoBruto >= PISO_EXCESSO &&
        (baseline === 0 ? true : valor >= baseline * LIMIAR_PICO);
      return {
        mes: meses[i],
        valor: round2(valor),
        baseline: round2(baseline),
        excesso: acimaDoNormal ? round2(excessoBruto) : 0,
        acimaDoNormal,
      };
    });

    const picos = serie.filter((s) => s.acimaDoNormal);
    const excessoTotal = round2(picos.reduce((s, p) => s + p.excesso, 0));

    // Volatilidade pelo coeficiente de variação (desvio / média).
    let volatilidade: Volatilidade;
    if (mesesComGasto <= 1 && n > 1) {
      volatilidade = 'pontual';
    } else {
      const variancia = valores.reduce((s, v) => s + (v - media) ** 2, 0) / n;
      const cv = media > 0 ? Math.sqrt(variancia) / media : 0;
      volatilidade = cv < 0.25 ? 'estavel' : cv < 0.6 ? 'variavel' : 'irregular';
    }

    return {
      categoria,
      total: round2(total),
      media: round2(media),
      mediaParcela: round2(parcelaTotal / n),
      pctParcela: total > 0 ? round2((parcelaTotal / total) * 100) : 0,
      mesesComGasto,
      meses: serie,
      picos,
      excessoTotal,
      volatilidade,
      pctDoTotal: totalPeriodo > 0 ? round2((total / totalPeriodo) * 100) : 0,
    };
  })
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  return {
    meses,
    mesesConsiderados: n,
    totalPeriodo,
    mediaMensal: round2(totalPeriodo / n),
    totalPorMes,
    categorias,
    excessoTotal: round2(categorias.reduce((s, c) => s + c.excessoTotal, 0)),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function mediana(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const meio = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[meio] : (s[meio - 1] + s[meio]) / 2;
}

// ---------------------------------------------------------------------------
// KPIs do mês: saldo livre projetado, taxa de poupança, % despesas essenciais.
// ---------------------------------------------------------------------------
export interface MonthlyKpis {
  receita: number;
  despesa: number;
  saldoLivre: number;        // receita - despesa
  taxaPoupanca: number;      // (receita - despesa) / receita
  pctEssencial: number;      // essenciais / total despesas
  parcelasMes: number;       // contagem de parcelas ativas no mês
  valorParcelas: number;     // soma valor das parcelas no mês
}

export function computeMonthlyKpis(
  transactions: TransactionRecord[],
  targetMonth: string,
  todayIso?: string,
): MonthlyKpis {
  // KPIs do mês corrente devem refletir o REALIZADO, não o que ainda nem aconteceu.
  // Sem este filtro, parcela datada pra dia 31 entra como "já gastei" no dia 15,
  // virando "Sobra do mês -R$200" em vermelho injustificadamente.
  const cutoff = todayIso || null;
  let receita = 0,
    despesa = 0,
    essencial = 0,
    valorParcelas = 0,
    parcelasMes = 0;
  for (const t of transactions) {
    if (t.ignorar_dashboard) continue;
    if (monthKey(t) !== targetMonth) continue;
    if (cutoff && t.data > cutoff) continue;
    if (t.tipo === 'receita') receita += Number(t.valor);
    else if (t.tipo === 'despesa') {
      despesa += Number(t.valor);
      if (t.essencial) essencial += Number(t.valor);
      if (t.parcela_atual != null && t.parcela_total != null) {
        parcelasMes += 1;
        valorParcelas += Number(t.valor);
      }
    }
  }
  return {
    receita,
    despesa,
    saldoLivre: receita - despesa,
    taxaPoupanca: receita > 0 ? (receita - despesa) / receita : 0,
    pctEssencial: despesa > 0 ? essencial / despesa : 0,
    parcelasMes,
    valorParcelas,
  };
}

// ---------------------------------------------------------------------------
// Top contas/cartões — quanto sai de cada origem (debito) e quanto entra na
// fatura (credito). Útil pra mostrar onde está o sangrar.
// ---------------------------------------------------------------------------
export interface AccountFlow {
  conta_id: string;
  total: number;       // despesa total no mês (ou all-time se month=null)
  count: number;
}

export function buildAccountFlow(
  transactions: TransactionRecord[],
  targetMonth: string | null = null,
): AccountFlow[] {
  const byAcc: Record<string, { total: number; count: number }> = {};
  for (const t of transactions) {
    if (t.ignorar_dashboard) continue;
    if (t.tipo !== 'despesa') continue;
    if (targetMonth && monthKey(t) !== targetMonth) continue;
    const id = t.conta_id || 'sem_conta';
    if (!byAcc[id]) byAcc[id] = { total: 0, count: 0 };
    byAcc[id].total += Number(t.valor);
    byAcc[id].count += 1;
  }
  return Object.entries(byAcc)
    .map(([conta_id, { total, count }]) => ({ conta_id, total, count }))
    .sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Comparativo: 3 últimos meses vs 3 anteriores. Devolve totais agregados pra
// alimentar a "Tese" do Claude e o cartão de KPIs.
// ---------------------------------------------------------------------------
export interface PeriodCompare {
  receitaRecente: number;
  despesaRecente: number;
  sobraRecente: number;
  receitaAnterior: number;
  despesaAnterior: number;
  sobraAnterior: number;
  deltaReceita: number; // %, positivo = recente > anterior
  deltaDespesa: number;
  deltaSobra: number;
}

export function comparePeriods(
  flow: MonthFlow[],
  windowSize = 3,
): PeriodCompare | null {
  if (flow.length < windowSize * 2) return null;
  const recent = flow.slice(-windowSize);
  const prior = flow.slice(-(windowSize * 2), -windowSize);
  const sum = (arr: MonthFlow[], k: keyof MonthFlow) =>
    arr.reduce((s, m) => s + (m[k] as number), 0);
  const recR = sum(recent, 'receita');
  const recD = sum(recent, 'despesa');
  const recS = sum(recent, 'sobra');
  const priR = sum(prior, 'receita');
  const priD = sum(prior, 'despesa');
  const priS = sum(prior, 'sobra');
  const delta = (rec: number, pri: number) => (pri !== 0 ? ((rec - pri) / Math.abs(pri)) * 100 : 0);
  return {
    receitaRecente: recR,
    despesaRecente: recD,
    sobraRecente: recS,
    receitaAnterior: priR,
    despesaAnterior: priD,
    sobraAnterior: priS,
    deltaReceita: delta(recR, priR),
    deltaDespesa: delta(recD, priD),
    deltaSobra: delta(recS, priS),
  };
}
