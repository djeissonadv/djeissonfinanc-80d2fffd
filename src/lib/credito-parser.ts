/**
 * Parser de "Documento Descritivo de Crédito" (DDC) — contratos de empréstimo/
 * financiamento (Sicredi e Mercado Pago). Extrai o contrato e as parcelas
 * futuras (abertas/programadas) para lançar como compromissos previsíveis.
 *
 * Recebe o texto já extraído do PDF (ver extractPdfText em pdf-parser).
 */

export interface CreditoParcela {
  numero: number;
  vencimento: string; // YYYY-MM-DD
  valor: number;
  futura: boolean;
}

export interface CreditoDescritivo {
  contratoKey: string; // chave usada no hash (agrupa na página de Dívidas)
  instituicao: 'Sicredi' | 'Mercado Pago' | 'Crédito';
  totalParcelas: number;
  parcelaFixa: number;
  saldoDevedor: number | null;
  parcelas: CreditoParcela[];
  futuras: CreditoParcela[];
}

const MESES_PT: Record<string, string> = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
};

// Sicredi usa formato US no demonstrativo: "1,283.71" (vírgula milhar, ponto decimal).
function parseUS(s: string): number {
  return parseFloat(s.replace(/,/g, '')) || 0;
}
// Mercado Pago usa formato BR: "1.283,71".
function parseBR(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function isCreditoDescritivo(text: string): boolean {
  return /documento descritivo de cr[eé]dito/i.test(text);
}

export function parseCreditoDescritivo(text: string): CreditoDescritivo | null {
  if (!isCreditoDescritivo(text)) return null;

  const isMp = /mercado\s*pago|mercado\s*cr[eé]dito/i.test(text);

  if (isMp) return parseMercadoPago(text);
  return parseSicredi(text);
}

// ── Sicredi ───────────────────────────────────────────────────────────────
function parseSicredi(text: string): CreditoDescritivo | null {
  // Contrato: "Código do contrato / OID: C5A9200110 / 64317853"
  const contratoMatch = text.match(/\b([A-Z0-9]{8,})\s*\/\s*\d{6,}\b/);
  const contratoKey = contratoMatch ? contratoMatch[1] : 'SICREDI';

  const totalMatch = text.match(/total de parcelas[^0-9]*(\d+)/i);
  const saldoMatch = text.match(/saldo devedor atualizado[^0-9]*R\$\s*([\d.,]+)/i);

  // Linhas: NNN DD/MM/AAAA principal juros enc corr outros amortizado saldo L|A|E
  const rowRe = /(\d{3})\s+(\d{2})\/(\d{2})\/(\d{4})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([LAE])(?=\s|$)/g;

  const parcelas: CreditoParcela[] = [];
  const pagasAmort: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const numero = parseInt(m[1], 10);
    const vencimento = `${m[4]}-${m[3]}-${m[2]}`; // YYYY-MM-DD (m[2]=dia, m[3]=mês)
    const amortizado = parseUS(m[10]);
    const situacao = m[12];
    const futura = situacao === 'A' || situacao === 'E';
    if (!futura) pagasAmort.push(amortizado);
    parcelas.push({ numero, vencimento, valor: amortizado, futura });
  }
  if (parcelas.length === 0) return null;

  // Parcela fixa (PRICE): mediana do "Amortizado" das parcelas pagas.
  const parcelaFixa = pagasAmort.length ? median(pagasAmort) : median(parcelas.map(p => p.valor));
  const futuras = parcelas
    .filter(p => p.futura)
    .map(p => ({ ...p, valor: parcelaFixa }));

  return {
    contratoKey,
    instituicao: 'Sicredi',
    totalParcelas: totalMatch ? parseInt(totalMatch[1], 10) : parcelas.length,
    parcelaFixa,
    // No Sicredi o cabeçalho usa formato BR (R$ 31.097,69), diferente da tabela (US).
    saldoDevedor: saldoMatch ? parseBR(saldoMatch[1]) : null,
    parcelas,
    futuras,
  };
}

// ── Mercado Pago ──────────────────────────────────────────────────────────
function parseMercadoPago(text: string): CreditoDescritivo | null {
  // Contrato: "Contrato #1240412639" → chave MP1240412639 (alinha com a página de Dívidas)
  const contratoMatch = text.match(/contrato\s*#?\s*(\d{6,})/i);
  const contratoKey = contratoMatch ? `MP${contratoMatch[1]}` : 'MP';

  const totalMatch = text.match(/total de parcelas[^0-9]*(\d+)/i);
  const fixaMatch = text.match(/valor de cada parcela[^R]*R\$\s*([\d.,]+)/i);
  const saldoMatch = text.match(/saldo devedor atualizado[^R]*R\$\s*([\d.,]+)/i);

  // Linhas: N D/mmm/AAAA (data_pgto|-) [R$] valor ...  (futura quando data
  // de pagamento = "-").
  //
  // 2 fontes de variação observadas em DDCs MP reais:
  //   1. "R$" é OPCIONAL — versões recentes mostram só o número ("563.41"
  //      em vez de "R$ 563,41").
  //   2. pdfjs extrai dia/mês como itens SEPARADOS e nosso join com space
  //      injeta espaço dentro da data: "5/ jan/ 2026" em vez de "5/jan/2026".
  //      O regex tolera \s* em torno das barras.
  // Pra não casar dia/mês como valor, exigimos pelo menos separador decimal.
  const rowRe = /(\d{1,2})\s+(\d{1,2})\/\s*([a-z]{3})\/\s*(\d{4})\s+(-|\d{1,2}\/\s*[a-z]{3}\/\s*\d{4})\s+(?:R\$\s*)?(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/gi;

  const parcelas: CreditoParcela[] = [];
  const valores: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const numero = parseInt(m[1], 10);
    const mes = MESES_PT[m[3].toLowerCase()];
    if (!mes) continue;
    const vencimento = `${m[4]}-${mes}-${m[2].padStart(2, '0')}`;
    const valor = parseBR(m[6]);
    const futura = m[5] === '-'; // sem data de pagamento = programada
    valores.push(valor);
    parcelas.push({ numero, vencimento, valor, futura });
  }
  if (parcelas.length === 0) return null;

  const parcelaFixa = fixaMatch ? parseBR(fixaMatch[1]) : median(valores);
  const futuras = parcelas
    .filter(p => p.futura)
    .map(p => ({ ...p, valor: parcelaFixa }));

  return {
    contratoKey,
    instituicao: 'Mercado Pago',
    totalParcelas: totalMatch ? parseInt(totalMatch[1], 10) : parcelas.length,
    parcelaFixa,
    saldoDevedor: saldoMatch ? parseBR(saldoMatch[1]) : null,
    parcelas,
    futuras,
  };
}

// ── Sicredi CSV (cronograma de parcelas do empréstimo) ─────────────────────
// Header: "Número do título";"Parcela";"Situação";"Valor a Liquidar (R$)";"Data Vencimento";"Data Pagamento"
export function isSicrediLoanCsv(text: string): boolean {
  const head = (text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] || '').toLowerCase();
  return (
    (head.includes('número do título') || head.includes('numero do titulo')) &&
    head.includes('parcela') &&
    head.includes('vencimento')
  );
}

export function parseSicrediLoanCsv(text: string): CreditoDescritivo | null {
  if (!isSicrediLoanCsv(text)) return null;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const splitCols = (l: string) => l.split(';').map(c => c.replace(/^"|"$/g, '').trim());

  const parcelas: CreditoParcela[] = [];
  const valores: number[] = [];
  let contratoKey = 'SICREDI';

  for (const l of lines.slice(1)) { // pula o cabeçalho
    const cols = splitCols(l);
    if (cols.length < 5) continue;
    const [titulo, parcelaStr, situacao, valorStr, vencStr] = cols;
    const numero = parseInt(parcelaStr, 10);
    if (!numero) continue;
    const dm = vencStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!dm) continue;
    if (titulo) contratoKey = titulo;
    const valor = parseBR(valorStr);
    const vencimento = `${dm[3]}-${dm[2]}-${dm[1]}`;
    // Liquidado/pago/quitado = paga; o resto (NORMAL, em atraso) = futura/aberta.
    const futura = !/liquidad|pago|quitad/i.test(situacao);
    valores.push(valor);
    parcelas.push({ numero, vencimento, valor, futura });
  }
  if (parcelas.length === 0) return null;

  const parcelaFixa = median(valores);
  const futuras = parcelas.filter(p => p.futura).map(p => ({ ...p, valor: parcelaFixa }));
  return {
    contratoKey,
    instituicao: 'Sicredi',
    totalParcelas: parcelas.reduce((mx, p) => Math.max(mx, p.numero), parcelas.length),
    parcelaFixa,
    saldoDevedor: futuras.reduce((s, p) => s + p.valor, 0),
    parcelas,
    futuras,
  };
}

// ── Construção das transações de empréstimo (parcelas futuras) ──────────────
export interface EmprestimoRow {
  user_id: string;
  conta_id: string;
  data: string;
  data_original: string;
  mes_competencia: null;
  descricao: string;
  descricao_normalizada: string;
  valor: number;
  categoria: 'Empréstimos';
  tipo: 'despesa';
  essencial: boolean;
  parcela_atual: number;
  parcela_total: number;
  grupo_parcela: null;
  hash_transacao: string;
  pessoa: string;
  ignorar_dashboard: false;
}

/**
 * Gera as transações futuras (parcelas abertas) para lançar. O hash começa com
 * o contratoKey para que a página de Dívidas agrupe por contrato. Só inclui
 * parcelas com vencimento >= hoje (YYYY-MM-DD).
 */
export function buildEmprestimoRows(
  ddc: CreditoDescritivo,
  opts: { userId: string; contaId: string; pessoa: string; hojeIso: string },
): EmprestimoRow[] {
  const baseDesc = `Parcela empréstimo ${ddc.instituicao} ${ddc.contratoKey}`;
  return ddc.futuras
    .filter(p => p.vencimento >= opts.hojeIso)
    .map(p => ({
      user_id: opts.userId,
      conta_id: opts.contaId,
      data: p.vencimento,
      data_original: p.vencimento,
      mes_competencia: null as null,
      descricao: `${baseDesc} (${p.numero}/${ddc.totalParcelas})`,
      descricao_normalizada: baseDesc.toUpperCase().substring(0, 40),
      valor: p.valor,
      categoria: 'Empréstimos' as const,
      tipo: 'despesa' as const,
      essencial: true,
      parcela_atual: p.numero,
      parcela_total: ddc.totalParcelas,
      grupo_parcela: null as null,
      hash_transacao: `${ddc.contratoKey}_p${p.numero}`,
      pessoa: opts.pessoa,
      ignorar_dashboard: false as const,
    }));
}
