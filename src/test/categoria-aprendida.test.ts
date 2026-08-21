import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCategoriaAprendida, aprenderCategoria, esquecerCategoria, _resetCacheParaTeste,
} from '@/lib/categoria-aprendida';
import { autoCategorizarTransacao } from '@/lib/auto-categorize';

beforeEach(() => {
  localStorage.clear();
  _resetCacheParaTeste();
});

describe('categoria-aprendida', () => {
  it('aprende e recupera pela mesma descrição', () => {
    aprenderCategoria('PADARIA DO ZE LTDA', 'Alimentação');
    expect(getCategoriaAprendida('PADARIA DO ZE LTDA')).toBe('Alimentação');
  });

  it('normaliza: casa apesar de números, datas e pontuação diferentes', () => {
    aprenderCategoria('MERCADOLIVRE*ABC 3/10', 'Compras');
    // mesma loja, parcela diferente e sem o "*"
    expect(getCategoriaAprendida('MERCADOLIVRE ABC 7/10')).toBe('Compras');
    expect(getCategoriaAprendida('mercadolivre abc')).toBe('Compras');
  });

  it('descrições diferentes não se misturam', () => {
    aprenderCategoria('POSTO IPIRANGA', 'Transporte');
    expect(getCategoriaAprendida('SUPERMERCADO X')).toBeNull();
  });

  it('esquecer volta pro automático', () => {
    aprenderCategoria('LOJA Y', 'Casa');
    esquecerCategoria('LOJA Y');
    expect(getCategoriaAprendida('LOJA Y')).toBeNull();
  });

  it('persiste no localStorage entre "sessões" (novo cache)', () => {
    aprenderCategoria('ACADEMIA SMART FIT', 'Saúde');
    _resetCacheParaTeste(); // simula recarregar a página
    expect(getCategoriaAprendida('ACADEMIA SMART FIT')).toBe('Saúde');
  });
});

describe('autoCategorizarTransacao respeita o aprendizado', () => {
  it('aprendizado tem prioridade sobre a regra fixa', () => {
    // "NETFLIX" cairia em Assinatura pela regra fixa
    expect(autoCategorizarTransacao('NETFLIX.COM')).toBe('Assinatura');
    // usuário corrige pra Lazer → passa a valer
    aprenderCategoria('NETFLIX.COM', 'Lazer');
    expect(autoCategorizarTransacao('NETFLIX.COM')).toBe('Lazer');
  });

  it('permite marcar algo como Transferência entre contas e aprender', () => {
    const desc = 'PIX ENVIADO FULANO DE TAL';
    aprenderCategoria(desc, 'Transferência entre contas');
    expect(autoCategorizarTransacao(desc)).toBe('Transferência entre contas');
  });
});
