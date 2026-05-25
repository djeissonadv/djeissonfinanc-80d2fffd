import { describe, it, expect } from 'vitest';
import { parseCreditoDescritivo, buildEmprestimoRows, isSicrediLoanCsv, parseSicrediLoanCsv } from '@/lib/credito-parser';

// Trechos representativos do texto extraído dos PDFs reais.
const SICREDI = `Documento Descritivo de Crédito
Código do contrato / OID: C5A9200110 / 64317853
Sistema de Amortização: PRICE
Total de Parcelas da Operação: 48
Valor do Saldo Devedor Atualizado: R$ 31.097,69
015 20/04/2026 695.24 588.47 0.00 0.00 0.00 1,283.71 0.00 L
016 20/05/2026 707.90 575.81 0.00 0.00 0.00 1,283.71 0.00 L
017 20/06/2026 1,267.61 0.00 0.00 0.00 0.00 0.00 1,267.61 A
018 20/07/2026 1,244.95 0.00 0.00 0.00 0.00 0.00 1,244.95 A
048 20/01/2029 724.70 0.00 0.00 0.00 0.00 0.00 724.70 A`;

const MP = `Documento Descritivo de Crédito
Contrato #1240412639 Credor: MERCADO CREDITO
Valor de cada parcela (no vencimento) R$ 563,41
Total de parcelas 24
Saldo devedor atualizado R$ 6.120,28
5 5/mai/2026 6/mai/2026 R$ 563,41 R$ 169,62 R$ 393,79 - - R$ 563,41 Paga R$ 0
6 5/jun/2026 - R$ 563,41 R$ 153,38 R$ 410,03 - - - Programada R$ 548,88
7 6/jul/2026 - R$ 563,41 R$ 164,09 R$ 399,32 - - - Programada R$ 513,05`;

describe('parseCreditoDescritivo — Sicredi', () => {
  const r = parseCreditoDescritivo(SICREDI)!;
  it('identifica contrato, instituição e total', () => {
    expect(r.instituicao).toBe('Sicredi');
    expect(r.contratoKey).toBe('C5A9200110');
    expect(r.totalParcelas).toBe(48);
    expect(r.saldoDevedor).toBe(31097.69);
  });
  it('deriva a parcela fixa das pagas (PRICE)', () => {
    expect(r.parcelaFixa).toBe(1283.71);
  });
  it('extrai as parcelas futuras (A) com valor fixo', () => {
    expect(r.futuras.map(p => p.numero)).toEqual([17, 18, 48]);
    expect(r.futuras.every(p => p.valor === 1283.71)).toBe(true);
    expect(r.futuras[0].vencimento).toBe('2026-06-20');
    expect(r.futuras[2].vencimento).toBe('2029-01-20');
  });
});

describe('parseCreditoDescritivo — Mercado Pago', () => {
  const r = parseCreditoDescritivo(MP)!;
  it('identifica contrato (prefixo MP) e parcela fixa', () => {
    expect(r.instituicao).toBe('Mercado Pago');
    expect(r.contratoKey).toBe('MP1240412639');
    expect(r.totalParcelas).toBe(24);
    expect(r.parcelaFixa).toBe(563.41);
    expect(r.saldoDevedor).toBe(6120.28);
  });
  it('marca como futura quem não tem data de pagamento (Programada)', () => {
    expect(r.futuras.map(p => p.numero)).toEqual([6, 7]);
    expect(r.parcelas.find(p => p.numero === 5)?.futura).toBe(false);
    expect(r.futuras[0].vencimento).toBe('2026-06-05');
  });
});

describe('buildEmprestimoRows', () => {
  it('gera linhas Empréstimos com hash por contrato e filtra por hoje', () => {
    const ddc = parseCreditoDescritivo(SICREDI)!;
    const rows = buildEmprestimoRows(ddc, {
      userId: 'u1', contaId: 'c1', pessoa: 'Djeisson', hojeIso: '2026-05-24',
    });
    // parcela 17 (20/06/2026), 18 (20/07/2026), 48 (2029) >= hoje → 3 linhas
    expect(rows).toHaveLength(3);
    expect(rows[0].categoria).toBe('Empréstimos');
    expect(rows[0].conta_id).toBe('c1');
    expect(rows[0].valor).toBe(1283.71);
    expect(rows[0].hash_transacao).toBe('C5A9200110_p17'); // agrupa por contrato na página de Dívidas
    expect(rows[0].descricao).toContain('17/48');
  });

  it('exclui parcelas já vencidas antes de hoje', () => {
    const ddc = parseCreditoDescritivo(SICREDI)!;
    const rows = buildEmprestimoRows(ddc, {
      userId: 'u1', contaId: 'c1', pessoa: 'Djeisson', hojeIso: '2026-07-01',
    });
    // só 18 (20/07/2026) e 48 ficam (17 venceu 20/06)
    expect(rows.map(r => r.parcela_atual)).toEqual([18, 48]);
  });
});

const SICREDI_CSV = `"Número do título";"Parcela";"Situação";"Valor a Liquidar (R$)";"Data Vencimento";"Data Pagamento"
"C5A9304161";"010";"LIQUIDADO";"601,71";"20/05/2026";"20/05/2026"
"C5A9304161";"011";"NORMAL";"601,71";"20/06/2026";""
"C5A9304161";"012";"NORMAL";"601,71";"20/07/2026";""
"C5A9304161";"036";"NORMAL";"601,71";"20/07/2028";""`;

describe('parseSicrediLoanCsv', () => {
  it('detecta o formato do cronograma Sicredi', () => {
    expect(isSicrediLoanCsv(SICREDI_CSV)).toBe(true);
    expect(isSicrediLoanCsv('date,title,amount\n2026-01-01,Loja,10')).toBe(false);
  });

  it('extrai contrato, parcela fixa e futuras (NORMAL = aberta)', () => {
    const r = parseSicrediLoanCsv(SICREDI_CSV)!;
    expect(r.contratoKey).toBe('C5A9304161');
    expect(r.parcelaFixa).toBe(601.71);
    expect(r.totalParcelas).toBe(36);
    expect(r.futuras.map(p => p.numero)).toEqual([11, 12, 36]); // 10 é LIQUIDADO
    expect(r.futuras[0].vencimento).toBe('2026-06-20');
  });

  it('gera linhas com hash por contrato (agrupa em Dívidas)', () => {
    const r = parseSicrediLoanCsv(SICREDI_CSV)!;
    const rows = buildEmprestimoRows(r, { userId: 'u1', contaId: 'c1', pessoa: 'D', hojeIso: '2026-05-25' });
    expect(rows.map(x => x.parcela_atual)).toEqual([11, 12, 36]);
    expect(rows[0].hash_transacao).toBe('C5A9304161_p11');
    expect(rows[0].valor).toBe(601.71);
  });
});
