/**
 * Próximos vencimentos — fontes consolidadas em UM tipo só.
 *
 * O que conta como "próximo vencimento":
 *  1. Transação pendente (`pago=false`) com data futura.
 *  2. Conta a pagar/receber em aberto (`contas_pagar_receber.pago=false`).
 *
 * Cartão de crédito NÃO entra aqui — fatura tem UI própria (CardFatura no
 * Dashboard). Esse widget é pra "o que cai/sai da conta nos próximos dias".
 */

export interface Vencimento {
  id: string;
  fonte: 'transacao' | 'conta_pr' | 'fatura';
  tipo: 'pagar' | 'receber';
  descricao: string;
  valor: number;
  dataVencimento: string; // YYYY-MM-DD
  categoria?: string | null;
  diasAteVencer: number; // negativo = atrasado
  /** Pra fonte=fatura: id do cartão (pra abrir o drawer ao clicar) */
  cardId?: string;
}

interface TxLike {
  id: string;
  descricao: string;
  valor: number | string;
  tipo: 'receita' | 'despesa' | string;
  data: string;
  categoria?: string | null;
  pago?: boolean | null;
}

interface CprLike {
  id: string;
  descricao: string;
  valor: number | string;
  tipo: 'pagar' | 'receber' | string;
  data_vencimento: string | null;
  categoria?: string | null;
  pago: boolean;
}

/**
 * Calcula dias até a data X (positivo = futuro, 0 = hoje, negativo = atrasado).
 * Compara YYYY-MM-DD strings — não cai em armadilhas de timezone porque
 * trabalha só no nível de dia.
 */
export function diasAte(dataAlvo: string, hoje: string): number {
  const [yA, mA, dA] = dataAlvo.split('-').map(Number);
  const [yH, mH, dH] = hoje.split('-').map(Number);
  const alvoMs = Date.UTC(yA, mA - 1, dA);
  const hojeMs = Date.UTC(yH, mH - 1, dH);
  return Math.round((alvoMs - hojeMs) / 86_400_000);
}

/**
 * Constrói lista de vencimentos a partir das 2 fontes. Ordenado por data
 * (mais próximos primeiro). Atrasados entram no topo (dias negativos).
 *
 * @param txs Transações (qualquer range — a função filtra pendentes futuras).
 * @param cprs Contas a pagar/receber (mesma ideia).
 * @param hoje ISO YYYY-MM-DD do dia atual (use useTodayIso).
 * @param ateNDias Limite de dias no futuro (ex: 30 = próximos 30 dias).
 *   Atrasados (data < hoje) sempre entram, independente do limite.
 */
export function construirVencimentos(
  txs: TxLike[],
  cprs: CprLike[],
  hoje: string,
  ateNDias = 30
): Vencimento[] {
  const result: Vencimento[] = [];

  // Fonte 1: transações pendentes
  for (const t of txs) {
    if (t.pago !== false) continue; // só pendentes
    if (!t.data) continue;
    const dias = diasAte(t.data, hoje);
    if (dias > ateNDias) continue; // muito longe — ignora
    result.push({
      id: `tx:${t.id}`,
      fonte: 'transacao',
      tipo: t.tipo === 'receita' ? 'receber' : 'pagar',
      descricao: t.descricao,
      valor: Number(t.valor) || 0,
      dataVencimento: t.data,
      categoria: t.categoria,
      diasAteVencer: dias,
    });
  }

  // Fonte 2: contas a pagar/receber em aberto
  for (const c of cprs) {
    if (c.pago) continue;
    if (!c.data_vencimento) continue;
    const dias = diasAte(c.data_vencimento, hoje);
    if (dias > ateNDias) continue;
    result.push({
      id: `cpr:${c.id}`,
      fonte: 'conta_pr',
      tipo: c.tipo === 'receber' ? 'receber' : 'pagar',
      descricao: c.descricao,
      valor: Number(c.valor) || 0,
      dataVencimento: c.data_vencimento,
      categoria: c.categoria,
      diasAteVencer: dias,
    });
  }

  // Ordena: mais atrasado primeiro, depois mais próximo
  result.sort((a, b) => a.diasAteVencer - b.diasAteVencer);
  return result;
}

/**
 * Soma o saldo projetado: realizado + receitas pendentes próximas −
 * despesas pendentes próximas. "Quanto sobra se tudo previsto rolar até X dias".
 */
export function calcularImpactoVencimentos(
  vencimentos: Vencimento[]
): { totalAPagar: number; totalAReceber: number; impactoLiquido: number } {
  let totalAPagar = 0;
  let totalAReceber = 0;
  for (const v of vencimentos) {
    if (v.tipo === 'pagar') totalAPagar += v.valor;
    else totalAReceber += v.valor;
  }
  return {
    totalAPagar,
    totalAReceber,
    impactoLiquido: totalAReceber - totalAPagar,
  };
}

interface CartaoComFatura {
  id: string;
  nome: string;
  dia_vencimento?: number | null;
}

interface FaturaInfo {
  totalAPagar: number;
}

/**
 * Calcula próximo vencimento de cartão a partir do dia do mês.
 * Se dia_vencimento já passou este mês, vai pro mês seguinte.
 *
 * @returns ISO YYYY-MM-DD do próximo vencimento.
 */
export function proximoVencimentoCartao(diaVencimento: number, hoje: string): string {
  const [y, m, d] = hoje.split('-').map(Number);
  const targetDay = Math.min(Math.max(diaVencimento, 1), 28); // clamp pra evitar fev/31
  // Se o dia ja passou neste mes, vai pro proximo
  const useNextMonth = targetDay < d;
  const dt = new Date(Date.UTC(y, m - 1 + (useNextMonth ? 1 : 0), targetDay));
  return dt.toISOString().slice(0, 10);
}

/**
 * Constrói vencimentos a partir das faturas em aberto dos cartões.
 *
 * Cada cartão com `totalAPagar > 0` e `dia_vencimento` setado vira um item
 * de vencimento. Filtra pelo range `ateNDias`.
 *
 * Por que esta função existe:
 *   Antes a Hero "Disponível pra gastar" ignorava a fatura do cartão — você
 *   podia ter R$ 5k de saldo e uma fatura de R$ 3k vencendo em 8 dias e o
 *   headline mostrava R$ 5k "disponível". Agora fatura próxima entra como
 *   compromisso e o headline reflete o que sobra DEPOIS dela.
 */
export function buildVencimentosFatura(
  cards: CartaoComFatura[],
  faturas: Record<string, FaturaInfo>,
  hoje: string,
  ateNDias = 30
): Vencimento[] {
  const result: Vencimento[] = [];
  for (const card of cards) {
    if (!card.dia_vencimento) continue;
    const fatura = faturas[card.id];
    if (!fatura || fatura.totalAPagar <= 0.01) continue; // paga ou sem saldo
    const dataVencimento = proximoVencimentoCartao(card.dia_vencimento, hoje);
    const dias = diasAte(dataVencimento, hoje);
    if (dias > ateNDias) continue;
    result.push({
      id: `fat:${card.id}`,
      fonte: 'fatura',
      tipo: 'pagar',
      descricao: `Fatura ${card.nome}`,
      valor: fatura.totalAPagar,
      dataVencimento,
      categoria: 'Pagamento Fatura',
      diasAteVencer: dias,
      cardId: card.id,
    });
  }
  return result;
}

/**
 * Rótulo amigável pro badge de vencimento.
 * Atrasado: "vencido há 3d" / "vencido"
 * Hoje: "hoje"
 * Próximo: "em 2d", "em 1 sem", "em 3 sem"
 */
export function labelVencimento(dias: number): { texto: string; nivel: 'atrasado' | 'urgente' | 'proximo' | 'normal' } {
  if (dias < 0) return { texto: dias === -1 ? 'vencido ontem' : `vencido há ${-dias}d`, nivel: 'atrasado' };
  if (dias === 0) return { texto: 'vence hoje', nivel: 'urgente' };
  if (dias === 1) return { texto: 'amanhã', nivel: 'urgente' };
  if (dias <= 3) return { texto: `em ${dias}d`, nivel: 'urgente' };
  if (dias <= 7) return { texto: `em ${dias}d`, nivel: 'proximo' };
  if (dias <= 14) return { texto: `em ${dias}d`, nivel: 'normal' };
  return { texto: `em ${dias}d`, nivel: 'normal' };
}
