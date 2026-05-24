import { describe, it, expect } from 'vitest';
import { valorPresenteDivida, jurosEvitadosQuitando, buildDebtPlan, type DebtItem } from '@/lib/debt-strategy';

describe('valorPresenteDivida', () => {
  it('sem taxa retorna a soma nominal das parcelas', () => {
    expect(valorPresenteDivida(100, 10)).toBe(1000);
    expect(valorPresenteDivida(100, 10, 0)).toBe(1000);
  });

  it('com taxa, o valor presente é menor que a soma nominal', () => {
    const pv = valorPresenteDivida(1000, 12, 130);
    expect(pv).toBeLessThan(12000);
    expect(pv).toBeGreaterThan(0);
  });
});

describe('jurosEvitadosQuitando', () => {
  it('é zero quando a taxa é desconhecida', () => {
    expect(jurosEvitadosQuitando(500, 6)).toBe(0);
  });

  it('é positivo e igual a soma - valor presente quando há taxa', () => {
    const parcela = 1000, n = 12, taxa = 130;
    const esperado = parcela * n - valorPresenteDivida(parcela, n, taxa);
    expect(jurosEvitadosQuitando(parcela, n, taxa)).toBeCloseTo(esperado, 2);
    expect(jurosEvitadosQuitando(parcela, n, taxa)).toBeGreaterThan(0);
  });
});

describe('buildDebtPlan', () => {
  const itens: DebtItem[] = [
    { id: 'a', nome: 'MP', valorMensal: 1000, parcelasRestantes: 12, valorRestante: 12000, mesFim: '2027-06', taxaAno: 130, tipo: 'emprestimo' },
    { id: 'b', nome: 'Sicredi', valorMensal: 500, parcelasRestantes: 6, valorRestante: 3000, mesFim: '2026-11', tipo: 'emprestimo' },
    { id: 'c', nome: 'Compra TV', valorMensal: 200, parcelasRestantes: 3, valorRestante: 600, mesFim: '2026-08', tipo: 'compra' },
  ];

  it('prioriza dívida com taxa conhecida (avalanche), depois por saldo', () => {
    const plan = buildDebtPlan(itens, 10000, '2026-05');
    expect(plan.ordemAtaque[0].item.nome).toBe('MP'); // taxa conhecida vem primeiro
    expect(plan.ordemAtaque[1].item.nome).toBe('Sicredi'); // maior saldo entre os sem taxa
    expect(plan.ordemAtaque[2].item.nome).toBe('Compra TV');
  });

  it('calcula liberdade, comprometimento e bola-de-neve ordenada por mês', () => {
    const plan = buildDebtPlan(itens, 10000, '2026-05');
    expect(plan.totalRestante).toBe(15600);
    expect(plan.totalMensal).toBe(1700);
    expect(plan.comprometimentoRenda).toBeCloseTo(17, 0);
    expect(plan.mesLiberdade).toBe('2027-06');
    expect(plan.liberacoes[0].mes).toBe('2026-08'); // a que acaba primeiro
  });

  it('comprometimento é null quando renda desconhecida', () => {
    const plan = buildDebtPlan(itens, 0, '2026-05');
    expect(plan.comprometimentoRenda).toBeNull();
  });
});
