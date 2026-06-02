/**
 * SINGLE SOURCE OF TRUTH pra "o que uma transação representa".
 *
 * ANTES: cada página filtrava à mão (`t.pago !== false`, `t.ignorar_dashboard
 * === false`, `t.categoria !== 'Saldo Inicial'`). Quando mudava uma regra
 * (tipo: agora tem coluna `pago`), tinha que lembrar de mexer em 5+ lugares
 * — sempre esquecia um, virava bug.
 *
 * AGORA: TODA filtragem passa por aqui. Mexer numa regra = mexer num arquivo.
 *
 * Use sempre que precisar decidir "essa transação conta pra X?".
 */

// Shape mínimo que as funções precisam — qualquer Tx do banco serve.
export interface TransacaoLike {
  pago?: boolean | null;
  ignorar_dashboard?: boolean | null;
  categoria?: string | null;
  tipo?: string | null;
  valor?: number | string | null;
  data?: string | null;
}

/**
 * Transação foi efetivamente paga/recebida?
 *
 * Pendente = `pago === false`. Qualquer outro valor (true, null, undefined)
 * conta como realizada. Esse default protege quando a coluna `pago` ainda
 * não existe no banco (migration pendente) — sem ele, app quebra silencioso.
 */
export function eRealizada(t: TransacaoLike): boolean {
  return t.pago !== false;
}

/**
 * Transação aparece no Dashboard como receita/despesa do mês?
 *
 * Critério: NÃO é interna (transferência entre contas, pagamento de fatura
 * que abate o cartão) E é realizada (pendente vira pill separada). "Saldo
 * Inicial" também não aparece como receita.
 */
export function apareceNoDashboard(t: TransacaoLike): boolean {
  if (t.ignorar_dashboard === true) return false;
  if (t.categoria === 'Saldo Inicial') return false;
  return eRealizada(t);
}

/**
 * Transação afeta saldo bancário da conta?
 *
 * Critério: realizada E não é a linha "Saldo Inicial" (essa é representada
 * pelo campo `contas.saldo_inicial`, não por transação). Transferência
 * interna AFETA saldo (sai de uma conta, entra em outra) — então
 * `ignorar_dashboard` NÃO entra aqui. Pagamento de fatura também: sai do
 * débito, abate o crédito.
 */
export function contaNoSaldo(t: TransacaoLike): boolean {
  if (t.categoria === 'Saldo Inicial') return false;
  return eRealizada(t);
}

/**
 * Transação está PENDENTE (não paga ainda)?
 * Inversa exata de eRealizada — atalho semântico pra ficar legível.
 */
export function ePendente(t: TransacaoLike): boolean {
  return t.pago === false;
}

/**
 * Soma valores aplicando sinal pelo tipo (receita +, despesa -).
 * Helper usado em vários cálculos de saldo.
 */
export function somaComSinal(transacoes: TransacaoLike[]): number {
  let total = 0;
  for (const t of transacoes) {
    const v = Number(t.valor) || 0;
    total += t.tipo === 'receita' ? v : -v;
  }
  return total;
}
