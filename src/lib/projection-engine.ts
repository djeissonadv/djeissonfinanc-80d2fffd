/**
 * Projection Engine
 * 
 * Analyzes historical transactions to detect:
 * 1. Fixed expenses (same description + same value in 2+ consecutive months)
 * 2. Active installments (parcela_atual < parcela_total)
 * 3. Variable expenses (average by category for remaining)
 * 
 * Produces monthly projections from current month through Dec/2026.
 */

export interface TransactionRecord {
  data: string;
  mes_competencia?: string | null;
  descricao: string;
  valor: number;
  tipo: string;
  categoria: string;
  categoria_id: string | null;
  parcela_atual: number | null;
  parcela_total: number | null;
  grupo_parcela: string | null;
  ignorar_dashboard: boolean;
  essencial: boolean;
  conta_id: string;
}

export interface FixedExpense {
  descricao: string;
  valor: number;
  categoria: string;
  categoria_id: string | null;
  monthsDetected: string[]; // YYYY-MM
}

export interface InstallmentProjection {
  descricao: string;
  valor: number;
  categoria: string;
  categoria_id: string | null;
  startMonth: string;
  endMonth: string;
  remaining: number;
}

export interface CategoryProjection {
  categoria: string;
  categoria_id: string | null;
  tipo: 'fixo' | 'estimado' | 'manual' | 'parcela';
  valor: number;
  detalhes?: string;
}

export interface MonthProjection {
  mes: string; // YYYY-MM
  categorias: CategoryProjection[];
  totalDespesas: number;
  totalReceitas: number;
  saldoMes: number;
}

/**
 * Detect fixed expenses: same normalized description + same value appearing in 2+ months
 */
export function detectFixedExpenses(transactions: TransactionRecord[]): FixedExpense[] {
  const despesas = transactions.filter(t => t.tipo === 'despesa' && !t.ignorar_dashboard && !t.parcela_total);
  
  // Group by normalized description + value
  const groups: Record<string, { months: Set<string>; t: TransactionRecord }> = {};
  
  for (const t of despesas) {
    const normDesc = t.descricao
      .replace(/\s*\(auto-projetada\)/, '')
      .trim()
      .substring(0, 30)
      .toUpperCase();
    const key = `${normDesc}|${t.valor.toFixed(2)}`;
    const month = t.mes_competencia || t.data.substring(0, 7);

    if (!groups[key]) {
      groups[key] = { months: new Set(), t };
    }
    groups[key].months.add(month);
  }
  
  // Filter: must appear in 2+ different months
  const fixed: FixedExpense[] = [];
  for (const [, { months, t }] of Object.entries(groups)) {
    if (months.size >= 2) {
      fixed.push({
        descricao: t.descricao.replace(/\s*\(auto-projetada\)/, '').trim(),
        valor: t.valor,
        categoria: t.categoria,
        categoria_id: t.categoria_id,
        monthsDetected: Array.from(months).sort(),
      });
    }
  }
  
  return fixed;
}

/**
 * Detect active installments from transactions
 */
export function detectActiveInstallments(transactions: TransactionRecord[]): InstallmentProjection[] {
  // Group by grupo_parcela or description pattern
  const installmentGroups: Record<string, TransactionRecord[]> = {};
  
  for (const t of transactions) {
    if (!t.parcela_atual || !t.parcela_total || t.ignorar_dashboard) continue;
    const key = t.grupo_parcela || t.descricao.replace(/\s*\(auto-projetada\)/, '').trim().substring(0, 25);
    if (!installmentGroups[key]) installmentGroups[key] = [];
    installmentGroups[key].push(t);
  }
  
  const projections: InstallmentProjection[] = [];
  
  for (const [, txs] of Object.entries(installmentGroups)) {
    // Find the latest parcela for this group
    const sorted = txs.sort((a, b) => (b.parcela_atual || 0) - (a.parcela_atual || 0));
    const latest = sorted[0];
    if (!latest.parcela_atual || !latest.parcela_total) continue;

    const remaining = latest.parcela_total - latest.parcela_atual;
    if (remaining <= 0) continue;

    // Use mes_competencia (billing period) when available, NOT the purchase date.
    // For credit card installments, the purchase date (data) can be months/years before
    // the billing period, causing endMonth calculations to be wildly off.
    const baseMonth = latest.mes_competencia || latest.data.substring(0, 7);
    const [baseY, baseM] = baseMonth.split('-').map(Number);
    const startDate = new Date(baseY, baseM - 1, 1);
    const endDate = new Date(baseY, baseM - 1 + remaining, 1);

    projections.push({
      descricao: latest.descricao.replace(/\s*\(auto-projetada\)/, '').trim(),
      valor: latest.valor,
      categoria: latest.categoria,
      categoria_id: latest.categoria_id,
      startMonth: baseMonth,
      endMonth: `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`,
      remaining,
    });
  }
  
  return projections;
}

/**
 * Calculate average monthly spending by category (variable expenses)
 */
export function calculateCategoryAverages(
  transactions: TransactionRecord[],
  fixedDescriptions: Set<string>
): Record<string, { average: number; monthCount: number; categoria_id: string | null }> {
  const despesas = transactions.filter(t => 
    t.tipo === 'despesa' && 
    !t.ignorar_dashboard && 
    !t.parcela_total &&
    !fixedDescriptions.has(t.descricao.replace(/\s*\(auto-projetada\)/, '').trim().substring(0, 30).toUpperCase())
  );
  
  // Group by category and month
  const catMonths: Record<string, { months: Record<string, number>; categoria_id: string | null }> = {};
  
  for (const t of despesas) {
    const cat = t.categoria;
    const month = t.mes_competencia || t.data.substring(0, 7);

    if (!catMonths[cat]) catMonths[cat] = { months: {}, categoria_id: t.categoria_id };
    if (!catMonths[cat].months[month]) catMonths[cat].months[month] = 0;
    catMonths[cat].months[month] += t.valor;
  }
  
  const averages: Record<string, { average: number; monthCount: number; categoria_id: string | null }> = {};
  
  for (const [cat, { months, categoria_id }] of Object.entries(catMonths)) {
    const values = Object.values(months);
    const total = values.reduce((s, v) => s + v, 0);
    averages[cat] = {
      average: total / values.length,
      monthCount: values.length,
      categoria_id,
    };
  }
  
  return averages;
}

/**
 * Calculate average monthly revenue
 */
export function calculateRevenueAverage(transactions: TransactionRecord[]): number {
  const receitas = transactions.filter(t => t.tipo === 'receita' && !t.ignorar_dashboard);
  
  const months: Record<string, number> = {};
  for (const t of receitas) {
    // Use mes_competencia when available so revenue lands in the same period
    // as expenses (which also key off competência). Keying revenue off the raw
    // purchase/credit date would misalign the two and distort saldoMes.
    const month = t.mes_competencia || t.data.substring(0, 7);
    if (!months[month]) months[month] = 0;
    months[month] += t.valor;
  }
  
  const values = Object.values(months);
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export interface ManualOverride {
  mes: string;
  categoria_nome: string;
  tipo: string;
  valor: number;
  descricao: string | null;
}

/**
 * Generate full projection table from current month to Dec 2026
 */
export function generateProjections(
  transactions: TransactionRecord[],
  receitaBase: number,
  manualOverrides: ManualOverride[] = [],
  startMonth?: string,
): MonthProjection[] {
  const fixed = detectFixedExpenses(transactions);
  const installments = detectActiveInstallments(transactions);
  const fixedDescSet = new Set(fixed.map(f => f.descricao.substring(0, 30).toUpperCase()));
  const catAverages = calculateCategoryAverages(transactions, fixedDescSet);
  const revenueAvg = calculateRevenueAverage(transactions);
  
  // Build manual overrides map
  const overrideMap: Record<string, ManualOverride> = {};
  for (const o of manualOverrides) {
    overrideMap[`${o.mes}|${o.categoria_nome}|${o.tipo}`] = o;
  }
  
  // Generate months from startMonth to Dec 2026
  const now = new Date();
  const start = startMonth 
    ? new Date(parseInt(startMonth.split('-')[0]), parseInt(startMonth.split('-')[1]) - 1, 1)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = new Date(now.getFullYear(), 11, 1); // Dec of current year
  
  const projections: MonthProjection[] = [];
  
  const current = new Date(start);
  while (current <= endDate) {
    const mes = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
    const categorias: CategoryProjection[] = [];
    
    // 1. Fixed expenses
    for (const f of fixed) {
      const overrideKey = `${mes}|${f.categoria}|despesa`;
      if (overrideMap[overrideKey]) continue; // Manual override takes precedence
      
      categorias.push({
        categoria: f.categoria,
        categoria_id: f.categoria_id,
        tipo: 'fixo',
        valor: f.valor,
        detalhes: f.descricao,
      });
    }
    
    // 2. Active installments for this month
    for (const inst of installments) {
      if (mes < inst.startMonth || mes > inst.endMonth) continue;
      const overrideKey = `${mes}|${inst.categoria}|despesa`;
      if (overrideMap[overrideKey]) continue;
      
      // Check if already added as fixed
      const alreadyAdded = categorias.some(c => 
        c.detalhes?.substring(0, 20).toUpperCase() === inst.descricao.substring(0, 20).toUpperCase()
      );
      if (alreadyAdded) continue;
      
      categorias.push({
        categoria: inst.categoria,
        categoria_id: inst.categoria_id,
        tipo: 'parcela',
        valor: inst.valor,
        detalhes: inst.descricao,
      });
    }
    
    // 3. Variable category averages
    const addedCats = new Set(categorias.map(c => c.categoria));
    for (const [cat, { average, monthCount, categoria_id }] of Object.entries(catAverages)) {
      const overrideKey = `${mes}|${cat}|despesa`;
      if (overrideMap[overrideKey]) continue;
      
      // Only add variable average for categories not fully covered by fixed/installments
      // Sum what we already have for this category
      const existingTotal = categorias
        .filter(c => c.categoria === cat)
        .reduce((s, c) => s + c.valor, 0);
      
      const remainingAvg = average - existingTotal;
      if (remainingAvg > 10) { // Only if there's meaningful remaining average
        categorias.push({
          categoria: cat,
          categoria_id,
          tipo: 'estimado',
          valor: remainingAvg,
          detalhes: `Média de ${monthCount} mês(es)${monthCount < 3 ? ' ⚠️' : ''}`,
        });
      }
    }
    
    // 4. Manual overrides
    for (const o of manualOverrides) {
      if (o.mes !== mes) continue;
      categorias.push({
        categoria: o.categoria_nome,
        categoria_id: null,
        tipo: 'manual',
        valor: o.valor,
        detalhes: o.descricao || 'Valor manual',
      });
    }
    
    // Calculate totals (exclude revenue manual overrides from despesas)
    const despesaCategorias = categorias.filter(c => {
      const override = manualOverrides.find(o => o.mes === mes && o.categoria_nome === c.categoria && o.tipo === 'receita');
      return !override;
    });
    const totalDespesas = despesaCategorias.reduce((s, c) => s + c.valor, 0);
    const receitaOverride = manualOverrides.find(o => o.mes === mes && o.tipo === 'receita');
    const totalReceitas = receitaOverride ? receitaOverride.valor : (revenueAvg || receitaBase);
    
    projections.push({
      mes,
      categorias,
      totalDespesas,
      totalReceitas,
      saldoMes: totalReceitas - totalDespesas,
    });
    
    current.setMonth(current.getMonth() + 1);
  }
  
  return projections;
}

/**
 * Aggregate projections by category across all months (for summary)
 */
export function aggregateByCategory(projections: MonthProjection[]): Record<string, { total: number; avgPerMonth: number }> {
  const cats: Record<string, number> = {};
  
  for (const p of projections) {
    for (const c of p.categorias) {
      if (!cats[c.categoria]) cats[c.categoria] = 0;
      cats[c.categoria] += c.valor;
    }
  }
  
  const result: Record<string, { total: number; avgPerMonth: number }> = {};
  const monthCount = projections.length || 1;
  
  for (const [cat, total] of Object.entries(cats)) {
    result[cat] = { total, avgPerMonth: total / monthCount };
  }
  
  return result;
}
