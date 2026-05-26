/**
 * Dictionary-based auto-categorization for financial transactions.
 * Returns category name or null if no match found.
 *
 * IMPORTANTE: todas as categorias usadas aqui devem existir em
 * CATEGORIAS_CONFIG (src/types/database.types.ts). Não crie nomes novos
 * sem atualizar CATEGORIAS_CONFIG primeiro — caso contrário você vai
 * reintroduzir duplicatas como "Assinatura" vs "Assinaturas".
 */

import { CATEGORIAS_CONFIG } from '@/types/database.types';

interface CategoriaRule {
  patterns: string[];
  categoria: string;
}

const RULES: CategoriaRule[] = [
  // PAGAMENTO DE FATURA
  { patterns: ['PAGTO FATURA', 'PAGAMENTO FATURA', 'PAGTO FAT', 'PAG FATURA'], categoria: 'Operação bancária' },

  // EMPRÉSTIMOS
  { patterns: ['LIQUIDACAO DE PARCELA', 'LIQUIDAÇÃO DE PARCELA', 'PARCELA-C5A', 'AMORTIZACAO CONTRATO', 'AMORTIZAÇÃO CONTRATO'], categoria: 'Empréstimos' },

  // TARIFAS / OPERAÇÕES BANCÁRIAS
  { patterns: ['IOF BASICO', 'IOF ADICIONAL', 'IOF COMPRA', 'CESTA DE RELACIONAMENTO', 'INTEGR.CAPITAL SUBSCRITO', 'INTEGRCAPITAL SUBSCRITO', 'JUROS UTILIZ', 'MENSALID TAG'], categoria: 'Operação bancária' },

  // IMPOSTOS → Transporte (categoria canônica que abarca impostos de veículo/IPVA)
  { patterns: ['RECEITA FEDERAL', 'ARRECADACAO ESTADUAL', 'IPVA', 'DETRAN', 'DPVAT'], categoria: 'Transporte' },

  // INVESTIMENTOS (receita / poupança / sobras da cooperativa)
  { patterns: ['TORO INVESTIMEN', 'TORO INVEST', 'XP INVEST', 'CLEAR CORRET', 'APLICACAO POUPANCA', 'DISTRIBUICAO RESULTADOS'], categoria: 'Investimentos' },

  // RECEITA DA PRODUTORA — precede o PIX genérico (a memo tem "RECEBIMENTO PIX ... ADVERSE")
  { patterns: ['ADVERSE PRODUTORA', 'ADVERSE'], categoria: 'Receita Produtora' },

  // SEGURO DE VIDA → Saúde
  { patterns: ['PRUDENTIAL'], categoria: 'Saúde' },

  // SEGURO DO CARRO → Transporte
  { patterns: ['SUICA SEGURAD', 'ASAASIP*SUICA', 'ASAAS*SUICA', 'ASAASIPSUICA', 'ASAASSUICA'], categoria: 'Transporte' },

  // ASSINATURA
  { patterns: ['NETFLIX', 'SPOTIFY', 'AMAZON PRIME', 'YOUTUBE PREMIUM', 'YOUTUBE PREMI', 'APPLECOMBILL', 'APPLE.COM', 'APPLECOM', 'BUDGI', 'PIXIESET', 'GODADDY', 'BRASIL PARAL', 'BRASILPAR', 'KIWIFY', 'HOTMART', 'ORGANIZZE', 'MELIMAIS', 'MELI MAIS'], categoria: 'Assinatura' },

  // EDUCAÇÃO
  { patterns: ['HTM*SIMONE', 'HTMSIMONE', 'SIMONE DE OLIVE', 'CURSO', 'ESCOLA', 'FACULDADE', 'MENTORIA'], categoria: 'Educação' },

  // TELECOM → Serviços
  { patterns: ['CONTA VIVO', 'COPREL TELECOM', 'VIVO', 'CLARO TELECOM', 'TIM CELULAR', 'TIM S.A', 'TIM SA', 'TIM *'], categoria: 'Serviços' },

  // SAÚDE
  { patterns: ['FARMACIA', 'FARMACIAS', 'SAO JOAO FARMACIAS', 'PANVEL', 'DROGARIA', 'CONSULTORIO', 'DR FBS', 'ROSELI MAGALHAES', 'CARTAO DE TODOS', 'CARTAODETODO', 'NATUPHARMA', 'AMORSAUDE', 'AMOR SAUDE', 'ODONTO', 'HOSPITAL'], categoria: 'Saúde' },

  // BELEZA
  { patterns: ['OBOTICARIO', 'HNA*OBOTICARIO', 'HNAOBOTICARIO', 'LETICIA MUNIZ', 'NH COMERCIO', 'BEAUTY', 'ESTETICA', 'BARBEARIA', 'DECADA BARBEARIA'], categoria: 'Beleza' },

  // VESTUÁRIO (calçados/roupas)
  { patterns: ['CALCADOS', 'PITTOL', 'FEIRA DE CALCADOS'], categoria: 'Vestuário' },

  // MORADIA / CONTAS DA CASA → Casa (aluguel, condomínio, energia, gás)
  { patterns: ['CEOLIN ADMINISTRACAO', 'RESIDENCIAL PORTO SEGURO', 'ZOOP BRASIL', 'CONDOMINIO', 'ALUGUEL', 'SUPERGASBRAS', '02016440000162', 'CAIXA HABITACAO', 'ARMAZEM DA UTILIDADE', 'SEMPRE UTIL'], categoria: 'Casa' },

  // COMBUSTÍVEL → Transporte
  { patterns: ['PF CIDADE NOVA'], categoria: 'Transporte' },

  // TRANSPORTE (apps, oficina, peças, combustível, lava-jato)
  { patterns: ['PASSAGEM PEDAGIO', 'PEDAGIO', 'MENSALID TAG DE PASSAGEM', 'LAPAZA EMPREEND', '99APP', 'UBER', 'MECANICA', 'AUTO PECAS', 'ABASTECEDORA', 'CAR WASH', 'LAVA JATO', 'POSTO ', 'TAURA AUTO', 'CLOUDPARK', 'ESTACIONAMENTO'], categoria: 'Transporte' },

  // COMPRAS (online)
  { patterns: ['MERCADOLIVRE', 'MERCADO*MERCAD', 'MERCADOMERCAD', 'MERCADO*RICO', 'MERCADORICO', 'MERCADO*15PROD', 'MERCADO15PROD', 'SHOPEE', 'HAVAN', 'SHEIN', 'SITE HAVAN', 'COMAXCASA', 'MERLIN MAT', 'NOVACOR', 'NOVA COR'], categoria: 'Compras' },

  // ALIMENTAÇÃO (mercado/atacarejo, restaurantes, delivery, padaria)
  { patterns: ['MIX CENTER', 'FRUTEIRA TERRIBILE', 'COTRISAL', 'SUPERMERCADO', 'ZAFFARI', 'STOK CENTER', 'TOP MAIS', 'MINIMARKET', 'MERCADO MOY', 'DOCE MANIA', '212 BISTRO', 'QUESTO GASTRONOMIA', 'IFOOD', 'IFD*', 'CAFE PREMIUM', 'DONA AUGUSTA', 'AMO RESTAURANTE', 'AMO CABANA', 'RESTAURANTE', 'ALASSIO CAFE', 'CAFE E PROSA', 'CONVENIENCIA', 'QUIERO CAFE', 'PADARIA'], categoria: 'Alimentação' },

  // RECEITA → Outras receitas (catch-all)
  { patterns: ['RECEBIMENTO PIX', 'PIX SICREDI', 'VERTATTO NEGOCIOS'], categoria: 'Outras receitas' },

  // COMPRAS GENÉRICAS (Mercado Pago catch-all)
  { patterns: ['MP *', 'MP*', 'MERPAG*', 'MERCADOPAGO*'], categoria: 'Compras' },
];

/**
 * Normalize description for matching (same logic as dedup but without truncation).
 */
function normalizeForMatch(desc: string): string {
  return desc
    .toUpperCase()
    .replace(/\s{2,}/g, ' ')
    .trim()
    // Remove trailing city/state patterns
    .replace(/\s+[A-Z]{2,3}\s*$/, '')
    .replace(/\s{2,}[A-Z\s]+$/, '')
    .trim();
}

/**
 * Auto-categorize a transaction based on its description.
 * Returns category name or null if no match.
 */
export function autoCategorizarTransacao(descricao: string): string | null {
  const normalized = normalizeForMatch(descricao);
  // Also create a version without special chars for matching patterns that had * or .
  const normalizedClean = normalized.replace(/[^A-Z0-9 ]/g, '').replace(/\s{2,}/g, ' ').trim();

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const patternUpper = pattern.toUpperCase();
      // Also create clean version of pattern
      const patternClean = patternUpper.replace(/[^A-Z0-9 ]/g, '').replace(/\s{2,}/g, ' ').trim();

      // For short patterns (<=4 chars after cleaning), require word boundary to avoid false positives
      if (patternClean.length <= 4) {
        const wordBoundaryRegex = new RegExp(`(^|\\s)${patternClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
        if (wordBoundaryRegex.test(normalizedClean)) {
          return rule.categoria;
        }
      } else if (normalized.includes(patternUpper) || normalizedClean.includes(patternClean)) {
        return rule.categoria;
      }
    }
  }

  return null;
}

/**
 * Canonical list of categories — derived de CATEGORIAS_CONFIG para garantir
 * fonte única da verdade (nenhum nome novo deve ser introduzido aqui).
 */
export const REQUIRED_CATEGORIES: string[] = Object.keys(CATEGORIAS_CONFIG);

/**
 * Default colors — também derivado de CATEGORIAS_CONFIG.
 */
export const CATEGORY_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORIAS_CONFIG).map(([nome, cfg]) => [nome, cfg.cor])
);
