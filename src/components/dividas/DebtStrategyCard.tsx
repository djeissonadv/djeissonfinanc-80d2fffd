import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface DebtContextItem {
  nome: string;
  valorMensal: number;
  parcelasRestantes: number;
  valorRestante: number;
  taxaAno: number | null;
}

interface Props {
  context: {
    rendaMensal: number;
    totalRestante: number;
    totalMensal: number;
    comprometimentoRenda: number | null;
    mesLiberdade: string;
    mesesAteLiberdade: number;
    jurosEvitaveis: number;
    dividas: DebtContextItem[];
  };
}

export function DebtStrategyCard({ context }: Props) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAnalysis = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-financial-advisor', {
        body: { type: 'debt_strategy', context },
      });
      if (error) throw error;
      setAnalysis(data?.analysis ?? 'Sem resposta da IA');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao gerar o plano');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Plano de saída por IA
          {analysis && (
            <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" onClick={fetchAnalysis} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!analysis && !loading && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Gere um plano objetivo e personalizado pra priorizar e quitar suas dívidas mais rápido.
            </p>
            <Button size="sm" onClick={fetchAnalysis} className="shrink-0">
              Gerar plano
            </Button>
          </div>
        )}
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        )}
        {analysis && !loading && (
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
            <ReactMarkdown>{analysis}</ReactMarkdown>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
