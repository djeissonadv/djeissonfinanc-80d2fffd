import { describe, it, expect } from 'vitest';
import { planoParcelamentoFatura } from '@/lib/parcelamento-fatura';
import { addMonthsYM } from '@/lib/format';

describe('addMonthsYM', () => {
  it('soma meses dentro do ano', () => {
    expect(addMonthsYM('2026-01', 1)).toBe('2026-02');
    expect(addMonthsYM('2026-01', 5)).toBe('2026-06');
  });
  it('vira o ano', () => {
    expect(addMonthsYM('2026-11', 2)).toBe('2027-01');
    expect(addMonthsYM('2026-12', 1)).toBe('2027-01');
  });
});

describe('planoParcelamentoFatura', () => {
  it('1ª parcela cai no mês SEGUINTE ao billing', () => {
    const p = planoParcelamentoFatura('2026-06', 12, 530, 6000);
    expect(p.parcelas).toHaveLength(12);
    expect(p.parcelas[0].competencia).toBe('2026-07'); // 1ª = jul (billing+1)
    expect(p.parcelas[11].competencia).toBe('2027-06'); // 12ª = jun/27
  });

  it('calcula total e juros embutidos', () => {
    const p = planoParcelamentoFatura('2026-06', 12, 530, 6000);
    expect(p.principal).toBe(6000);
    expect(p.totalParcelado).toBe(6360); // 12 × 530
    expect(p.juros).toBe(360);           // 6360 − 6000
  });

  it('sem juros quando total = principal', () => {
    const p = planoParcelamentoFatura('2026-06', 10, 100, 1000);
    expect(p.juros).toBe(0);
  });

  it('arredonda valores a 2 casas (sem epsilon de float)', () => {
    const p = planoParcelamentoFatura('2026-06', 3, 33.34, 100);
    expect(p.totalParcelado).toBe(100.02);
    expect(p.juros).toBe(0.02);
  });

  it('força no mínimo 1 parcela', () => {
    const p = planoParcelamentoFatura('2026-06', 0, 500, 500);
    expect(p.numParcelas).toBe(1);
    expect(p.parcelas).toHaveLength(1);
  });

  it('entrada reduz o valor financiado; juro incide só sobre o financiado', () => {
    // fatura 6000, entrada 1000 → financia 5000 em 10x de 530 = 5300
    const p = planoParcelamentoFatura('2026-06', 10, 530, 6000, 1000);
    expect(p.entrada).toBe(1000);
    expect(p.financiado).toBe(5000);
    expect(p.totalParcelado).toBe(5300);       // 10 × 530
    expect(p.juros).toBe(300);                  // 5300 − 5000
    expect(p.totalDesembolsado).toBe(6300);     // 1000 + 5300
  });

  it('entrada não passa do total da fatura', () => {
    const p = planoParcelamentoFatura('2026-06', 1, 100, 500, 999);
    expect(p.entrada).toBe(500);
    expect(p.financiado).toBe(0);
  });

  it('sem entrada (default 0) mantém o comportamento antigo', () => {
    const p = planoParcelamentoFatura('2026-06', 12, 530, 6000);
    expect(p.entrada).toBe(0);
    expect(p.financiado).toBe(6000);
    expect(p.totalDesembolsado).toBe(6360);
  });
});
