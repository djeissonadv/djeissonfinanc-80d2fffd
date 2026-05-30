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
  // SALÁRIO / PRÓ-LABORE — receitas recorrentes nominadas (seed do app cria
  // "Salário Djêisson" e "Salário Maiara"). Vem ANTES das demais pra não cair em
  // catch-all genérico.
  { patterns: ['SALÁRIO ', 'SALARIO ', 'PRÓ-LABORE', 'PRO-LABORE', 'PROLABORE'], categoria: 'Salário/Pró-labore' },

  // TRANSFERÊNCIA ENTRE CONTAS — PIX/transferências entre os cônjuges (MAIARA ↔
  // DJEISSON) e entre contas próprias. NÃO é despesa nem receita real — é
  // movimentação interna. O insert/recategorize também marca ignorar_dashboard=true
  // pra não inflar totais do mês.
  //
  // Identificadores únicos: nomes completos OU CPFs conhecidos (54.447.569 =
  // Maiara CNPJ, 04409382012 = Maiara CPF, 03885096005 = Djeisson CPF).
  // Vem MUITO CEDO na lista pra preceder qualquer regra de PIX genérico.
  {
    patterns: [
      'MAIARA PEREIRA MARTINS',
      'MAIARA P MARTINS',
      'MAIARA MARTINS',
      'DJEISSON ALAN MAUSS',
      'DJÊISSON ALAN MAUSS',
      'DJEISSON A MAUSS',
      '54447569000129',
      '54.447.569',
      '04409382012',
      '03885096005',
    ],
    categoria: 'Transferência entre contas',
  },

  // PAGAMENTO DE FATURA / CARTÃO / TRANSFERÊNCIA PRO MP (saída da conta, não é consumo)
  // Obs: o PIX pro "MERCADO PAGO INSTITUICAO" é uma mistura (fatura do cartão e
  // parcela do empréstimo MP) — não dá pra distinguir pelo texto, então fica como
  // Operação bancária pra não virar gasto falso. Vem ANTES do catch-all 'MERCADOPAGO*'.
  { patterns: ['PAGTO FATURA', 'PAGAMENTO FATURA', 'PAGTO FAT', 'PAG FATURA', 'PAG FAT DEB', 'PARCELA DA FATURA', 'MERCADO PAGO INSTITUICAO', '10573521000191'], categoria: 'Operação bancária' },

  // ROTATIVO / JUROS / MULTA / TARIFAS do cartão (linhas internas das faturas)
  { patterns: ['JUROS DO ROTATIVO', 'JUROS DE MORA', 'JUROS DO CHEQUE', 'MULTA POR ATRASO', 'IOF DO ROTATIVO', 'IOF DE ATRASO', 'IOF S/ OPER', 'IOF S OPER', 'SEGURO PRESTAMISTA'], categoria: 'Operação bancária' },

  // SEGURO DE VIDA (variações sem completar o "PRUDENTIAL")
  { patterns: ['PRUDENT APOL', 'PRUDENT *', 'PRUDENT'], categoria: 'Saúde' },

  // SEGURO DO CARRO — formato Asaas que carrega o número do cliente
  { patterns: ['ASA*SUICA SEGURAD', 'ASA SUICA', 'ASAAS SUICA SEGURAD'], categoria: 'Transporte' },

  // CONVÊNIOS DEDUZIDOS DA CONTA (plano de saúde/cooperativa)
  { patterns: ['DEBITO CONVENIOS', 'PMSARAN', 'UNIMED', 'AMIL', 'BRADESCO SAUDE'], categoria: 'Saúde' },

  // FINANCEIRAS / EMPRÉSTIMOS — PIX a financeiras
  { patterns: ['REALIZE CREDITO', 'REALIZE CRED', 'CREFISA', 'BMG CONSIGNADO', 'BMG FACTA'], categoria: 'Empréstimos' },

  // TELECOM extra (PIX/boleto pra operadora)
  { patterns: ['TELEFONICA BRAS', 'TELEFONICA', 'OI CELULAR', 'OI S.A'], categoria: 'Serviços' },

  // E-COMMERCE marketplace adicional (variantes que não casaram)
  { patterns: ['MERCADO MERCADOLIVR', 'MERCADO RICOFERRAGE', 'MERCADO RICO', '5PRODUTOS', '14PRODUTOS', '15PRODU', 'MP 5PRODUTOS', 'MP 14PRODUTOS', 'ALI GESTAO', 'ALIEXPRESS', 'ALI EXPRESS'], categoria: 'Compras' },

  // SERVIÇOS GENÉRICOS
  { patterns: ['ARRANJOS EXPRESS', 'COSTUREIRA', 'CHAVEIRO'], categoria: 'Serviços' },

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

  // ASSINATURA — apps/sites pagos recorrentes
  { patterns: ['NETFLIX', 'SPOTIFY', 'AMAZON PRIME', 'YOUTUBE PREMIUM', 'YOUTUBE PREMI', 'GOOGLE YOUTUBE', 'APPLECOMBILL', 'APPLE.COM', 'APPLECOM', 'APPLE COM/BILL', 'APPLE COM', 'BUDGI', 'PIXIESET', 'GODADDY', 'DM GODADDY', 'DM      GODADDY', 'BRASIL PARAL', 'BRASILPAR', 'BRASIL PARAL*', 'KIWIFY', 'HOTMART', 'ORGANIZZE', 'MELIMAIS', 'MELI MAIS', 'DL*GOOGLE', 'DLGOOGLE', 'PG *BRAIP', 'PG *GUIAEXCEL', 'PG *PP NATU', 'PG TORO INVEST', 'EBN*ADOBE', 'EBN ADOBE'], categoria: 'Assinatura' },

  // PRODUTORA (Adverse) — ferramentas/serviços de produção audiovisual usados
  // como custo direto do trabalho. Vem ANTES das catch-alls de Compras.
  { patterns: ['ADOBE *ADOBE', 'ADOBE *', 'ADOBE*', 'ALBOOM PHOTOGRAPHER', 'ALBOOM', 'CANVA', 'FRAME.IO', 'FRAMEIO', 'DAVINCI RESOLVE', 'BLACKMAGIC'], categoria: 'Produtora' },

  // EDUCAÇÃO
  { patterns: ['HTM*SIMONE', 'HTMSIMONE', 'SIMONE DE OLIVE', 'CURSO', 'ESCOLA', 'FACULDADE', 'MENTORIA'], categoria: 'Educação' },

  // TELECOM → Serviços
  { patterns: ['CONTA VIVO', 'COPREL TELECOM', 'VIVO', 'CLARO TELECOM', 'TIM CELULAR', 'TIM S.A', 'TIM SA', 'TIM *'], categoria: 'Serviços' },

  // SAÚDE
  { patterns: ['FARMACIA', 'FARMACIAS', 'SAO JOAO FARMACIAS', 'PANVEL', 'DROGARIA', 'CONSULTORIO', 'DR FBS', 'ROSELI MAGALHAES', 'CARTAO DE TODOS', 'CARTAODETODO', 'NATUPHARMA', 'AMORSAUDE', 'AMOR SAUDE', 'ODONTO', 'HOSPITAL'], categoria: 'Saúde' },

  // BELEZA
  { patterns: ['OBOTICARIO', 'HNA*OBOTICARIO', 'HNAOBOTICARIO', 'LETICIA MUNIZ', 'NH COMERCIO', 'BEAUTY', 'ESTETICA', 'BARBEARIA', 'DECADA BARBEARIA'], categoria: 'Beleza' },

  // SAÚDE — óticas/lentes (precede o Compras genérico)
  { patterns: ['99 OTICAS', '99OTICAS', 'OTICA ', 'OPTICA '], categoria: 'Saúde' },

  // VESTUÁRIO (calçados/roupas)
  { patterns: ['CALCADOS', 'PITTOL', 'FEIRA DE CALCADOS'], categoria: 'Vestuário' },

  // MORADIA / CONTAS DA CASA → Casa (aluguel, condomínio, energia, gás)
  { patterns: ['CEOLIN ADMINISTRACAO', 'RESIDENCIAL PORTO SEGURO', 'ZOOP BRASIL', 'CONDOMINIO', 'ALUGUEL', 'SUPERGASBRAS', '02016440000162', 'CAIXA HABITACAO', 'ARMAZEM DA UTILIDADE', 'SEMPRE UTIL'], categoria: 'Casa' },

  // COMBUSTÍVEL → Transporte
  { patterns: ['PF CIDADE NOVA'], categoria: 'Transporte' },

  // TRANSPORTE (apps, oficina, peças, combustível, lava-jato)
  { patterns: ['PASSAGEM PEDAGIO', 'PEDAGIO', 'MENSALID TAG DE PASSAGEM', 'LAPAZA EMPREEND', '99APP', 'UBER', 'MECANICA', 'AUTO PECAS', 'ABASTECEDORA', 'CAR WASH', 'LAVA JATO', 'POSTO ', 'TAURA AUTO', 'CLOUDPARK', 'ESTACIONAMENTO'], categoria: 'Transporte' },

  // COMPRAS (online + lojas)
  { patterns: ['MERCADOLIVRE', 'MERCADO*MERCAD', 'MERCADOMERCAD', 'MERCADO*RICO', 'MERCADORICO', 'MERCADO*15PROD', 'MERCADO15PROD', 'SHOPEE', 'HAVAN', 'SHEIN', 'SITE HAVAN', 'COMAXCASA', 'MERLIN MAT', 'NOVACOR', 'NOVA COR', 'EC *5PRODUTOS', 'EC*5PRODUTOS', 'MP *5PRODUTOS', 'MP*5PRODUTOS', '5PRODUTOS', 'MIMI BIJUTERIAS', 'PAPELITA'], categoria: 'Compras' },

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
