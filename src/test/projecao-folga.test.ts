import { describe, it, expect } from 'vitest';
import { projetarFolga } from '@/lib/projecao-folga';

describe('projetarFolga', () => {
  const base = {
    renda: 5440,
    baseFixaMensal: 3600,        // dia a dia + financiamento − aluguel − quitações
    parcelasPorMes: {} as Record<string, number>,
    reposicao: 0,
    comprasCasaParcela: 950,
    comprasCasaMeses: 18,
    mesInicio: '2026-07',
    nMeses: 24,
  };

  it('compras da casa entram por N meses e depois somem', () => {
    const r = projetarFolga(base);
    expect(r[0].comprasCasa).toBe(950);
    expect(r[17].comprasCasa).toBe(950);   // 18ª parcela (idx 17)
    expect(r[18].comprasCasa).toBe(0);     // 19º mês já sem compras
    expect(r[0].comprometimento).toBe(4550); // 3600 + 950
    expect(r[0].folga).toBe(890);            // 5440 − 4550 (o número do usuário!)
  });

  it('parcelas conhecidas decaem; reposição segura o piso', () => {
    const r = projetarFolga({
      ...base,
      reposicao: 300,
      parcelasPorMes: { '2026-07': 1000, '2026-08': 500 }, // jul alto, ago baixo, set+ zero
    });
    expect(r[0].parcelas).toBe(1000); // jul: conhecida 1000 > piso 300
    expect(r[1].parcelas).toBe(500);  // ago: conhecida 500 > piso 300
    expect(r[2].parcelas).toBe(300);  // set: sem conhecida → piso 300 (reposição)
  });

  it('folga melhora quando as compras da casa terminam', () => {
    const r = projetarFolga(base);
    expect(r[18].folga).toBeGreaterThan(r[0].folga); // depois das 18x, sobra mais
    expect(r[18].folga).toBe(1840); // 5440 − 3600
  });
});
