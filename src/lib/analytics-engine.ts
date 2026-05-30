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
): MonthFlow[] {
  const byMonth: Record<string, { receita: number; despesa: number }> = {};
  for (const t of transactions) {
    if (t.ignorar_dashboard) continue;
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
export interface CategorySlice {
  categoria: string;
  valor: number;
  pct: number;
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
  let grandTotal = 0;
  for (const t of filtered) {
    const cat = t.categoria || 'Outros';
    totals[cat] = (totals[cat] || 0) + Number(t.valor);
    grandTotal += Number(t.valor);
  }
  return Object.entries(totals)
    .map(([categoria, valor]) => ({
      categoria,
      valor: Math.round(valor * 100) / 100,
      pct: grandTotal > 0 ? Math.round((valor / grandTotal) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.valor - a.valor);
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
): MonthlyKpis {
  let receita = 0,
    despesa = 0,
    essencial = 0,
    valorParcelas = 0,
    parcelasMes = 0;
  for (const t of transactions) {
    if (t.ignorar_dashboard) continue;
    if (monthKey(t) !== targetMonth) continue;
    if (t.tipo === 'receita') receita += Number(t.valor);
    else if (t.tipo === 'despesa') {
      despesa += Number(t.valor);
      if (t.essencial) essencial += Number(t.valor);
      if (t.parcela_atual && t.parcela_total) {
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
