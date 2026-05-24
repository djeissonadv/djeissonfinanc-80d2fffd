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
});
