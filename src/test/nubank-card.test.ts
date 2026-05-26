import { describe, it, expect } from 'vitest';
import { parseNubankCard } from '@/lib/pdf-parser';

// Texto reproduzindo o layout REAL da fatura do cartão Nubank (extraído via pdftotext).
const FATURA_JAN = `
Olá, Maiara. Esta é a sua fatura de janeiro, no valor de R$ 334,31
Data de vencimento: 12 JAN 2026
Período vigente: 04 DEZ a 04 JAN
RESUMO DA FATURA ATUAL
Fatura anterior R$ 234,33
Total a pagar R$ 334,31
TRANSAÇÕES DE 04 DEZ A 04 JAN
Maiara P Martins R$ 334,31
04 DEZ •••• 1376 Pg *Braip Intermediaca - Parcela 8/12 R$ 15,12
04 DEZ •••• 8593 Hna*Oboticario - Parcela 8/12 R$ 32,08
04 DEZ •••• 1376 Pg *Braip Intermediaca - Parcela 8/12 R$ 15,12
13 DEZ •••• 8858 Alboom Photographer Pr R$ 108,00
14 DEZ •••• 8858 Adobe R$ 71,00
18 DEZ •••• 8858 Dl*Google Google R$ 49,99
19 DEZ •••• 8858 Adobe R$ 43,00
Pagamentos e Financiamentos -R$ 234,33
11 DEZ Pagamento em 11 DEZ −R$ 234,33
11 DEZ Saldo restante da fatura anterior R$ 0,00
`;

describe('parseNubankCard — fatura de cartão Nubank', () => {
  const r = parseNubankCard([FATURA_JAN], 'Maiara');

  it('extrai as 7 compras + 1 pagamento (ignora saldo R$ 0,00)', () => {
    // 7 compras + 1 pagamento = 8; "Saldo restante R$ 0,00" é ignorado
    expect(r.transactions.length).toBe(8);
  });

  it('detecta vencimento 12 JAN 2026 (month 0-indexed = 0)', () => {
    expect(r.detectedDueDate).toEqual({ day: 12, month: 0, year: 2026 });
  });

  it('infere o ano: DEZ pertence a 2025 (fatura jan/2026)', () => {
    const adobe = r.transactions.find(t => t.descricao === 'Adobe' && t.valor === 71);
    expect(adobe?.data).toBe('2025-12-14');
  });

  it('parseia valor e tipo despesa para compras', () => {
    const alboom = r.transactions.find(t => t.descricao.includes('Alboom'));
    expect(alboom?.valor).toBe(108);
    expect(alboom?.tipo).toBe('despesa');
  });

  it('extrai parcela "8/12" e limpa a descrição', () => {
    const braip = r.transactions.find(t => t.descricao.includes('Braip'));
    expect(braip?.parcela_atual).toBe(8);
    expect(braip?.parcela_total).toBe(12);
    expect(braip?.descricao).not.toMatch(/Parcela/i);
  });

  it('pagamento (−R$) vira receita', () => {
    const pag = r.transactions.find(t => /Pagamento em/i.test(t.descricao));
    expect(pag?.tipo).toBe('receita');
    expect(pag?.valor).toBe(234.33);
  });

  it('duas compras idênticas (Braip 8/12) geram hashes distintos', () => {
    const braips = r.transactions.filter(t => t.descricao.includes('Braip'));
    expect(braips.length).toBe(2);
    expect(braips[0].hash_transacao).not.toBe(braips[1].hash_transacao);
  });

  it('captura o total da fatura', () => {
    expect(r.headerTotal).toBe(334.31);
  });
});
