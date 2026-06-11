export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('pt-BR');
}

export function getMonthYear(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

// Format a Date as YYYY-MM-DD in LOCAL time. Using toISOString() here would
// convert to UTC and shift the day by ±1 near midnight (BR is UTC-3), which
// corrupts the date buckets used for balances and "a pagar/receber".
export function toLocalIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentMonthRange(): { start: string; end: string } {
  const now = new Date();
  return getMonthRange(now.getMonth(), now.getFullYear());
}

export function getMonthRange(month: number, year: number): { start: string; end: string } {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return {
    start: toLocalIso(start),
    end: toLocalIso(end),
  };
}

export function getMonthName(monthIndex: number): string {
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return months[monthIndex];
}

/**
 * Retorna uma data YYYY-MM-DD DENTRO do mês de competência (YYYY-MM),
 * mantendo o dia informado, com clamp no último dia do mês (Fev → 28/29).
 *
 * Usado no lançamento de cartão: a competência define a fatura, mas a DATA
 * precisa cair no mês certo (não em "hoje"), senão lançamentos de faturas
 * passadas aparecem todos na data de hoje.
 */
export function dataNoMesCompetencia(competencia: string, dia: number): string {
  const [y, m] = competencia.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate(); // dia 0 do mês seguinte = último do atual
  const d = Math.min(Math.max(1, dia), lastDay);
  return `${competencia}-${String(d).padStart(2, '0')}`;
}
