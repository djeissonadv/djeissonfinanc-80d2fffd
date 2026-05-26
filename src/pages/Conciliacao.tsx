import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTodayIso } from '@/hooks/useTodayIso';
import { formatCurrency } from '@/lib/format';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { normalizeDescription, isFaturaPayment, isDevolution, isSaldoAnteriorFatura, generateHash } from '@/lib/csv-parser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, AlertTriangle, Trash2, CalendarRange, Link2 } from 'lucide-react';

interface Tx {
  id: string;
  conta_id: string;
  descricao: string;
  valor: number;
  tipo: string;
  data: string;
  mes_competencia: string | null;
  categoria: string | null;
  ignorar_dashboard: boolean;
}
interface Conta { id: string; nome: string; tipo: string; saldo_inicial: number | null; }

const MES_LABEL = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const compLabel = (yyyymm: string) => {
  const [y, m] = yyyymm.split('-');
  return `${MES_LABEL[Number(m)] || m}/${(y || '').slice(2)}`;
};

export default function ConciliacaoPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const todayIso = useTodayIso();

  const { data: contas } = useQuery({
    queryKey: ['contas', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('contas').select('id, nome, tipo, saldo_inicial').eq('user_id', user!.id);
      return (data || []) as Conta[];
    },
    enabled: !!user,
  });

  const { data: txs } = useQuery({
    queryKey: ['conciliacao-txs', user?.id],
    queryFn: async () =>
      fetchAllRows<Tx>(() => supabase
        .from('transacoes')
        .select('id, conta_id, descricao, valor, tipo, data, mes_competencia, categoria, ignorar_dashboard')
        .eq('user_id', user!.id)),
    enabled: !!user,
  });

  const removeMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('transacoes').delete().in('id', ids).eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: (_d, ids) => {
      queryClient.invalidateQueries({ queryKey: ['conciliacao-txs'] });
      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      toast({ title: `${ids.length} duplicata(s) removida(s)` });
    },
    onError: (e: any) => toast({ title: 'Erro ao remover', description: e?.message, variant: 'destructive' }),
  });

  // ── Conciliação de faturas: cruza pagamentos no extrato (conta corrente) com a
  //    fatura de um cartão. Ao conciliar: marca o débito como transferência
  //    (ignorar_dashboard) e lança a baixa no cartão (fatura consta paga).
  const [sel, setSel] = useState<Record<string, { cardId: string; period: string }>>({});

  const conc = useMemo(() => {
    if (!contas || !txs) return { pagamentos: [] as any[], cards: [] as Conta[], periodsByCard: {} as Record<string, string[]> };
    const cards = contas.filter((c) => c.tipo === 'credito');
    const debitIds = new Set(contas.filter((c) => c.tipo === 'debito').map((c) => c.id));

    const fatura: Record<string, Record<string, { despesas: number; pagamentos: number }>> = {};
    for (const c of cards) fatura[c.id] = {};
    for (const t of txs) {
      if (!fatura[t.conta_id]) continue;
      if (isSaldoAnteriorFatura(t.descricao)) continue; // artefato de rollover
      const p = t.mes_competencia || t.data.substring(0, 7);
      const b = (fatura[t.conta_id][p] ||= { despesas: 0, pagamentos: 0 });
      if (t.tipo === 'despesa') b.despesas += Number(t.valor);
      if (isFaturaPayment(t.descricao)) b.pagamentos += Math.abs(Number(t.valor));
      if (isDevolution(t.descricao) && t.tipo === 'receita') b.despesas -= Math.abs(Number(t.valor));
    }
    const totalAPagar = (cardId: string, period: string) => {
      const periods = Object.keys(fatura[cardId] || {}).sort();
      let ant = 0;
      for (const p of periods) if (p < period) ant += fatura[cardId][p].despesas - fatura[cardId][p].pagamentos;
      ant = Math.max(0, ant);
      const cur = fatura[cardId][period] || { despesas: 0, pagamentos: 0 };
      return ant + cur.despesas - cur.pagamentos;
    };
    // TODOS os meses do cartão que têm lançamento (não só os "em aberto") —
    // ordenados do mais recente pro mais antigo. Assim você sempre pode escolher
    // o mês certo (ex: janeiro), mesmo que a fatura já apareça zerada.
    const periodsByCard: Record<string, string[]> = {};
    for (const c of cards) {
      periodsByCard[c.id] = Object.keys(fatura[c.id])
        .filter((p) => Math.abs(fatura[c.id][p].despesas) > 0.01 || Math.abs(fatura[c.id][p].pagamentos) > 0.01)
        .sort()
        .reverse();
    }

    // Candidato a pagamento de fatura na conta corrente: além do "PAGTO FATURA"
    // clássico (isFaturaPayment), inclui PIX/transferência ao Mercado Pago
    // (CNPJ 10573521000191), que paga a fatura do cartão MP mas não tem a palavra
    // "fatura" no texto. Como pode ser fatura OU parcela de empréstimo, fica como
    // candidato pra VOCÊ conciliar (não classifica sozinho).
    const ehPagamentoCartao = (desc: string) =>
      isFaturaPayment(desc) ||
      /mercado\s*pago/i.test(desc) ||
      desc.includes('10573521000191');

    const pagamentos = txs
      .filter((t) => debitIds.has(t.conta_id) && t.tipo === 'despesa' && ehPagamentoCartao(t.descricao) && !t.ignorar_dashboard)
      .map((pay) => {
        const payMonth = (pay.data || '').substring(0, 7);
        // Match: prioriza o cartão+mês cujo total bate por VALOR (±1), preferindo
        // o mês DO PAGAMENTO (você paga a fatura no mês do débito) e o mês anterior.
        let match: { cardId: string; period: string } | null = null;
        const prefer = (p: string) => (p === payMonth ? 0 : p < payMonth ? 1 : 2); // mês do pgto > anteriores > futuros
        for (const c of cards) {
          const cands = periodsByCard[c.id]
            .filter((p) => Math.abs(totalAPagar(c.id, p) - Number(pay.valor)) <= 1)
            .sort((a, b) => prefer(a) - prefer(b) || b.localeCompare(a));
          if (cands.length) { match = { cardId: c.id, period: cands[0] }; break; }
        }
        // default do mês: o mês do pagamento, se o cartão tiver lançamento nele.
        const defaultPeriod = match
          ? (periodsByCard[match.cardId].includes(payMonth) ? payMonth : match.period)
          : '';
        const defaultMatch = match ? { cardId: match.cardId, period: defaultPeriod } : null;
        return { pay, contaNome: contas.find((c) => c.id === pay.conta_id)?.nome || '', match: defaultMatch };
      });

    return { pagamentos, cards, periodsByCard };
  }, [contas, txs]);

  const conciliarMutation = useMutation({
    mutationFn: async ({ payId, cardId, period, valor }: { payId: string; cardId: string; period: string; valor: number }) => {
      const cardNome = (contas || []).find((c) => c.id === cardId)?.nome || 'Cartão';
      // 1) o débito da conta corrente vira transferência (não despesa solta do dashboard)
      const { error: e1 } = await supabase.from('transacoes')
        .update({ ignorar_dashboard: true, categoria: 'Pagamento Fatura' })
        .eq('id', payId).eq('user_id', user!.id);
      if (e1) throw e1;

      // 2) baixa no cartão — SÓ se a fatura ainda não estiver coberta. Muitas
      // faturas (Sicredi/Nubank) já trazem a linha de pagamento no próprio extrato;
      // criar outra aqui pagaria em DOBRO (foi o que zerou/negativou o Black).
      const cardTxs = (txs || []).filter((t) => t.conta_id === cardId && (t.mes_competencia || t.data.substring(0, 7)) === period);
      const compras = cardTxs
        .filter((t) => t.tipo === 'despesa' && !isFaturaPayment(t.descricao) && !isSaldoAnteriorFatura(t.descricao))
        .reduce((s, t) => s + Number(t.valor), 0)
        - cardTxs.filter((t) => isDevolution(t.descricao) && t.tipo === 'receita').reduce((s, t) => s + Math.abs(Number(t.valor)), 0);
      const pagoExistente = cardTxs.filter((t) => isFaturaPayment(t.descricao)).reduce((s, t) => s + Math.abs(Number(t.valor)), 0);
      const falta = compras - pagoExistente; // quanto ainda falta pagar nessa fatura
      const aBaixar = Math.min(Number(valor), falta);

      if (aBaixar > 0.5) {
        const baseDate = `${period}-01`;
        const hash = generateHash(baseDate, `Pag Fat Deb Cc - ${cardNome}`, aBaixar, 'Conciliacao') + '_conc';
        const { error: e2 } = await supabase.from('transacoes').insert({
          user_id: user!.id, conta_id: cardId, data: baseDate, mes_competencia: period,
          descricao: `Pag Fat Deb Cc - ${cardNome}`, valor: aBaixar, categoria: 'Pagamento Fatura',
          tipo: 'receita', essencial: true, ignorar_dashboard: true, hash_transacao: hash,
          pessoa: user?.user_metadata?.full_name || 'Titular',
        });
        if (e2) throw e2;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conciliacao-txs'] });
      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });
      queryClient.invalidateQueries({ queryKey: ['faturas'] });
      toast({ title: 'Fatura conciliada', description: 'O débito virou transferência. A baixa no cartão só é criada se a fatura ainda não estava paga (evita pagar em dobro).' });
    },
    onError: (e: any) => toast({ title: 'Erro ao conciliar', description: e?.message, variant: 'destructive' }),
  });

  const analise = useMemo(() => {
    if (!contas || !txs) return [];
    return contas.map((c) => {
      const list = txs.filter((t) => t.conta_id === c.id);

      // Saldo calculado (até hoje, ignora "Saldo Inicial" pra não duplicar o campo)
      let saldo = c.saldo_inicial || 0;
      for (const t of list) {
        if (t.categoria === 'Saldo Inicial') continue;
        if (t.data > todayIso) continue;
        saldo += t.tipo === 'receita' ? Number(t.valor) : -Number(t.valor);
      }

      // Duplicatas: mesma desc+valor+data+competência (exclui projeções)
      const groups: Record<string, Tx[]> = {};
      for (const t of list) {
        if (t.descricao.includes('(auto-projetada)')) continue;
        const k = `${normalizeDescription(t.descricao)}|${Number(t.valor).toFixed(2)}|${t.data}|${t.mes_competencia || '-'}`;
        (groups[k] ||= []).push(t);
      }
      const duplicatas = Object.values(groups)
        .filter((g) => g.length > 1)
        .map((g) => ({ amostra: g[0], extras: g.slice(1), total: g.length }));

      // Pagamentos de fatura repetidos (mesmo valor ~igual no mesmo mês)
      const pays = list.filter((t) => isFaturaPayment(t.descricao));
      const payGroups: Record<string, Tx[]> = {};
      for (const t of pays) {
        const k = `${(t.mes_competencia || t.data.substring(0, 7))}|${Number(t.valor).toFixed(2)}`;
        (payGroups[k] ||= []).push(t);
      }
      const pagamentosDup = Object.values(payGroups)
        .filter((g) => g.length > 1)
        .map((g) => ({ amostra: g[0], extras: g.slice(1), total: g.length }));

      // Cobertura de meses
      const meses = Array.from(new Set(list.map((t) => t.mes_competencia || t.data.substring(0, 7)))).sort();
      // Buracos entre o primeiro e o último mês
      const buracos: string[] = [];
      if (meses.length >= 2) {
        const [y0, m0] = meses[0].split('-').map(Number);
        const [y1, m1] = meses[meses.length - 1].split('-').map(Number);
        const set = new Set(meses);
        let y = y0, m = m0;
        while (y < y1 || (y === y1 && m <= m1)) {
          const key = `${y}-${String(m).padStart(2, '0')}`;
          if (!set.has(key)) buracos.push(key);
          m++; if (m > 12) { m = 1; y++; }
        }
      }

      // Faturas pagas em EXCESSO (cartão): período onde os pagamentos somam mais
      // que as compras — sinal de pagamento em dobro (ex: linha do extrato + baixa
      // da conciliação). Lista os pagamentos do período pra você remover o extra.
      const faturasExcesso: { periodo: string; compras: number; pago: number; pagamentos: Tx[] }[] = [];
      if (c.tipo === 'credito') {
        const perMap: Record<string, { compras: number; pago: number; pagamentos: Tx[] }> = {};
        for (const t of list) {
          if (isSaldoAnteriorFatura(t.descricao)) continue;
          const p = t.mes_competencia || t.data.substring(0, 7);
          perMap[p] ||= { compras: 0, pago: 0, pagamentos: [] };
          if (isFaturaPayment(t.descricao)) { perMap[p].pago += Math.abs(Number(t.valor)); perMap[p].pagamentos.push(t); }
          else if (t.tipo === 'despesa') perMap[p].compras += Number(t.valor);
          else if (isDevolution(t.descricao) && t.tipo === 'receita') perMap[p].compras -= Math.abs(Number(t.valor));
        }
        for (const [periodo, v] of Object.entries(perMap)) {
          if (v.pago > v.compras + 0.5 && v.pagamentos.length > 0) {
            faturasExcesso.push({ periodo, compras: v.compras, pago: v.pago, pagamentos: v.pagamentos });
          }
        }
        faturasExcesso.sort((a, b) => a.periodo.localeCompare(b.periodo));
      }

      return { conta: c, saldo, duplicatas, pagamentosDup, faturasExcesso, meses, buracos, total: list.length };
    });
  }, [contas, txs, todayIso]);

  const totalDup = analise.reduce((s, a) => s + a.duplicatas.length + a.pagamentosDup.length + a.faturasExcesso.length, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Conciliação</h1>
        <p className="text-sm text-muted-foreground">
          Confira o saldo de cada conta, duplicatas e meses faltando. {totalDup === 0 ? 'Nenhum problema detectado. ✅' : `${totalDup} ponto(s) de atenção.`}
        </p>
      </div>

      {/* Conciliação de faturas: cruza pagamento do extrato com a fatura do cartão */}
      {conc.pagamentos.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-primary" />
              Conciliação de faturas ({conc.pagamentos.length} pagamento{conc.pagamentos.length > 1 ? 's' : ''} no extrato)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Pagamentos de fatura encontrados na conta corrente. Ligue cada um à fatura do cartão — ela é marcada como paga e o débito vira transferência (para de contar como despesa solta).
            </p>
            {conc.pagamentos.map(({ pay, contaNome, match }) => {
              const escolha = sel[pay.id] || (match ? { cardId: match.cardId, period: match.period } : { cardId: '', period: '' });
              const periods = escolha.cardId ? (conc.periodsByCard[escolha.cardId] || []) : [];
              return (
                <div key={pay.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      <span className="font-medium">{formatCurrency(Number(pay.valor))}</span>
                      <span className="text-muted-foreground"> · {contaNome} · {pay.data} · {pay.descricao.slice(0, 32)}</span>
                    </span>
                    {match && <Badge variant="secondary" className="shrink-0">match automático</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={escolha.cardId}
                      onValueChange={(v) => setSel((s) => ({ ...s, [pay.id]: { cardId: v, period: (conc.periodsByCard[v] || [])[0] || '' } }))}
                    >
                      <SelectTrigger className="h-8 w-[160px]"><SelectValue placeholder="Cartão" /></SelectTrigger>
                      <SelectContent>
                        {conc.cards.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select
                      value={escolha.period}
                      onValueChange={(v) => setSel((s) => ({ ...s, [pay.id]: { cardId: escolha.cardId, period: v } }))}
                      disabled={!escolha.cardId}
                    >
                      <SelectTrigger className="h-8 w-[130px]"><SelectValue placeholder="Fatura (mês)" /></SelectTrigger>
                      <SelectContent>
                        {periods.map((p) => <SelectItem key={p} value={p}>{compLabel(p)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={!escolha.cardId || !escolha.period || conciliarMutation.isPending}
                      onClick={() => conciliarMutation.mutate({ payId: pay.id, cardId: escolha.cardId, period: escolha.period, valor: Number(pay.valor) })}
                    >
                      <Link2 className="mr-1 h-3.5 w-3.5" /> Conciliar
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {analise.map(({ conta, saldo, duplicatas, pagamentosDup, faturasExcesso, meses, buracos, total }) => {
        const semProblema = duplicatas.length === 0 && pagamentosDup.length === 0 && faturasExcesso.length === 0;
        return (
          <Card key={conta.id}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  {semProblema ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                  {conta.nome}
                  <Badge variant="secondary">{conta.tipo === 'credito' ? 'Cartão' : 'Conta'}</Badge>
                </span>
                <span className={`font-bold ${saldo >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {conta.tipo === 'credito' ? '—' : formatCurrency(saldo)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
                <span>{total} lançamentos</span>
                {conta.tipo !== 'credito' && <span>Saldo inicial: {formatCurrency(conta.saldo_inicial || 0)}</span>}
              </div>

              {/* Cobertura de meses */}
              {meses.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <CalendarRange className="h-3.5 w-3.5" /> Meses com lançamento
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {meses.map((m) => <Badge key={m} variant="outline">{compLabel(m)}</Badge>)}
                    {buracos.map((m) => <Badge key={m} variant="destructive" className="opacity-80">falta {compLabel(m)}</Badge>)}
                  </div>
                </div>
              )}

              {/* Duplicatas */}
              {duplicatas.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-destructive">{duplicatas.length} grupo(s) de duplicata</p>
                  {duplicatas.map((d, i) => (
                    <div key={i} className="flex items-center justify-between rounded border p-2">
                      <span className="truncate">
                        <span className="text-muted-foreground">{d.total}x</span> {d.amostra.descricao} — {formatCurrency(Number(d.amostra.valor))} ({d.amostra.data})
                      </span>
                      <ConfirmDelete
                        onConfirm={() => removeMutation.mutate(d.extras.map((e) => e.id))}
                        title="Remover duplicatas?"
                        description={`Mantém 1 lançamento e remove os outros ${d.extras.length}. Não pode ser desfeito.`}
                        confirmLabel={`Remover ${d.extras.length}`}
                        trigger={
                          <Button size="sm" variant="ghost" className="text-destructive shrink-0">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Pagamentos de fatura repetidos */}
              {pagamentosDup.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-destructive">{pagamentosDup.length} pagamento(s) de fatura repetido(s)</p>
                  {pagamentosDup.map((d, i) => (
                    <div key={i} className="flex items-center justify-between rounded border p-2">
                      <span className="truncate">
                        <span className="text-muted-foreground">{d.total}x</span> {d.amostra.descricao} — {formatCurrency(Number(d.amostra.valor))}
                      </span>
                      <ConfirmDelete
                        onConfirm={() => removeMutation.mutate(d.extras.map((e) => e.id))}
                        title="Remover pagamentos repetidos?"
                        description={`Mantém 1 e remove os outros ${d.extras.length}. Não pode ser desfeito.`}
                        confirmLabel={`Remover ${d.extras.length}`}
                        trigger={
                          <Button size="sm" variant="ghost" className="text-destructive shrink-0">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Faturas pagas em excesso (pago > compras) — pagamento em dobro */}
              {faturasExcesso.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-destructive">
                    {faturasExcesso.length} fatura(s) paga(s) em excesso (pagamento em dobro)
                  </p>
                  {faturasExcesso.map((f) => (
                    <div key={f.periodo} className="rounded border p-2 space-y-1">
                      <p className="text-xs text-muted-foreground">
                        {compLabel(f.periodo)} — compras {formatCurrency(f.compras)} · pago <span className="text-destructive font-medium">{formatCurrency(f.pago)}</span>
                      </p>
                      {f.pagamentos.map((t) => (
                        <div key={t.id} className="flex items-center justify-between text-xs pl-2">
                          <span className="truncate">{t.data} · {t.descricao.slice(0, 36)} · {formatCurrency(Number(t.valor))}</span>
                          <ConfirmDelete
                            onConfirm={() => removeMutation.mutate([t.id])}
                            title="Remover este pagamento?"
                            description="Remove esta baixa de fatura (use para apagar o pagamento duplicado). Não pode ser desfeito."
                            confirmLabel="Remover"
                            trigger={
                              <Button size="sm" variant="ghost" className="text-destructive shrink-0 h-7">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {semProblema && <p className="text-xs text-success">Sem duplicatas ou pagamentos repetidos. ✅</p>}
            </CardContent>
          </Card>
        );
      })}

      {analise.length === 0 && <p className="text-muted-foreground">Carregando…</p>}
    </div>
  );
}
