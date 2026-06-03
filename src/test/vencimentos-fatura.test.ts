import { describe, it, expect } from 'vitest';
import { buildVencimentosFatura, proximoVencimentoCartao } from '@/lib/vencimentos';
import { calcularSaldosContas } from '@/lib/saldo';

describe('proximoVencimentoCartao', () => {
  it('mesmo mês: dia ainda não passou', () => {
    expect(proximoVencimentoCartao(10, '2026-06-05')).toBe('2026-06-10');
  });
  it('próximo mês: dia já passou', () => {
    expect(proximoVencimentoCartao(10, '2026-06-15')).toBe('2026-07-10');
  });
  it('dia 28 atravessa pra janeiro do próximo ano', () => {
    expect(proximoVencimentoCartao(15, '2026-12-20')).toBe('2027-01-15');
  });
});

describe('buildVencimentosFatura', () => {
  const hoje = '2026-06-02';

  it('cartão com fatura aberta vira vencimento', () => {
    const cards = [{ id: 'black', nome: 'Black', dia_vencimento: 10 }];
    const faturas = { black: { totalAPagar: 3000 } };
    const vencs = buildVencimentosFatura(cards, faturas, hoje, 30);
    expect(vencs).toHaveLength(1);
    expect(vencs[0].fonte).toBe('fatura');
    expect(vencs[0].valor).toBe(3000);
    expect(vencs[0].diasAteVencer).toBe(8);
  });

  it('cartão paga (totalAPagar <= 0) é ignorado', () => {
    const cards = [{ id: 'mp', nome: 'MP', dia_vencimento: 15 }];
    const faturas = { mp: { totalAPagar: 0 } };
    expect(buildVencimentosFatura(cards, faturas, hoje, 30)).toHaveLength(0);
  });

  it('cartão sem dia_vencimento é ignorado', () => {
    const cards = [{ id: 'x', nome: 'X', dia_vencimento: null }];
    const faturas = { x: { totalAPagar: 1000 } };
    expect(buildVencimentosFatura(cards, faturas, hoje, 30)).toHaveLength(0);
  });

  it('cartão com vencimento além de ateNDias é cortado', () => {
    const cards = [{ id: 'x', nome: 'X', dia_vencimento: 28 }];
    const faturas = { x: { totalAPagar: 500 } };
    // dia 28 está fora dos 7 dias
    expect(buildVencimentosFatura(cards, faturas, hoje, 7)).toHaveLength(0);
    expect(buildVencimentosFatura(cards, faturas, hoje, 30)).toHaveLength(1);
  });
});

describe('calcularSaldosContas com cutoffExclusive', () => {
  const contas = [
    { id: 'a', saldo_inicial: 1000, data_abertura: '2026-06-01' },
  ];

  it('cutoffExclusive=false (default): conta aberta no dia 1 COUNTA pro mês', () => {
    const saldos = calcularSaldosContas(contas, [], { cutoffDate: '2026-06-01' });
    expect(saldos.a).toBe(1000); // <=  → conta entra
  });

  it('cutoffExclusive=true: conta aberta no dia 1 NÃO conta pra "antes do mês"', () => {
    const saldos = calcularSaldosContas(contas, [], { cutoffDate: '2026-06-01', cutoffExclusive: true });
    expect(saldos.a).toBe(0); // <  → conta foi aberta exatamente no cutoff
  });

  it('compat: string como cutoffDate continua funcionando (inclusivo)', () => {
    const saldos = calcularSaldosContas(contas, [], '2026-06-01');
    expect(saldos.a).toBe(1000);
  });
});
