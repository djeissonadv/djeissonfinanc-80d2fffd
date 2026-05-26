import { normalizeDescription, generateHash, parseParcelaFromDesc, type ClassifiedTransaction, type SkippedLine, type CsvLineLogEntry } from './csv-parser';

interface PdfParseResult {
  transactions: ClassifiedTransaction[];
  skippedLines: SkippedLine[];
  totalLines: number;
  lineLogs: CsvLineLogEntry[];
  institution: string | null;
  /** Total from PDF header for verification */
  headerTotal?: number;
  /** Due date detected from header */
  detectedDueDate?: { month: number; year: number; day?: number };
  /** Saldo inicial do período (extrato de conta corrente, ex: Nu Conta). */
  openingBalance?: number;
  /** Data do saldo inicial (YYYY-MM-DD). */
  openingDate?: string;
}

// Load PDF.js from CDN
let pdfjs: any = null;

async function loadPdfJs(): Promise<any> {
  if (pdfjs) return pdfjs;

  return new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) {
      pdfjs = (window as any).pdfjsLib;
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(pdfjs);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      pdfjs = (window as any).pdfjsLib;
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(pdfjs);
    };
    script.onerror = () => reject(new Error('Falha ao carregar PDF.js'));
    document.head.appendChild(script);
  });
}

// ── Mercado Pago garbled font decoder ──────────────────────────
const MP_CHAR_MAP: Record<string, string> = {
  '+': '3', '%': '9', 'M': '4', ')': '7', '9': '8', '3': '5', 'J': '.',
  '$': 'R', '4': '$', 'z': 'M', 'í': 'C', 'ó': 'A', 'F': 'I', '5': 'F',
  'N': 'U', 'Y': 'B', 'G': 'Z', 'Z': 'Y', '8': 'J', 'U': '*', 'ê': 'b',
  'ô': 'x', '*': 'õ', 'Q': '"', 'à': 'G', 'b': 'z',
};

function decodeMpText(text: string): string {
  return text.split('').map(ch => MP_CHAR_MAP[ch] ?? ch).join('');
}

/** Normalize fontName — some PDF.js builds return empty/undefined */
function normFontName(fn: any): string {
  return (typeof fn === 'string' && fn.length > 0) ? fn : '__unknown__';
}

function detectGarbledFonts(items: any[]): Set<string> {
  const garbledFonts = new Set<string>();
  for (const item of items) {
    if (item.str && item.str.includes('$4')) {
      garbledFonts.add(normFontName(item.fontName));
    }
  }
  return garbledFonts;
}

// ── Structured extraction ──────────────────────────────────────

interface PdfTextBlock {
  items: Array<{ str: string; fontName: string; x: number; y: number }>;
}

function groupItemsIntoRows(items: any[]): PdfTextBlock[] {
  if (!items.length) return [];

  const sorted = [...items]
    .filter((it: any) => it.str && it.str.trim())
    .map((it: any) => ({
      str: it.str,
      fontName: normFontName(it.fontName),
      x: it.transform?.[4] ?? 0,
      y: it.transform?.[5] ?? 0,
    }));

  sorted.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 3) return dy;
    return a.x - b.x;
  });

  const rows: PdfTextBlock[] = [];
  let currentRow: PdfTextBlock = { items: [] };
  let lastY = sorted[0]?.y ?? 0;

  for (const item of sorted) {
    if (Math.abs(item.y - lastY) > 3) {
      if (currentRow.items.length) rows.push(currentRow);
      currentRow = { items: [] };
      lastY = item.y;
    }
    currentRow.items.push(item);
  }
  if (currentRow.items.length) rows.push(currentRow);

  return rows;
}

function getRowText(row: PdfTextBlock, garbledFonts: Set<string>): string {
  return row.items
    .map(it => garbledFonts.has(it.fontName) ? decodeMpText(it.str) : it.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getRowSegments(row: PdfTextBlock, garbledFonts: Set<string>): string[] {
  return row.items
    .map(it => (garbledFonts.has(it.fontName) ? decodeMpText(it.str) : it.str).trim())
    .filter(s => s.length > 0);
}

// ── Extraction ─────────────────────────────────────────────────

export async function extractPdfText(file: File): Promise<string[]> {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();

  try {
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: string[] = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item: any) => item.str).join(' ');
      pages.push(text);
    }

    return pages;
  } catch (err: any) {
    if (err?.message?.includes('password')) {
      throw new Error('PDF_PASSWORD');
    }
    throw err;
  }
}

export async function extractPdfStructured(file: File): Promise<{
  pages: Array<{ rows: PdfTextBlock[]; garbledFonts: Set<string> }>;
  isMercadoPago: boolean;
  isNubankConta: boolean;
  isNubankCard: boolean;
}> {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let isMercadoPago = false;
  let isNubankConta = false;
  let isNubankCard = false;
  const pages: Array<{ rows: PdfTextBlock[]; garbledFonts: Set<string> }> = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const garbledFonts = detectGarbledFonts(content.items);
    const rows = groupItemsIntoRows(content.items);

    const fullText = content.items.map((it: any) => it.str).join(' ').toLowerCase();
    if (fullText.includes('mercado pago') || fullText.includes('mercadopago') || garbledFonts.size > 0) {
      isMercadoPago = true;
    }
    // Nu Conta (checking account) statements have these footer markers and the
    // characteristic "Total de entradas/saídas" daily grouping.
    if (
      (fullText.includes('nu financeira') || fullText.includes('nu pagamentos')) &&
      (fullText.includes('total de entradas') || fullText.includes('total de saídas') || fullText.includes('total de saidas') || fullText.includes('movimentações'))
    ) {
      isNubankConta = true;
    }
    // Fatura de CARTÃO Nubank: tem o cabeçalho "TRANSAÇÕES DE DD MMM A DD MMM".
    if (
      (fullText.includes('nubank') || fullText.includes('nu pagamentos')) &&
      /transa[çc][õo]es\s+de\s+\d{1,2}\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/i.test(fullText)
    ) {
      isNubankCard = true;
    }

    pages.push({ rows, garbledFonts });
  }

  // Nu Conta (extrato) tem prioridade sobre cartão se ambos baterem (não deve ocorrer).
  if (isNubankConta) isNubankCard = false;

  return { pages, isMercadoPago, isNubankConta, isNubankCard };
}

// ── Value/date parsing ─────────────────────────────────────────

const VALUE_REGEX = /R\$\s*-?\d{1,3}(?:\.\d{3})*,\d{2}/;
const MP_PARCELA_REGEX = /^Parcela\s+(\d+)\s+de\s+(\d+)$/;
const DATE_DD_MM = /^(\d{2})\/(\d{2})$/;
const DATE_DD_MM_YYYY = /(\d{2})\/(\d{2})\/(\d{4})/;

/**
 * Parse date string to ISO format.
 * For DD/MM (no year), uses defaultYear but adjusts to previous year
 * if the resulting date falls AFTER the fatura due date (dueMonth, 0-indexed).
 * This is critical for MP PDFs where only DD/MM is provided.
 */
function parseDate(dateStr: string, defaultYear?: number, dueMonth?: number): string {
  const full = dateStr.match(DATE_DD_MM_YYYY);
  if (full) {
    return `${full[3]}-${full[2].padStart(2, '0')}-${full[1].padStart(2, '0')}`;
  }
  const short = dateStr.match(DATE_DD_MM);
  if (short && defaultYear) {
    const mm = short[2].padStart(2, '0');
    const dd = short[1].padStart(2, '0');
    let year = defaultYear;
    // If we know the fatura due month, check if this date would be in the future
    // relative to the billing period. Credit card transactions can't be after the due date.
    if (dueMonth !== undefined) {
      const txMonth = parseInt(short[2]) - 1; // 0-indexed
      // Last day of the due month = end of billing period
      const dueEndOfMonth = new Date(defaultYear, dueMonth + 1, 0);
      const candidateDate = new Date(defaultYear, txMonth, parseInt(short[1]));
      if (candidateDate > dueEndOfMonth) {
        year = defaultYear - 1;
      }
    }
    return `${year}-${mm}-${dd}`;
  }
  return dateStr;
}

function parseValue(valorStr: string): number | null {
  let clean = valorStr
    .replace(/R\$?/g, '')
    .replace(/\s/g, '')
    .trim();

  if (clean.includes('.') && clean.includes(',')) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (clean.includes(',')) {
    clean = clean.replace(',', '.');
  }

  const val = parseFloat(clean);
  return isNaN(val) ? null : val;
}

function classifyTransaction(parcela_atual: number | null, parcela_total: number | null, valor: number, descricao: string) {
  if (valor < 0) {
    const desc = descricao.toLowerCase();
    if (
      desc.includes('pag fat') ||
      /pagamento\s+(d[ae]\s+)?fatura/.test(desc) ||
      desc.includes('pagto fatura') ||
      desc.includes('crédito por parcelamento') ||
      desc.includes('credito por parcelamento') ||
      desc.includes('pagamento recebido')
    ) {
      return 'payment' as const;
    }
    return 'refund' as const;
  }
  if (parcela_atual === 1 && parcela_total !== null && parcela_total > 1) return 'new_installment' as const;
  if (parcela_atual !== null && parcela_atual > 1 && parcela_total !== null) return 'ongoing_installment' as const;
  return 'simple' as const;
}

// ── Mercado Pago parser ────────────────────────────────────────

function parseMercadoPago(
  pages: Array<{ rows: PdfTextBlock[]; garbledFonts: Set<string> }>,
  defaultPessoa: string = 'Titular'
): PdfParseResult {
  const transactions: ClassifiedTransaction[] = [];
  const skippedLines: SkippedLine[] = [];
  const lineLogs: CsvLineLogEntry[] = [];
  const hashCounts = new Map<string, number>();

  let section: 'mov' | 'card' | null = null;
  let stopParsing = false;
  let lineNumber = 0;
  let dueYear = new Date().getFullYear();
  let headerTotal: number | undefined;
  let detectedDueDate: { month: number; year: number; day?: number } | undefined;

  // First pass: find vencimento year and header total from first few pages
  // MP PDF layout puts "Total a pagar" on one row, then the date/limit row, then "R$ X,XXX.XX"
  // So we track a counter (up to 3 rows) instead of just the previous row.
  for (let pi = 0; pi < Math.min(pages.length, 3); pi++) {
    if (detectedDueDate && headerTotal) break;
    const { rows, garbledFonts } = pages[pi];
    let rowsSinceTotalAPagar = -1; // -1 = not seen yet
    let inSummarySection = false;
    for (const row of rows) {
      const text = getRowText(row, garbledFonts);
      const vencMatch = text.match(/Vencimento[:\s]*(\d{2})\/(\d{2})\/(\d{4})/i)
        || text.match(/Vence\s+em\s*(\d{2})\/(\d{2})\/(\d{4})/i);
      if (vencMatch && !detectedDueDate) {
        dueYear = parseInt(vencMatch[3]);
        detectedDueDate = { month: parseInt(vencMatch[2]) - 1, year: dueYear, day: parseInt(vencMatch[1]) };
      }
      // Also detect due date from the row right after "Total a pagar" header
      if (!detectedDueDate && rowsSinceTotalAPagar >= 0 && rowsSinceTotalAPagar < 3) {
        const dateInRow = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateInRow) {
          dueYear = parseInt(dateInRow[3]);
          detectedDueDate = { month: parseInt(dateInRow[2]) - 1, year: dueYear, day: parseInt(dateInRow[1]) };
        }
      }
      // Detect "Total a pagar R$ X" on the same row
      const totalMatch = text.match(/Total\s+a\s+pagar.*?R\$\s*([\d.,]+)/i);
      if (totalMatch) {
        headerTotal = parseValue('R$ ' + totalMatch[1]) ?? undefined;
      }
      // "Total a pagar" label found → start counting rows to find the value
      if (/Total\s+a\s+pagar/i.test(text)) {
        rowsSinceTotalAPagar = 0;
      }
      // Look for standalone "R$ X,XXX.XX" within 3 rows after "Total a pagar"
      if (!headerTotal && rowsSinceTotalAPagar >= 0 && rowsSinceTotalAPagar < 3) {
        const valMatch = text.match(/^R\$\s*([\d.,]+)/);
        if (valMatch) {
          headerTotal = parseValue('R$ ' + valMatch[1]) ?? undefined;
        }
      }
      if (rowsSinceTotalAPagar >= 0) rowsSinceTotalAPagar++;

      // Track summary section for fallback "Total R$ X" matching
      if (/Resumo da fatura/i.test(text)) inSummarySection = true;
      if (/Detalhes de consumo|Movimentações na fatura/i.test(text)) inSummarySection = false;
      // Fallback: "Total R$ X" in summary section (last line before transaction details)
      if (!headerTotal && inSummarySection) {
        const summaryTotal = text.match(/^Total\s+R\$\s*([\d.,]+)/i);
        if (summaryTotal) {
          headerTotal = parseValue('R$ ' + summaryTotal[1]) ?? undefined;
        }
      }
    }
  }

  // Second pass: parse transactions
  for (const { rows, garbledFonts } of pages) {
    if (stopParsing) break;

    for (const row of rows) {
      if (stopParsing) break;
      lineNumber++;

      const text = getRowText(row, garbledFonts);
      const segments = getRowSegments(row, garbledFonts);

      // Stop at non-transaction sections
      if (/Parcele a fatura|Seus parcelamentos|Limite do cartão|Datas importantes|Opções de pagamento|Lançamentos futuros/i.test(text)) {
        stopParsing = true;
        break;
      }

      // Section detection
      if (/Movimentações na fatura/i.test(text)) {
        section = 'mov';
        lineLogs.push({ lineNumber, content: text, status: 'ignorada', reason: 'Cabeçalho de seção' });
        continue;
      }
      if (/Cartão Visa/i.test(text)) {
        section = 'card';
        lineLogs.push({ lineNumber, content: text, status: 'ignorada', reason: 'Cabeçalho de seção' });
        continue;
      }
      if (!section) continue;

      // Skip header/total rows
      if (/^(Data|Movimentações|Valor em R\$|Total|Detalhes de consumo)$/i.test(text)) continue;
      if (text.startsWith('Total')) {
        lineLogs.push({ lineNumber, content: text, status: 'ignorada', reason: 'Linha de total' });
        continue;
      }

      // Parse row: look for date, description, optional parcela, value
      const dateMatch = segments[0]?.match(DATE_DD_MM);
      if (!dateMatch) {
        lineLogs.push({ lineNumber, content: text, status: 'ignorada', reason: 'Sem data DD/MM' });
        continue;
      }

      const dateStr = segments[0];
      let descricao: string | null = null;
      let parcela_atual: number | null = null;
      let parcela_total: number | null = null;
      let valor: number | null = null;

      for (let si = 1; si < segments.length; si++) {
        const seg = segments[si];

        const valMatch = seg.match(VALUE_REGEX);
        if (valMatch) {
          valor = parseValue(valMatch[0]);
          continue;
        }

        const parcMatch = seg.match(MP_PARCELA_REGEX);
        if (parcMatch) {
          parcela_atual = parseInt(parcMatch[1]);
          parcela_total = parseInt(parcMatch[2]);
          continue;
        }

        if (!descricao && seg.length >= 2 && !/^\d+[.,]\d+$/.test(seg)) {
          descricao = seg;
        }
      }

      if (!descricao || valor === null) {
        lineLogs.push({ lineNumber, content: text, status: 'rejeitada', reason: 'Sem descrição ou valor' });
        continue;
      }

      // Fallback: parcela embutida na descrição (ex: "Parcelamento de fatura 3/10",
      // "Parcela da fatura (3/10)") quando não veio no formato "Parcela N de M".
      if (parcela_atual === null) {
        const p = parseParcelaFromDesc(descricao);
        if (p) {
          parcela_atual = p.atual;
          parcela_total = p.total;
        }
      }

      const isCredit = section === 'mov' && /cr[eé]dito|pagamento da fatura/i.test(descricao);
      const rawValor = isCredit ? -valor : valor;
      const tipo = isCredit ? 'receita' as const : 'despesa' as const;
      const absValor = Math.abs(valor);

      const isoDate = parseDate(dateStr, dueYear, detectedDueDate?.month);
      const baseHash = generateHash(isoDate, descricao, absValor, defaultPessoa, parcela_atual, parcela_total);
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
        pessoa: defaultPessoa,
        hash_transacao,
        codigo_cartao: null,
        valor_dolar: null,
        classification,
        source_line_number: lineNumber,
        source_line_content: text,
      });

      lineLogs.push({
        lineNumber,
        content: text,
        status: 'importada',
        reason: `${section === 'mov' ? 'Movimentação' : 'Compra cartão'}: ${tipo}`,
        hash_transacao,
      });
    }
  }

  // Reconciliation: if header total > sum of parsed lines, inject "Saldo anterior" transaction
  // This handles Mercado Pago's rolled-over unpaid balance from previous months
  if (headerTotal && headerTotal > 0 && detectedDueDate) {
    const payments = transactions.filter(t => t.classification === 'payment');
    const importable = transactions.filter(t => t.classification !== 'payment');
    const sumDespesas = importable.filter(t => t.tipo === 'despesa').reduce((s, t) => s + t.valor, 0);
    const sumReceitas = importable.filter(t => t.tipo === 'receita').reduce((s, t) => s + t.valor, 0);
    const linesFatura = sumDespesas - sumReceitas;
    const missing = headerTotal - linesFatura;

    if (missing > 0.50) {
      const dueDate = `${detectedDueDate.year}-${String(detectedDueDate.month + 1).padStart(2, '0')}-01`;
      const desc = 'Saldo anterior da fatura';
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
        source_line_number: 0,
        source_line_content: `Saldo anterior: header R$ ${headerTotal.toFixed(2)} - linhas R$ ${linesFatura.toFixed(2)} = R$ ${missing.toFixed(2)}`,
      });

      lineLogs.push({
        lineNumber: 0,
        content: `Saldo anterior não listado: R$ ${missing.toFixed(2)}`,
        status: 'importada',
        reason: 'Saldo anterior da fatura (rollover de mês anterior sem pagamento total)',
        hash_transacao: hash,
      });
    }
  }

  return {
    transactions,
    skippedLines,
    totalLines: lineNumber,
    lineLogs,
    institution: 'Mercado Pago',
    headerTotal,
    detectedDueDate,
  };
}

// ── Nu Conta (Nubank checking account) parser ──────────────────

const NU_MONTHS: Record<string, number> = {
  JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6,
  JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12,
};
const NU_DATE_HEADER = /(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})/i;
const NU_VALUE_AT_END = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
const NU_TX_PREFIX = /(Transferência\s+(?:recebida|enviada)\s+pelo\s+Pix|Transferência\s+(?:Recebida|Enviada)|Pagamento\s+de\s+fatura|Pagamento\s+de\s+conta|Compra\s+no\s+(?:débito|debito|crédito|credito)|Estorno|Reembolso|Cashback|Rendimentos?(?:\s+líquidos?| de poupança)?|Saque|Depósito|Tarifa|Boleto)/i;

export function parseNubankConta(
  pages: Array<{ rows: PdfTextBlock[]; garbledFonts: Set<string> }>,
  defaultPessoa: string = 'Titular'
): PdfParseResult {
  const transactions: ClassifiedTransaction[] = [];
  const skippedLines: SkippedLine[] = [];
  const lineLogs: CsvLineLogEntry[] = [];
  const hashCounts = new Map<string, number>();

  let currentDate: string | null = null;
  let currentSection: 'entrada' | 'saida' | null = null;
  let lineNumber = 0;
  let openingBalance: number | undefined;
  let openingDate: string | undefined;

  // No layout do extrato Nu Conta, "Saldo inicial" e seu valor caem na mesma
  // linha (mesma posição Y), ex: "Saldo inicial 1,53". Capturamos pra setar o
  // saldo_inicial da conta (senão o saldo fica defasado do valor do período).
  const MESES_FULL: Record<string, number> = {
    JANEIRO: 1, FEVEREIRO: 2, MARÇO: 3, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6,
    JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12,
  };

  for (const { rows, garbledFonts } of pages) {
    for (const row of rows) {
      lineNumber++;
      const text = getRowText(row, garbledFonts);
      if (!text) continue;

      // Saldo inicial do período (apenas a primeira ocorrência).
      if (openingBalance === undefined) {
        const sm = text.match(/saldo inicial\s+R?\$?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);
        if (sm) openingBalance = parseValue(sm[1]) ?? undefined;
      }
      // Data inicial do período: "01 DE JANEIRO DE 2026 a 31 ..."
      if (openingDate === undefined) {
        const pm = text.match(/(\d{1,2})\s+DE\s+([A-ZÇÃ]+)\s+DE\s+(\d{4})\s+a\s+/i);
        if (pm) {
          const mn = MESES_FULL[pm[2].toUpperCase()];
          if (mn) openingDate = `${pm[3]}-${String(mn).padStart(2, '0')}-${pm[1].padStart(2, '0')}`;
        }
      }

      // Update current date when we see a date marker (may share row with section header)
      const dateMatch = text.match(NU_DATE_HEADER);
      if (dateMatch) {
        const day = dateMatch[1].padStart(2, '0');
        const monthNum = NU_MONTHS[dateMatch[2].toUpperCase()];
        if (monthNum) {
          const month = String(monthNum).padStart(2, '0');
          const year = dateMatch[3];
          currentDate = `${year}-${month}-${day}`;
        }
      }

      // Update current section (entradas/saídas) when seeing the day-total header
      if (/Total\s+de\s+entradas/i.test(text)) {
        currentSection = 'entrada';
        lineLogs.push({ lineNumber, content: text, status: 'ignorada', reason: 'Total do dia (entradas)' });
        continue;
      }
      if (/Total\s+de\s+sa[íi]das/i.test(text)) {
        currentSection = 'saida';
        lineLogs.push({ lineNumber, content: text, status: 'ignorada', reason: 'Total do dia (saídas)' });
        continue;
      }

      // Skip header/footer/metadata
      if (
        /^(Saldo|Rendimento|VALORES EM R\$|Movimentações|Tem alguma dúvida|Nu Financeira|Nu Pagamentos|CNPJ|Extrato gerado|O saldo líquido|Não nos responsabilizamos|Asseguramos|Caso a solução|CPF\s)/i.test(text)
      ) {
        lineLogs.push({ lineNumber, content: text, status: 'ignorada', reason: 'Cabeçalho/rodapé' });
        continue;
      }

      if (!currentDate || !currentSection) {
        continue;
      }

      // Match transaction row: must contain a known prefix AND a value at end
      const prefixMatch = text.match(NU_TX_PREFIX);
      if (!prefixMatch) continue;

      const valueMatch = text.match(NU_VALUE_AT_END);
      if (!valueMatch) {
        // Likely a wrapped continuation row — skip
        continue;
      }

      const valor = parseValue(valueMatch[1]);
      if (valor === null || valor === 0) continue;

      // Build description: prefix + a short slice of counterpart text (if any)
      const prefixIdx = text.indexOf(prefixMatch[0]);
      const prefixEnd = prefixIdx + prefixMatch[0].length;
      const valueStart = text.lastIndexOf(valueMatch[1]);
      let counterpart = text.substring(prefixEnd, valueStart).trim();
      // Strip CPF/CNPJ noise and trailing technical info (Agência/Conta numbers)
      counterpart = counterpart
        .replace(/-?\s*•+\.\d+\.\d+-•+/g, '')
        .replace(/-?\s*\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      // Truncate counterpart at first " - " or after ~50 chars
      const dashSplit = counterpart.split(/\s+-\s+/);
      if (dashSplit.length > 0 && dashSplit[0].length >= 3) {
        counterpart = dashSplit[0].trim();
      }
      if (counterpart.length > 60) counterpart = counterpart.substring(0, 60).trim();

      const descricao = counterpart
        ? `${prefixMatch[0]} - ${counterpart}`
        : prefixMatch[0];

      const tipo: 'receita' | 'despesa' = currentSection === 'entrada' ? 'receita' : 'despesa';
      const rawValor = currentSection === 'entrada' ? -valor : valor;

      const baseHash = generateHash(currentDate, descricao, valor, defaultPessoa);
      const count = hashCounts.get(baseHash) || 0;
      hashCounts.set(baseHash, count + 1);
      const hash_transacao = count > 0 ? `${baseHash}_seq${count}` : baseHash;

      const classification = classifyTransaction(null, null, rawValor, descricao);

      transactions.push({
        data: currentDate,
        descricao,
        descricao_normalizada: normalizeDescription(descricao),
        valor,
        tipo,
        parcela_atual: null,
        parcela_total: null,
        pessoa: defaultPessoa,
        hash_transacao,
        codigo_cartao: null,
        valor_dolar: null,
        classification,
        source_line_number: lineNumber,
        source_line_content: text,
      });

      lineLogs.push({
        lineNumber,
        content: text,
        status: 'importada',
        reason: `Nu Conta: ${tipo}`,
        hash_transacao,
      });
    }
  }

  return {
    transactions,
    skippedLines,
    totalLines: lineNumber,
    lineLogs,
    institution: 'Nu Conta',
    openingBalance,
    openingDate,
  };
}

// ── Nubank CARD (fatura de cartão de crédito) parser ───────────
// Formato distinto da Nu Conta e dos demais: seção "TRANSAÇÕES DE DD MMM A DD MMM"
// e linhas "DD MMM •••• NNNN  descrição  R$ valor" (data sem ano, mês em PT).
// O parser genérico falhava porque exige data DD/MM e seções "Movimentações".

const NUCARD_VENC = /Data de vencimento:?\s*(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})/i;
const NUCARD_TOTAL = /Total a pagar\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
// DD MMM [•••• NNNN] descrição R$ valor   (valor pode ser negativo com − ou -)
const NUCARD_LINE = /^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(?:[••·∙*]{2,}\s*\d{3,4}\s+)?(.+?)\s+([−-]?\s*R\$\s*\d{1,3}(?:\.\d{3})*,\d{2})$/i;
const NUCARD_PARCELA = /-?\s*Parcela\s+(\d{1,2})\/(\d{1,2})/i;

export function parseNubankCard(pages: string[], defaultPessoa: string = 'Titular'): PdfParseResult {
  const fullText = pages.join('\n');
  const transactions: ClassifiedTransaction[] = [];
  const lineLogs: CsvLineLogEntry[] = [];
  const hashCounts = new Map<string, number>();

  // Vencimento → ano/mês de referência (para inferir o ano das datas sem ano).
  const vm = fullText.match(NUCARD_VENC);
  const dueMonth = vm ? NU_MONTHS[vm[2].toUpperCase()] : null; // 1-12
  const dueYear = vm ? parseInt(vm[3]) : new Date().getFullYear();
  const detectedDueDate = vm
    ? { day: parseInt(vm[1]), month: (dueMonth! - 1), year: dueYear }
    : undefined;

  const totalMatch = fullText.match(NUCARD_TOTAL);
  const headerTotal = totalMatch ? (parseValue(totalMatch[1]) ?? undefined) : undefined;

  const rawLines = fullText.split(/\n/);
  let lineNumber = 0;
  for (const raw of rawLines) {
    lineNumber++;
    const line = raw.replace(/\s{2,}/g, ' ').trim();
    if (!line) continue;

    const m = line.match(NUCARD_LINE);
    if (!m) continue;

    const day = parseInt(m[1]);
    const monthNum = NU_MONTHS[m[2].toUpperCase()]; // 1-12
    if (!monthNum) continue;
    // Inferência de ano: meses APÓS o mês do vencimento pertencem ao ano anterior
    // (ex: fatura jan/2026 cobre "04 DEZ a 04 JAN" → DEZ é 2025, JAN é 2026).
    const year = dueMonth && monthNum > dueMonth ? dueYear - 1 : dueYear;
    const isoDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    let descricao = m[3].trim();
    // Normaliza sinal de menos unicode (−, U+2212) para '-' antes de parsear.
    const valStr = m[4].replace(/−/g, '-');
    const valor = parseValue(valStr);
    if (valor === null || valor === 0) {
      lineLogs.push({ lineNumber, content: line, status: 'ignorada', reason: 'Valor zero/ inválido' });
      continue;
    }

    // Parcela "Parcela N/M" (Nubank escreve "- Parcela 8/12")
    let parcela_atual: number | null = null;
    let parcela_total: number | null = null;
    const pm = descricao.match(NUCARD_PARCELA);
    if (pm) {
      parcela_atual = parseInt(pm[1]);
      parcela_total = parseInt(pm[2]);
      descricao = descricao.replace(NUCARD_PARCELA, '').trim();
    }

    // Sinal: valor negativo (pagamento/estorno) ou descrição de pagamento → receita.
    const ehCredito = valor < 0 || /pagamento|saldo restante|estorno|reembolso|cashback/i.test(descricao);
    const tipo = ehCredito ? ('receita' as const) : ('despesa' as const);
    const rawValor = ehCredito ? -Math.abs(valor) : Math.abs(valor);
    const absValor = Math.abs(valor);

    const baseHash = generateHash(isoDate, descricao, absValor, defaultPessoa, parcela_atual, parcela_total);
    const count = hashCounts.get(baseHash) || 0;
    hashCounts.set(baseHash, count + 1);
    const hash_transacao = count > 0 ? `${baseHash}_seq${count}` : baseHash;

    transactions.push({
      data: isoDate,
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
      classification: classifyTransaction(parcela_atual, parcela_total, rawValor, descricao),
      source_line_number: lineNumber,
      source_line_content: line,
    });
    lineLogs.push({ lineNumber, content: line, status: 'importada', reason: 'Cartão Nubank', hash_transacao });
  }

  return {
    transactions,
    skippedLines: [],
    totalLines: rawLines.length,
    lineLogs,
    institution: 'Nubank',
    headerTotal,
    detectedDueDate,
  };
}

// ── Generic PDF parser (existing logic, improved) ──────────────

const GENERIC_DATE_REGEX = /(\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2}\/\d{2})/;
const GENERIC_VALUE_REGEX = /R?\$?\s*-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d{1,3}(?:\.\d{3})*,\d{2}/;
const GENERIC_PARCELA_REGEX = /\(?(\d{1,2})\/(\d{1,2})\)?/;

function parseGenericPdf(pages: string[], defaultPessoa: string = 'Titular'): PdfParseResult {
  const fullText = pages.join('\n');
  const lines = fullText.split(/\n/).flatMap(line => {
    const parts = line.split(/(?=\d{2}\/\d{2}\/\d{4})/);
    return parts.length > 1 ? parts : [line];
  });

  let institution: string | null = null;
  const textLower = fullText.toLowerCase();
  if (textLower.includes('sicredi')) institution = 'Sicredi';
  else if (textLower.includes('nubank')) institution = 'Nubank';
  else if (textLower.includes('inter') || textLower.includes('banco inter')) institution = 'Inter';

  const transactions: ClassifiedTransaction[] = [];
  const skippedLines: SkippedLine[] = [];
  const lineLogs: CsvLineLogEntry[] = [];
  const hashCounts = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNumber = i + 1;

    if (!line || line.length < 10) {
      lineLogs.push({ lineNumber, content: line, status: 'ignorada', reason: 'Linha muito curta' });
      continue;
    }

    const dateMatch = line.match(GENERIC_DATE_REGEX);
    if (!dateMatch) {
      lineLogs.push({ lineNumber, content: line, status: 'ignorada', reason: 'Sem data reconhecida' });
      continue;
    }

    const valueMatch = line.match(GENERIC_VALUE_REGEX);
    if (!valueMatch) {
      lineLogs.push({ lineNumber, content: line, status: 'ignorada', reason: 'Sem valor monetário' });
      continue;
    }

    const isoDate = parseDate(dateMatch[1]);
    const valor = parseValue(valueMatch[0]);

    if (valor === null || valor === 0) {
      lineLogs.push({ lineNumber, content: line, status: 'rejeitada', reason: 'Valor inválido' });
      continue;
    }

    const dateEnd = line.indexOf(dateMatch[0]) + dateMatch[0].length;
    const valueStart = line.indexOf(valueMatch[0]);
    let descricao = line.substring(dateEnd, valueStart).trim();
    descricao = descricao.replace(/^\s*[-–]\s*/, '').replace(/\s+/g, ' ').trim();

    if (!descricao || descricao.length < 2) {
      lineLogs.push({ lineNumber, content: line, status: 'rejeitada', reason: 'Descrição vazia' });
      continue;
    }

    const parcelaMatch = descricao.match(GENERIC_PARCELA_REGEX);
    let parcela_atual: number | null = null;
    let parcela_total: number | null = null;
    if (parcelaMatch) {
      parcela_atual = parseInt(parcelaMatch[1]);
      parcela_total = parseInt(parcelaMatch[2]);
      descricao = descricao.replace(GENERIC_PARCELA_REGEX, '').trim();
    }

    const rawValor = valor;
    const tipo = valor < 0 ? 'receita' as const : 'despesa' as const;
    const absValor = Math.abs(valor);

    const baseHash = generateHash(isoDate, descricao, absValor, defaultPessoa, parcela_atual, parcela_total);
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
      pessoa: defaultPessoa,
      hash_transacao,
      codigo_cartao: null,
      valor_dolar: null,
      classification,
      source_line_number: lineNumber,
      source_line_content: line,
    });

    lineLogs.push({
      lineNumber,
      content: line,
      status: 'importada',
      reason: 'Transação extraída do PDF',
      hash_transacao,
    });
  }

  return {
    transactions,
    skippedLines,
    totalLines: lines.length,
    lineLogs,
    institution,
  };
}

// ── Main entry point ───────────────────────────────────────────

export async function parsePdfFile(file: File, defaultPessoa: string = 'Titular'): Promise<PdfParseResult> {
  try {
    const structured = await extractPdfStructured(file);

    if (structured.isMercadoPago) {
      return parseMercadoPago(structured.pages, defaultPessoa);
    }
    if (structured.isNubankConta) {
      return parseNubankConta(structured.pages, defaultPessoa);
    }
    if (structured.isNubankCard) {
      // Constrói linhas reais a partir das rows estruturadas (o extractPdfText
      // junta tudo com espaço, sem \n, e quebra o parser por linha).
      const lines = structured.pages.flatMap((p) =>
        p.rows.map((r) => getRowText(r, p.garbledFonts)),
      );
      const nu = parseNubankCard(lines, defaultPessoa);
      if (nu.transactions.length > 0) return nu;
    }
  } catch (err) {
    console.error('[pdf-parser] extractPdfStructured failed, falling back to generic:', err);
  }

  const pages = await extractPdfText(file);

  // Safety: if text looks like MP, retry structured extraction
  const combined = pages.join(' ').toLowerCase();
  if (combined.includes('mercado pago') || combined.includes('mercadopago') || combined.includes('$4 ')) {
    console.warn('[pdf-parser] Mercado Pago detected in text but structured extraction failed. Retrying...');
    try {
      const structured2 = await extractPdfStructured(file);
      if (structured2.isMercadoPago) {
        return parseMercadoPago(structured2.pages, defaultPessoa);
      }
    } catch (err2) {
      console.error('[pdf-parser] Second structured extraction attempt also failed:', err2);
    }
  }
  // Safety: same retry for Nu Conta
  if ((combined.includes('nu financeira') || combined.includes('nu pagamentos')) && combined.includes('total de')) {
    console.warn('[pdf-parser] Nu Conta detected in text but structured extraction failed. Retrying...');
    try {
      const structured3 = await extractPdfStructured(file);
      if (structured3.isNubankConta) {
        return parseNubankConta(structured3.pages, defaultPessoa);
      }
    } catch (err3) {
      console.error('[pdf-parser] Second structured extraction attempt for Nu Conta failed:', err3);
    }
  }

  // Nubank CARTÃO: se a extração estruturada falhou mas o texto indica fatura de
  // cartão, tenta re-extrair estruturado (o parser precisa de linhas reais).
  if (
    (combined.includes('nubank') || combined.includes('nu pagamentos')) &&
    /transa[çc][õo]es\s+de\s+\d{1,2}\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/i.test(combined)
  ) {
    try {
      const s = await extractPdfStructured(file);
      if (s.isNubankCard) {
        const lines = s.pages.flatMap((p) => p.rows.map((r) => getRowText(r, p.garbledFonts)));
        const nu = parseNubankCard(lines, defaultPessoa);
        if (nu.transactions.length > 0) return nu;
      }
    } catch (e) {
      console.error('[pdf-parser] retry estruturado Nubank card falhou:', e);
    }
  }

  return parseGenericPdf(pages, defaultPessoa);
}

/** @deprecated Use parsePdfFile instead. Kept for backward compatibility. */
export function parsePdfText(pages: string[]): PdfParseResult {
  return parseGenericPdf(pages);
}
