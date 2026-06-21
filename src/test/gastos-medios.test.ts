import { describe, it, expect } from 'vitest';
import { buildGastosMedios } from '@/lib/analytics-engine';

function tx(over: Partial<any> = {}): any {
  return {
    data: '2026-03-10',
    mes_competencia: null,
    descricao: 'x',
    valor: 100,
    tipo: 'despesa',
    categoria: 'Alimentação',
    categoria_id: null,
    parcela_atual: null,
    parcela_total: null,
    grupo_parcela: null,
    ignorar_dashboard: false,
    essencial: true,
    conta_id: 'c1',
    ...over,
  };
}

describe('buildGastosMedios', () => {
  it('média mensal = total / nº de meses completos', () => {
    // 3 meses (jan, fev, mar), R$300 cada em Alimentação → média 300
    const txs = [
      tx({ data: '2026-01-05', valor: 300 }),
      tx({ data: '2026-02-05', valor: 300 }),
      tx({ data: '2026-03-05', valor: 300 }),
    ];
    const r = buildGastosMedios(txs, 6, '2026-04-10'); // mês corrente = abril
    expect(r.mesesConsiderados).toBe(3);
    expect(r.mediaMensal).toBe(300);
    expect(r.categorias[0].categoria).toBe('Alimentação');
    expect(r.categorias[0].media).toBe(300);
    expect(r.projecaoProximoMes).toBe(300);
  });

  it('EXCLUI o mês corrente (incompleto) da média', () => {
    const txs = [
      tx({ data: '2026-01-05', valor: 200 }),
      tx({ data: '2026-02-05', valor: 200 }),
      tx({ data: '2026-03-05', valor: 9999 }), // mês corrente — deve ser ignorado
    ];
    const r = buildGastosMedios(txs, 6, '2026-03-20');
    expect(r.mesesConsiderados).toBe(2); // só jan e fev
    expect(r.mediaMensal).toBe(200);
  });

  it('divide pela janela: categoria que aparece em 1 de 2 meses tem média menor', () => {
    const txs = [
      tx({ data: '2026-01-05', categoria: 'Saúde', valor: 400 }), // só em janeiro
      tx({ data: '2026-01-05', categoria: 'Transporte', valor: 100 }),
      tx({ data: '2026-02-05', categoria: 'Transporte', valor: 100 }),
    ];
    const r = buildGastosMedios(txs, 6, '2026-03-10');
    const saude = r.categorias.find(c => c.categoria === 'Saúde')!;
    const transp = r.categorias.find(c => c.categoria === 'Transporte')!;
    expect(saude.media).toBe(200);     // 400 / 2 meses
    expect(saude.mesesComGasto).toBe(1);
    expect(transp.media).toBe(100);    // 200 / 2 meses
    expect(transp.mesesComGasto).toBe(2);
  });

  it('ignora ignorar_dashboard e receitas', () => {
    const txs = [
      tx({ data: '2026-01-05', valor: 500, ignorar_dashboard: true }),
      tx({ data: '2026-01-05', valor: 500, tipo: 'receita' }),
      tx({ data: '2026-01-05', valor: 100 }),
    ];
    const r = buildGastosMedios(txs, 6, '2026-02-10');
    expect(r.mediaMensal).toBe(100);
  });

  it('usa mes_competencia quando presente (cartão)', () => {
    const txs = [
      tx({ data: '2026-03-28', mes_competencia: '2026-01', valor: 150 }),
      tx({ data: '2026-03-28', mes_competencia: '2026-02', valor: 150 }),
    ];
    const r = buildGastosMedios(txs, 6, '2026-04-10');
    expect(r.mesesConsiderados).toBe(2); // jan e fev por competência
    expect(r.mediaMensal).toBe(150);
  });

  it('sem dados → tudo zero', () => {
    const r = buildGastosMedios([], 6, '2026-04-10');
    expect(r.mesesConsiderados).toBe(0);
    expect(r.mediaMensal).toBe(0);
    expect(r.categorias).toHaveLength(0);
  });
});

import { mediaPorCategoriaNaoParcela, reposicaoParcelasNovas } from '@/lib/analytics-engine';

describe('mediaPorCategoriaNaoParcela', () => {
  it('média por categoria das NÃO-parceladas, exclui parcelas e categorias internas', () => {
    const txs = [
      tx({ data: '2026-01-05', categoria: 'Alimentação', valor: 1000 }),
      tx({ data: '2026-02-05', categoria: 'Alimentação', valor: 2000 }),
      tx({ data: '2026-01-05', categoria: 'Transporte', valor: 500 }),
      // parcela → ignorada aqui (vai pro timeline de parcelas)
      tx({ data: '2026-01-05', categoria: 'Compras', valor: 9999, parcela_total: 12, parcela_atual: 3 }),
      // categoria interna → fora da base
      tx({ data: '2026-01-05', categoria: 'Pagamento Fatura', valor: 5000 }),
    ];
    const r = mediaPorCategoriaNaoParcela(txs, 5, '2026-03-10');
    const ali = r.find(c => c.categoria === 'Alimentação')!;
    const tr = r.find(c => c.categoria === 'Transporte')!;
    expect(ali.media).toBe(1500); // (1000+2000)/2 meses
    expect(tr.media).toBe(250);   // 500/2 meses
    expect(r.find(c => c.categoria === 'Compras')).toBeFalsy(); // parcela fora
    expect(r.find(c => c.categoria === 'Pagamento Fatura')).toBeFalsy();
  });
});

describe('reposicaoParcelasNovas', () => {
  it('média mensal do valor de parcelas que COMEÇAM (parcela_atual===1)', () => {
    const txs = [
      tx({ data: '2026-01-05', valor: 100, parcela_atual: 1, parcela_total: 12 }),
      tx({ data: '2026-01-05', valor: 50, parcela_atual: 1, parcela_total: 6 }),
      tx({ data: '2026-02-05', valor: 30, parcela_atual: 1, parcela_total: 10 }),
      // parcela_atual > 1 → não conta (já tinha começado antes)
      tx({ data: '2026-02-05', valor: 999, parcela_atual: 5, parcela_total: 12 }),
    ];
    const r = reposicaoParcelasNovas(txs, 5, '2026-03-10');
    expect(r).toBe(90); // (150 + 30) / 2 meses
  });
});
