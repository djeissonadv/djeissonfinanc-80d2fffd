import { describe, it, expect } from 'vitest';
import { detectConflicts, type ProjectableTransaction } from '@/lib/installment-projection';

function planned(over: Partial<ProjectableTransaction> = {}): ProjectableTransaction {
  return {
    data: '2026-05-10',
    descricao: 'SUPERMERCADO XYZ',
    valor: 100,
    tipo: 'despesa',
    parcela_atual: null,
    parcela_total: null,
    pessoa: 'Djeisson',
    hash_transacao: 'novohash',
    categoria: 'Alimentação',
    essencial: true,
    conta_id: 'c1',
    user_id: 'u1',
    data_original: '2026-05-10',
    mes_competencia: null,
    grupo_parcela: null,
    ...over,
  };
}

function existing(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    descricao: 'SUPERMERCADO XYZ',
    valor: 100,
    data: '2026-05-10',
    data_original: '2026-05-10',
    mes_competencia: null,
    parcela_atual: null,
    parcela_total: null,
    pessoa: 'Djeisson',
    hash_transacao: 'hashantigo', // hash diferente do planned (algoritmo/origem distinta)
    ...over,
  };
}

describe('detectConflicts — dedup independente de hash', () => {
  it('auto-pula duplicata forte (mesma desc/valor/data) mesmo com hash diferente', () => {
    const r = detectConflicts([planned()], [existing()]);
    expect(r.exactMatches).toHaveLength(1);
    expect(r.clean).toHaveLength(0);
    expect(r.conflicts).toHaveLength(0);
  });

  it('tolera variação leve de texto (fonte garbled) via esqueleto normalizado', () => {
    const r = detectConflicts([planned({ descricao: 'SUPERMERCADO  XYZ!!' })], [existing()]);
    expect(r.exactMatches).toHaveLength(1);
  });

  it('data deslocada poucos dias vira conflito (não duplicata silenciosa)', () => {
    const r = detectConflicts([planned({ data: '2026-05-13', data_original: '2026-05-13' })], [existing()]);
    expect(r.conflicts).toHaveLength(1);
    expect(r.clean).toHaveLength(0);
  });

  it('mesma desc/valor em data distante é transação diferente (clean)', () => {
    const r = detectConflicts([planned({ data: '2026-05-28', data_original: '2026-05-28' })], [existing()]);
    expect(r.clean).toHaveLength(1);
    expect(r.conflicts).toHaveLength(0);
    expect(r.exactMatches).toHaveLength(0);
  });

  it('match por hash exato continua funcionando (caminho rápido)', () => {
    const r = detectConflicts([planned({ hash_transacao: 'hashantigo' })], [existing()]);
    expect(r.exactMatches).toHaveLength(1);
  });

  it('valor bem diferente na mesma data não é duplicata', () => {
    const r = detectConflicts([planned({ valor: 250 })], [existing()]);
    expect(r.clean).toHaveLength(1);
    expect(r.exactMatches).toHaveLength(0);
  });

  it('lançamento real substitui a recorrente auto-projetada do mesmo mês (autoReplacement)', () => {
    const proj = existing({
      id: 'proj1',
      descricao: 'NETFLIX.COM (auto-projetada)',
      valor: 55,
      data: '2026-08-10',
      data_original: '2026-08-10',
      hash_transacao: 'projhash',
    });
    const real = planned({
      descricao: 'NETFLIX.COM',
      valor: 59.9, // variou um pouco
      data: '2026-08-12',
      data_original: '2026-08-12',
      hash_transacao: 'realhash',
    });
    const r = detectConflicts([real], [proj]);
    expect(r.autoReplacements).toHaveLength(1);
    expect(r.autoReplacements[0].existingId).toBe('proj1');
    expect(r.clean).toHaveLength(0);
  });

  it('reimport da mesma fatura: mesma competência + desc + valor → pula, mesmo com data (ano) diferente', () => {
    // 1º import: MP inferiu ano 2025 pra compra DD/MM; 2º import inferiu 2026.
    const proj = existing({
      id: 'f1',
      descricao: 'MERCADOLIVRE COMPRA',
      valor: 100,
      data: '2025-04-07',
      data_original: '2025-04-07',
      mes_competencia: '2026-03',
      hash_transacao: 'hashA',
    });
    const real = planned({
      descricao: 'MERCADOLIVRE COMPRA',
      valor: 100,
      data: '2026-04-07',
      data_original: '2026-04-07',
      mes_competencia: '2026-03',
      hash_transacao: 'hashB',
    });
    const r = detectConflicts([real], [proj]);
    expect(r.exactMatches).toHaveLength(1);
    expect(r.clean).toHaveLength(0);
  });

  it('mesma desc/valor em competência diferente NÃO é tratada como duplicata pela regra de fatura', () => {
    const e1 = existing({ id: 'a', descricao: 'NETFLIX', valor: 59.9, mes_competencia: '2026-02', data: '2026-02-28', data_original: '2026-02-28', hash_transacao: 'h1' });
    const real = planned({ descricao: 'NETFLIX', valor: 59.9, mes_competencia: '2026-03', data: '2026-03-31', data_original: '2026-03-31', hash_transacao: 'h2' });
    const r = detectConflicts([real], [e1]);
    expect(r.exactMatches).toHaveLength(0);
    expect(r.clean).toHaveLength(1);
  });

  it('não substitui recorrente projetada de outro mês', () => {
    const proj = existing({
      id: 'proj1',
      descricao: 'NETFLIX (auto-projetada)',
      valor: 55,
      data: '2026-09-10',
      data_original: '2026-09-10',
      hash_transacao: 'projhash',
    });
    const real = planned({ descricao: 'NETFLIX', valor: 55, data: '2026-08-10', data_original: '2026-08-10' });
    const r = detectConflicts([real], [proj]);
    expect(r.autoReplacements).toHaveLength(0);
    expect(r.clean).toHaveLength(1);
  });
});
