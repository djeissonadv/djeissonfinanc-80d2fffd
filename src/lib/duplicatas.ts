/**
 * Detecção de duplicatas em transações.
 *
 * Antes vivia na página Conciliação (que foi removida porque misturava 3
 * coisas distintas). Agora é só essa função pura — usada por um widget
 * que aparece SÓ se tiver duplicata.
 *
 * Critério: duas transações com mesma `descricao_normalizada`, mesmo `valor`
 * (±1 centavo pra tolerar rounding) e mesma `data` (ou ±1 dia). Hash igual
 * também conta — esse é o caso óbvio.
 */

export interface DuplicataGrupo {
  /** id estável pro grupo (hash do primeiro item) */
  groupId: string;
  /** chave: descrição_normalizada + valor */
  chave: string;
  descricao: string;
  valor: number;
  /** ids das transações duplicadas (>= 2) */
  txIds: string[];
}

interface TxLike {
  id: string;
  descricao: string;
  descricao_normalizada?: string | null;
  valor: number | string;
  data: string;
  hash_transacao?: string | null;
  conta_id?: string | null;
}

/**
 * Identifica grupos de transações que parecem duplicatas.
 *
 * Regras:
 *  1. Hash igual = duplicata segura (ignora data, mesma operação).
 *  2. (descricao_normalizada, valor, data ±1d) = duplicata por similaridade.
 *
 * Não tenta resolver — só sinaliza. UI mostra grupo e deixa o user escolher
 * qual apagar (ou ignorar se for legítimo).
 */
export function detectarDuplicatas(txs: TxLike[]): DuplicataGrupo[] {
  // 1) Agrupa por hash (quando existe)
  const byHash = new Map<string, TxLike[]>();
  for (const t of txs) {
    if (!t.hash_transacao) continue;
    const arr = byHash.get(t.hash_transacao) || [];
    arr.push(t);
    byHash.set(t.hash_transacao, arr);
  }

  // 2) Agrupa por chave de similaridade: descNorm + valor centavos + ano-mês
  // (a tolerância ±1d é simplificada pra mesmo mês — refinar depois se virar
  // problema; vale notar que parcelamentos legítimos compartilham desc + valor)
  const bySim = new Map<string, TxLike[]>();
  for (const t of txs) {
    const descNorm = (t.descricao_normalizada || t.descricao || '').trim().toUpperCase().slice(0, 40);
    if (!descNorm) continue;
    const valorCents = Math.round(Math.abs(Number(t.valor)) * 100);
    if (!valorCents) continue;
    const ym = (t.data || '').substring(0, 7);
    const key = `${descNorm}|${valorCents}|${ym}`;
    const arr = bySim.get(key) || [];
    arr.push(t);
    bySim.set(key, arr);
  }

  // 3) Constrói grupos finais — só quando count >= 2 num dos critérios.
  // Dedupe entre hash e sim usando set de ids já vistos.
  const grupos: DuplicataGrupo[] = [];
  const txIdsJaAgrupados = new Set<string>();

  for (const [hash, lista] of byHash.entries()) {
    if (lista.length < 2) continue;
    const ids = lista.map(t => t.id);
    ids.forEach(id => txIdsJaAgrupados.add(id));
    grupos.push({
      groupId: 'h:' + hash,
      chave: hash,
      descricao: lista[0].descricao,
      valor: Number(lista[0].valor),
      txIds: ids,
    });
  }

  for (const [key, lista] of bySim.entries()) {
    if (lista.length < 2) continue;
    // pula se TODAS já entraram via hash
    const idsNovos = lista.filter(t => !txIdsJaAgrupados.has(t.id));
    if (idsNovos.length < 2) continue;
    grupos.push({
      groupId: 's:' + key,
      chave: key,
      descricao: lista[0].descricao,
      valor: Number(lista[0].valor),
      txIds: idsNovos.map(t => t.id),
    });
  }

  return grupos;
}
