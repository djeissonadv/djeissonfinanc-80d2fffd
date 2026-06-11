import { describe, expect, it } from 'vitest';
import { toLocalIso, getMonthRange, formatDate, getMonthName, dataNoMesCompetencia } from '@/lib/format';

describe('toLocalIso — usa componentes LOCAIS (sem shift de UTC)', () => {
  it('formata uma data local como YYYY-MM-DD pelos getters locais', () => {
    const d = new Date(2026, 0, 15, 23, 30, 0); // 15/jan/2026 23:30 local
    expect(toLocalIso(d)).toBe('2026-01-15');
  });
  it('mantém o dia mesmo às 23h (toISOString viraria o dia em UTC-3)', () => {
    // Em UTC-3, 22:00 local de 31/12 vira 01/01 no toISOString. toLocalIso não.
    const d = new Date(2026, 11, 31, 22, 0, 0);
    expect(toLocalIso(d)).toBe('2026-12-31');
  });
  it('zero-padding de mês e dia', () => {
    expect(toLocalIso(new Date(2026, 2, 5))).toBe('2026-03-05');
  });
});

describe('getMonthRange — primeiro e último dia do mês', () => {
  it('janeiro (31 dias)', () => {
    expect(getMonthRange(0, 2026)).toEqual({ start: '2026-01-01', end: '2026-01-31' });
  });
  it('fevereiro ano comum (28 dias)', () => {
    expect(getMonthRange(1, 2026)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
  it('fevereiro bissexto (29 dias)', () => {
    expect(getMonthRange(1, 2024)).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  });
  it('dezembro não vaza pro ano seguinte', () => {
    expect(getMonthRange(11, 2026)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });
});

describe('formatDate — não desloca o dia (T00:00:00)', () => {
  it('formata YYYY-MM-DD no padrão pt-BR sem perder um dia', () => {
    expect(formatDate('2026-01-01')).toBe('01/01/2026');
  });
});

describe('getMonthName', () => {
  it('mapeia índices 0..11 para abreviações pt-BR', () => {
    expect(getMonthName(0)).toBe('Jan');
    expect(getMonthName(11)).toBe('Dez');
  });
});

describe('dataNoMesCompetencia — ancora a data no mês da fatura', () => {
  it('mantém o dia dentro do mês', () => {
    expect(dataNoMesCompetencia('2026-01', 10)).toBe('2026-01-10');
  });
  it('clampa no último dia do mês (fevereiro)', () => {
    expect(dataNoMesCompetencia('2026-02', 30)).toBe('2026-02-28');
  });
  it('clampa fevereiro bissexto em 29', () => {
    expect(dataNoMesCompetencia('2028-02', 31)).toBe('2028-02-29');
  });
  it('dia mínimo é 1', () => {
    expect(dataNoMesCompetencia('2026-06', 0)).toBe('2026-06-01');
  });
});
