import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { generateHash } from '@/lib/csv-parser';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { AlertTriangle, CheckCircle2, Loader2, Stethoscope } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Tx {
  id: string;
  descricao: string;
  descricao_normalizada: string | null;
  valor: number;
  tipo: string;
  data: string;
  data_original: string | null;
  mes_competencia: string | null;
  parcela_atual: number | null;
  parcela_total: number | null;
  grupo_parcela: string | null;
  conta_id: string;
  categoria: string | null;
  essencial: boolean;
  pessoa: string | null;
}

interface GrupoIncompleto {
  key: string;
  descricaoBase: string;
  contaId: string;
  contaNome: string;
  parcelaTotal: number;
  maxParcelaAtual: number;
  faltam: number;
  valorMedio: number;
  dataOriginal: string;
  ultimoMesCompetencia: string | null;
  grupoParcela: string | null;
  categoria: string | null;
  essencial: boolean;
  pessoa: string;
  tipo: 'despesa' | 'receita';
  parcelasExistentes: Tx[];
}

/**
 * Diagnóstico de parcelamentos incompletos.
 *
 * Identifica grupos onde MAX(parcela_atual) < parcela_total — tipicamente
 * importações parciais (extrato cobriu só alguns meses) onde as parcelas
 * finais nunca foram criadas. Oferece preencher de uma vez com:
 *   - Valor médio das parcelas existentes
 *   - Mesma descrição base + (N/total) no final
 *   - mes_competencia incrementando mês a mês a partir do último existente
 *   - data_original mantida (data da compra)
 *   - Mesmo grupo_parcela (pra agrupamento na UI)
 */
export function DiagnosticoParcelamentos({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [preenchendo, setPreenchendo] = useState<string | null>(null);

  // Busca TODAS as transações parceladas (parcela_total > 1) — sem filtro de
  // data. Necessário pra ver o grupo todo.
  const { data: dados, isLoading } = useQuery({
    queryKey: ['diagnostico-parcelas', user?.id],
    queryFn: async () => {
      const [txs, contasData] = await Promise.all([
        fetchAllRows<Tx>(() => supabase
          .from('transacoes')
          .select('id, descricao, descricao_normalizada, valor, tipo, data, data_original, mes_competencia, parcela_atual, parcela_total, grupo_parcela, conta_id, categoria, essencial, pessoa')
          .eq('user_id', user!.id)
          .not('parcela_total', 'is', null)
          .gt('parcela_total', 1)),
        supabase
          .from('contas')
          .select('id, nome')
          .eq('user_id', user!.id)
          .then(({ data }) => data || []),
      ]);
      return { txs, contas: contasData };
    },
    enabled: open && !!user,
  });

  // Agrupa por (descrição normalizada + parcela_total + conta) — robusto contra
  // grupo_parcela nulo. Se grupo_parcela existe, usa ele direto.
  const grupos: GrupoIncompleto[] = useMemo(() => {
    if (!dados) return [];
    const { txs, contas } = dados;
    const contasMap = new Map(contas.map(c => [c.id, c.nome]));

    const buckets = new Map<string, Tx[]>();
    for (const t of txs) {
      if (!t.parcela_total || !t.parcela_atual) continue;
      // Chave: grupo_parcela quando existe, senão (descrição + total + conta)
      const desc = (t.descricao_normalizada || t.descricao || '')
        .replace(/\s*\(\d+\/\d+\)\s*$/, '')
        .replace(/\s*\(auto-projetada\)/, '')
        .trim()
        .toUpperCase()
        .substring(0, 30);
      const key = t.grupo_parcela || `${desc}|${t.parcela_total}|${t.conta_id}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(t);
    }

    const incompletos: GrupoIncompleto[] = [];
    for (const [key, parcelas] of buckets) {
      const parcelaTotal = parcelas[0].parcela_total!;
      const maxAtual = parcelas.reduce((m, p) => Math.max(m, p.parcela_atual || 0), 0);
      if (maxAtual >= parcelaTotal) continue; // completo, pula

      const valorMedio = parcelas.reduce((s, p) => s + Number(p.valor), 0) / parcelas.length;
      // Ordena pra pegar a última existente como ponto de partida pra projeção
      parcelas.sort((a, b) => (a.parcela_atual || 0) - (b.parcela_atual || 0));
      const ultima = parcelas[parcelas.length - 1];
      const descBase = (ultima.descricao || '')
        .replace(/\s*\(\d+\/\d+\)\s*$/, '')
        .replace(/\s*\(auto-projetada\)/, '')
        .trim();

      incompletos.push({
        key,
        descricaoBase: descBase,
        contaId: ultima.conta_id,
        contaNome: contasMap.get(ultima.conta_id) || 'Conta',
        parcelaTotal,
        maxParcelaAtual: maxAtual,
        faltam: parcelaTotal - maxAtual,
        valorMedio,
        dataOriginal: ultima.data_original || ultima.data,
        ultimoMesCompetencia: ultima.mes_competencia,
        grupoParcela: ultima.grupo_parcela,
        categoria: ultima.categoria,
        essencial: ultima.essencial,
        pessoa: ultima.pessoa || '',
        tipo: (ultima.tipo === 'receita' ? 'receita' : 'despesa') as 'despesa' | 'receita',
        parcelasExistentes: parcelas,
      });
    }

    // Ordena: mais parcelas faltando primeiro
    return incompletos.sort((a, b) => b.faltam - a.faltam);
  }, [dados]);

  const preencherMutation = useMutation({
    mutationFn: async (g: GrupoIncompleto) => {
      if (!user) throw new Error('Sem usuário');
      const rows = [];
      const baseDate = g.dataOriginal; // data da compra original (mantém)
      // Ponto de partida do mes_competencia: usa o último existente + 1.
      // Se não há mes_competencia (parcelas sem competência), cai na data.
      const startCompYM = g.ultimoMesCompetencia
        ? incrementYM(g.ultimoMesCompetencia, 1)
        : null;
      for (let i = 0; i < g.faltam; i++) {
        const parcelaIdx = g.maxParcelaAtual + 1 + i;
        const mesComp = startCompYM ? incrementYM(startCompYM, i) : null;
        const descricao = `${g.descricaoBase} (${parcelaIdx}/${g.parcelaTotal})`;
        const hash = generateHash(baseDate, g.descricaoBase, g.valorMedio, g.pessoa, parcelaIdx, g.parcelaTotal) + '_completed';
        rows.push({
          user_id: user.id,
          conta_id: g.contaId,
          data: baseDate,
          data_original: baseDate,
          descricao,
          descricao_normalizada: descricao.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().substring(0, 50),
          valor: Number(g.valorMedio.toFixed(2)),
          tipo: g.tipo,
          categoria: g.categoria || 'Outros',
          essencial: g.essencial,
          parcela_atual: parcelaIdx,
          parcela_total: g.parcelaTotal,
          grupo_parcela: g.grupoParcela,
          hash_transacao: hash,
          pessoa: g.pessoa,
          mes_competencia: mesComp,
          ignorar_dashboard: false,
        });
      }
      const { error } = await supabase.from('transacoes').insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onMutate: (g) => setPreenchendo(g.key),
    onSettled: () => setPreenchendo(null),
    onSuccess: (count, g) => {
      toast({
        title: `${count} parcela${count === 1 ? '' : 's'} criada${count === 1 ? '' : 's'}`,
        description: `${g.descricaoBase} agora vai até ${g.parcelaTotal}/${g.parcelaTotal}`,
      });
      queryClient.invalidateQueries({ queryKey: ['diagnostico-parcelas'] });
      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
    },
    onError: (e: any) => {
      toast({ title: 'Erro ao preencher', description: String(e?.message || e).slice(0, 200), variant: 'destructive' });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5" />
            Diagnóstico de parcelamentos
          </DialogTitle>
          <DialogDescription>
            Detecta compras parceladas onde só parte das parcelas foi importada (importação incompleta).
            Clica em "Preencher" pra criar as parcelas faltantes automaticamente.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : grupos.length === 0 ? (
          <div className="rounded-xl border border-success/30 bg-success/5 p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Tudo OK</p>
              <p className="text-sm text-muted-foreground">
                Nenhum parcelamento incompleto. Todas as suas compras parceladas têm a sequência completa no banco.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 flex items-start gap-3 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div>
                <strong>{grupos.length}</strong> parcelamento{grupos.length === 1 ? '' : 's'} com sequência incompleta.
                Total de parcelas faltando: <strong>{grupos.reduce((s, g) => s + g.faltam, 0)}</strong>.
              </div>
            </div>
            {grupos.map(g => (
              <div key={g.key} className="rounded-xl border border-border bg-secondary/40 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{g.descricaoBase}</p>
                    <p className="text-xs text-muted-foreground tabular">
                      {g.contaNome} • {g.parcelasExistentes.length} de {g.parcelaTotal} parcelas existentes
                      {g.ultimoMesCompetencia && ` • última: ${g.ultimoMesCompetencia}`}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-warning/40 text-warning shrink-0 tabular">
                    Faltam {g.faltam}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">Valor médio</span>
                    <p className="font-medium tabular">{formatCurrency(g.valorMedio)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">Total a criar</span>
                    <p className="font-medium tabular">{formatCurrency(g.valorMedio * g.faltam)}</p>
                  </div>
                </div>

                <Button
                  size="sm"
                  className="w-full"
                  disabled={preencherMutation.isPending}
                  onClick={() => preencherMutation.mutate(g)}
                >
                  {preenchendo === g.key ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Criando {g.faltam} parcelas...</>
                  ) : (
                    <>Preencher {g.faltam} parcela{g.faltam === 1 ? '' : 's'} faltante{g.faltam === 1 ? '' : 's'}</>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Incrementa YYYY-MM em N meses (positivo ou negativo). */
function incrementYM(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
