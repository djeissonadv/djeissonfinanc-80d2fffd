import { describe, it, expect } from 'vitest';
import {
  analisePicosGastos, mesesComGasto, lancamentosPorMes,
} from '@/lib/analytics-engine';

function tx(over: Partial<any> = {}): any {
  return {
    data: '2026-01-10', mes_competencia: null, descricao: 'x', valor: 100,
    tipo: 'despesa', categoria: 'Alimentação', categoria_id: null,
    parcela_atual: null, parcela_total: null, grupo_parcela: null,
    ignorar_dashboard: false, essencial: true, conta_id: 'debito1', ...over,
  };
}

// 4 meses de janela: mar, abr, mai, jun (corrente = julho)
const HOJE = '2026-07-15';

describe('analisePicosGastos', () => {
  it('detecta o mês fora da curva usando baseline dos OUTROS meses', () => {
    const txs = [
      tx({ data: '2026-03-10', categoria: 'Alimentação', valor: 400 }),
      tx({ data: '2026-04-10', categoria: 'Alimentação', valor: 400 }),
      tx({ data: '2026-05-10', categoria: 'Alimentação', valor: 400 }),
      tx({ data: '2026-06-10', categoria: 'Alimentação', valor: 1600 }), // pico
    ];
    const r = analisePicosGastos(txs, 4, HOJE);
    const ali = r.categorias.find(c => c.categoria === 'Alimentação')!;

    expect(ali.picos).toHaveLength(1);
    expect(ali.picos[0].mes).toBe('2026-06');
    // baseline = (400+400+400)/3 = 400 → excesso = 1600 - 400 = 1200
    expect(ali.picos[0].baseline).toBe(400);
    expect(ali.picos[0].excesso).toBe(1200);
    expect(ali.excessoTotal).toBe(1200);
  });

  it('não sinaliza variação pequena (abaixo do piso de R$ 80)', () => {
    const txs = [
      tx({ data: '2026-03-10', valor: 300 }),
      tx({ data: '2026-04-10', valor: 300 }),
      tx({ data: '2026-05-10', valor: 300 }),
      tx({ data: '2026-06-10', valor: 350 }), // +50, abaixo do piso
    ];
    const r = analisePicosGastos(txs, 4, HOJE);
    expect(r.categorias[0].picos).toHaveLength(0);
    expect(r.excessoTotal).toBe(0);
  });

  it('não sinaliza variação percentual pequena mesmo com valor alto', () => {
    const txs = [
      tx({ data: '2026-03-10', valor: 5000 }),
      tx({ data: '2026-04-10', valor: 5000 }),
      tx({ data: '2026-05-10', valor: 5000 }),
      tx({ data: '2026-06-10', valor: 5400 }), // +400 mas só 8% acima → não é pico
    ];
    const r = analisePicosGastos(txs, 4, HOJE);
    expect(r.categorias[0].picos).toHaveLength(0);
  });

  it('série em alta constante é TENDÊNCIA, não pico', () => {
    // 218 → 427 → 465 → 496: sobe todo mês. Com baseline por MÉDIA dos outros,
    // o último mês seria marcado como pico (média dos outros = 370). Com
    // MEDIANA (427), não dispara — que é o certo: isso é tendência.
    const txs = [218, 427, 465, 496].map((v, i) =>
      tx({ data: `2026-0${3 + i}-10`, categoria: 'Operação bancária', valor: v }));
    const r = analisePicosGastos(txs, 4, HOJE);
    expect(r.categorias[0].picos).toHaveLength(0);
    expect(r.excessoTotal).toBe(0);
  });

  it('detecta DOIS picos na mesma janela (um não esconde o outro)', () => {
    const txs = [400, 1500, 400, 1500].map((v, i) =>
      tx({ data: `2026-0${3 + i}-10`, categoria: 'Compras', valor: v }));
    const r = analisePicosGastos(txs, 4, HOJE);
    const picos = r.categorias[0].picos;
    expect(picos).toHaveLength(2);
    expect(picos.map(p => p.mes)).toEqual(['2026-04', '2026-06']);
    // baseline = mediana dos outros = 400 → excesso 1100 cada
    expect(picos[0].excesso).toBe(1100);
  });

  it('gasto que aparece em um único mês vira pico "pontual"', () => {
    const txs = [
      tx({ data: '2026-03-10', categoria: 'Alimentação', valor: 400 }),
      tx({ data: '2026-04-10', categoria: 'Alimentação', valor: 400 }),
      tx({ data: '2026-05-10', categoria: 'Alimentação', valor: 400 }),
      tx({ data: '2026-06-10', categoria: 'Alimentação', valor: 400 }),
      tx({ data: '2026-05-20', categoria: 'Saúde', valor: 900 }), // só em maio
    ];
    const r = analisePicosGastos(txs, 4, HOJE);
    const saude = r.categorias.find(c => c.categoria === 'Saúde')!;
    expect(saude.volatilidade).toBe('pontual');
    expect(saude.picos).toHaveLength(1);
    expect(saude.picos[0].mes).toBe('2026-05');
    // baseline 0 (não houve nos outros meses) → excesso = valor cheio
    expect(saude.picos[0].excesso).toBe(900);
  });

  it('classifica volatilidade pelo coeficiente de variação', () => {
    const txs = [
      // estável: 500 nos 4 meses
      ...['03', '04', '05', '06'].map(m => tx({ data: `2026-${m}-10`, categoria: 'Aluguel', valor: 500 })),
      // irregular: 100, 100, 100, 1200
      ...[100, 100, 100, 1200].map((v, i) =>
        tx({ data: `2026-0${3 + i}-10`, categoria: 'Compras', valor: v })),
    ];
    const r = analisePicosGastos(txs, 4, HOJE);
    expect(r.categorias.find(c => c.categoria === 'Aluguel')!.volatilidade).toBe('estavel');
    expect(r.categorias.find(c => c.categoria === 'Compras')!.volatilidade).toBe('irregular');
  });

  it('separa quanto da categoria é parcela (comprometido)', () => {
    const txs = [
      tx({ data: '2026-03-10', categoria: 'Compras', valor: 300, parcela_atual: 2, parcela_total: 10 }),
      tx({ data: '2026-03-15', categoria: 'Compras', valor: 100 }),
      tx({ data: '2026-04-10', categoria: 'Compras', valor: 300, parcela_atual: 3, parcela_total: 10 }),
      tx({ data: '2026-04-15', categoria: 'Compras', valor: 100 }),
    ];
    const r = analisePicosGastos(txs, 4, HOJE);
    const compras = r.categorias[0];
    expect(compras.total).toBe(800);
    expect(compras.pctParcela).toBe(75); // 600 de 800
  });

  it('ordena por total e calcula % do total do período', () => {
    const txs = [
      tx({ data: '2026-03-10', categoria: 'Alimentação', valor: 1000 }),
      tx({ data: '2026-03-10', categoria: 'Transporte', valor: 500 }),
      tx({ data: '2026-03-10', categoria: 'Lazer', valor: 500 }),
    ];
    const r = analisePicosGastos(txs, 4, HOJE);
    expect(r.categorias[0].categoria).toBe('Alimentação');
    expect(r.categorias[0].pctDoTotal).toBe(50);
    expect(r.totalPeriodo).toBe(2000);
  });

  it('exclui mês corrente, categorias internas e ignorar_dashboard', () => {
    const txs = [
      tx({ data: '2026-03-10', valor: 400 }),
      tx({ data: '2026-07-10', valor: 9999 }),                          // mês corrente
      tx({ data: '2026-04-10', categoria: 'Pagamento Fatura', valor: 5000 }), // interna
      tx({ data: '2026-04-10', valor: 7000, ignorar_dashboard: true }),  // fora do dashboard
      tx({ data: '2026-04-10', tipo: 'receita', valor: 8000 }),          // receita
    ];
    const r = analisePicosGastos(txs, 4, HOJE);
    expect(r.totalPeriodo).toBe(400);
    expect(r.categorias.find(c => c.categoria === 'Pagamento Fatura')).toBeFalsy();
  });

  it('respeita a janela de N meses (pega os mais recentes)', () => {
    const txs = [1, 2, 3, 4, 5, 6].map(m =>
      tx({ data: `2026-0${m}-10`, valor: m * 100 }));
    const r = analisePicosGastos(txs, 4, HOJE);
    expect(r.meses).toEqual(['2026-03', '2026-04', '2026-05', '2026-06']);
    expect(r.totalPeriodo).toBe(300 + 400 + 500 + 600);
  });

  it('sem dados → estrutura vazia sem quebrar', () => {
    const r = analisePicosGastos([], 4, HOJE);
    expect(r.mesesConsiderados).toBe(0);
    expect(r.categorias).toHaveLength(0);
    expect(r.mediaMensal).toBe(0);
    expect(r.excessoTotal).toBe(0);
  });

  it('range explícito manda — permite cortar mês incompleto fora', () => {
    const txs = [
      tx({ data: '2026-03-10', valor: 1000 }),
      tx({ data: '2026-04-10', valor: 1000 }),
      tx({ data: '2026-05-10', valor: 1000 }),
      tx({ data: '2026-06-10', valor: 200 }), // mês com importação incompleta
    ];
    // Sem range: junho entra e derruba a média (3200/4 = 800)
    expect(analisePicosGastos(txs, 4, HOJE).mediaMensal).toBe(800);
    // Com range cortando junho: média volta pro real
    const r = analisePicosGastos(txs, 4, HOJE, { inicio: '2026-03', fim: '2026-05' });
    expect(r.mediaMensal).toBe(1000);
    expect(r.meses).toEqual(['2026-03', '2026-04', '2026-05']);
  });

  it('range explícito pode incluir o mês corrente se o usuário quiser', () => {
    const txs = [
      tx({ data: '2026-06-10', valor: 500 }),
      tx({ data: '2026-07-10', valor: 700 }), // corrente
    ];
    const semRange = analisePicosGastos(txs, 4, HOJE);
    expect(semRange.meses).toEqual(['2026-06']); // corrente excluído por padrão
    const comRange = analisePicosGastos(txs, 4, HOJE, { inicio: '2026-06', fim: '2026-07' });
    expect(comRange.meses).toEqual(['2026-06', '2026-07']);
  });

  it('mês único na janela não inventa pico (sem baseline pra comparar)', () => {
    const txs = [tx({ data: '2026-06-10', valor: 5000 })];
    const r = analisePicosGastos(txs, 4, HOJE);
    expect(r.mesesConsiderados).toBe(1);
    expect(r.categorias[0].picos).toHaveLength(0);
  });

  it('mesesComGasto lista os meses com despesa, ordenados', () => {
    const txs = [
      tx({ data: '2026-05-10' }),
      tx({ data: '2026-03-10' }),
      tx({ data: '2026-03-20' }),
      tx({ data: '2026-04-10', categoria: 'Pagamento Fatura' }), // interna, fora
      tx({ data: '2026-06-10', ignorar_dashboard: true }),        // fora
      tx({ data: '2026-07-10', tipo: 'receita' }),                // fora
    ];
    expect(mesesComGasto(txs)).toEqual(['2026-03', '2026-05']);
  });

  it('lancamentosPorMes bate com o total agregado (mesmo filtro)', () => {
    const txs = [
      tx({ data: '2026-03-05', categoria: 'Compras', descricao: 'Tênis', valor: 300 }),
      tx({ data: '2026-03-20', categoria: 'Compras', descricao: 'Fone', valor: 150, parcela_atual: 2, parcela_total: 6 }),
      tx({ data: '2026-04-05', categoria: 'Compras', descricao: 'Mesa', valor: 500 }),
      tx({ data: '2026-03-05', categoria: 'Alimentação', valor: 999 }), // outra categoria
      tx({ data: '2026-03-05', categoria: 'Compras', valor: 777, ignorar_dashboard: true }), // fora
    ];
    const analise = analisePicosGastos(txs, 4, HOJE);
    const compras = analise.categorias.find(c => c.categoria === 'Compras')!;
    const det = lancamentosPorMes(txs, 'Compras', analise.meses);

    const somaDetalhe = det.reduce((s, m) => s + m.total, 0);
    expect(somaDetalhe).toBe(compras.total); // detalhe NUNCA diverge do total

    const marco = det.find(m => m.mes === '2026-03')!;
    expect(marco.total).toBe(450);
    // ordenado do maior pro menor
    expect(marco.itens.map(i => i.descricao)).toEqual(['Tênis', 'Fone']);
    expect(marco.itens[1].parcela).toBe('2/6');
  });

  it('lancamentosPorMes ignora meses fora da janela', () => {
    const txs = [
      tx({ data: '2026-03-05', categoria: 'Compras', valor: 100 }),
      tx({ data: '2026-04-05', categoria: 'Compras', valor: 200 }),
    ];
    const det = lancamentosPorMes(txs, 'Compras', ['2026-04']);
    expect(det).toHaveLength(1);
    expect(det[0].mes).toBe('2026-04');
    expect(det[0].total).toBe(200);
  });

  it('usa mes_competencia quando existe (compra no cartão cai na fatura)', () => {
    const txs = [
      // comprado em fevereiro, mas competência de junho
      tx({ data: '2026-02-25', mes_competencia: '2026-06', categoria: 'Compras', valor: 900 }),
      tx({ data: '2026-03-10', categoria: 'Compras', valor: 100 }),
    ];
    const r = analisePicosGastos(txs, 4, HOJE);
    const jun = r.totalPorMes.find(m => m.mes === '2026-06');
    expect(jun?.valor).toBe(900);
  });
});
