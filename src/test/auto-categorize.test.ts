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
    // Conta corrente (OFX)
    ['RECEBIMENTO PIX-CX497834  50937235000182 ADVERSE PRODUTORA AUDIOVISUAL LTDA', 'Receita Produtora'],
    ['LIQUIDACAO BOLETO SICREDI-600156574 10361115000165 CEOLIN ADMINISTRACAO DE IMOVEI', 'Casa'],
    ['PAGAMENTO PIX-PIX_DEB   02016440000162 RGE', 'Casa'],
    ['LIQUIDACAO BOLETO-          19791896000283 SUPERGASBRAS ENERGIA LTDA', 'Casa'],
    ['LIQUIDACAO BOLETO-          00360305000104 GCI CAIXA   HABITACAO', 'Casa'],
    ['AMORTIZACAO CONTRATO-C5A920011 ', 'Empréstimos'],
    ['APLICACAO POUPANCA-SOBRAS_CP ', 'Investimentos'],
    ['COMPRA DEBITO MASTER-CM0436559 MTD AmorSaude Passo Fu   Passo Fundo  BR', 'Saúde'],
    // Fixes de padrões truncados
    ['COTRISAL SUPERMERCAD', 'Alimentação'],
    ['NH COMERCIO DE COSM', 'Beleza'],
    // Vestuário / outros novos
    ['FEIRA DE CALCADOS', 'Vestuário'],
    ['ZAFFARI 09', 'Alimentação'],
    ['ORGANIZZE TE ORGANI', 'Assinatura'],
    ['PEDU RESTAURANTE', 'Alimentação'],
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
