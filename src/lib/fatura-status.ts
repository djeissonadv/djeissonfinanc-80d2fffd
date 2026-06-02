/**
 * Status único da fatura — UMA fonte de verdade pra Dashboard, Contas,
 * FaturaDrawer (qualquer página que mostra um cartão de crédito).
 *
 * Regra:
 *   totalAPagar <= 0.01      → Paga (tolerância de 1 centavo pra rounding)
 *   pagamentos > 0           → Parcialmente paga
 *   despesas + saldoAnt > 0  → Em aberto
 *   nada                     → Sem fatura
 *
 * Recebe valores do hook useFaturaAcumulada e devolve label + cor + classe.
 */

export type FaturaStatusKind = 'paga' | 'parcial' | 'aberta' | 'vazia';

export interface FaturaStatus {
  kind: FaturaStatusKind;
  label: string;
  emoji: string;
  color: string;
  className: string;
}

export interface FaturaInput {
  saldoAnterior: number;
  despesasMes: number;
  pagamentosMes: number;
  totalAPagar: number;
}

export function getFaturaStatus(f: FaturaInput): FaturaStatus {
  const totalAPagar = f.totalAPagar || 0;
  const pagamentos = f.pagamentosMes || 0;
  const teveFatura = (f.despesasMes || 0) > 0 || (f.saldoAnterior || 0) > 0 || pagamentos > 0;

  if (!teveFatura) {
    return {
      kind: 'vazia',
      label: 'Sem fatura',
      emoji: '',
      color: 'hsl(var(--muted-foreground))',
      className: 'text-muted-foreground border-muted-foreground/30',
    };
  }
  if (totalAPagar <= 0.01) {
    return {
      kind: 'paga',
      label: 'Paga',
      emoji: '🟢',
      color: 'hsl(var(--success))',
      className: 'text-success border-success/40',
    };
  }
  if (pagamentos > 0) {
    return {
      kind: 'parcial',
      label: 'Parcialmente paga',
      emoji: '🟡',
      color: 'hsl(var(--warning))',
      className: 'text-warning border-warning/40',
    };
  }
  return {
    kind: 'aberta',
    label: 'Em aberto',
    emoji: '🔴',
    color: 'hsl(var(--destructive))',
    className: 'text-destructive border-destructive/40',
  };
}

/**
 * Total a pagar é SEMPRE o do hook (saldoAnt + despesas - pagamentos).
 * Não recalcule em nenhum lugar — use este alias.
 */
export function getFaturaTotalAPagar(f: FaturaInput): number {
  return Math.max(0, f.totalAPagar || 0);
}
