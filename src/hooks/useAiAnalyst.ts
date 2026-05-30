import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Modos suportados pela edge function `ai-analyst` (Claude Sonnet 4.5).
 * Cada modo tem prompt de sistema próprio + builder de prompt do usuário no servidor.
 */
export type AnalystMode =
  | 'analises_deep_analysis'
  | 'analises_ask'
  | 'projecoes_scenario'
  | 'planejamento_review'
  | 'dividas_strategy';

export interface AnalystResult {
  analysis: string;
  mode: AnalystMode;
}

/**
 * Hook pra invocar análises Claude. Retorna `mutate` (sob demanda — não dispara
 * automaticamente porque cada call custa ~R$0,05). Use `isPending` pra loading,
 * `data?.analysis` pro markdown gerado, `error` pra erros amigáveis.
 *
 * Exemplo:
 *   const m = useAiAnalyst();
 *   <Button onClick={() => m.mutate({ mode: 'analises_deep_analysis', context })}>
 *     Gerar análise profunda
 *   </Button>
 *   {m.data && <Markdown>{m.data.analysis}</Markdown>}
 */
export function useAiAnalyst() {
  return useMutation({
    mutationFn: async ({ mode, context }: { mode: AnalystMode; context: any }): Promise<AnalystResult> => {
      const { data, error } = await supabase.functions.invoke('ai-analyst', {
        body: { mode, context },
      });
      if (error) throw new Error(error.message || 'Erro ao consultar Claude');
      if (data?.error) throw new Error(data.error);
      if (!data?.analysis) throw new Error('Claude retornou resposta vazia');
      return data as AnalystResult;
    },
  });
}
