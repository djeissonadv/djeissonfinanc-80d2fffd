/**
 * SINGLE SOURCE OF TRUTH pro cálculo de saldo.
 *
 * ANTES: Dashboard.saldoAtual + Dashboard.saldoAnterior + Contas.saldos +
 * Análises.saldoAnterior — 4 implementações ligeiramente diferentes do mesmo
 * cálculo. Bug clássico: muda regra num lugar, esquece os outros 3.
 *
 * AGORA: TODA query de saldo vira chamada de `calcularSaldosContas()`.
 */

import { contaNoSaldo, somaComSinal, type TransacaoLike } from './transacao-filters';

interface ContaSaldoLike {
  id: string;
  saldo_inicial?: number | null;
  tipo?: string | null;
  data_abertura?: string | null;
}

interface TransacaoSaldoLike extends TransacaoLike {
  conta_id?: string | null;
}

/**
 * Calcula saldo por conta — único caminho na codebase.
 *
 * Regras (TODAS aqui, não espalhadas):
 *  1. Saldo inicial só conta se a conta foi aberta ANTES ou EM `cutoffDate`.
 *  2. Só soma transações realizadas (`pago !== false`).
 *  3. Ignora "Saldo Inicial" (esse campo já está em `contas.saldo_inicial`).
 *  4. Receita soma, despesa subtrai.
 *
 * @param contas Lista de contas (qualquer tipo, mas normalmente só débito).
 * @param transacoes Lista de transações JÁ FILTRADAS pelo range desejado
 *   (a função não filtra por data — o caller decide se é "até hoje" ou
 *   "antes do mês X"). Centraliza apenas a *lógica de soma*, não a janela.
 * @returns Mapa `{ [contaId]: saldo }`. Use `Object.values().reduce` pra total.
 */
export function calcularSaldosContas(
  contas: ContaSaldoLike[],
  transacoes: TransacaoSaldoLike[],
  cutoffDate?: string
): Record<string, number> {
  const saldos: Record<string, number> = {};

  // 1) saldo inicial
  for (const c of contas) {
    const inicialContaConta = !c.data_abertura || !cutoffDate || c.data_abertura <= cutoffDate;
    saldos[c.id] = inicialContaConta ? Number(c.saldo_inicial || 0) : 0;
  }

  // 2) transações
  for (const t of transacoes) {
    if (!contaNoSaldo(t)) continue;
    if (!t.conta_id) continue;
    if (!(t.conta_id in saldos)) continue; // conta não está na lista
    const v = Number(t.valor) || 0;
    saldos[t.conta_id] += t.tipo === 'receita' ? v : -v;
  }

  return saldos;
}

/**
 * Soma total de saldos. Conveniência pra "saldo geral de todas as contas".
 */
export function somaSaldos(saldos: Record<string, number>): number {
  return Object.values(saldos).reduce((s, v) => s + v, 0);
}

/**
 * Calcula saldo total (soma todas contas) — atalho composto.
 */
export function calcularSaldoTotal(
  contas: ContaSaldoLike[],
  transacoes: TransacaoSaldoLike[],
  cutoffDate?: string
): number {
  return somaSaldos(calcularSaldosContas(contas, transacoes, cutoffDate));
}

// Re-export pra import único nos consumers
export { somaComSinal, contaNoSaldo };
