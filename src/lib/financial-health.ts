/**
 * Financial Health Scoring Engine
 *
 * Analyzes transactions, income, and balances to produce a 0-100 health score
 * with component breakdowns and actionable recommendations in Portuguese.
 */

import type { TransactionRecord } from './projection-engine';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface HealthComponent {
  nome: string;
  score: number; // 0-100
  peso: number; // weight 0-1
  descricao: string; // Portuguese
}

export interface FinancialHealthReport {
  score: number; // 0-100
  nivel: 'critico' | 'atencao' | 'bom' | 'excelente';
  componentes: HealthComponent[];
  recomendacoes: string[]; // Portuguese recommendations
}

export interface FinancialHealthParams {
  transactions: TransactionRecord[];
  receitaBase: number;
  reservaMinima: number;
  saldoAtual: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Mês de atribuição da transação. Usa mes_competencia (período de fatura do
// cartão) quando presente, senão YYYY-MM da data. ALINHADO com projection-engine
// e income-commitment — sem isso, parcelas de cartão caíam no mês da COMPRA
// (data), distorcendo a estabilidade de gastos e a reserva vs. o resto do app.
function getMonthKey(t: TransactionRecord): string {
  return t.mes_competencia || t.data.substring(0, 7); // YYYY-MM
}

/**
 * Return the last N distinct months present in the transaction list,
 * sorted chronologically (oldest first).
 */
function getLastNMonths(transactions: TransactionRecord[], n: number): string[] {
  const months = new Set<string>();
  for (const t of transactions) {
    months.add(getMonthKey(t));
  }
  return Array.from(months).sort().slice(-n);
}

/**
 * Sum of expense values for a given month.
 */
function totalExpensesForMonth(
  transactions: TransactionRecord[],
  month: string,
): number {
  return transactions
    .filter(
      (t) =>
        t.tipo === 'despesa' &&
        !t.ignorar_dashboard &&
        getMonthKey(t) === month,
    )
    .reduce((sum, t) => sum + t.valor, 0);
}

/**
 * Average monthly expenses across all months present.
 */
function averageMonthlyExpenses(transactions: TransactionRecord[]): number {
  const despesas = transactions.filter(
    (t) => t.tipo === 'despesa' && !t.ignorar_dashboard,
  );
  const months: Record<string, number> = {};
  for (const t of despesas) {
    const m = getMonthKey(t);
    months[m] = (months[m] || 0) + t.valor;
  }
  const values = Object.values(months);
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Total income across all months.
 */
function totalIncome(transactions: TransactionRecord[]): number {
  return transactions
    .filter((t) => t.tipo === 'receita' && !t.ignorar_dashboard)
    .reduce((sum, t) => sum + t.valor, 0);
}

/**
 * Average monthly income, dividing only by the months that ACTUALLY have
 * income. Dividing lifetime income by every month present (including months
 * where the salary wasn't imported) understates the real monthly figure.
 */
function averageMonthlyIncome(transactions: TransactionRecord[]): number {
  const receitas = transactions.filter(
    (t) => t.tipo === 'receita' && !t.ignorar_dashboard,
  );
  const months: Record<string, number> = {};
  for (const t of receitas) {
    const m = getMonthKey(t);
    months[m] = (months[m] || 0) + t.valor;
  }
  const values = Object.values(months);
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Total expenses across all months.
 */
function totalExpenses(transactions: TransactionRecord[]): number {
  return transactions
    .filter((t) => t.tipo === 'despesa' && !t.ignorar_dashboard)
    .reduce((sum, t) => sum + t.valor, 0);
}

// ---------------------------------------------------------------------------
// Component scorers
// ---------------------------------------------------------------------------

function scoreTaxaPoupanca(transactions: TransactionRecord[], receitaBase: number): HealthComponent {
  // Monthly-aligned: compara uma RECEITA MENSAL contra a DESPESA MENSAL média.
  // Misturar receita acumulada (lifetime) com despesa acumulada distorce a taxa
  // quando a receita só foi importada em parte dos meses (ex.: salário ausente em
  // alguns meses inflaria artificialmente a poupança).
  const monthlyIncome = receitaBase > 0 ? receitaBase : averageMonthlyIncome(transactions);
  const monthlyExpense = averageMonthlyExpenses(transactions);
  const savingsRate = monthlyIncome > 0 ? (monthlyIncome - monthlyExpense) / monthlyIncome : 0;

  let score: number;
  if (savingsRate <= 0) {
    score = 0;
  } else if (savingsRate < 0.05) {
    score = Math.round((savingsRate / 0.05) * 30);
  } else if (savingsRate < 0.1) {
    score = 30 + Math.round(((savingsRate - 0.05) / 0.05) * 20);
  } else if (savingsRate < 0.2) {
    score = 50 + Math.round(((savingsRate - 0.1) / 0.1) * 25);
  } else if (savingsRate < 0.3) {
    score = 75 + Math.round(((savingsRate - 0.2) / 0.1) * 25);
  } else {
    score = 100;
  }

  return {
    nome: 'Taxa de Poupança',
    score: Math.min(100, Math.max(0, score)),
    peso: 0.25,
    descricao: `Taxa de poupança de ${(savingsRate * 100).toFixed(1)}% da receita.`,
  };
}

function scoreControleGastosEssenciais(transactions: TransactionRecord[]): HealthComponent {
  const despesas = transactions.filter(
    (t) => t.tipo === 'despesa' && !t.ignorar_dashboard,
  );
  const totalDesp = despesas.reduce((s, t) => s + t.valor, 0);
  const essenciais = despesas.filter((t) => t.essencial).reduce((s, t) => s + t.valor, 0);

  const ratio = totalDesp > 0 ? essenciais / totalDesp : 0;

  let score: number;
  if (ratio > 0.8) {
    score = 90;
  } else if (ratio >= 0.6) {
    score = 70;
  } else if (ratio >= 0.4) {
    score = 50;
  } else {
    score = 30;
  }

  return {
    nome: 'Controle de Gastos Essenciais',
    score,
    peso: 0.2,
    descricao: `${(ratio * 100).toFixed(0)}% dos gastos são essenciais.`,
  };
}

function scoreReservaEmergencia(
  transactions: TransactionRecord[],
  saldoAtual: number,
): HealthComponent {
  const avgExpenses = averageMonthlyExpenses(transactions);
  const monthsCovered = avgExpenses > 0 ? saldoAtual / avgExpenses : 0;

  let score: number;
  if (monthsCovered <= 0) {
    score = 0;
  } else if (monthsCovered < 1) {
    score = Math.round(monthsCovered * 30);
  } else if (monthsCovered < 3) {
    score = 30 + Math.round(((monthsCovered - 1) / 2) * 40);
  } else if (monthsCovered < 6) {
    score = 70 + Math.round(((monthsCovered - 3) / 3) * 30);
  } else {
    score = 100;
  }

  return {
    nome: 'Reserva de Emergência',
    score: Math.min(100, Math.max(0, score)),
    peso: 0.2,
    descricao: `Saldo atual cobre ${monthsCovered.toFixed(1)} mês(es) de despesas médias.`,
  };
}

function scoreEstabilidadeGastos(transactions: TransactionRecord[]): HealthComponent {
  const last6 = getLastNMonths(transactions, 6);
  const monthlyTotals = last6.map((m) => totalExpensesForMonth(transactions, m));

  let score: number;
  if (monthlyTotals.length < 2) {
    // Not enough data to measure variability — neutral score
    score = 60;
  } else {
    const mean = monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length;
    const variance =
      monthlyTotals.reduce((s, v) => s + (v - mean) ** 2, 0) / monthlyTotals.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 0;

    if (cv < 0.1) {
      score = 100;
    } else if (cv < 0.2) {
      score = 80;
    } else if (cv < 0.3) {
      score = 60;
    } else if (cv < 0.5) {
      score = 40;
    } else {
      score = 20;
    }
  }

  return {
    nome: 'Estabilidade de Gastos',
    score,
    peso: 0.15,
    descricao:
      monthlyTotals.length < 2
        ? 'Dados insuficientes para medir estabilidade.'
        : `Variação de gastos nos últimos ${monthlyTotals.length} meses avaliada.`,
  };
}

function scoreComprometimentoParcelas(
  transactions: TransactionRecord[],
  receitaBase: number,
): HealthComponent {
  const monthlyIncome = receitaBase > 0 ? receitaBase : averageMonthlyIncome(transactions);

  // Desembolso médio de parcelas por mês que DE FATO tem parcelas. Dividir o total
  // acumulado de parcelas por TODOS os meses (incluindo meses sem nenhuma parcela)
  // subestimava o comprometimento mensal real.
  const installmentMonths = new Set<string>();
  let totalInstallments = 0;
  for (const t of transactions) {
    if (t.tipo === 'despesa' && !t.ignorar_dashboard && t.parcela_atual && t.parcela_total) {
      totalInstallments += t.valor;
      installmentMonths.add(getMonthKey(t));
    }
  }

  const monthlyInstallments =
    installmentMonths.size > 0 ? totalInstallments / installmentMonths.size : 0;
  const ratio = monthlyIncome > 0 ? monthlyInstallments / monthlyIncome : 0;

  let score: number;
  if (ratio <= 0) {
    score = 100;
  } else if (ratio < 0.15) {
    score = 80;
  } else if (ratio < 0.3) {
    score = 60;
  } else if (ratio < 0.5) {
    score = 40;
  } else {
    score = 20;
  }

  return {
    nome: 'Comprometimento com Parcelas',
    score,
    peso: 0.2,
    descricao: `${(ratio * 100).toFixed(0)}% da receita comprometida com parcelas.`,
  };
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

function generateRecomendacoes(componentes: HealthComponent[]): string[] {
  const sorted = [...componentes].sort((a, b) => a.score - b.score);
  const recs: string[] = [];

  for (const comp of sorted) {
    if (recs.length >= 4) break;

    switch (comp.nome) {
      case 'Taxa de Poupança':
        if (comp.score < 50) {
          recs.push(
            'Revise seus gastos variáveis e tente separar pelo menos 10% da receita mensal como poupança automática.',
          );
        }
        if (comp.score < 30) {
          recs.push(
            'Considere cortar assinaturas ou serviços não essenciais para aumentar sua margem de poupança.',
          );
        }
        break;

      case 'Controle de Gastos Essenciais':
        if (comp.score < 50) {
          recs.push(
            'Seus gastos supérfluos estão altos. Classifique cada despesa como essencial ou não e estabeleça um limite mensal para gastos não essenciais.',
          );
        }
        break;

      case 'Reserva de Emergência':
        if (comp.score < 70) {
          recs.push(
            'Priorize a formação de uma reserva de emergência equivalente a pelo menos 3 meses de despesas em uma aplicação de alta liquidez.',
          );
        }
        if (comp.score < 30) {
          recs.push(
            'Sua reserva está muito abaixo do mínimo seguro. Direcione qualquer valor excedente do mês para a reserva antes de outros investimentos.',
          );
        }
        break;

      case 'Estabilidade de Gastos':
        if (comp.score < 60) {
          recs.push(
            'Seus gastos mensais variam bastante. Crie um orçamento fixo por categoria para ter mais previsibilidade financeira.',
          );
        }
        break;

      case 'Comprometimento com Parcelas':
        if (comp.score < 60) {
          recs.push(
            'O comprometimento com parcelas está elevado. Evite novas compras parceladas até que as parcelas atuais sejam quitadas.',
          );
        }
        if (comp.score < 40) {
          recs.push(
            'Avalie a possibilidade de antecipar parcelas com desconto ou renegociar prazos para reduzir o impacto mensal.',
          );
        }
        break;
    }
  }

  // Guarantee at least 2 recommendations
  if (recs.length < 2) {
    if (!recs.some((r) => r.includes('poupança'))) {
      recs.push(
        'Continue mantendo suas finanças equilibradas e considere diversificar seus investimentos.',
      );
    }
    if (recs.length < 2) {
      recs.push(
        'Revise seu planejamento financeiro a cada trimestre para ajustar metas e acompanhar sua evolução.',
      );
    }
  }

  return recs.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function calculateFinancialHealth(params: FinancialHealthParams): FinancialHealthReport {
  const { transactions, receitaBase, saldoAtual } = params;

  const componentes: HealthComponent[] = [
    scoreTaxaPoupanca(transactions, receitaBase),
    scoreControleGastosEssenciais(transactions),
    scoreReservaEmergencia(transactions, saldoAtual),
    scoreEstabilidadeGastos(transactions),
    scoreComprometimentoParcelas(transactions, receitaBase),
  ];

  const score = Math.round(
    componentes.reduce((sum, c) => sum + c.score * c.peso, 0),
  );

  let nivel: FinancialHealthReport['nivel'];
  if (score < 30) {
    nivel = 'critico';
  } else if (score < 55) {
    nivel = 'atencao';
  } else if (score < 80) {
    nivel = 'bom';
  } else {
    nivel = 'excelente';
  }

  const recomendacoes = generateRecomendacoes(componentes);

  return { score, nivel, componentes, recomendacoes };
}

// ---------------------------------------------------------------------------
// Color helper
// ---------------------------------------------------------------------------

export function getScoreColor(score: number): string {
  if (score < 30) return 'text-red-500 bg-red-50 border-red-200';
  if (score < 55) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
  if (score < 80) return 'text-green-600 bg-green-50 border-green-200';
  return 'text-emerald-600 bg-emerald-50 border-emerald-200';
}
