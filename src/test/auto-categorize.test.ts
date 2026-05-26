import { describe, it, expect } from 'vitest';
import { autoCategorizarTransacao } from '@/lib/auto-categorize';

describe('autoCategorizarTransacao — padrões do usuário', () => {
  const casos: [string, string][] = [
    // Alimentação
    ['MIX CENTER             PASSO FUNDO   BRA', 'Alimentação'],
    ['MINIMARKET', 'Alimentação'],
    ['MERCADO MOY            PASSO FUNDO   BRA', 'Alimentação'],
    ['DOCE MANIA DISTRIB DE  PASSO FUNDO   BRA', 'Alimentação'],
    ['QUESTO GASTRONOMIA LTD PASSO FUNDO   BRA', 'Alimentação'],
    ['IFD*CAFE PREMIUM PF DE PASSO FUNDO   BRA', 'Alimentação'],
    ['IFD PARZIANELLO  CAP', 'Alimentação'],
    ['Amo*Dona Augusta - Pas Passo Fundo   BRA', 'Alimentação'],
    ['STOK CENTER 20', 'Alimentação'], // movido de Casa
    ['TOP MAIS PASSO FUNDO   SARANDI       BRA', 'Alimentação'],
    // Transporte
    ['99APP        99App', 'Transporte'],
    ['MECANICA TONI LTDA', 'Transporte'],
    ['TAURA AUTO PECAS', 'Transporte'],
    ['AUTO ABASTECEDORA PA', 'Transporte'],
    ['CIDADE NOVA CAR WASH', 'Transporte'],
    // Saúde
    ['Cartao de TODOS mai', 'Saúde'],
    ['PANVEL FARMACIAS PASSO FUNDO BR', 'Saúde'],
    // Beleza
    ['DECADA BARBEARIA CLASS PASSO FUNDO   BRA', 'Beleza'],
    // Já existentes (regressão)
    ['NETFLIX COM', 'Assinatura'],
    ['CONTA VIVO             SAO PAULO     BRA', 'Serviços'],
    ['FARMACIA SAO JOAO', 'Saúde'],
  ];

  for (const [desc, esperado] of casos) {
    it(`"${desc}" → ${esperado}`, () => {
      expect(autoCategorizarTransacao(desc)).toBe(esperado);
    });
  }
});
