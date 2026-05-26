import { describe, it, expect } from 'vitest';
import {
  projectFutureInstallments,
  detectConflicts,
  type ProjectableTransaction,
} from '@/lib/installment-projection';

function parcela(over: Partial<ProjectableTransaction>): ProjectableTransaction {
  return {
    data: '2026-01-15',
    descricao: 'LOJA TESTE',
    valor: 100,
    tipo: 'despesa',
    parcela_atual: 1,
    parcela_total: 3,
    pessoa: 'Djeisson',
    hash_transacao: 'h-jan-01',
    categoria: 'Compras',
    essencial: false,
    conta_id: 'card1',
    user_id: 'u1',
    data_original: '2026-01-15',
    mes_competencia: '2026-01',
    grupo_parcela: 'g1',
    ...over,
  };
}

// Converte planned -> formato "existing" do banco. A descrição é usada como está:
// projeções já vêm com "(auto-projetada)" do projectFutureInstallments.
function toExisting(list: any[]) {
  return list.map((t, i) => ({
    id: `e${i}`,
    descricao: t.descricao,
    valor: t.valor,
    data: t.data,
    data_original: t.data_original,
    mes_competencia: t.mes_competencia,
    parcela_atual: t.parcela_atual,
    parcela_total: t.parcela_total,
    pessoa: t.pessoa,
    hash_transacao: t.hash_transacao,
  }));
}

describe('reimport de parcelamento de cartão (parcelas projetadas)', () => {
  it('projeta as parcelas futuras com mes_competencia avançado', () => {
    const proj = projectFutureInstallments([parcela({})]);
    // 01/03 importada → projeta 02/03 (fev) e 03/03 (mar)
    expect(proj.length).toBe(2);
    expect(proj.map(p => p.parcela_atual).sort()).toEqual([2, 3]);
    expect(proj.find(p => p.parcela_atual === 2)?.mes_competencia).toBe('2026-02');
    expect(proj.find(p => p.parcela_atual === 3)?.mes_competencia).toBe('2026-03');
  });

  it('reimportar a MESMA fatura não duplica (original + projetadas)', () => {
    const originals = [parcela({})];
    const projected = projectFutureInstallments(originals);
    const all = [...originals, ...projected];
    const existing = toExisting(all);
    const r = detectConflicts(all as any, existing as any);
    expect(r.clean.length).toBe(0);
  });

  it('mês seguinte: a parcela 02/03 REAL substitui a 02/03 projetada (não duplica)', () => {
    // Mês 1: importa 01/03 e projeta 02/03 (fev) e 03/03 (mar)
    const mes1 = [parcela({})];
    const proj1 = projectFutureInstallments(mes1);
    const existing = toExisting([...mes1, ...proj1]);

    // Mês 2: chega a parcela 02/03 REAL (fatura de fevereiro), hash diferente
    const real0203 = parcela({
      parcela_atual: 2,
      data: '2026-02-15',
      data_original: '2026-01-15',
      mes_competencia: '2026-02',
      hash_transacao: 'h-fev-02',
    });
    const mes2 = [real0203];
    const proj2 = projectFutureInstallments(mes2); // projeta 03/03 de novo (mar)
    const planned2 = [...mes2, ...proj2];

    const r = detectConflicts(planned2 as any, existing as any);

    // A 02/03 real deve substituir a projetada (autoReplacement), não entrar como nova
    const realNasNovas = r.clean.some((c: any) => !('_isProjected' in c) && c.parcela_atual === 2);
    expect(realNasNovas).toBe(false);
    const substituida = r.autoReplacements.some((a: any) => a.planned.parcela_atual === 2 && !('_isProjected' in a.planned));
    expect(substituida).toBe(true);
  });
});
