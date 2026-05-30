export interface Configuracao {
  id: string;
  user_id: string;
  receita_mensal_fixa: number;
  reserva_minima: number;
  created_at: string;
  updated_at: string;
}

export interface Conta {
  id: string;
  user_id: string;
  nome: string;
  tipo: 'credito' | 'debito';
  saldo_inicial: number;
  data_abertura: string;
  banco: string;
  codigo_banco: string;
  agencia: string;
  numero_conta: string;
  created_at: string;
}

export interface Transacao {
  id: string;
  user_id: string;
  conta_id: string;
  data: string;
  data_original: string | null;
  mes_competencia: string | null;
  descricao: string;
  valor: number;
  categoria: string;
  subcategoria?: string | null;
  tipo: 'receita' | 'despesa';
  essencial: boolean;
  parcela_atual: number | null;
  parcela_total: number | null;
  grupo_parcela: string | null;
  hash_transacao: string;
  pessoa: string;
  observacoes: string | null;
  ignorar_dashboard: boolean;
  categoria_id: string | null;
  created_at: string;
}

export interface RegraCategorizada {
  id: string;
  user_id: string;
  padrao: string;
  categoria: string;
  essencial: boolean;
  aprendido_auto: boolean;
  created_at: string;
}

export type TransacaoComConta = Transacao & { conta: Pick<Conta, 'nome' | 'tipo'> };

export interface CategoriaConfig {
  cor: string;
  essencial: boolean;
  subcategorias: string[];
}

export const CATEGORIAS_CONFIG: Record<string, CategoriaConfig> = {
  // === DESPESAS ===
  "Alimentação": {
    cor: "#ef4444",
    essencial: true,
    subcategorias: ["Fruteira", "Lanches/Delivery", "Restaurante", "Supermercado"]
  },
  "Assinatura": {
    cor: "#a855f7",
    essencial: false,
    subcategorias: []
  },
  "Beleza": {
    cor: "#f97316",
    essencial: false,
    subcategorias: ["Barbearia", "Salão/Beauty"]
  },
  "Casa": {
    cor: "#0ea5e9",
    essencial: true,
    subcategorias: ["Aluguel", "Condomínio", "Gás", "Internet", "Luz", "Móveis", "Reformas/melhorias", "Utensílios"]
  },
  "Compras": {
    cor: "#a855f7",
    essencial: false,
    subcategorias: []
  },
  "Educação": {
    cor: "#a855f7",
    essencial: true,
    subcategorias: []
  },
  "Empréstimos": {
    cor: "#ef4444",
    essencial: false,
    subcategorias: []
  },
  "Lazer": {
    cor: "#f97316",
    essencial: false,
    subcategorias: ["Hobbys"]
  },
  "Operação bancária": {
    cor: "#a855f7",
    essencial: false,
    subcategorias: []
  },
  "Outros": {
    cor: "#9ca3af",
    essencial: false,
    subcategorias: []
  },
  "Pais Maiara": {
    cor: "#9ca3af",
    essencial: false,
    subcategorias: []
  },
  "Presente": {
    cor: "#84cc16",
    essencial: false,
    subcategorias: []
  },
  "Produtora": {
    cor: "#ef4444",
    essencial: false,
    subcategorias: []
  },
  "Saúde": {
    cor: "#22c55e",
    essencial: true,
    subcategorias: ["Consultas", "Farmácia", "Seguro de vida"]
  },
  "Serviços": {
    cor: "#16a34a",
    essencial: true,
    subcategorias: ["Celular"]
  },
  "Transporte": {
    cor: "#3b82f6",
    essencial: true,
    subcategorias: ["Combustível", "Financiamento", "Imposto", "Manutenção", "Seguro carro"]
  },
  "Vestuário": {
    cor: "#0ea5e9",
    essencial: false,
    subcategorias: []
  },
  "Viagem": {
    cor: "#0ea5e9",
    essencial: false,
    subcategorias: []
  },
  // === RECEITAS ===
  "Salário/Pró-labore": {
    cor: "#10b981",
    essencial: true,
    subcategorias: []
  },
  "Freelance/PJ": {
    cor: "#10b981",
    essencial: false,
    subcategorias: []
  },
  "Receita Produtora": {
    cor: "#059669",
    essencial: false,
    subcategorias: []
  },
  "Investimentos": {
    cor: "#3b82f6",
    essencial: false,
    subcategorias: ["Dividendos", "Juros", "Rendimentos"]
  },
  "Vendas": {
    cor: "#f97316",
    essencial: false,
    subcategorias: ["Produtos", "Usados"]
  },
  "Reembolsos": {
    cor: "#6b7280",
    essencial: false,
    subcategorias: []
  },
  "Devoluções": {
    cor: "#6b7280",
    essencial: false,
    subcategorias: []
  },
  "Transferência entre contas": {
    cor: "#a855f7",
    essencial: false,
    subcategorias: []
  },
  "Outras receitas": {
    cor: "#9ca3af",
    essencial: false,
    subcategorias: []
  },
};

export const CATEGORIAS = Object.keys(CATEGORIAS_CONFIG);

// "Transferência entre contas" intencionalmente NÃO está na lista de exclusão —
// movimentações entre contas próprias do usuário aparecem como DESPESA (saída
// da conta origem) E RECEITA (entrada na conta destino), e devem usar a mesma
// categoria pra refletir que é movimento interno, não consumo. Combine com
// ignorar_dashboard=true pra não contar nos totais do mês.
export const CATEGORIAS_DESPESA = CATEGORIAS.filter(c =>
  !['Salário/Pró-labore', 'Freelance/PJ', 'Receita Produtora', 'Investimentos', 'Vendas', 'Reembolsos', 'Devoluções', 'Outras receitas'].includes(c)
);

export const CATEGORIAS_RECEITA = [
  'Salário/Pró-labore', 'Freelance/PJ', 'Receita Produtora', 'Investimentos',
  'Vendas', 'Reembolsos', 'Devoluções', 'Transferência entre contas', 'Outras receitas',
];

export const getCategoriaColor = (categoria: string): string => {
  return CATEGORIAS_CONFIG[categoria]?.cor || '#9ca3af';
};

export const getSubcategorias = (categoria: string): string[] => {
  return CATEGORIAS_CONFIG[categoria]?.subcategorias || [];
};

export const CONTAS_PADRAO: Omit<Conta, 'id' | 'user_id' | 'created_at'>[] = [
  { nome: 'Sicredi Conta Corrente', tipo: 'debito', saldo_inicial: 163.66, banco: 'Sicredi', codigo_banco: '748', numero_conta: '885890', agencia: '', data_abertura: '2026-01-01' },
  { nome: 'Sicredi Conta 2', tipo: 'debito', saldo_inicial: -469.57, banco: 'Sicredi', codigo_banco: '748', numero_conta: '939935', agencia: '', data_abertura: '2026-01-01' },
  { nome: 'Black', tipo: 'credito', saldo_inicial: 0, banco: 'Sicredi', codigo_banco: '748', numero_conta: '', agencia: '', data_abertura: '2026-01-01' },
  { nome: 'Mercado Pago', tipo: 'credito', saldo_inicial: 0, banco: 'Mercado Pago', codigo_banco: '323', numero_conta: '', agencia: '', data_abertura: '2026-01-01' },
];
