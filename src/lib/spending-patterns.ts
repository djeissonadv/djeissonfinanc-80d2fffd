/**
 * Spending Patterns Analysis Engine
 *
 * Analyzes transaction history to detect spending trends, anomalies,
 * recurring charges, and generate actionable insights.
 */

import type { TransactionRecord } from './projection-engine';
import { toLocalIso } from './format';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface CategoryTrend {
  categoria: string;
  tendencia: 'subindo' | 'descendo' | 'estavel';
  variacao: number; // percentage change
  mediaRecente: number; // average last 3 months
  mediaAnterior: number; // average previous 3 months
}

export interface SpendingAnomaly {
  categoria: string;
  mes: string; // YYYY-MM
  valor: number;
  media: number;
  desvio: number;
  excesso: number;
}

export interface RecurringCharge {
  descricao: string;
  valor: number; // average amount
  frequencia: number; // number of months
  ultimoMes: string; // YYYY-MM
  categoria: string;
}

export interface MonthlyDigest {
  mes: string;
  totalDespesas: number;
  totalReceitas: number;
  saldo: number;
  topCategories: { categoria: string; valor: number; percentual: number }[];
  essencialPercent: number;
  comparisonPrevMonth: { despesas: number; receitas: number }; // percentage change
}

export interface SmartInsight {
  tipo: 'alerta' | 'oportunidade' | 'info' | 'positivo';
  titulo: string;
  descricao: string;
  prioridade: number; // 1-5
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Mês de atribuição: mes_competencia (fatura do cartão) quando presente, senão
// YYYY-MM da data. ALINHADO com projection-engine/financial-health — sem isso,
// parcelas de cartão caíam no mês da COMPRA e distorciam tendências/anomalias.
function getMonth(t: TransactionRecord): string {
  return t.mes_competencia || t.data.substring(0, 7);
}

function getSortedUniqueMonths(transactions: TransactionRecord[]): string[] {
  const set = new Set<string>();
  for (const t of transactions) {
    set.add(getMonth(t));
  }
  return Array.from(set).sort();
}

function buildCategoryMonthlyTotals(
  transactions: TransactionRecord[],
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  const despesas = transactions.filter(
    (t) => t.tipo === 'despesa' && !t.ignorar_dashboard,
  );
  for (const t of despesas) {
    const cat = t.categoria;
    const mes = getMonth(t);
    if (!result[cat]) result[cat] = {};
    if (!result[cat][mes]) result[cat][mes] = 0;
    result[cat][mes] += t.valor;
  }
  return result;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// 1. detectSpendingTrends
// ---------------------------------------------------------------------------

export function detectSpendingTrends(
  transactions: TransactionRecord[],
): CategoryTrend[] {
  const catMonths = buildCategoryMonthlyTotals(transactions);
  const allMonths = getSortedUniqueMonths(transactions);

  if (allMonths.length < 6) {
    // Need at least 6 months to compare 3 recent vs 3 previous
    // Fall back: use whatever we have, splitting in half
  }

  const trends: CategoryTrend[] = [];

  for (const [categoria, monthMap] of Object.entries(catMonths)) {
    const catMonthsSorted = Object.keys(monthMap).sort();
    if (catMonthsSorted.length < 3) continue; // need 3+ months of data

    const recent3 = catMonthsSorted.slice(-3);
    const previous = catMonthsSorted.slice(0, -3);

    if (previous.length === 0) continue; // need at least some previous data
    const previous3 = previous.slice(-3);

    const mediaRecente = mean(recent3.map((m) => monthMap[m]));
    const mediaAnterior = mean(previous3.map((m) => monthMap[m]));

    let variacao = 0;
    if (mediaAnterior > 0) {
      variacao = ((mediaRecente - mediaAnterior) / mediaAnterior) * 100;
    }

    let tendencia: CategoryTrend['tendencia'] = 'estavel';
    if (variacao > 10) tendencia = 'subindo';
    else if (variacao < -10) tendencia = 'descendo';

    trends.push({
      categoria,
      tendencia,
      variacao: Math.round(variacao * 100) / 100,
      mediaRecente: Math.round(mediaRecente * 100) / 100,
      mediaAnterior: Math.round(mediaAnterior * 100) / 100,
    });
  }

  return trends.sort((a, b) => Math.abs(b.variacao) - Math.abs(a.variacao));
}

// ---------------------------------------------------------------------------
// 2. detectAnomalies
// ---------------------------------------------------------------------------

export function detectAnomalies(
  transactions: TransactionRecord[],
): SpendingAnomaly[] {
  const catMonths = buildCategoryMonthlyTotals(transactions);
  const anomalies: SpendingAnomaly[] = [];

  for (const [categoria, monthMap] of Object.entries(catMonths)) {
    const months = Object.keys(monthMap).sort();
    const values = months.map((m) => monthMap[m]);

    if (values.length < 3) continue; // need enough data for meaningful stats

    const m = mean(values);
    const sd = stddev(values);

    if (sd === 0) continue; // no variation, no anomalies

    const threshold = m + 1.5 * sd;

    for (let i = 0; i < months.length; i++) {
      if (values[i] > threshold) {
        anomalies.push({
          categoria,
          mes: months[i],
          valor: Math.round(values[i] * 100) / 100,
          media: Math.round(m * 100) / 100,
          desvio: Math.round(sd * 100) / 100,
          excesso: Math.round((values[i] - threshold) * 100) / 100,
        });
      }
    }
  }

  return anomalies.sort((a, b) => b.excesso - a.excesso);
}

// ---------------------------------------------------------------------------
// 3. detectRecurringCharges
// ---------------------------------------------------------------------------

export function detectRecurringCharges(
  transactions: TransactionRecord[],
): RecurringCharge[] {
  const despesas = transactions.filter(
    (t) =>
      t.tipo === 'despesa' &&
      !t.ignorar_dashboard &&
      t.parcela_total == null,
  );

  // Group by normalized description
  const groups: Record<
    string,
    { months: Set<string>; valores: number[]; original: string; categoria: string }
  > = {};

  for (const t of despesas) {
    const normDesc = t.descricao.trim().toUpperCase().substring(0, 25);
    if (!groups[normDesc]) {
      groups[normDesc] = {
        months: new Set(),
        valores: [],
        original: t.descricao.trim(),
        categoria: t.categoria,
      };
    }
    const mes = getMonth(t);
    if (!groups[normDesc].months.has(mes)) {
      groups[normDesc].months.add(mes);
      groups[normDesc].valores.push(t.valor);
    }
  }

  const recurring: RecurringCharge[] = [];

  for (const [, group] of Object.entries(groups)) {
    if (group.months.size < 3) continue;

    const sortedMonths = Array.from(group.months).sort();
    const valorMedio = mean(group.valores);

    recurring.push({
      descricao: group.original,
      valor: Math.round(valorMedio * 100) / 100,
      frequencia: group.months.size,
      ultimoMes: sortedMonths[sortedMonths.length - 1],
      categoria: group.categoria,
    });
  }

  return recurring.sort((a, b) => b.valor - a.valor);
}

// ---------------------------------------------------------------------------
// 4. calculateMonthlyDigest
// ---------------------------------------------------------------------------

export function calculateMonthlyDigest(
  transactions: TransactionRecord[],
  today: string = toLocalIso(new Date()),
): MonthlyDigest | null {
  const validTx = transactions.filter((t) => !t.ignorar_dashboard);
  const allMonths = getSortedUniqueMonths(validTx);

  if (allMonths.length < 1) return null;

  // O "mês fechado" mais recente. Só tratamos o último mês com dados como parcial
  // (e recuamos pro anterior) quando ele É o mês corrente. Escolher cegamente o
  // penúltimo reportava o mês ERRADO sempre que o último mês já estava completo
  // (ex.: importação feita no início do mês seguinte).
  const currentMonth = today.substring(0, 7); // YYYY-MM
  const lastMonth = allMonths[allMonths.length - 1];
  const targetMonth =
    lastMonth === currentMonth && allMonths.length >= 2
      ? allMonths[allMonths.length - 2]
      : lastMonth;

  const targetIdx = allMonths.indexOf(targetMonth);
  const prevMonth = targetIdx > 0 ? allMonths[targetIdx - 1] : null;

  const monthTx = validTx.filter((t) => getMonth(t) === targetMonth);
  const prevMonthTx = prevMonth
    ? validTx.filter((t) => getMonth(t) === prevMonth)
    : [];

  const despesas = monthTx.filter((t) => t.tipo === 'despesa');
  const receitas = monthTx.filter((t) => t.tipo === 'receita');

  const totalDespesas = despesas.reduce((s, t) => s + t.valor, 0);
  const totalReceitas = receitas.reduce((s, t) => s + t.valor, 0);

  // Top categories
  const catTotals: Record<string, number> = {};
  for (const t of despesas) {
    if (!catTotals[t.categoria]) catTotals[t.categoria] = 0;
    catTotals[t.categoria] += t.valor;
  }

  const topCategories = Object.entries(catTotals)
    .map(([categoria, valor]) => ({
      categoria,
      valor: Math.round(valor * 100) / 100,
      percentual:
        totalDespesas > 0
          ? Math.round((valor / totalDespesas) * 10000) / 100
          : 0,
    }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5);

  // Essential percentage
  const essencialTotal = despesas
    .filter((t) => t.essencial)
    .reduce((s, t) => s + t.valor, 0);
  const essencialPercent =
    totalDespesas > 0
      ? Math.round((essencialTotal / totalDespesas) * 10000) / 100
      : 0;

  // Comparison with previous month
  const prevDespesas = prevMonthTx
    .filter((t) => t.tipo === 'despesa')
    .reduce((s, t) => s + t.valor, 0);
  const prevReceitas = prevMonthTx
    .filter((t) => t.tipo === 'receita')
    .reduce((s, t) => s + t.valor, 0);

  const comparisonPrevMonth = {
    despesas:
      prevDespesas > 0
        ? Math.round(((totalDespesas - prevDespesas) / prevDespesas) * 10000) / 100
        : 0,
    receitas:
      prevReceitas > 0
        ? Math.round(((totalReceitas - prevReceitas) / prevReceitas) * 10000) / 100
        : 0,
  };

  return {
    mes: targetMonth,
    totalDespesas: Math.round(totalDespesas * 100) / 100,
    totalReceitas: Math.round(totalReceitas * 100) / 100,
    saldo: Math.round((totalReceitas - totalDespesas) * 100) / 100,
    topCategories,
    essencialPercent,
    comparisonPrevMonth,
  };
}

// ---------------------------------------------------------------------------
// 5. generateSmartInsights
// ---------------------------------------------------------------------------

export function generateSmartInsights(
  transactions: TransactionRecord[],
  receitaBase: number,
): SmartInsight[] {
  const insights: SmartInsight[] = [];
  const trends = detectSpendingTrends(transactions);
  const anomalies = detectAnomalies(transactions);
  const recurring = detectRecurringCharges(transactions);
  const digest = calculateMonthlyDigest(transactions);

  // --- Alert: categories trending up significantly ---
  for (const trend of trends) {
    if (trend.tendencia === 'subindo' && trend.variacao > 20) {
      insights.push({
        tipo: 'alerta',
        titulo: `${trend.categoria} em alta`,
        descricao: `Seus gastos com ${trend.categoria} subiram ${trend.variacao.toFixed(0)}% nos últimos 3 meses (média de R$ ${trend.mediaRecente.toFixed(0)} vs R$ ${trend.mediaAnterior.toFixed(0)} anteriormente).`,
        prioridade: trend.variacao > 50 ? 1 : 2,
      });
    }
  }

  // --- Alert: essential expenses > 60% of income ---
  if (digest && receitaBase > 0) {
    const essencialAbsoluto =
      (digest.essencialPercent / 100) * digest.totalDespesas;
    const essencialPercentRenda = (essencialAbsoluto / receitaBase) * 100;

    if (essencialPercentRenda > 60) {
      insights.push({
        tipo: 'alerta',
        titulo: 'Gastos essenciais elevados',
        descricao: `Despesas essenciais representam ${essencialPercentRenda.toFixed(0)}% da sua renda. O ideal é manter abaixo de 60%.`,
        prioridade: 2,
      });
    }
  }

  // --- Alert: total expenses > 90% of income ---
  if (digest && receitaBase > 0) {
    const expenseRatio = (digest.totalDespesas / receitaBase) * 100;
    if (expenseRatio > 90) {
      insights.push({
        tipo: 'alerta',
        titulo: 'Despesas próximas da renda',
        descricao: `Suas despesas representam ${expenseRatio.toFixed(0)}% da sua renda mensal. Margem de segurança muito baixa.`,
        prioridade: 1,
      });
    }
  }

  // --- Alert: anomalies in recent months ---
  if (anomalies.length > 0) {
    const allMonths = getSortedUniqueMonths(transactions);
    const recentMonth = allMonths.length >= 2
      ? allMonths[allMonths.length - 2]
      : allMonths[allMonths.length - 1];

    const recentAnomalies = anomalies.filter((a) => a.mes === recentMonth);
    for (const anomaly of recentAnomalies) {
      insights.push({
        tipo: 'alerta',
        titulo: `Gasto atípico em ${anomaly.categoria}`,
        descricao: `Em ${anomaly.mes}, ${anomaly.categoria} ficou R$ ${anomaly.excesso.toFixed(0)} acima do normal (R$ ${anomaly.valor.toFixed(0)} vs média de R$ ${anomaly.media.toFixed(0)}).`,
        prioridade: 2,
      });
    }
  }

  // --- Opportunity: installments ending soon ---
  const installmentTx = transactions.filter(
    (t) =>
      t.tipo === 'despesa' &&
      !t.ignorar_dashboard &&
      t.parcela_atual != null &&
      t.parcela_total != null,
  );

  // Group by grupo_parcela or description
  const installmentGroups: Record<string, TransactionRecord[]> = {};
  for (const t of installmentTx) {
    const key =
      t.grupo_parcela || t.descricao.trim().substring(0, 25).toUpperCase();
    if (!installmentGroups[key]) installmentGroups[key] = [];
    installmentGroups[key].push(t);
  }

  for (const [, txs] of Object.entries(installmentGroups)) {
    const sorted = txs.sort(
      (a, b) => (b.parcela_atual || 0) - (a.parcela_atual || 0),
    );
    const latest = sorted[0];
    if (!latest.parcela_atual || !latest.parcela_total) continue;

    const remaining = latest.parcela_total - latest.parcela_atual;
    if (remaining > 0 && remaining <= 3) {
      insights.push({
        tipo: 'oportunidade',
        titulo: `${latest.descricao.trim()} termina em breve`,
        descricao: `Faltam ${remaining} parcela(s) de R$ ${latest.valor.toFixed(2)}. Isso vai liberar R$ ${latest.valor.toFixed(2)}/mês no seu orçamento.`,
        prioridade: 3,
      });
    }
  }

  // --- Positive: savings rate > 20% ---
  if (digest && receitaBase > 0) {
    const savingsRate =
      ((receitaBase - digest.totalDespesas) / receitaBase) * 100;
    if (savingsRate > 20) {
      insights.push({
        tipo: 'positivo',
        titulo: 'Boa taxa de poupança',
        descricao: `Você está poupando aproximadamente ${savingsRate.toFixed(0)}% da sua renda. Continue assim!`,
        prioridade: 4,
      });
    }
  }

  // --- Info: recurring charges total ---
  if (recurring.length > 0) {
    const totalRecorrente = recurring.reduce((s, r) => s + r.valor, 0);
    insights.push({
      tipo: 'info',
      titulo: 'Cobranças recorrentes',
      descricao: `Você tem ${recurring.length} cobranças recorrentes identificadas, totalizando R$ ${totalRecorrente.toFixed(2)}/mês.`,
      prioridade: 4,
    });
  }

  // --- Positive: categories trending down ---
  for (const trend of trends) {
    if (trend.tendencia === 'descendo' && trend.variacao < -15) {
      insights.push({
        tipo: 'positivo',
        titulo: `${trend.categoria} em queda`,
        descricao: `Gastos com ${trend.categoria} reduziram ${Math.abs(trend.variacao).toFixed(0)}% nos últimos meses. Bom trabalho!`,
        prioridade: 5,
      });
    }
  }

  return insights.sort((a, b) => a.prioridade - b.prioridade);
}
