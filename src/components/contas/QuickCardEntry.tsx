import { useState, useRef, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFaturaAcumulada } from '@/hooks/useFaturaAcumulada';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { generateHash } from '@/lib/csv-parser';
import { autoCategorizarTransacao } from '@/lib/auto-categorize';
import { toLocalIso, getMonthName, formatCurrency } from '@/lib/format';
import { CATEGORIAS_DESPESA, getSubcategorias } from '@/types/database.types';
import { ChevronLeft, ChevronRight, Zap, Trash2, CreditCard } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Lancado {
  id: string;          // id da 1ª transação (pra desfazer)
  grupoParcela: string | null; // pra desfazer a série inteira
  descricao: string;
  valor: number;       // valor por parcela
  categoria: string;
  subcategoria: string | null;
  parcelaAtual: number; // 1 = à vista
  parcelaTotal: number; // 1 = à vista
}

const LS_CARD = 'quickcard:lastCardId';

/**
 * Lançamento rápido de cartão — estilo caixa de supermercado.
 *
 * Escolhe cartão + competência UMA vez; depois é só descrição + valor + Enter,
 * repetindo. Cada item: auto-categoriza, insere, limpa os campos, devolve o
 * foco pra descrição e mostra na lista da sessão (com total e botão de desfazer).
 *
 * Pra parcelamento/recorrência/reembolso, use o "Novo Lançamento" completo.
 */
export function QuickCardEntry({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const descRef = useRef<HTMLInputElement>(null);

  const [cardId, setCardId] = useState<string>(() => localStorage.getItem(LS_CARD) || '');
  const now = new Date();
  const [compMonth, setCompMonth] = useState(now.getMonth());
  const [compYear, setCompYear] = useState(now.getFullYear());

  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState<number>(0);
  // Parcelamento: atual/total. Vazio = à vista. Ex: 5 / 12 = parcela 5 de 12
  // (cria 5/12 na fatura escolhida + projeta 6/12..12/12).
  const [parcAtual, setParcAtual] = useState('');
  const [parcTotal, setParcTotal] = useState('');
  const [categoria, setCategoria] = useState('');
  const [subcategoria, setSubcategoria] = useState('');
  const [estorno, setEstorno] = useState(false); // true = crédito que abate a fatura
  const [submitting, setSubmitting] = useState(false);
  const [sessao, setSessao] = useState<Lancado[]>([]);
  // Memória de aprendizado da sessão: descrição_normalizada → {cat, sub}.
  // Atualiza na hora a cada lançamento (sem esperar refetch do banco).
  const [aprendidoSessao, setAprendidoSessao] = useState<Record<string, { categoria: string; subcategoria: string }>>({});

  const pessoaNome = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Titular';
  const mesCompetencia = `${compYear}-${String(compMonth + 1).padStart(2, '0')}`;

  // Cartões de crédito
  const { data: cards } = useQuery({
    queryKey: ['cards-quick', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('contas')
        .select('id, nome')
        .eq('user_id', user!.id)
        .eq('tipo', 'credito')
        .order('nome');
      return data || [];
    },
    enabled: open && !!user,
  });

  // Se não tem cartão selecionado e só há 1, escolhe ele. Se o salvo não existe
  // mais, limpa.
  useEffect(() => {
    if (!cards?.length) return;
    if (cardId && cards.some(c => c.id === cardId)) return;
    setCardId(cards.length === 1 ? cards[0].id : (cards[0]?.id || ''));
  }, [cards]); // eslint-disable-line react-hooks/exhaustive-deps

  // Foca a descrição quando abre / quando muda cartão
  useEffect(() => {
    if (open) setTimeout(() => descRef.current?.focus(), 100);
  }, [open]);

  // ── "Aprendizado" SEGURO ──────────────────────────────────────────────
  // Mapa: descrição_normalizada → categoria que VOCÊ mais usou pra ela.
  // Carregado 1x ao abrir. É só SUGESTÃO no form (pré-preenche o select).
  // NUNCA reescreve transação existente nem roda no import — diferente do
  // antigo regras_categorizacao que causava "virou Saúde sozinha".
  const { data: histMap } = useQuery({
    queryKey: ['cat-history', user?.id],
    queryFn: async () => {
      const rows = await fetchAllRows<{ descricao_normalizada: string | null; categoria: string; subcategoria: string | null }>(() => supabase
        .from('transacoes')
        .select('descricao_normalizada, categoria, subcategoria')
        .eq('user_id', user!.id)
        .eq('tipo', 'despesa')
        .neq('categoria', 'Outros'));
      // Conta o par (categoria|subcategoria) mais usado por descrição
      const freq: Record<string, Record<string, number>> = {};
      for (const r of rows) {
        const k = (r.descricao_normalizada || '').trim().toUpperCase();
        if (!k || !r.categoria) continue;
        const par = `${r.categoria}|${r.subcategoria || ''}`;
        (freq[k] ||= {})[par] = (freq[k]?.[par] || 0) + 1;
      }
      const best: Record<string, { categoria: string; subcategoria: string }> = {};
      for (const [k, pares] of Object.entries(freq)) {
        const top = Object.entries(pares).sort((a, b) => b[1] - a[1])[0][0];
        const [cat, sub] = top.split('|');
        best[k] = { categoria: cat, subcategoria: sub };
      }
      return best;
    },
    enabled: open && !!user,
    staleTime: 5 * 60_000,
  });

  const normDesc = useMemo(() => descricao.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(), [descricao]);
  // Aprendizado: 1º a memória INSTANTÂNEA da sessão (atualiza a cada lançamento,
  // sem esperar refetch do banco); 2º o histórico do banco. A sessão ganha
  // porque reflete o que você ACABOU de escolher.
  const aprendido = useMemo(() => {
    if (normDesc && aprendidoSessao[normDesc]) return aprendidoSessao[normDesc];
    if (normDesc && histMap?.[normDesc]) return histMap[normDesc];
    return null;
  }, [normDesc, aprendidoSessao, histMap]);
  // Sugestão de categoria: aprendizado > dicionário > Outros
  const catPreview = useMemo(() => {
    if (aprendido) return aprendido.categoria;
    return autoCategorizarTransacao(descricao) || 'Outros';
  }, [descricao, aprendido]);
  const catFinal = categoria || catPreview;
  // Subcategorias disponíveis pra categoria atual
  const subsDisponiveis = useMemo(() => getSubcategorias(catFinal), [catFinal]);
  // Sugestão de sub: do aprendizado, se válida pra categoria atual
  const subPreview = useMemo(() => {
    const h = aprendido?.subcategoria;
    if (h && subsDisponiveis.includes(h)) return h;
    return '';
  }, [aprendido, subsDisponiveis]);
  const subFinal = subcategoria || subPreview;
  const veioDoHistorico = useMemo(() => {
    return !categoria && !!normDesc && !!aprendido;
  }, [normDesc, aprendido, categoria]);
  // total de parcelas (1 = à vista); atual default 1 se total setado.
  const pTotalVal = Math.max(1, Math.min(parseInt(parcTotal) || 1, 99));
  const pAtualVal = pTotalVal > 1 ? Math.max(1, Math.min(parseInt(parcAtual) || 1, pTotalVal)) : 1;
  // quantas linhas serão criadas: da parcela atual até a última.
  const nRows = pTotalVal > 1 ? (pTotalVal - pAtualVal + 1) : 1;

  const prevMonth = () => {
    if (compMonth === 0) { setCompMonth(11); setCompYear(y => y - 1); }
    else setCompMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (compMonth === 11) { setCompMonth(0); setCompYear(y => y + 1); }
    else setCompMonth(m => m + 1);
  };

  const totalSessao = sessao.reduce((s, l) => s + l.valor, 0);

  const cardNome = cards?.find(c => c.id === cardId)?.nome || '';

  // Total REAL da fatura: soma de TODOS os lançamentos do cartão nesta
  // competência (importados + de outras sessões + os de agora), já com
  // estornos abatidos. Invalidado a cada lançar/desfazer → atualiza ao vivo.
  const { data: faturaMap, isLoading: faturaLoading } = useFaturaAcumulada(
    open && cardId ? [cardId] : [],
    mesCompetencia,
  );
  const totalFatura = faturaMap?.[cardId]?.despesasMes ?? 0;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['transacoes'] });
    qc.invalidateQueries({ queryKey: ['fatura-acumulada'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['saldos'] });
    qc.invalidateQueries({ queryKey: ['cat-history'] }); // aprende a cada lançamento
  };

  const lancar = async () => {
    if (!user || !cardId) return;
    const valorNum = valor;
    if (!valorNum || valorNum <= 0 || !descricao.trim()) return;
    const pTotal = pTotalVal;   // total de parcelas (1 = à vista)
    const pAtual = pAtualVal;   // parcela atual (a que cai na fatura escolhida)

    setSubmitting(true);
    try {
      // Compra de cartão = hoje; competência define a fatura. A parcela ATUAL
      // (pAtual) cai na fatura escolhida e é paga (fato consumado). As
      // seguintes (pAtual+1..pTotal) projetam nas faturas posteriores como
      // pendentes. Parcelas ANTERIORES (1..pAtual-1) não são criadas — já
      // foram pagas antes e estão fora do controle atual.
      const hoje = toLocalIso(new Date());
      const desc = descricao.trim();
      // Estorno é crédito único — nunca parcelado.
      const ehParcelado = pTotal > 1 && !estorno;
      const grupoParcela = ehParcelado ? crypto.randomUUID() : null;
      const [cy, cm] = mesCompetencia.split('-').map(Number);

      const rows = [];
      const numLinhas = ehParcelado ? (pTotal - pAtual + 1) : 1;
      for (let i = 0; i < numLinhas; i++) {
        const parcelaIdx = ehParcelado ? pAtual + i : null;       // 5, 6, 7...
        const dt = new Date(cy, cm - 1 + i, 1);                   // competência avança
        const compI = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
        const descFinal = ehParcelado ? `${desc} (${parcelaIdx}/${pTotal})` : desc;
        const seed = grupoParcela ? `${grupoParcela}_${parcelaIdx}` : crypto.randomUUID().slice(0, 8);
        const hash = generateHash(hoje, descFinal, valorNum, pessoaNome) + '_quick_' + seed.slice(0, 12);
        rows.push({
          user_id: user.id,
          conta_id: cardId,
          data: hoje,
          descricao: descFinal,
          descricao_normalizada: descFinal.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(),
          valor: valorNum,
          // Estorno: receita com categoria 'Estorno' e ignorar_dashboard=true
          // (abate a fatura via useFaturaAcumulada; não conta como renda).
          tipo: estorno ? 'receita' : 'despesa',
          categoria: estorno ? 'Estorno' : catFinal,
          subcategoria: estorno ? null : (subFinal || null),
          essencial: false,
          parcela_atual: parcelaIdx,
          parcela_total: ehParcelado ? pTotal : null,
          grupo_parcela: grupoParcela,
          hash_transacao: hash,
          pessoa: pessoaNome,
          mes_competencia: compI,
          ignorar_dashboard: estorno,
          pago: i === 0, // a parcela atual é paga; as projetadas, pendentes
        });
      }

      const { data: inseridas, error } = await supabase.from('transacoes').insert(rows).select('id');
      if (error) throw error;

      setSessao(prev => [{
        id: inseridas[0].id,
        grupoParcela,
        descricao: desc,
        valor: estorno ? -valorNum : valorNum, // estorno entra como crédito (negativo)
        categoria: estorno ? 'Estorno' : catFinal,
        subcategoria: estorno ? null : (subFinal || null),
        parcelaAtual: ehParcelado ? pAtual : 1,
        parcelaTotal: ehParcelado ? pTotal : 1,
      }, ...prev]);
      // Aprende NA HORA (só compras, não estornos): próxima vez que digitar
      // essa descrição, já vem com categoria + subcategoria preenchidas.
      const kAprend = desc.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
      if (kAprend && !estorno) {
        setAprendidoSessao(prev => ({ ...prev, [kAprend]: { categoria: catFinal, subcategoria: subFinal || '' } }));
      }
      localStorage.setItem(LS_CARD, cardId);
      invalidate();

      // Limpa e volta o foco pra próxima compra
      setDescricao('');
      setValor(0);
      setParcAtual('');
      setParcTotal('');
      setCategoria('');
      setSubcategoria('');
      setEstorno(false);
      descRef.current?.focus();
    } catch (err: any) {
      toast({ title: 'Erro ao lançar', description: String(err?.message || err).slice(0, 160), variant: 'destructive' });
    }
    setSubmitting(false);
  };

  const desfazer = async (l: Lancado) => {
    try {
      // Parcelado: apaga a série inteira pelo grupo. À vista: só a transação.
      if (l.grupoParcela) {
        await supabase.from('transacoes').delete().eq('grupo_parcela', l.grupoParcela).eq('user_id', user!.id);
      } else {
        await supabase.from('transacoes').delete().eq('id', l.id);
      }
      setSessao(prev => prev.filter(x => x.id !== l.id));
      invalidate();
    } catch (err: any) {
      toast({ title: 'Erro ao desfazer', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Lançamento rápido de cartão
          </DialogTitle>
          <DialogDescription>
            Escolha o cartão e a fatura uma vez. Depois é só descrição + valor + Enter.
          </DialogDescription>
        </DialogHeader>

        {/* TOPO FIXO: cartão + fatura — escolhidos 1x */}
        <div className="grid grid-cols-[1fr_auto] gap-3 items-end pb-1">
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1"><CreditCard className="h-3 w-3" /> Cartão</Label>
            <Select value={cardId} onValueChange={setCardId}>
              <SelectTrigger><SelectValue placeholder="Selecione o cartão" /></SelectTrigger>
              <SelectContent>
                {(cards || []).map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fatura</Label>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon" className="h-9 w-8" onClick={prevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium tabular w-20 text-center">{getMonthName(compMonth).slice(0, 3)}/{String(compYear).slice(2)}</span>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-8" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* LISTA: tabela contínua. Cabeçalho + linha de entrada + itens. */}
        <div className="rounded-xl border overflow-hidden">
          {/* Cabeçalho de colunas */}
          <div className="grid grid-cols-[1fr_80px_84px_32px] gap-2 px-2.5 py-1.5 bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>Descrição</span>
            <span className="text-right">Valor</span>
            <span className="text-center">Parc/tot</span>
            <span></span>
          </div>

          {/* Linha de entrada ativa (sempre no topo, fica fixa) */}
          <form
            onSubmit={(e) => { e.preventDefault(); lancar(); }}
            className="border-b bg-primary/5"
          >
            <div className="grid grid-cols-[1fr_80px_84px_32px] gap-2 px-2.5 py-2 items-center">
              <Input
                ref={descRef}
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                placeholder="Mercado São João"
                className="h-8 border-0 bg-transparent px-1 focus-visible:ring-1"
                autoFocus
              />
              <MoneyInput
                value={valor}
                onChange={setValor}
                placeholder="0,00"
                className="h-8 text-right border-0 bg-transparent px-1 focus-visible:ring-1"
              />
              <div className="flex items-center gap-0.5">
                <Input
                  value={parcAtual}
                  onChange={e => setParcAtual(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="—"
                  inputMode="numeric"
                  className="h-8 w-9 text-center border-0 bg-transparent px-0.5 focus-visible:ring-1"
                  title="Parcela atual (a que cai nesta fatura). Vazio = à vista."
                />
                <span className="text-muted-foreground text-sm">/</span>
                <Input
                  value={parcTotal}
                  onChange={e => setParcTotal(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="—"
                  inputMode="numeric"
                  className="h-8 w-9 text-center border-0 bg-transparent px-0.5 focus-visible:ring-1"
                  title="Total de parcelas. Ex: atual 5 / total 12."
                />
              </div>
              <Button
                type="submit"
                size="icon"
                disabled={submitting || !cardId || !descricao.trim() || !valor}
                className="h-8 w-8"
                title="Lançar (Enter)"
              >
                <Zap className="h-4 w-4" />
              </Button>
            </div>
            {/* Categoria auto + estorno + hint de parcelamento na linha de apoio */}
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
                {estorno ? (
                  <span className="text-[11px] text-green-500 font-medium">↩ Estorno — abate a fatura</span>
                ) : (
                  <>
                    <span>Categoria:</span>
                    <Select value={catFinal} onValueChange={(v) => { setCategoria(v); setSubcategoria(''); }}>
                      <SelectTrigger className="h-6 text-[11px] border-0 bg-secondary/50 px-2 gap-1 w-auto"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIAS_DESPESA.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {subsDisponiveis.length > 0 && (
                      <>
                        <span>›</span>
                        <Select value={subFinal || '__none__'} onValueChange={(v) => setSubcategoria(v === '__none__' ? '' : v)}>
                          <SelectTrigger className="h-6 text-[11px] border-0 bg-secondary/50 px-2 gap-1 w-auto"><SelectValue placeholder="sub (opcional)" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— sem sub —</SelectItem>
                            {subsDisponiveis.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </>
                    )}
                    {veioDoHistorico && (
                      <span className="text-[10px] text-primary" title="Sugerido pelo seu histórico de lançamentos">↩ histórico</span>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {pTotalVal > 1 && !estorno && (
                  <span className="text-[11px] text-primary text-right">
                    {pAtualVal}/{pTotalVal} · + {nRows - 1} fut.
                  </span>
                )}
                {/* Toggle estorno */}
                <button
                  type="button"
                  onClick={() => setEstorno(e => !e)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${estorno ? 'bg-green-500/15 border-green-500/50 text-green-500' : 'border-muted text-muted-foreground hover:text-foreground'}`}
                  title="Marca como estorno/devolução — vira crédito que abate a fatura"
                >
                  estorno
                </button>
              </div>
            </div>
          </form>

          {/* Itens já lançados nesta sessão */}
          {sessao.length > 0 && (
            <div className="max-h-52 overflow-y-auto divide-y divide-border/50">
              {sessao.map(l => {
                const ehEstornoItem = l.valor < 0 || l.categoria === 'Estorno';
                return (
                <div key={l.id} className="grid grid-cols-[1fr_80px_84px_32px] gap-2 px-2.5 py-2 items-center text-sm hover:bg-secondary/20">
                  <div className="min-w-0">
                    <p className="truncate">{l.descricao}</p>
                    <p className="text-[10px] text-muted-foreground">{ehEstornoItem ? '↩ Estorno' : `${l.categoria}${l.subcategoria ? ` › ${l.subcategoria}` : ''}`}</p>
                  </div>
                  <span className={`tabular text-right text-sm ${ehEstornoItem ? 'text-green-500' : 'text-destructive'}`}>
                    {ehEstornoItem ? '+' : ''}{formatCurrency(Math.abs(l.valor))}
                  </span>
                  <span className="text-center text-[11px] text-muted-foreground">{l.parcelaTotal > 1 ? `${l.parcelaAtual}/${l.parcelaTotal}` : ehEstornoItem ? '—' : 'à vista'}</span>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => desfazer(l)} title={l.parcelaTotal > 1 ? 'Desfazer série inteira' : 'Desfazer'}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                );
              })}
            </div>
          )}

          {/* Rodapé: total REAL da fatura (todos os lançamentos do mês, não só
              os desta sessão). A linha menor mostra quanto você lançou agora. */}
          {cardId && (
            <div className="px-2.5 py-2 bg-secondary/40 border-t space-y-0.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5" />
                  Fatura {cardNome} {getMonthName(compMonth).slice(0, 3)}/{String(compYear).slice(2)}
                </span>
                <span className="font-bold tabular text-destructive text-base">
                  {faturaLoading ? '…' : formatCurrency(totalFatura)}
                </span>
              </div>
              {sessao.length > 0 && (
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{sessao.length} {sessao.length === 1 ? 'lançado' : 'lançados'} agora</span>
                  <span className="tabular">{formatCurrency(totalSessao)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground text-center">
          Descrição → Tab → valor → <kbd className="px-1 rounded bg-muted">Enter</kbd>. Parcelas só se tiver.
        </p>
      </DialogContent>
    </Dialog>
  );
}
