import { describe, it, expect } from 'vitest';
import { detectarDuplicatas } from '@/lib/duplicatas';

describe('detectarDuplicatas', () => {
  it('detecta duplicata por hash igual', () => {
    const txs = [
      { id: '1', descricao: 'X', valor: 100, data: '2026-06-01', hash_transacao: 'h1' },
      { id: '2', descricao: 'X', valor: 100, data: '2026-06-02', hash_transacao: 'h1' },
    ];
    const grupos = detectarDuplicatas(txs);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].txIds).toEqual(['1', '2']);
  });

  it('detecta duplicata por descrição + valor + mês', () => {
    const txs = [
      { id: '1', descricao: 'Mercado X', descricao_normalizada: 'MERCADO X', valor: 50, data: '2026-06-01', hash_transacao: null },
      { id: '2', descricao: 'Mercado X', descricao_normalizada: 'MERCADO X', valor: 50, data: '2026-06-05', hash_transacao: null },
    ];
    const grupos = detectarDuplicatas(txs);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].txIds.length).toBe(2);
  });

  it('NÃO marca parcelas legítimas (valores iguais em meses diferentes)', () => {
    const txs = [
      { id: '1', descricao: 'PARC 1/12', descricao_normalizada: 'PARC', valor: 100, data: '2026-01-15' },
      { id: '2', descricao: 'PARC 2/12', descricao_normalizada: 'PARC', valor: 100, data: '2026-02-15' },
    ];
    const grupos = detectarDuplicatas(txs);
    expect(grupos).toHaveLength(0); // meses diferentes — não conta
  });

  it('NÃO marca lançamento único', () => {
    const txs = [
      { id: '1', descricao: 'Único', valor: 100, data: '2026-06-01', hash_transacao: 'h1' },
    ];
    expect(detectarDuplicatas(txs)).toHaveLength(0);
  });

  it('agrupa 3 txs iguais num grupo só, não 3 grupos', () => {
    const txs = [
      { id: '1', descricao: 'X', descricao_normalizada: 'X', valor: 50, data: '2026-06-01' },
      { id: '2', descricao: 'X', descricao_normalizada: 'X', valor: 50, data: '2026-06-05' },
      { id: '3', descricao: 'X', descricao_normalizada: 'X', valor: 50, data: '2026-06-10' },
    ];
    const grupos = detectarDuplicatas(txs);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].txIds.length).toBe(3);
  });
});
