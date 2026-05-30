import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAiAnalyst, type AnalystMode } from '@/hooks/useAiAnalyst';
import { Loader2, Sparkles, RefreshCw, MessageSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Card de "análise profunda" — botão dispara Claude com contexto pesado e
// renderiza markdown. Estado vazio convidativo, loading com spinner, erro com
// retry. Mantém a resposta na memória até troca de mês ou re-fetch.
// ---------------------------------------------------------------------------
interface DeepAnalysisCardProps {
  context: any;
  mode: AnalystMode;
  title?: string;
  description?: string;
  buttonLabel?: string;
}

export function DeepAnalysisCard({
  context,
  mode,
  title = 'Análise profunda do Claude',
  description = 'Relatório analítico estruturado a partir dos seus dados de 12 meses',
  buttonLabel = 'Gerar análise',
}: DeepAnalysisCardProps) {
  const mut = useAiAnalyst();

  const run = () => {
    mut.mutate(
      { mode, context },
      {
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Erro ao consultar Claude'),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {mut.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Claude analisando seus dados…
          </div>
        )}
        {!mut.isPending && mut.data && (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-h2:text-base prose-h2:mt-4 prose-h2:mb-2 prose-p:my-2 prose-li:my-0.5 prose-strong:text-foreground">
            <ReactMarkdown>{mut.data.analysis}</ReactMarkdown>
          </div>
        )}
        {!mut.isPending && !mut.data && !mut.isError && (
          <div className="text-sm text-muted-foreground py-6 text-center">
            Clique em <strong>{buttonLabel}</strong> para o Claude ler seus números e produzir uma análise estruturada.
          </div>
        )}
        {mut.isError && !mut.isPending && (
          <div className="text-sm text-red-600 py-4">
            {mut.error instanceof Error ? mut.error.message : 'Erro desconhecido'}
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-2">
        <Button onClick={run} disabled={mut.isPending} variant={mut.data ? 'outline' : 'default'} size="sm">
          {mut.isPending ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Gerando…</>
          ) : mut.data ? (
            <><RefreshCw className="h-3.5 w-3.5 mr-2" /> Gerar novamente</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5 mr-2" /> {buttonLabel}</>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Q&A free-form: textarea + botão. Claude responde com markdown, conteúdo vive
// na memória até nova pergunta. Histórico de 1 turno apenas (KISS pra começar).
// ---------------------------------------------------------------------------
interface AskClaudeCardProps {
  baseContext: any; // os números do usuário; question vai junto
}

export function AskClaudeCard({ baseContext }: AskClaudeCardProps) {
  const [question, setQuestion] = useState('');
  const mut = useAiAnalyst();

  const ask = () => {
    const q = question.trim();
    if (!q) return;
    mut.mutate(
      { mode: 'analises_ask', context: { ...baseContext, question: q } },
      { onError: (e) => toast.error(e instanceof Error ? e.message : 'Erro ao consultar Claude') },
    );
  };

  const SUGESTOES = [
    'Onde estou gastando mais do que deveria?',
    'Quanto posso poupar se cortar não-essenciais pela metade?',
    'Qual é minha maior fragilidade financeira hoje?',
    'O que mudou nos últimos 3 meses?',
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          Pergunte ao Claude
        </CardTitle>
        <CardDescription>Resposta direta usando os seus números reais</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ex: Devo cortar Netflix? Quanto sobrou em maio?"
          rows={2}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              ask();
            }
          }}
        />

        {!mut.data && !mut.isPending && (
          <div className="flex flex-wrap gap-1.5">
            {SUGESTOES.map((s) => (
              <button
                key={s}
                onClick={() => setQuestion(s)}
                className="text-xs rounded-full border bg-muted/40 hover:bg-muted px-2.5 py-1 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {mut.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Claude pensando…
          </div>
        )}

        {mut.data && !mut.isPending && (
          <div className="rounded-md bg-muted/30 p-3">
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-li:my-0.5">
              <ReactMarkdown>{mut.data.analysis}</ReactMarkdown>
            </div>
          </div>
        )}

        {mut.isError && !mut.isPending && (
          <div className="text-sm text-red-600">
            {mut.error instanceof Error ? mut.error.message : 'Erro'}
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-0">
        <Button onClick={ask} disabled={mut.isPending || !question.trim()} size="sm">
          {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Sparkles className="h-3.5 w-3.5 mr-2" />}
          Perguntar
        </Button>
        <span className="text-xs text-muted-foreground ml-3">⌘+Enter envia</span>
      </CardFooter>
    </Card>
  );
}
