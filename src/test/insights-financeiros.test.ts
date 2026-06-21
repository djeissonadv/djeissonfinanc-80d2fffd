import { describe, it, expect } from 'vitest';
import { gerarInsights } from '@/lib/insights-financeiros';

function tx(over: Partial<any> = {}): any {
  return {
    data: '2026-01-10', mes_competencia: null, descricao: 'x', valor: 100,
    tipo: 'despesa', categoria: 'Alimentação', categoria_id: null,
    parcela_atual: null, parcela_total: null, grupo_parcela: null,
    ignorar_dashboard: false, essencial: true, conta_id: 'debito1', ...over,
  };
}

describe('gerarInsights', () => {
  it('alerta de juros quando há gasto recorrente em Operação bancária', () => {
    const txs = [
      tx({ data: '2026-01-10', categoria: 'Operação bancária', valor: 200 }),
      tx({ data: '2026-02-10', categoria: 'Operação bancária', valor: 200 }),
    ];
    const r = gerarInsights(txs, [], '2026-03-10');
    const juros = r.find(i => i.id === 'juros');
    expect(juros).toBeTruthy();
    expect(juros!.nivel).toBe('alerta');
    expect(juros!.valor).toBe(200);
  });

  it('dica de débito só aparece quando há juros + gasto no crédito', () => {
    const txs = [
      tx({ data: '2026-01-10', categoria: 'Operação bancária', valor: 200 }),
      tx({ data: '2026-02-10', categoria: 'Operação bancária', valor: 200 }),
      tx({ data: '2026-01-10', categoria: 'Alimentação', valor: 400, conta_id: 'cartao1' }),
      tx({ data: '2026-02-10', categoria: 'Alimentação', valor: 400, conta_id: 'cartao1' }),
    ];
    const r = gerarInsights(txs, ['cartao1'], '2026-03-10');
    expect(r.find(i => i.id === 'credito-essencial')).toBeTruthy();
  });

  it('sem juros, NÃO sugere débito mesmo gastando no crédito', () => {
    const txs = [
      tx({ data: '2026-01-10', categoria: 'Alimentação', valor: 400, conta_id: 'cartao1' }),
      tx({ data: '2026-02-10', categoria: 'Alimentação', valor: 400, conta_id: 'cartao1' }),
    ];
    const r = gerarInsights(txs, ['cartao1'], '2026-03-10');
    expect(r.find(i => i.id === 'credito-essencial')).toBeFalsy();
  });

  it('alerta de sobra negativa quando gasta mais que ganha', () => {
    const txs = [
      tx({ data: '2026-01-05', tipo: 'receita', categoria: 'Salário/Pró-labore', valor: 1000 }),
      tx({ data: '2026-01-10', valor: 1500 }),
      tx({ data: '2026-02-05', tipo: 'receita', categoria: 'Salário/Pró-labore', valor: 1000 }),
      tx({ data: '2026-02-10', valor: 1500 }),
    ];
    const r = gerarInsights(txs, [], '2026-03-10');
    expect(r.find(i => i.id === 'sobra-negativa')).toBeTruthy();
  });

  it('alertas vêm antes de dicas na ordenação', () => {
    const txs = [
      tx({ data: '2026-01-10', categoria: 'Operação bancária', valor: 200 }),
      tx({ data: '2026-02-10', categoria: 'Operação bancária', valor: 200 }),
      tx({ data: '2026-01-10', categoria: 'Assinatura', valor: 100 }),
      tx({ data: '2026-02-10', categoria: 'Assinatura', valor: 100 }),
    ];
    const r = gerarInsights(txs, [], '2026-03-10');
    const idxAlerta = r.findIndex(i => i.nivel === 'alerta');
    const idxDica = r.findIndex(i => i.nivel === 'dica');
    expect(idxAlerta).toBeLessThan(idxDica);
  });
});
