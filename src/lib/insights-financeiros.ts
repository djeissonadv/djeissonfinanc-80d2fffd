import type { TransactionRecord } from './projection-engine';
import { buildGastosMedios } from './analytics-engine';

export interface InsightFin {
  id: string;
  titulo: string;
  descricao: string;
  nivel: 'alerta' | 'dica' | 'bom';
  valor?: number; // valor relevante (economia/gasto)
}

function monthKey(t: TransactionRecord): string {
  return t.mes_competencia || t.data.substring(0, 7);
}

/**
 * Insights financeiros DETERMINÍSTICOS — cruzam boas práticas com os gastos
 * reais do usuário. Nada de IA genérica: cada dica nasce de um padrão medível
 * nos dados (juros pagos, gasto no crédito, sobra negativa, etc.).
 *
 * `cartaoIds` = ids das contas de crédito (pra separar gasto no crédito).
 */
export function gerarInsights(
  txs: TransactionRecord[],
  cartaoIds: string[],
  todayIso: string,
): InsightFin[] {
  const insights: InsightFin[] = [];
  const gm = buildGastosMedios(txs, 6, todayIso);
  const cartoes = new Set(cartaoIds);
  const mesAtual = (todayIso || '').substring(0, 7);

  // Meses completos (exclui o corrente) — base das médias.
  const mesesCompletos = new Set<string>();
  for (const t of txs) {
    if (t.ignorar_dashboard) continue;
    const k = monthKey(t);
    if (k < mesAtual) mesesCompletos.add(k);
  }
  const nMeses = Math.max(1, Math.min(6, mesesCompletos.size));

  // ── 1) Juros e encargos: o vazamento mais fácil de cortar ──────────────
  const jurosMedia = gm.categorias
    .filter(c => c.categoria === 'Operação bancária')
    .reduce((s, c) => s + c.media, 0);
  if (jurosMedia >= 50) {
    insights.push({
      id: 'juros',
      nivel: 'alerta',
      titulo: 'Juros e tarifas são seu maior vazamento',
      descricao: `Você gasta em média ${fmt(jurosMedia)}/mês em juros, multa e tarifas. É o corte mais fácil: pagar a fatura INTEGRAL e em dia zera quase tudo isso. Em 12 meses isso é ${fmt(jurosMedia * 12)}.`,
      valor: jurosMedia,
    });
  }

  // ── 2) Gasto no crédito em categorias do dia a dia (enquanto há juros) ──
  // Só vale a dica do débito quando o usuário ESTÁ pagando juros — senão
  // crédito à vista é neutro/melhor. Aqui é condicional ao comportamento.
  if (jurosMedia >= 30) {
    const essenciais = ['Alimentação', 'Transporte'];
    const porCatCredito: Record<string, number> = {};
    for (const t of txs) {
      if (t.ignorar_dashboard || t.tipo !== 'despesa') continue;
      if (!cartoes.has(t.conta_id)) continue;
      const k = monthKey(t);
      if (k >= mesAtual) continue;
      const cat = t.categoria || 'Outros';
      if (essenciais.includes(cat)) porCatCredito[cat] = (porCatCredito[cat] || 0) + Number(t.valor);
    }
    const maior = Object.entries(porCatCredito).sort((a, b) => b[1] - a[1])[0];
    if (maior && maior[1] / nMeses >= 150) {
      const catNome = maior[0].toLowerCase();
      insights.push({
        id: 'credito-essencial',
        nivel: 'dica',
        titulo: `Passe ${catNome} no débito enquanto quita o rotativo`,
        descricao: `Você passa ~${fmt(maior[1] / nMeses)}/mês de ${catNome} no cartão. Como ainda está pagando juros, usar débito à vista nessas compras evita engordar a fatura e rolar mais dívida.`,
        valor: Math.round((maior[1] / nMeses) * 100) / 100,
      });
    }
  }

  // ── 3) Sobra média (ganha vs gasta) ────────────────────────────────────
  const porMes: Record<string, { receita: number; despesa: number }> = {};
  for (const t of txs) {
    if (t.ignorar_dashboard) continue;
    const k = monthKey(t);
    if (k >= mesAtual) continue;
    if (!porMes[k]) porMes[k] = { receita: 0, despesa: 0 };
    if (t.tipo === 'receita') porMes[k].receita += Number(t.valor);
    else if (t.tipo === 'despesa') porMes[k].despesa += Number(t.valor);
  }
  const mesesArr = Object.values(porMes);
  if (mesesArr.length >= 2) {
    const sobraMedia = mesesArr.reduce((s, m) => s + (m.receita - m.despesa), 0) / mesesArr.length;
    if (sobraMedia < 0) {
      insights.push({
        id: 'sobra-negativa',
        nivel: 'alerta',
        titulo: 'Você está gastando mais do que ganha',
        descricao: `Na média dos últimos meses, suas despesas passaram a renda em ${fmt(Math.abs(sobraMedia))}/mês. É isso que alimenta a dívida do cartão. O caminho é cortar onde dá (veja o raio-X) até a sobra ficar positiva.`,
        valor: Math.round(sobraMedia * 100) / 100,
      });
    } else if (sobraMedia > 0) {
      insights.push({
        id: 'sobra-positiva',
        nivel: 'bom',
        titulo: 'Você fecha o mês no positivo',
        descricao: `Na média, sobra ${fmt(sobraMedia)}/mês. Direcionar essa sobra pra quitar o cartão (que cobra ~18% a.m.) rende mais que qualquer investimento conservador.`,
        valor: Math.round(sobraMedia * 100) / 100,
      });
    }
  }

  // ── 4) Assinaturas ─────────────────────────────────────────────────────
  const assin = gm.categorias.find(c => c.categoria === 'Assinatura');
  if (assin && assin.media >= 50) {
    insights.push({
      id: 'assinaturas',
      nivel: 'dica',
      titulo: 'Revise as assinaturas',
      descricao: `Você tem ~${fmt(assin.media)}/mês em assinaturas (${fmt(assin.media * 12)}/ano). Vale conferir quais você realmente usa — costuma ter 1 ou 2 esquecidas.`,
      valor: assin.media,
    });
  }

  // ── 5) Concentração: 1 categoria domina o orçamento ────────────────────
  const top = gm.categorias[0];
  if (top && gm.mediaMensal > 0 && top.pctDaMedia >= 40 && top.categoria !== 'Operação bancária') {
    insights.push({
      id: 'concentracao',
      nivel: 'dica',
      titulo: `${top.categoria} concentra ${top.pctDaMedia.toFixed(0)}% dos seus gastos`,
      descricao: `Sozinha, ${top.categoria.toLowerCase()} leva ${fmt(top.media)}/mês. É o lugar onde um corte de 10% já faz a maior diferença na sobra.`,
      valor: top.media,
    });
  }

  // Ordena: alertas primeiro, depois dicas, depois "bom".
  const ordem = { alerta: 0, dica: 1, bom: 2 } as const;
  return insights.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
}

function fmt(v: number): string {
  return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
}
