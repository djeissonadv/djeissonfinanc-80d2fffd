import { describe, expect, it } from 'vitest';
import { parseSicrediCSV, normalizeDescription, parseValue, isSaldoAnteriorFatura } from '@/lib/csv-parser';

describe('isSaldoAnteriorFatura — artefato de rollover (não é despesa nova)', () => {
  it('detecta "Saldo anterior da fatura"', () => {
    expect(isSaldoAnteriorFatura('Saldo anterior da fatura')).toBe(true);
    expect(isSaldoAnteriorFatura('SALDO ANTERIOR DA FATURA')).toBe(true);
  });
  it('NÃO confunde com parcela de fatura financiada (despesa real)', () => {
    expect(isSaldoAnteriorFatura('Parcela da fatura de dezembro/2025')).toBe(false);
  });
  it('NÃO confunde com compra normal', () => {
    expect(isSaldoAnteriorFatura('MERCADOLIVRE*EBAZARCOMBRL')).toBe(false);
  });
});

describe('parseValue — formatos de número monetário', () => {
  it('formato BR com milhar e decimal: 7.038,96 → 7038.96', () => {
    expect(parseValue('R$ 7.038,96')).toBe(7038.96);
  });
  it('negativo BR: -7.038,96 → -7038.96', () => {
    expect(parseValue('R$ -7.038,96')).toBe(-7038.96);
  });
  it('só vírgula decimal: 22,90 → 22.9', () => {
    expect(parseValue('R$ 22,90')).toBe(22.9);
  });
  it('decimal US com 2 casas (ponto): 150.00 → 150', () => {
    expect(parseValue('150.00')).toBe(150);
  });
  it('decimal com 2 casas (ponto): 12.34 → 12.34', () => {
    expect(parseValue('12.34')).toBe(12.34);
  });
  // Regressão do bug: ponto solitário com 3 dígitos é MILHAR no padrão BR,
  // não decimal. "1.500" deve ser 1500, e não 1.5.
  it('ponto solitário com 3 dígitos é milhar: 1.500 → 1500', () => {
    expect(parseValue('R$ 1.500')).toBe(1500);
  });
  it('ponto solitário com 3 dígitos é milhar: 12.345 → 12345', () => {
    expect(parseValue('12.345')).toBe(12345);
  });
  it('milhar negativo: -1.500 → -1500', () => {
    expect(parseValue('-1.500')).toBe(-1500);
  });
  it('múltiplos pontos são milhar: 1.234.567 → 1234567', () => {
    expect(parseValue('1.234.567')).toBe(1234567);
  });
  it('valor inválido retorna null', () => {
    expect(parseValue('abc')).toBeNull();
  });
});

describe('parseSicrediCSV', () => {
  it('importa devolução como receita (refund) com valor 718.80', () => {
    const csv = [
      'Relatório Sicredi',
      'Data;Descrição;Parcela;Valor;Extra;Codigo;Pessoa;Obs',
      '05/01/2026;Devolucao de Compras Nacionais;;-R$ 718,80;;912;Djeisson Mauss;',
    ].join('\n');

    const result = parseSicrediCSV(csv);

    expect(result.totalLines).toBe(3);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      data: '2026-01-05',
      descricao: 'Devolucao de Compras Nacionais',
      valor: 718.8,
      tipo: 'receita',
      pessoa: 'Djeisson Mauss',
      classification: 'refund',
      source_line_number: 3,
    });
    expect(result.skippedLines).toHaveLength(0);
  });

  it('gera hashes únicos para linhas idênticas no mesmo CSV', () => {
    const line = '05/01/2026;Devolucao de Compras Nacionais;;-R$ 718,80;;912;Djeisson Mauss;';
    const csv = [
      'Relatório Sicredi',
      'Data;Descrição;Parcela;Valor;Extra;Codigo;Pessoa;Obs',
      line,
      line,
    ].join('\n');

    const result = parseSicrediCSV(csv);

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].hash_transacao).not.toBe(result.transactions[1].hash_transacao);
    expect(result.transactions[1].hash_transacao).toContain('_seq1');
  });

  it('classifica parcela 01/X como new_installment', () => {
    const csv = [
      'Relatório Sicredi',
      'Data;Descrição;Parcela;Valor',
      '01/03/2026;BRASIL PARAL*BrasilPar;(01/12);"R$ 22,90"',
    ].join('\n');

    const result = parseSicrediCSV(csv);
    expect(result.transactions[0].classification).toBe('new_installment');
    expect(result.transactions[0].parcela_atual).toBe(1);
    expect(result.transactions[0].parcela_total).toBe(12);
  });

  it('classifica parcela N/X (N>1) como ongoing_installment', () => {
    const csv = [
      'Relatório Sicredi',
      'Data;Descrição;Parcela;Valor',
      '30/01/2026;SAO JOAO FARMACIAS;(02/03);"R$ 20,02"',
    ].join('\n');

    const result = parseSicrediCSV(csv);
    expect(result.transactions[0].classification).toBe('ongoing_installment');
    expect(result.transactions[0].parcela_atual).toBe(2);
  });

  it('classifica transação sem parcela como simple', () => {
    const csv = [
      'Relatório Sicredi',
      'Data;Descrição;Parcela;Valor',
      '28/02/2026;NETFLIX ENTRETENIMENTO;;"R$ 59,90"',
    ].join('\n');

    const result = parseSicrediCSV(csv);
    expect(result.transactions[0].classification).toBe('simple');
  });

  it('classifica pagamento de fatura como payment e outros negativos como refund', () => {
    const csv = [
      'Relatório Sicredi',
      'Data;Descrição;Parcela;Valor',
      '18/02/2026;Pag Fat Deb Cc;;"R$ -7.038,96"',
    ].join('\n');

    const result = parseSicrediCSV(csv);
    expect(result.transactions[0].classification).toBe('payment');
    expect(result.transactions[0].tipo).toBe('receita');
    expect(result.transactions[0].valor).toBe(7038.96);
  });

  it('extrai codigo_cartao e pessoa corretamente', () => {
    const csv = [
      'Relatório Sicredi',
      'Data;Descrição;Parcela;Valor;Valor Dolar;Adicional;Nome',
      '30/01/2026;SAO JOAO FARMACIAS;(02/03);"R$ 20,02";;0219;Maiara Martins',
    ].join('\n');

    const result = parseSicrediCSV(csv);
    expect(result.transactions[0].codigo_cartao).toBe('0219');
    expect(result.transactions[0].pessoa).toBe('Maiara Martins');
  });
});

describe('normalizeDescription', () => {
  it('normaliza descrição para deduplicação', () => {
    expect(normalizeDescription('CONSULTORIO DR FBS PASSO FUNDO   BRA')).toBe('CONSULTORIO DR FBS PASSO FUNDO');
    expect(normalizeDescription('netflix entretenimento')).toBe('NETFLIX ENTRETENIMENTO');
    expect(normalizeDescription('BRASIL PARAL*BrasilPar')).toBe('BRASIL PARALBrasilPar'.toUpperCase());
  });

  it('trunca em 40 caracteres', () => {
    const long = 'A'.repeat(50);
    expect(normalizeDescription(long).length).toBe(40);
  });
});
