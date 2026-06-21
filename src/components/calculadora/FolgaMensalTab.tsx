import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { getCategoriaColor } from '@/types/database.types';
import { useTransacoes12m } from '@/hooks/useTransacoes12m';
import { useTransacoesPeriodo } from '@/hooks/useTransacoesMes';
import { useFontesReceita } from '@/hooks/useFontesReceita';
import { useTodayIso } from '@/hooks/useTodayIso';
import { mediaPorCategoriaNaoParcela, reposicaoParcelasNovas } from '@/lib/analytics-engine';
import { projetarFolga } from '@/lib/projecao-folga';
import { Home, TrendingDown, TrendingUp, X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';

/**
 * "Cabe no mês?" — projeção de folga construída a partir das MÉDIAS POR
 * CATEGORIA dos últimos meses (editáveis), não de um total opaco. Modela a
 * troca aluguel→financiamento, quitação de dívidas e compras da casa, com as
 * parcelas decaindo e uma reposição realista de parcelas novas.
 */
export function FolgaMensalTab() {
  const { data: txs, isLoading } = useTransacoes12m();
  const { receitaBase } = useFontesReceita();
  const todayIso = useTodayIso();

  const anoBase = Number(todayIso.slice(0, 4));
  const { data: parcelasFuturas } = useTransacoesPeriodo({
    inicioComp: `${anoBase}-01`,
    fimComp: `${anoBase + 3}-12`,
    inicioData: `${anoBase}-01-01`,
    fimData: `${anoBase + 3}-12-31`,
    apenasVisivelDashboard: true,
    apenasParceladas: true,
    cachePrefix: 'parcelas-folga',
  });

  const [renda, setRenda] = useState(0);
  const [categorias, setCategorias] = useState<Record<string, number>>({});
  const [aluguel, setAluguel] = useState(0);
  const [financiamento, setFinanciamento] = useState(0);
  const [comprasParcela, setComprasParcela] = useState(0);
  const [comprasMeses, setComprasMeses] = useState(18);
  const [emprestimos, setEmprestimos] = useState(0);
  const [carro, setCarro] = useState(0);
  const [reposicao, setReposicao] = useState(0);
  const [mesesAteMudanca, setMesesAteMudanca] = useState(3);
  const [quitarEmprestimos, setQuitarEmprestimos] = useState(true);
  const [quitarCarro, setQuitarCarro] = useState(true);
  const [prefilled, setPrefilled] = useState(false);

  const mediasCat = useMemo(
    () => (txs ? mediaPorCategoriaNaoParcela(txs, 5, todayIso) : []),
    [txs, todayIso],
  );

  // Pré-preenche 1x: renda, categorias (médias 5 meses) e reposição.
  useEffect(() => {
    if (prefilled || !txs) return;
    if (receitaBase > 0) setRenda(Math.round(receitaBase * 100) / 100);
    const cats: Record<string, number> = {};
    for (const c of mediasCat) cats[c.categoria] = c.media;
    setCategorias(cats);
    setReposicao(reposicaoParcelasNovas(txs, 5, todayIso));
    setPrefilled(true);
  }, [txs, mediasCat, receitaBase, todayIso, prefilled]);

  const parcelasPorMes = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of (parcelasFuturas || []) as any[]) {
      const k = p.mes_competencia || (p.data || '').substring(0, 7);
      if (k) m[k] = (m[k] || 0) + Number(p.valor);
    }
    return m;
  }, [parcelasFuturas]);

  const recorrente = useMemo(
    () => Math.round(Object.values(categorias).reduce((s, v) => s + (v || 0), 0) * 100) / 100,
    [categorias],
  );

  const mesAtual = todayIso.slice(0, 7);
  const deducoes = aluguel + (quitarCarro ? carro : 0) + (quitarEmprestimos ? emprestimos : 0);
  const baseFixaAtual = recorrente;
  const baseFixaNova = Math.max(0, recorrente - deducoes) + financiamento;

  const timeline = useMemo(() => projetarFolga({
    renda, baseFixaAtual, baseFixaNova, parcelasPorMes, reposicao,
    comprasCasaParcela: comprasParcela, comprasCasaMeses: Math.max(0, comprasMeses),
    mesAtual, mesesAteMudanca: Math.max(0, mesesAteMudanca), nMeses: 24,
  }), [renda, baseFixaAtual, baseFixaNova, parcelasPorMes, reposicao, comprasParcela, comprasMeses, mesAtual, mesesAteMudanca]);

  if (isLoading) {
    return <Card><CardContent className="p-6"><Skeleton className="h-64" /></CardContent></Card>;
  }

  const idxMudanca = Math.min(Math.max(0, mesesAteMudanca), 23);
  const parcelasHoje = Math.max(parcelasPorMes[mesAtual] || 0, reposicao);
  const comprometimentoHoje = Math.round((recorrente + parcelasHoje) * 100) / 100;
  const mesMudanca = timeline[idxMudanca];
  const depois1 = mesMudanca?.comprometimento ?? 0;
  const alivio = Math.round((comprometimentoHoje - depois1) * 100) / 100;
  const folga1 = mesMudanca?.folga ?? 0;
  const labelMudanca = mesMudanca?.label ?? '';
  const idxFimCompras = idxMudanca + Math.max(0, comprasMeses);
  const fimCompras = comprasParcela > 0 && comprasMeses > 0 && idxFimCompras < 24 ? timeline[idxFimCompras] : null;

  const catEntries = Object.entries(categorias).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      {/* Resultado em destaque */}
      <Card className={folga1 >= 0 ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5'}>
        <CardContent className="p-5 md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">
                {mesesAteMudanca > 0 ? `Quando mudar (${labelMudanca}), todo mês você` : 'Logo que mudar, todo mês você'}
              </p>
              <p className={`num-display text-3xl md:text-4xl mt-1 ${folga1 >= 0 ? 'text-success' : 'text-destructive'}`}>
                {folga1 >= 0 ? 'sobra ' : 'falta '}{formatCurrency(Math.abs(folga1))}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Sua conta vai de <strong className="tabular">{formatCurrency(comprometimentoHoje)}</strong> (hoje) pra{' '}
                <strong className="tabular">{formatCurrency(depois1)}</strong> (depois)
                {alivio !== 0 && <> — {alivio >= 0 ? 'alívio' : 'aumento'} de <strong className="tabular">{formatCurrency(Math.abs(alivio))}</strong>/mês</>}
              </p>
            </div>
            {folga1 >= 0
              ? <TrendingUp className="h-7 w-7 text-success shrink-0" />
              : <TrendingDown className="h-7 w-7 text-destructive shrink-0" />}
          </div>
          {fimCompras && (
            <p className="text-[12px] text-success mt-3">
              Quando as compras da casa terminarem ({fimCompras.label}), a folga sobe pra {formatCurrency(fimCompras.folga)}/mês.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Projeção mês a mês */}
      <Card>
        <CardContent className="p-5 md:p-6">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Folga mês a mês (24 meses)</p>
          <p className="text-xs text-muted-foreground mb-3">
            Verde = sobra, vermelho = falta. As parcelas que terminam aliviam; a reposição segura o piso.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={timeline}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
              <Tooltip
                formatter={(v: number) => [formatCurrency(v), 'Folga']}
                labelFormatter={(l) => `Mês ${l}`}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              {mesesAteMudanca > 0 && mesMudanca && (
                <ReferenceLine x={mesMudanca.label} stroke="hsl(var(--primary))" strokeDasharray="3 3"
                  label={{ value: 'muda', fontSize: 10, fill: 'hsl(var(--primary))', position: 'top' }} />
              )}
              <Bar dataKey="folga" radius={[3, 3, 0, 0]}>
                {timeline.map((m, i) => (
                  <Cell key={i} fill={m.folga >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Gastos recorrentes por categoria (editável) */}
      <Card>
        <CardContent className="p-5 md:p-6">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-semibold">Gastos recorrentes (média de 5 meses)</h3>
            <span className="text-sm font-semibold tabular">{formatCurrency(recorrente)}/mês</span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Cada categoria com sua média (sem parcelas de cartão). <strong>Revise e conserte</strong> o que estiver
            irreal — é o que segura a conta. Inclui aluguel (em Casa), carro (em Transporte) e empréstimos.
          </p>
          {catEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem meses completos pra calcular médias ainda.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {catEntries.map(([cat, val]) => (
                <div key={cat} className="space-y-1">
                  <Label className="text-xs flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getCategoriaColor(cat) }} />
                    {cat}
                  </Label>
                  <div className="flex items-center gap-1">
                    <MoneyInput value={val} onChange={(n) => setCategorias((p) => ({ ...p, [cat]: n }))} placeholder="0,00" />
                    <button type="button" onClick={() => setCategorias((p) => { const c = { ...p }; delete c[cat]; return c; })}
                      className="text-muted-foreground hover:text-destructive shrink-0 p-1" aria-label={`Remover ${cat}`} title="Tirar da conta">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* A casa nova + transição */}
      <Card>
        <CardContent className="p-5 md:p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Home className="h-4 w-4" /> A casa nova
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Daqui a quantos meses você muda?</Label>
                <Input type="number" min={0} max={36} inputMode="numeric" value={mesesAteMudanca}
                  onChange={(e) => setMesesAteMudanca(Math.max(0, Math.min(36, parseInt(e.target.value) || 0)))} />
                <p className="text-[11px] text-muted-foreground">Até lá, segue a situação atual. 0 = já.</p>
              </div>
              <Field label="Financiamento (parcela/mês)" value={financiamento} onChange={setFinanciamento} hint="Entra no lugar do aluguel." />
              <Field label="Compras pra casa (parcela/mês)" value={comprasParcela} onChange={setComprasParcela} />
              <div className="space-y-1">
                <Label className="text-xs">Compras: em quantos meses?</Label>
                <Input type="number" min={1} max={60} inputMode="numeric" value={comprasMeses}
                  onChange={(e) => setComprasMeses(Math.max(1, Math.min(60, parseInt(e.target.value) || 1)))} />
                <p className="text-[11px] text-muted-foreground">Depois disso, a folga sobe.</p>
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">O que sai / você quita ao mudar</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Aluguel atual (sai)" value={aluguel} onChange={setAluguel} hint="Está dentro de Casa acima; descontado quando mudar." />
              <Field label="Reposição de parcelas novas /mês" value={reposicao} onChange={setReposicao} hint="Parcelas que sempre aparecem (São João etc.). Piso da projeção." />
              <div className="space-y-2">
                <Field label="Empréstimos (parcela/mês)" value={emprestimos} onChange={setEmprestimos} />
                <div className="flex items-center gap-2">
                  <Switch checked={quitarEmprestimos} onCheckedChange={setQuitarEmprestimos} id="q-emp" />
                  <Label htmlFor="q-emp" className="text-xs cursor-pointer">Vou quitar com o dinheiro do apê</Label>
                </div>
              </div>
              <div className="space-y-2">
                <Field label="Carro (parcela/mês)" value={carro} onChange={setCarro} />
                <div className="flex items-center gap-2">
                  <Switch checked={quitarCarro} onCheckedChange={setQuitarCarro} id="q-carro" />
                  <Label htmlFor="q-carro" className="text-xs cursor-pointer">Vou quitar com o dinheiro do apê</Label>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Aluguel, carro e empréstimos já estão dentro das categorias acima — marcar "quitar"/"sai" desconta da conta (não soma de novo).
            </p>
          </div>

          <div className="border-t pt-4">
            <Field label="Renda mensal" value={renda} onChange={setRenda} hint="Puxado das suas fontes de receita." />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <MoneyInput value={value} onChange={onChange} placeholder="0,00" />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
