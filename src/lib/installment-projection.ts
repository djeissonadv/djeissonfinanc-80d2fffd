import { generateHash } from '@/lib/csv-parser';

/**
 * Adds months to a date without overflow (e.g. Jan 31 + 1 month = Feb 28, not Mar 3).
 */
function addMonthsSafe(baseIso: string, months: number): string {
  const base = new Date(baseIso + 'T00:00:00');
  const targetMonth = base.getMonth() + months;
  const targetDate = new Date(base.getFullYear(), targetMonth, 1);
  // Clamp day to last day of target month
  const lastDay = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
  const day = Math.min(base.getDate(), lastDay);
  targetDate.setDate(day);
  const y = targetDate.getFullYear();
  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
  const d = String(targetDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface ProjectableTransaction {
  data: string;
  descricao: string;
  valor: number;
  tipo: 'receita' | 'despesa';
  parcela_atual: number | null;
  parcela_total: number | null;
  pessoa: string;
  hash_transacao: string;
  categoria: string;
  essencial: boolean;
  conta_id: string;
  user_id: string;
  data_original: string | null;
  mes_competencia: string | null;
  grupo_parcela: string | null;
}

export interface ProjectedInstallment extends ProjectableTransaction {
  _isProjected: true;
}

/**
 * For each installment transaction X/Y where X < Y,
 * project parcelas (X+1) through Y with sequential months.
 * Only creates projections with dates >= 2026-01-01.
 */
export function projectFutureInstallments(
  transactions: ProjectableTransaction[]
): ProjectedInstallment[] {
  const projected: ProjectedInstallment[] = [];

  // Build group key including value to distinguish different purchases at the same store
  // e.g., "FARMACIA SAO JOAO|6|59.49|Maiara" vs "FARMACIA SAO JOAO|6|44.05|Maiara"
  const makeGroupKey = (descricao: string, parcela_total: number, valor: number, pessoa: string) => {
    const baseDesc = descricao.replace(/\s*\(auto-projetada\)/, '').trim();
    return baseDesc.substring(0, 25).toUpperCase() + '|' + parcela_total + '|' + valor.toFixed(2) + '|' + pessoa;
  };

  // Collect existing parcela numbers per installment group to avoid projecting parcelas already in the batch
  const existingParcelas = new Map<string, Set<number>>();
  for (const t of transactions) {
    if (!t.parcela_atual || !t.parcela_total) continue;
    const key = makeGroupKey(t.descricao, t.parcela_total, t.valor, t.pessoa);
    if (!existingParcelas.has(key)) existingParcelas.set(key, new Set());
    existingParcelas.get(key)!.add(t.parcela_atual);
  }

  // For each installment group, only project from the one with the LOWEST parcela_atual
  const projected_from = new Set<string>();

  for (const t of transactions) {
    if (!t.parcela_atual || !t.parcela_total) continue;
    if (t.parcela_atual >= t.parcela_total) continue;

    const baseDesc = t.descricao.replace(/\s*\(auto-projetada\)/, '').trim();
    const groupKey = makeGroupKey(t.descricao, t.parcela_total, t.valor, t.pessoa);

    // Only project from the lowest parcela_atual in each group
    if (projected_from.has(groupKey)) continue;
    projected_from.add(groupKey);

    const existingSet = existingParcelas.get(groupKey) || new Set();

    // Use data_original (real purchase date) as base for incrementing, fallback to data
    const baseDate = t.data_original || t.data;

    for (let p = t.parcela_atual + 1; p <= t.parcela_total; p++) {
      // Skip if this parcela already exists in the import batch (e.g. CSV has parcelas 01-12)
      if (existingSet.has(p)) continue;

      const offset = p - t.parcela_atual;

      // Calculate future date from original purchase date (safe from month overflow)
      const isoDate = addMonthsSafe(baseDate, offset);

      // Project mes_competencia forward from billing period
      let projectedCompetencia: string | null = null;
      if (t.mes_competencia) {
        const compIso = addMonthsSafe(`${t.mes_competencia}-01`, offset);
        projectedCompetencia = compIso.substring(0, 7);
      }

      // Only project if the billing period (mes_competencia) is >= current year,
      // or if no mes_competencia, use the transaction date as fallback
      const checkDate = projectedCompetencia ? `${projectedCompetencia}-01` : isoDate;
      const currentYearStart = `${new Date().getFullYear()}-01-01`;
      if (checkDate < currentYearStart) continue;

      const hash = generateHash(isoDate, baseDesc, t.valor, t.pessoa, p, t.parcela_total) + `_p${p}`;

      projected.push({
        user_id: t.user_id,
        conta_id: t.conta_id,
        data: isoDate,
        data_original: baseDate,
        mes_competencia: projectedCompetencia,
        descricao: `${baseDesc} (auto-projetada)`,
        valor: t.valor,
        categoria: t.categoria,
        tipo: t.tipo,
        essencial: t.essencial,
        parcela_atual: p,
        parcela_total: t.parcela_total,
        grupo_parcela: t.grupo_parcela,
        hash_transacao: hash,
        pessoa: t.pessoa,
        _isProjected: true,
      });
    }
  }

  return projected;
}

export interface ConflictMatch {
  csvTransaction: ProjectableTransaction | ProjectedInstallment;
  existingTransaction: {
    id: string;
    descricao: string;
    valor: number;
    data: string;
    data_original: string | null;
    parcela_atual: number | null;
    parcela_total: number | null;
    pessoa: string;
    hash_transacao: string;
  };
  matchType: 'exact' | 'partial';
  matchReason: string;
  /** User choice: 'csv' to use CSV version, 'existing' to keep DB version */
  choice: 'csv' | 'existing';
}

/**
 * Check a list of planned transactions against existing DB transactions.
 * Returns: { clean (no conflict), exact (auto-skip), partial (needs user decision) }
 */
export function detectConflicts(
  planned: (ProjectableTransaction | ProjectedInstallment)[],
  existing: {
    id: string;
    descricao: string;
    valor: number;
    data: string;
    data_original: string | null;
    mes_competencia: string | null;
    parcela_atual: number | null;
    parcela_total: number | null;
    pessoa: string;
    hash_transacao: string;
  }[]
): {
  clean: (ProjectableTransaction | ProjectedInstallment)[];
  exactMatches: { planned: ProjectableTransaction | ProjectedInstallment; existingId: string }[];
  autoReplacements: { planned: ProjectableTransaction | ProjectedInstallment; existingId: string }[];
  conflicts: ConflictMatch[];
} {
  const clean: (ProjectableTransaction | ProjectedInstallment)[] = [];
  const exactMatches: { planned: ProjectableTransaction | ProjectedInstallment; existingId: string }[] = [];
  const autoReplacements: { planned: ProjectableTransaction | ProjectedInstallment; existingId: string }[] = [];
  const conflicts: ConflictMatch[] = [];

  // Robust normalize: strip "(auto-projetada)", non-alphanumeric chars, then compare prefix.
  // This handles garbled font differences (e.g., "TOALIBFO" vs "TOALINFO") by focusing
  // on the alphanumeric skeleton of the description.
  const normalize = (s: string) => s
    .replace(/\s*\(auto-projetada\)/, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 20)
    .toLowerCase();

  const daysDiff = (a: string, b: string): number => {
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    return Math.abs(da.getTime() - db.getTime()) / (1000 * 60 * 60 * 24);
  };

  for (const tx of planned) {
    const prefix = normalize(tx.descricao);
    const isFromCsv = !('_isProjected' in tx);

    // Find exact hash match first
    const hashMatch = existing.find(e => e.hash_transacao === tx.hash_transacao);
    if (hashMatch) {
      exactMatches.push({ planned: tx, existingId: hashMatch.id });
      continue;
    }

    // Try to match against auto-projected transactions for the SAME billing period
    const txCompetencia = (tx as any).mes_competencia || null;
    if (tx.parcela_atual && tx.parcela_total) {
      const autoProjectedMatch = existing.find(e => {
        if (!e.descricao.includes('(auto-projetada)')) return false;
        // Must be same billing period — don't replace March projection with Feb ongoing
        if (e.mes_competencia !== txCompetencia) return false;
        const ePrefix = normalize(e.descricao);
        if (ePrefix !== prefix) return false;
        if (Math.abs(Number(e.valor) - tx.valor) > 0.50) return false;
        if (e.parcela_atual !== tx.parcela_atual) return false;
        if (e.parcela_total !== tx.parcela_total) return false;
        if (e.pessoa.toLowerCase() !== tx.pessoa.toLowerCase()) return false;
        return true;
      });

      if (autoProjectedMatch) {
        autoReplacements.push({ planned: tx, existingId: autoProjectedMatch.id });
        continue;
      }
    }

    const txOriginal = (tx as any).data_original || tx.data;

    // Recurring projection replacement: a real (non-installment) transaction coming
    // from the import replaces a previously projected recurring "(auto-projetada)"
    // of the SAME month/skeleton/pessoa. Without this, the projected entry and the
    // real one would coexist as duplicates. Value can drift (bills vary), so the
    // tolerance is generous.
    if (isFromCsv && !tx.parcela_atual && !tx.parcela_total) {
      const txMonth = ((tx as any).mes_competencia as string | null) || txOriginal.substring(0, 7);
      const recProjMatch = existing.find(e => {
        if (!e.descricao.includes('(auto-projetada)')) return false;
        if (e.parcela_total != null) return false; // recorrente projetada não tem parcela
        if (normalize(e.descricao) !== prefix) return false;
        const eMonth = e.mes_competencia || (e.data_original || e.data).substring(0, 7);
        if (eMonth !== txMonth) return false;
        if (e.pessoa.toLowerCase() !== tx.pessoa.toLowerCase()) return false;
        const tol = Math.max(5, Math.abs(Number(e.valor)) * 0.3);
        return Math.abs(Number(e.valor) - tx.valor) <= tol;
      });
      if (recProjMatch) {
        autoReplacements.push({ planned: tx, existingId: recProjMatch.id });
        continue;
      }
    }

    // Hash-independent dedup against NON-auto-projected existing transactions.
    // The hash is raw-description based, so it misses the same transaction
    // re-imported with slightly different text (garbled PDF fonts, extra spaces)
    // or a shifted date. We compare the normalized alphanumeric skeleton instead.
    const sameSkeleton = (e: typeof existing[number]) =>
      !e.descricao.includes('(auto-projetada)') &&
      normalize(e.descricao) === prefix &&
      e.parcela_atual === tx.parcela_atual &&
      e.parcela_total === tx.parcela_total &&
      e.pessoa.toLowerCase() === tx.pessoa.toLowerCase();

    // 0) Mesma fatura (cartão): quando há mes_competencia, uma transação já
    //    existente no MESMO período com mesmo esqueleto + valor + parcela + pessoa
    //    é a mesma — mesmo que a DATA da compra tenha o ANO inferido diferente
    //    entre importações (PDF do Mercado Pago infere o ano pelo mês da fatura).
    //    Sem isso, reimportar a mesma fatura com período diferente duplicava.
    const txCompet = (tx as any).mes_competencia || null;
    if (txCompet) {
      const sameFatura = existing.find(e =>
        sameSkeleton(e) &&
        e.mes_competencia === txCompet &&
        Math.abs(Number(e.valor) - tx.valor) <= 0.01,
      );
      if (sameFatura) {
        exactMatches.push({ planned: tx, existingId: sameFatura.id });
        continue;
      }
    }

    // 1) Strong duplicate: same skeleton + value (±0,01) + SAME date → already
    //    imported. Auto-skip (no modal) — this is the common "re-importei o mesmo
    //    extrato" case the user hits.
    const strongDup = existing.find(e =>
      sameSkeleton(e) &&
      Math.abs(Number(e.valor) - tx.valor) <= 0.01 &&
      ((e.data_original || e.data) === txOriginal),
    );
    if (strongDup) {
      exactMatches.push({ planned: tx, existingId: strongDup.id });
      continue;
    }

    // 2) Ambiguous near-duplicate: same skeleton + value (±0,10) but the date
    //    shifted a few days (pending vs settled, date correction). Likely the same
    //    transaction — ask the user instead of inserting a silent duplicate.
    const ambiguous = existing.find(e =>
      sameSkeleton(e) &&
      Math.abs(Number(e.valor) - tx.valor) <= 0.10 &&
      daysDiff(txOriginal, e.data_original || e.data) <= 5,
    );

    if (ambiguous) {
      conflicts.push({
        csvTransaction: tx,
        existingTransaction: ambiguous,
        matchType: 'partial',
        matchReason: `Mesma descrição, valor e pessoa; data difere em poucos dias — possível duplicata já lançada.`,
        choice: 'csv',
      });
    } else {
      clean.push(tx);
    }
  }

  return { clean, exactMatches, autoReplacements, conflicts };
}
