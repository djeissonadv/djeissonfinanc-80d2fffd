import { describe, it, expect } from 'vitest';
import { computeOpeningBalance } from '@/lib/ofx-parser';

describe('computeOpeningBalance', () => {
  it('saldo anterior = fechamento - efeito líquido das transações', () => {
    // Fechamento 1500; entrou 1000 (receita), saiu 300 (despesa) => líquido +700
    // Saldo anterior = 1500 - 700 = 800
    const r = computeOpeningBalance(1500, [
      { data: '2026-01-05', valor: 1000, tipo: 'receita' },
      { data: '2026-01-20', valor: 300, tipo: 'despesa' },
    ]);
    expect(r?.openingBalance).toBe(800);
    expect(r?.openingDate).toBe('2026-01-05'); // data do primeiro lançamento
  });

  it('só despesas: saldo anterior é maior que o fechamento', () => {
    const r = computeOpeningBalance(200, [
      { data: '2026-01-10', valor: 100, tipo: 'despesa' },
      { data: '2026-01-15', valor: 50, tipo: 'despesa' },
    ]);
    expect(r?.openingBalance).toBe(350); // 200 + 150
  });

  it('arredonda para centavos', () => {
    const r = computeOpeningBalance(100.1, [{ data: '2026-01-10', valor: 33.33, tipo: 'despesa' }]);
    expect(r?.openingBalance).toBe(133.43);
  });

  it('retorna null sem saldo de fechamento ou sem transações', () => {
    expect(computeOpeningBalance(null, [{ data: '2026-01-10', valor: 10, tipo: 'despesa' }])).toBeNull();
    expect(computeOpeningBalance(1000, [])).toBeNull();
  });
});
