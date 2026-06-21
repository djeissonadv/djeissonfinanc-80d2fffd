import { describe, it, expect } from 'vitest';
import { projetarFolga } from '@/lib/projecao-folga';

describe('projetarFolga', () => {
  const base = {
    renda: 5440,
    baseFixaAtual: 5440,         // hoje: dia a dia com aluguel + dívidas
    baseFixaNova: 3600,          // depois: financiamento, sem aluguel, dívidas quitadas
    parcelasPorMes: {} as Record<string, number>,
    reposicao: 0,
    comprasCasaParcela: 950,
    comprasCasaMeses: 18,
    mesAtual: '2026-07',
    mesesAteMudanca: 0,          // muda já
    nMeses: 24,
  };

  it('com mudança imediata, reproduz a conta do usuário (folga 890)', () => {
    const r = projetarFolga(base);
    expect(r[0].mudou).toBe(true);
    expect(r[0].comprometimento).toBe(4550); // 3600 + 950
    expect(r[0].folga).toBe(890);            // 5440 − 4550
  });

  it('mesesAteMudanca desloca a fase nova; antes usa a base atual', () => {
    const r = projetarFolga({ ...base, mesesAteMudanca: 3 });
    expect(r[0].mudou).toBe(false);
    expect(r[0].baseFixa).toBe(5440);        // ainda na situação atual
    expect(r[0].comprasCasa).toBe(0);        // compras só depois de mudar
    expect(r[3].mudou).toBe(true);
    expect(r[3].baseFixa).toBe(3600);        // já mudou
    expect(r[3].comprasCasa).toBe(950);      // 1ª parcela da casa
  });

  it('compras da casa contam por N meses a partir da mudança', () => {
    const r = projetarFolga({ ...base, mesesAteMudanca: 2 });
    expect(r[2].comprasCasa).toBe(950);      // mês da mudança = 1ª
    expect(r[2 + 17].comprasCasa).toBe(950); // 18ª
    expect(r[2 + 18].comprasCasa).toBe(0);   // 19ª já não tem
  });

  it('parcelas decaem; reposição segura o piso', () => {
    const r = projetarFolga({
      ...base,
      reposicao: 300,
      parcelasPorMes: { '2026-07': 1000, '2026-08': 500 },
    });
    expect(r[0].parcelas).toBe(1000);
    expect(r[1].parcelas).toBe(500);
    expect(r[2].parcelas).toBe(300); // sem conhecida → piso
  });
});
