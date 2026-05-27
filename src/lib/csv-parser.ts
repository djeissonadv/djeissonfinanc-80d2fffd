export interface ParsedTransaction {
  data: string;
  descricao: string;
  descricao_normalizada: string;
  valor: number;
  tipo: 'receita' | 'despesa';
  parcela_atual: number | null;
  parcela_total: number | null;
  pessoa: string;
  hash_transacao: string;
  codigo_cartao: string | null;
  valor_dolar: number | null;
  source_line_number?: number;
  source_line_content?: string;
}

export interface SkippedLine {
  lineNumber: number;
  content: string;
  reason: string;
}

export interface CsvLineLogEntry {
  lineNumber: number;
  content: string;
  status: 'importada' | 'rejeitada' | 'duplicata' | 'ignorada';
  reason?: string;
  hash_transacao?: string;
}

export type TransactionClassification =
  | 'simple'           // Tipo 3: sem parcela
  | 'new_installment'  // Tipo 1: parcela 01/X
  | 'ongoing_installment' // Tipo 2: parcela N/X (N>1)
  | 'payment'          // Tipo 4: pagamento de fatura (pag fat)
  | 'refund';          // Tipo 5: devolução/estorno (valor negativo que não é pagamento)

export interface ClassifiedTransaction extends ParsedTransaction {
  classification: TransactionClassification;
}

interface ParseResult {
  contaDetectada: string | null;
  transactions: ClassifiedTransaction[];
  skippedLines: SkippedLine[];
  totalLines: number;
  lineLogs: CsvLineLogEntry[];
  /** Auto-detected due date from CSV header (e.g. "Data de Vencimento ;15/03/2026") */
  detectedDueDate: { month: number; year: number; day?: number } | null;
  /** "Total desta fatura" do cabeçalho — fonte da verdade do "A pagar" do cartão. */
  headerTotal?: number;
}

/**
 * Shared detection helpers — keep logic consistent across parsers, hooks and pages.
 * Always check isDevolution BEFORE isFaturaPayment; a string like "Estorno pag fat"
 * should classify as devolution, not payment.
 */
export function isDevolution(desc: string): boolean {
  const d = desc.toLowerCase();
  return d.includes('devoluc') || d.includes('devolução') || d.includes('estorno');
}

/**
 * "Crédito por parcelamento da fatura" é um abatimento interno do parcelamento
 * (não é caixa). Diferenciamos de um pagamento real pra não tratá-lo como tal.
 */
export function isCreditoParcelamento(desc: string): boolean {
  const d = desc.toLowerCase();
  return d.includes('crédito por parcelamento') || d.includes('credito por parcelamento');
}

/**
 * "Saldo anterior da fatura" é o artefato de reconciliação que o parser do PDF
 * injeta quando o total do cabeçalho > soma das linhas (rollover do mês anterior
 * não pago). NÃO é uma despesa nova — é a repetição do saldo de meses anteriores.
 * Quando o histórico está importado, esse valor JÁ está itemizado nos meses
 * anteriores, então contá-lo de novo é dupla contagem. Logo: nunca somar como
 * despesa do mês nem na fatura acumulada (que já faz o rollover por conta própria).
 */
export function isSaldoAnteriorFatura(desc: string): boolean {
  return /saldo anterior da fatura/i.test(desc);
}

/**
 * Marcador do "Total a pagar" informado pelo próprio extrato do cartão (ex:
 * Mercado Pago, que é rotativo e consolida o saldo — a acumulação por mês conta
 * em dobro). Guardamos esse total como uma transação-marcador IGNORADA no cartão;
 * o cálculo da fatura usa o valor pra SOBRESCREVER o "A pagar" do período.
 */
export const FATURA_TOTAL_MARKER = 'Total da fatura (informado pelo extrato)';
export function isFaturaTotalMarker(desc: string): boolean {
  return /total da fatura \(informado/i.test(desc);
}

/**
 * Pagamento de fatura feito EXPLICITAMENTE pelo usuário — via "Pagar fatura"
 * (PaymentModal) ou pela Conciliação. Sempre tem o sufixo " - <conta/cartão>"
 * ("Pag Fat Deb Cc - Black"). Diferente das linhas INTERNAS do extrato
 * ("Pag Fat Deb Cc" do CSV Sicredi, "Pagamento da fatura de X" do MP), que pagam
 * a fatura ANTERIOR e caem na competência errada. Quando a fatura tem o "Total
 * informado" (marcador), só os pagamentos de conciliação abatem — o marcador já
 * reflete o líquido do extrato.
 */
export function isConciliacaoPayment(desc: string): boolean {
  return /pag\s*fat\s*deb\s*cc\s*-\s*\S/i.test(desc);
}

export function isFaturaPayment(desc: string): boolean {
  if (isDevolution(desc)) return false;
  if (isFaturaTotalMarker(desc)) return false;
  const d = desc.toLowerCase();
  return (
    d.includes('pag fat') ||
    d.includes('pagto fatura') ||
    /pagamento\s+(d[ae]\s+)?fatura/.test(d) ||
    d.includes('crédito por parcelamento') ||
    d.includes('credito por parcelamento') ||
    d.includes('pagamento recebido')
  );
}

/**
 * Normalizes a description for deduplication:
 * - Remove multiple spaces
 * - Uppercase
 * - Remove city/state suffixes (e.g. "PASSO FUNDO   BRA")
 * - Remove special characters except letters and numbers
 * - Truncate at 40 characters
 */
export function normalizeDescription(desc: string): string {
  let normalized = desc
    .toUpperCase()
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Remove trailing city/state patterns like "PASSO FUNDO BR", "SAO PAULO BRA"
  normalized = normalized.replace(/\s+[A-Z]{2,3}\s*$/, '');
  // Remove trailing location patterns like "PASSO FUNDO" after main description
  normalized = normalized.replace(/\s{2,}[A-Z\s]+$/, '');

  // Keep only letters, numbers, spaces
  normalized = normalized.replace(/[^A-Z0-9 ]/g, '');

  // Collapse spaces again after removal
  normalized = normalized.replace(/\s{2,}/g, ' ').trim();

  // Truncate at 40 chars
  return normalized.substring(0, 40);
}

// Limite razoável de parcelas num cartão — evita interpretar datas (ex: "12/2025")
// como parcela "12 de 2025".
const MAX_PARCELAS = 99;

function validParcela(atual: number, total: number): { atual: number; total: number } | null {
  if (!Number.isFinite(atual) || !Number.isFinite(total)) return null;
  if (total < 2 || total > MAX_PARCELAS) return null; // 1/1 não é parcelamento
  if (atual < 1 || atual > total) return null;
  return { atual, total };
}

/**
 * Extrai parcela de um CAMPO dedicado (ex: coluna "Parcela" do Sicredi).
 * Aceita com ou sem parênteses e com espaços: "(01/12)", "01/12", "1 / 12".
 */
export function parseParcelaField(field: string | null | undefined): { atual: number; total: number } | null {
  if (!field) return null;
  const m = field.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
  if (!m) return null;
  return validParcela(parseInt(m[1], 10), parseInt(m[2], 10));
}

/**
 * Extrai parcela de uma DESCRIÇÃO livre. Exige contexto (parênteses ou a palavra
 * "parcela/parc/de") para não confundir com datas (ex: "03/2025" não é parcela).
 */
export function parseParcelaFromDesc(desc: string): { atual: number; total: number } | null {
  if (!desc) return null;
  let m = desc.match(/\((\d{1,3})\s*\/\s*(\d{1,3})\)/); // (03/10)
  if (!m) m = desc.match(/parc(?:ela)?\.?\s*(\d{1,3})\s*\/\s*(\d{1,3})/i); // Parcela 03/10
  if (!m) m = desc.match(/\b(\d{1,3})\s*de\s*(\d{1,3})\b/i); // 3 de 10
  if (!m) return null;
  return validParcela(parseInt(m[1], 10), parseInt(m[2], 10));
}

export function generateHash(
  data: string,
  descricao: string,
  valor: number,
  pessoa: string,
  parcela_atual?: number | null,
  parcela_total?: number | null
): string {
  let str = `${data}|${descricao}|${valor}|${pessoa}`;
  // Include parcela info when available to avoid collisions between different
  // installment months of the same purchase (e.g., parcela 1/6 vs 2/6)
  if (parcela_atual != null && parcela_total != null) {
    str += `|${parcela_atual}/${parcela_total}`;
  }
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function parseDate(dateStr: string): string {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return dateStr;
}

export function parseValue(valorStr: string): number | null {
  // Handle quoted values like "R$ 22,90" or "R$ -7.038,96"
  let clean = valorStr
    .replace(/"/g, '')
    .replace('R$', '')
    .replace(/\s/g, '')
    .trim();

  // Brazilian number format: 7.038,96 → 7038.96
  // If has both . and , → dots are thousands, comma is decimal
  if (clean.includes('.') && clean.includes(',')) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (clean.includes(',')) {
    clean = clean.replace(',', '.');
  } else if (clean.includes('.')) {
    // Ponto sozinho é AMBÍGUO: "12.34" (decimal US) vs "1.500" (milhar BR).
    // Em valores monetários o decimal sempre tem 2 casas; um ponto seguido de
    // exatamente 3 dígitos (e que não seja a única parte) é separador de milhar.
    // Vários pontos (1.234.567) também são milhar. Assim "1.500" → 1500 (e não 1.5),
    // enquanto "12.34" e "150.00" continuam decimais.
    const semSinal = clean.replace(/^-/, '');
    const partes = semSinal.split('.');
    const ultima = partes[partes.length - 1];
    const ehMilhar = partes.length > 2 || (partes.length === 2 && ultima.length === 3 && partes[0].length >= 1);
    if (ehMilhar) {
      clean = clean.replace(/\./g, '');
    }
  }

  const val = parseFloat(clean);
  return isNaN(val) ? null : val;
}

function classifyTransaction(parcela_atual: number | null, parcela_total: number | null, valor: number, descricao: string): TransactionClassification {
  if (valor < 0) {
    // "Pag Fat" / "Pagamento da fatura" / "Crédito por parcelamento" / "Pagamento recebido" (Nubank) = acerto de fatura → excluir
    if (isFaturaPayment(descricao)) return 'payment';
    // Devoluções, estornos e outros créditos → importar como receita
    return 'refund';
  }

  // Tipo 1: New installment (01/X where X > 1)
  if (parcela_atual === 1 && parcela_total !== null && parcela_total > 1) return 'new_installment';

  // Tipo 2: Ongoing installment (N/X where N > 1)
  if (parcela_atual !== null && parcela_atual > 1 && parcela_total !== null) return 'ongoing_installment';

  // Tipo 3: Simple transaction
  return 'simple';
}

export function parseSicrediCSV(csvText: string, defaultPessoa: string = 'Titular'): ParseResult {
  const normalizedText = csvText.replace(/^\uFEFF/, '');
  const lines = normalizedText.split(/\r?\n/);

  let contaDetectada: string | null = null;
  let detectedDueDate: { month: number; year: number; day?: number } | null = null;
  const headerLines = lines.slice(0, 10).join(' ');

  if (headerLines.includes('Mastercard Black') || headerLines.includes('Black')) {
    contaDetectada = 'Black';
  } else if (headerLines.includes('Mercado Pago')) {
    contaDetectada = 'Mercado Pago';
  } else if (headerLines.includes('Conta Corrente')) {
    contaDetectada = 'Sicredi Principal';
  }

  // Try to detect due date and fatura total from header
  let headerFaturaTotal: number | null = null;
  for (const line of lines.slice(0, 20)) {
    const dueDateMatch = line.match(/[Vv]encimento\s*;?\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (dueDateMatch) {
      detectedDueDate = {
        month: parseInt(dueDateMatch[2]) - 1, // 0-indexed
        year: parseInt(dueDateMatch[3]),
        day: parseInt(dueDateMatch[1]),
      };
    }
    // Detect total fatura from header: " (=) Total desta fatura (R$) ;"R$ 6.442,76""
    const totalMatch = line.match(/[Tt]otal\s+desta\s+fatura.*?"?R\$\s*([\d.,\-]+)"?/);
    if (totalMatch) {
      const val = parseValue(totalMatch[1]);
      if (val !== null && val > 0) {
        headerFaturaTotal = val;
      }
    }
  }

  const headerIndex = lines.findIndex((l) =>
    l.toLowerCase().includes('data') && l.toLowerCase().includes('descri')
  );

  const skippedLines: SkippedLine[] = [];
  const transactions: ClassifiedTransaction[] = [];
  const lineLogs: CsvLineLogEntry[] = [];
  const hashCounts = new Map<string, number>();

  if (headerIndex === -1) {
    return {
      contaDetectada,
      detectedDueDate,
      transactions: [],
      skippedLines: [{ lineNumber: 0, content: '', reason: 'Cabeçalho não encontrado no arquivo' }],
      totalLines: lines.length,
      lineLogs: [{ lineNumber: 0, content: '', status: 'rejeitada', reason: 'Cabeçalho não encontrado no arquivo' }],
    };
  }

  lines.forEach((line, idx) => {
    const lineNumber = idx + 1;
    const content = line.replace(/\r$/, '');
    const trimmed = content.trim();

    if (!trimmed) {
      lineLogs.push({ lineNumber, content, status: 'ignorada', reason: 'Linha vazia' });
      return;
    }

    if (idx < headerIndex) {
      lineLogs.push({ lineNumber, content, status: 'ignorada', reason: 'Metadados do arquivo' });
      return;
    }

    if (idx === headerIndex) {
      lineLogs.push({ lineNumber, content, status: 'ignorada', reason: 'Cabeçalho do CSV' });
      return;
    }

    if (trimmed.toLowerCase().includes('total')) {
      lineLogs.push({ lineNumber, content, status: 'ignorada', reason: 'Linha de total (ignorada)' });
      return;
    }

    // CSV columns: Data ; Descrição ; Parcela ; Valor ; Valor em Dólar ; Adicional ; Nome
    const parts = trimmed.split(';').map((p) => p.trim());
    if (parts.length < 3) {
      const reason = `Poucos campos (${parts.length} encontrados, mínimo 3)`;
      skippedLines.push({ lineNumber, content: trimmed, reason });
      lineLogs.push({ lineNumber, content, status: 'rejeitada', reason });
      return;
    }

    const [data, descricao] = parts;
    let valorStr = '';
    let parcela = '';

    if (parts.length >= 4) {
      parcela = parts[2];
      valorStr = parts[3];
    } else {
      valorStr = parts[2];
    }

    // Extract additional fields
    const valorDolarStr = parts.length >= 5 ? parts[4] : '';
    const codigoCartao = parts.length >= 6 ? (parts[5] || null) : null;
    const pessoa = parts.length >= 7 ? (parts[6] || defaultPessoa) : defaultPessoa;

    if (!data || !descricao) {
      const reason = 'Data ou descrição vazia';
      skippedLines.push({ lineNumber, content: trimmed, reason });
      lineLogs.push({ lineNumber, content, status: 'rejeitada', reason });
      return;
    }

    // Parse value
    let valor = parseValue(valorStr);
    if (valor === null) {
      // Try other columns
      for (let pi = 2; pi < parts.length; pi++) {
        const parsed = parseValue(parts[pi]);
        if (parsed !== null && parsed !== 0) {
          valor = parsed;
          break;
        }
      }
    }

    if (valor === null) {
      const reason = 'Valor não encontrado ou inválido';
      skippedLines.push({ lineNumber, content: trimmed, reason });
      lineLogs.push({ lineNumber, content, status: 'rejeitada', reason });
      return;
    }

    // Parcela: tenta a coluna dedicada (com/sem parênteses) e cai pra descrição.
    const parcelaInfo = parseParcelaField(parcela) || parseParcelaFromDesc(descricao);
    const parcela_atual = parcelaInfo?.atual ?? null;
    const parcela_total = parcelaInfo?.total ?? null;

    const rawValor = valor;
    const tipo = valor < 0 ? 'receita' as const : 'despesa' as const;
    const absValor = Math.abs(valor);
    const isoDate = parseDate(data);
    const finalPessoa = pessoa || defaultPessoa;

    // Parse valor em dólar
    let valorDolar: number | null = null;
    if (valorDolarStr) {
      valorDolar = parseValue(valorDolarStr);
    }

    const baseHash = generateHash(isoDate, descricao, absValor, finalPessoa, parcela_atual, parcela_total);
    const count = hashCounts.get(baseHash) || 0;
    hashCounts.set(baseHash, count + 1);
    const hash_transacao = count > 0 ? `${baseHash}_seq${count}` : baseHash;

    const classification = classifyTransaction(parcela_atual, parcela_total, rawValor, descricao);

    transactions.push({
      data: isoDate,
      descricao,
      descricao_normalizada: normalizeDescription(descricao),
      valor: absValor,
      tipo,
      parcela_atual,
      parcela_total,
      pessoa: finalPessoa,
      hash_transacao,
      codigo_cartao: codigoCartao || null,
      valor_dolar: valorDolar,
      classification,
      source_line_number: lineNumber,
      source_line_content: content,
    });

    lineLogs.push({
      lineNumber,
      content,
      status: 'importada',
      reason: 'Linha convertida em transação',
      hash_transacao,
    });
  });

  // If the CSV header declares a fatura total, compare against sum of parsed lines.
  // If there's a positive difference (e.g., encargos/fees not listed as individual lines),
  // inject a synthetic "Encargos da Fatura" transaction to reconcile.
  if (headerFaturaTotal !== null && headerFaturaTotal > 0 && detectedDueDate) {
    const sumDespesas = transactions.filter(t => t.tipo === 'despesa').reduce((s, t) => s + t.valor, 0);
    // Exclude fatura payments (they settle the previous balance, not the current invoice)
    // but KEEP credits like "Crédito por parcelamento" since those reduce the current invoice.
    const sumReceitas = transactions
      .filter(t => t.tipo === 'receita' && !/pag\s*fat|pagamento\s+(d[ae]\s+)?fatura|pagamento recebido/i.test(t.descricao))
      .reduce((s, t) => s + t.valor, 0);
    const linesFatura = sumDespesas - sumReceitas;
    const missing = headerFaturaTotal - linesFatura;

    if (missing > 0.01) {
      const dueDate = `${detectedDueDate.year}-${String(detectedDueDate.month + 1).padStart(2, '0')}-01`;
      const desc = 'Encargos da Fatura';
      const hash = generateHash(dueDate, desc, parseFloat(missing.toFixed(2)), defaultPessoa);

      transactions.push({
        data: dueDate,
        descricao: desc,
        descricao_normalizada: normalizeDescription(desc),
        valor: parseFloat(missing.toFixed(2)),
        tipo: 'despesa',
        parcela_atual: null,
        parcela_total: null,
        pessoa: defaultPessoa,
        hash_transacao: hash,
        codigo_cartao: null,
        valor_dolar: null,
        classification: 'simple',
      });

      lineLogs.push({
        lineNumber: 0,
        content: `Diferença cabeçalho vs linhas: R$ ${missing.toFixed(2)} (fatura header: R$ ${headerFaturaTotal.toFixed(2)}, soma linhas: R$ ${linesFatura.toFixed(2)})`,
        status: 'importada',
        reason: 'Encargos/taxas não listados como transações individuais no CSV',
        hash_transacao: hash,
      });
    }
  }

  return {
    contaDetectada,
    detectedDueDate,
    headerTotal: headerFaturaTotal ?? undefined,
    transactions,
    skippedLines,
    totalLines: lines.length,
    lineLogs,
  };
}

/**
 * Parses Nubank credit card CSV exports.
 * Format: `date,title,amount` header followed by rows like:
 *   2026-04-04,Pg *Braip Intermediaca - Parcela 12/12,15.12
 *   2026-04-14,Pagamento recebido,-334.31
 *
 * - Date is already ISO YYYY-MM-DD
 * - Amount is decimal with `.` separator
 * - Positive = despesa, negative = pagamento/estorno
 * - Parcelas come at the end of `title` as " - Parcela N/X"
 */
export function parseNubankCSV(csvText: string, defaultPessoa: string = 'Titular'): ParseResult {
  const normalizedText = csvText.replace(/^\uFEFF/, '');
  const lines = normalizedText.split(/\r?\n/);

  const skippedLines: SkippedLine[] = [];
  const transactions: ClassifiedTransaction[] = [];
  const lineLogs: CsvLineLogEntry[] = [];
  const hashCounts = new Map<string, number>();

  // Find header line
  const headerIndex = lines.findIndex(l =>
    /^\s*date\s*,\s*title\s*,\s*amount\s*$/i.test(l)
  );

  if (headerIndex === -1) {
    return {
      contaDetectada: null,
      detectedDueDate: null,
      transactions: [],
      skippedLines: [{ lineNumber: 0, content: '', reason: 'Cabeçalho Nubank não encontrado (esperado: date,title,amount)' }],
      totalLines: lines.length,
      lineLogs: [{ lineNumber: 0, content: '', status: 'rejeitada', reason: 'Cabeçalho Nubank não encontrado' }],
    };
  }

  const contaDetectada = 'Nubank';
  // Track latest transaction date to derive a default due-month
  let latestTxDate: string | null = null;

  lines.forEach((line, idx) => {
    const lineNumber = idx + 1;
    const content = line.replace(/\r$/, '');
    const trimmed = content.trim();

    if (!trimmed) {
      lineLogs.push({ lineNumber, content, status: 'ignorada', reason: 'Linha vazia' });
      return;
    }

    if (idx <= headerIndex) {
      lineLogs.push({ lineNumber, content, status: 'ignorada', reason: idx === headerIndex ? 'Cabeçalho do CSV' : 'Metadados do arquivo' });
      return;
    }

    // Split on first/last comma so descriptions with commas stay intact.
    const firstComma = trimmed.indexOf(',');
    const lastComma = trimmed.lastIndexOf(',');
    if (firstComma === -1 || lastComma === firstComma) {
      const reason = `Formato Nubank inválido (esperado date,title,amount)`;
      skippedLines.push({ lineNumber, content: trimmed, reason });
      lineLogs.push({ lineNumber, content, status: 'rejeitada', reason });
      return;
    }

    const dateStr = trimmed.substring(0, firstComma).trim();
    const descricao = trimmed.substring(firstComma + 1, lastComma).trim();
    const valorStr = trimmed.substring(lastComma + 1).trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const reason = `Data inválida: ${dateStr}`;
      skippedLines.push({ lineNumber, content: trimmed, reason });
      lineLogs.push({ lineNumber, content, status: 'rejeitada', reason });
      return;
    }

    if (!descricao) {
      const reason = 'Descrição vazia';
      skippedLines.push({ lineNumber, content: trimmed, reason });
      lineLogs.push({ lineNumber, content, status: 'rejeitada', reason });
      return;
    }

    const valor = parseFloat(valorStr);
    if (isNaN(valor) || valor === 0) {
      const reason = `Valor inválido: ${valorStr}`;
      skippedLines.push({ lineNumber, content: trimmed, reason });
      lineLogs.push({ lineNumber, content, status: 'rejeitada', reason });
      return;
    }

    // Parcela: "... - Parcela N/X" e variações, via detector robusto.
    const parcelaInfo = parseParcelaFromDesc(descricao);
    const parcela_atual = parcelaInfo?.atual ?? null;
    const parcela_total = parcelaInfo?.total ?? null;

    // Sign convention: positive = despesa, negative = receita (payment/refund)
    const tipo: 'receita' | 'despesa' = valor < 0 ? 'receita' : 'despesa';
    const absValor = Math.abs(valor);
    const rawValor = valor; // for classifyTransaction (negative => payment/refund branch)

    if (!latestTxDate || dateStr > latestTxDate) {
      latestTxDate = dateStr;
    }

    const baseHash = generateHash(dateStr, descricao, absValor, defaultPessoa, parcela_atual, parcela_total);
    const count = hashCounts.get(baseHash) || 0;
    hashCounts.set(baseHash, count + 1);
    const hash_transacao = count > 0 ? `${baseHash}_seq${count}` : baseHash;

    const classification = classifyTransaction(parcela_atual, parcela_total, rawValor, descricao);

    transactions.push({
      data: dateStr,
      descricao,
      descricao_normalizada: normalizeDescription(descricao),
      valor: absValor,
      tipo,
      parcela_atual,
      parcela_total,
      pessoa: defaultPessoa,
      hash_transacao,
      codigo_cartao: null,
      valor_dolar: null,
      classification,
      source_line_number: lineNumber,
      source_line_content: content,
    });

    lineLogs.push({
      lineNumber,
      content,
      status: 'importada',
      reason: 'Transação Nubank',
      hash_transacao,
    });
  });

  // Derive a default due date from the latest transaction date so the import
  // dialog pre-fills the billing period correctly (Nubank's filename uses the
  // statement-close date, which we don't parse here).
  let detectedDueDate: { month: number; year: number; day?: number } | null = null;
  if (latestTxDate) {
    const [y, m] = latestTxDate.split('-').map(Number);
    detectedDueDate = { month: m - 1, year: y };
  }

  return {
    contaDetectada,
    detectedDueDate,
    transactions,
    skippedLines,
    totalLines: lines.length,
    lineLogs,
  };
}
