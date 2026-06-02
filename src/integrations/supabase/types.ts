export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      categorias: {
        Row: {
          cor: string | null
          created_at: string
          icone: string | null
          id: string
          nome: string
          parent_id: string | null
          user_id: string
        }
        Insert: {
          cor?: string | null
          created_at?: string
          icone?: string | null
          id?: string
          nome: string
          parent_id?: string | null
          user_id: string
        }
        Update: {
          cor?: string | null
          created_at?: string
          icone?: string | null
          id?: string
          nome?: string
          parent_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes: {
        Row: {
          created_at: string
          id: string
          receita_mensal_fixa: number
          reserva_minima: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          receita_mensal_fixa?: number
          reserva_minima?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          receita_mensal_fixa?: number
          reserva_minima?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      contas: {
        Row: {
          agencia: string | null
          banco: string | null
          codigo_banco: string | null
          created_at: string
          data_abertura: string
          dia_vencimento: number | null
          id: string
          nome: string
          numero_conta: string | null
          saldo_inicial: number
          tipo: string
          user_id: string
        }
        Insert: {
          agencia?: string | null
          banco?: string | null
          codigo_banco?: string | null
          created_at?: string
          data_abertura?: string
          dia_vencimento?: number | null
          id?: string
          nome: string
          numero_conta?: string | null
          saldo_inicial?: number
          tipo: string
          user_id: string
        }
        Update: {
          agencia?: string | null
          banco?: string | null
          codigo_banco?: string | null
          created_at?: string
          data_abertura?: string
          dia_vencimento?: number | null
          id?: string
          nome?: string
          numero_conta?: string | null
          saldo_inicial?: number
          tipo?: string
          user_id?: string
        }
        Relationships: []
      }
      contas_pagar_receber: {
        Row: {
          categoria: string | null
          created_at: string
          data_vencimento: string | null
          descricao: string
          id: string
          mes: string
          pago: boolean
          tipo: string
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          categoria?: string | null
          created_at?: string
          data_vencimento?: string | null
          descricao: string
          id?: string
          mes: string
          pago?: boolean
          tipo?: string
          updated_at?: string
          user_id: string
          valor?: number
        }
        Update: {
          categoria?: string | null
          created_at?: string
          data_vencimento?: string | null
          descricao?: string
          id?: string
          mes?: string
          pago?: boolean
          tipo?: string
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: []
      }
      fontes_receita: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nome: string
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome: string
          updated_at?: string
          user_id: string
          valor?: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: []
      }
      grupos_parcela: {
        Row: {
          categoria_id: string | null
          conta_id: string
          created_at: string
          data_inicio: string
          descricao: string
          id: string
          total_parcelas: number
          user_id: string
          valor_parcela: number
        }
        Insert: {
          categoria_id?: string | null
          conta_id: string
          created_at?: string
          data_inicio: string
          descricao: string
          id?: string
          total_parcelas: number
          user_id: string
          valor_parcela: number
        }
        Update: {
          categoria_id?: string | null
          conta_id?: string
          created_at?: string
          data_inicio?: string
          descricao?: string
          id?: string
          total_parcelas?: number
          user_id?: string
          valor_parcela?: number
        }
        Relationships: [
          {
            foreignKeyName: "grupos_parcela_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grupos_parcela_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "contas"
            referencedColumns: ["id"]
          },
        ]
      }
      historico_importacoes: {
        Row: {
          conta_id: string
          conta_nome: string
          created_at: string
          id: string
          nome_arquivo: string
          qtd_duplicadas: number
          qtd_importada: number
          qtd_total: number
          tipo_arquivo: string
          user_id: string
        }
        Insert: {
          conta_id: string
          conta_nome: string
          created_at?: string
          id?: string
          nome_arquivo: string
          qtd_duplicadas?: number
          qtd_importada?: number
          qtd_total?: number
          tipo_arquivo?: string
          user_id: string
        }
        Update: {
          conta_id?: string
          conta_nome?: string
          created_at?: string
          id?: string
          nome_arquivo?: string
          qtd_duplicadas?: number
          qtd_importada?: number
          qtd_total?: number
          tipo_arquivo?: string
          user_id?: string
        }
        Relationships: []
      }
      import_logs: {
        Row: {
          arquivo: string
          created_at: string
          data_importacao: string
          detalhes_json: Json
          id: string
          linhas_importadas: number
          linhas_rejeitadas: number
          total_linhas_csv: number
          user_id: string
        }
        Insert: {
          arquivo: string
          created_at?: string
          data_importacao?: string
          detalhes_json?: Json
          id?: string
          linhas_importadas?: number
          linhas_rejeitadas?: number
          total_linhas_csv?: number
          user_id: string
        }
        Update: {
          arquivo?: string
          created_at?: string
          data_importacao?: string
          detalhes_json?: Json
          id?: string
          linhas_importadas?: number
          linhas_rejeitadas?: number
          total_linhas_csv?: number
          user_id?: string
        }
        Relationships: []
      }
      planejamento_categorias: {
        Row: {
          categoria_id: string | null
          categoria_nome: string
          created_at: string
          id: string
          mes: string
          updated_at: string
          user_id: string
          valor_planejado: number
        }
        Insert: {
          categoria_id?: string | null
          categoria_nome: string
          created_at?: string
          id?: string
          mes: string
          updated_at?: string
          user_id: string
          valor_planejado?: number
        }
        Update: {
          categoria_id?: string | null
          categoria_nome?: string
          created_at?: string
          id?: string
          mes?: string
          updated_at?: string
          user_id?: string
          valor_planejado?: number
        }
        Relationships: []
      }
      projecoes_manuais: {
        Row: {
          categoria_id: string | null
          categoria_nome: string
          created_at: string
          descricao: string | null
          id: string
          mes: string
          tipo: string
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          categoria_id?: string | null
          categoria_nome?: string
          created_at?: string
          descricao?: string | null
          id?: string
          mes: string
          tipo?: string
          updated_at?: string
          user_id: string
          valor: number
        }
        Update: {
          categoria_id?: string | null
          categoria_nome?: string
          created_at?: string
          descricao?: string | null
          id?: string
          mes?: string
          tipo?: string
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "projecoes_manuais_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      regras_categorizacao: {
        Row: {
          aprendido_auto: boolean
          categoria: string
          categoria_id: string | null
          created_at: string
          essencial: boolean
          id: string
          padrao: string
          user_id: string
        }
        Insert: {
          aprendido_auto?: boolean
          categoria: string
          categoria_id?: string | null
          created_at?: string
          essencial?: boolean
          id?: string
          padrao: string
          user_id: string
        }
        Update: {
          aprendido_auto?: boolean
          categoria?: string
          categoria_id?: string | null
          created_at?: string
          essencial?: boolean
          id?: string
          padrao?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "regras_categorizacao_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      simulacoes_financiamento: {
        Row: {
          aluguel_atual: number
          capital_disponivel: number
          condominio_atual: number
          created_at: string
          dividas_mensais: number
          entrada: number
          escritura_percent: number
          fgts_disponivel: number
          id: string
          iptu_atrasado: number
          ir_venda_estimado: number
          itbi_percent: number
          limite_comprometimento: number
          nome: string
          outros_custos_venda: number
          parcela_carro: number
          prazo_meses: number
          renda_bruta: number
          reserva_meses: number
          saldo_devedor_carro: number
          saldo_devedor_imovel_vender: number
          taxa_anual_nominal: number
          tr_anual: number
          updated_at: string
          user_id: string
          valor_imovel: number
          valor_venda_imovel: number
        }
        Insert: {
          aluguel_atual?: number
          capital_disponivel?: number
          condominio_atual?: number
          created_at?: string
          dividas_mensais?: number
          entrada: number
          escritura_percent?: number
          fgts_disponivel?: number
          id?: string
          iptu_atrasado?: number
          ir_venda_estimado?: number
          itbi_percent?: number
          limite_comprometimento?: number
          nome?: string
          outros_custos_venda?: number
          parcela_carro?: number
          prazo_meses: number
          renda_bruta: number
          reserva_meses?: number
          saldo_devedor_carro?: number
          saldo_devedor_imovel_vender?: number
          taxa_anual_nominal: number
          tr_anual?: number
          updated_at?: string
          user_id: string
          valor_imovel: number
          valor_venda_imovel?: number
        }
        Update: {
          aluguel_atual?: number
          capital_disponivel?: number
          condominio_atual?: number
          created_at?: string
          dividas_mensais?: number
          entrada?: number
          escritura_percent?: number
          fgts_disponivel?: number
          id?: string
          iptu_atrasado?: number
          ir_venda_estimado?: number
          itbi_percent?: number
          limite_comprometimento?: number
          nome?: string
          outros_custos_venda?: number
          parcela_carro?: number
          prazo_meses?: number
          renda_bruta?: number
          reserva_meses?: number
          saldo_devedor_carro?: number
          saldo_devedor_imovel_vender?: number
          taxa_anual_nominal?: number
          tr_anual?: number
          updated_at?: string
          user_id?: string
          valor_imovel?: number
          valor_venda_imovel?: number
        }
        Relationships: []
      }
      transacoes: {
        Row: {
          categoria: string
          categoria_id: string | null
          codigo_cartao: string | null
          conta_id: string
          created_at: string
          data: string
          data_original: string | null
          descricao: string
          descricao_normalizada: string | null
          essencial: boolean
          grupo_parcela: string | null
          hash_transacao: string
          id: string
          ignorar_dashboard: boolean
          mes_competencia: string | null
          observacoes: string | null
          pago: boolean
          parcela_atual: number | null
          parcela_total: number | null
          pessoa: string
          reembolso_pessoa: string | null
          reembolso_transacao_id: string | null
          reembolso_valor: number | null
          tipo: string
          user_id: string
          valor: number
          valor_dolar: number | null
        }
        Insert: {
          categoria?: string
          categoria_id?: string | null
          codigo_cartao?: string | null
          conta_id: string
          created_at?: string
          data: string
          data_original?: string | null
          descricao: string
          descricao_normalizada?: string | null
          essencial?: boolean
          grupo_parcela?: string | null
          hash_transacao: string
          id?: string
          ignorar_dashboard?: boolean
          mes_competencia?: string | null
          observacoes?: string | null
          pago?: boolean
          parcela_atual?: number | null
          parcela_total?: number | null
          pessoa?: string
          reembolso_pessoa?: string | null
          reembolso_transacao_id?: string | null
          reembolso_valor?: number | null
          tipo: string
          user_id: string
          valor: number
          valor_dolar?: number | null
        }
        Update: {
          categoria?: string
          categoria_id?: string | null
          codigo_cartao?: string | null
          conta_id?: string
          created_at?: string
          data?: string
          data_original?: string | null
          descricao?: string
          descricao_normalizada?: string | null
          essencial?: boolean
          grupo_parcela?: string | null
          hash_transacao?: string
          id?: string
          ignorar_dashboard?: boolean
          mes_competencia?: string | null
          observacoes?: string | null
          pago?: boolean
          parcela_atual?: number | null
          parcela_total?: number | null
          pessoa?: string
          reembolso_pessoa?: string | null
          reembolso_transacao_id?: string | null
          reembolso_valor?: number | null
          tipo?: string
          user_id?: string
          valor?: number
          valor_dolar?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transacoes_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "contas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
