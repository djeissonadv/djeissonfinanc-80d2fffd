import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { MoneyInput } from '@/components/ui/money-input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { useTransacoes12m } from '@/hooks/useTransacoes12m';
import { useFontesReceita } from '@/hooks/useFontesReceita';
import { useTodayIso } from '@/hooks/useTodayIso';
import { buildGastosMedios } from '@/lib/analytics-engine';
import { Home, TrendingDown, TrendingUp } from 'lucide-react';

/**
 * "Cabe no mês?" — calculadora prática de FOLGA mensal pra decisão da casa.
 *
 * Cenário do usuário: vai sair do aluguel e começar a pagar financiamento (uma
 * troca), pode quitar empréstimos e o carro com o dinheiro do apartamento, e
 * quer saber se passa o mês com o que tem — incluindo as compras da casa.
 *
 * Pré-preenche renda (fontes de receita) e gastos médios (raio-X dos últimos
 * meses). O usuário ajusta e completa o que falta. Tudo editável.
 */
export function FolgaMensalTab() {
  const { data: txs, isLoading } = useTransacoes12m();
  const { receitaBase } = useFontesReceita();
  const todayIso = useTodayIso();

  const [renda, setRenda] = useState(0);
  const [gastosMedios, setGastosMedios] = useState(0);
  const [aluguelAtual, setAluguelAtual] = useState(0);
  const [financiamento, setFinanciamento] = useState(0);
  const [comprasCasa, setComprasCasa] = useState(0);
  const [emprestimos, setEmprestimos] = useState(0);
  const [carro, setCarro] = useState(0);
  const [quitarEmprestimos, setQuitarEmprestimos] = useState(true);
  const [quitarCarro, setQuitarCarro] = useState(true);
  const [prefilled, setPrefilled] = useState(false);

  // Pré-preenche 1x quando os dados chegam (renda + média de gastos).
  useEffect(() => {
    if (prefilled || !txs) return;
    const gm = buildGastosMedios(txs, 6, todayIso);
    if (receitaBase > 0) setRenda(Math.round(receitaBase * 100) / 100);
    if (gm.mediaMensal > 0) setGastosMedios(gm.mediaMensal);
    setPrefilled(true);
  }, [txs, receitaBase, todayIso, prefilled]);

  if (isLoading) {
    return <Card><CardContent className="p-6"><Skeleton className="h-64" /></CardContent></Card>;
  }

  // Aluguel sai e vira financiamento → desconta o aluguel da média (senão conta 2x).
  const gastosAjustados = Math.max(0, gastosMedios - aluguelAtual);
  const dividas = (quitarEmprestimos ? 0 : emprestimos) + (quitarCarro ? 0 : carro);
  const comprometimento = gastosAjustados + financiamento + comprasCasa + dividas;
  const folga = renda - comprometimento;
  const pctComprometido = renda > 0 ? Math.round((comprometimento / renda) * 100) : 0;
  const economiaQuitando = (quitarEmprestimos ? emprestimos : 0) + (quitarCarro ? carro : 0);

  return (
    <div className="space-y-4">
      {/* Resultado em destaque */}
      <Card className={folga >= 0 ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5'}>
        <CardContent className="p-5 md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">No fim do mês, com tudo isso, você</p>
              <p className={`num-display text-3xl md:text-4xl mt-1 ${folga >= 0 ? 'text-success' : 'text-destructive'}`}>
                {folga >= 0 ? 'sobra ' : 'falta '}{formatCurrency(Math.abs(folga))}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Comprometendo {formatCurrency(comprometimento)} de {formatCurrency(renda)} ({pctComprometido}% da renda)
              </p>
            </div>
            {folga >= 0
              ? <TrendingUp className="h-7 w-7 text-success shrink-0" />
              : <TrendingDown className="h-7 w-7 text-destructive shrink-0" />}
          </div>
          {economiaQuitando > 0 && (
            <p className="text-[12px] text-success mt-3">
              Quitando o que você marcou, libera {formatCurrency(economiaQuitando)}/mês de parcela.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Entradas */}
      <Card>
        <CardContent className="p-5 md:p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Home className="h-4 w-4" /> O que entra e o dia a dia
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Renda mensal" value={renda} onChange={setRenda} hint="Puxado das suas fontes de receita — ajuste se quiser." />
              <Field label="Gastos médios do dia a dia" value={gastosMedios} onChange={setGastosMedios} hint="Média dos últimos meses (raio-X). Inclui o aluguel atual." />
              <Field label="Aluguel atual (vai sair)" value={aluguelAtual} onChange={setAluguelAtual} hint="Quando mudar, o aluguel some. Coloque aqui pra descontar da média." />
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">A casa nova</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Financiamento (parcela/mês)" value={financiamento} onChange={setFinanciamento} hint="Entra no lugar do aluguel." />
              <Field label="Compras pra casa (parcelas/mês)" value={comprasCasa} onChange={setComprasCasa} hint="Total estimado das parcelas de móveis/eletro." />
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">Dívidas atuais</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          </div>
        </CardContent>
      </Card>

      {/* Resumo do comprometimento */}
      <Card>
        <CardContent className="p-5 md:p-6">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Pra onde vai a renda</p>
          <div className="space-y-2 text-sm">
            <Linha label="Dia a dia (sem aluguel)" valor={gastosAjustados} />
            <Linha label="Financiamento da casa" valor={financiamento} />
            <Linha label="Compras pra casa" valor={comprasCasa} />
            {!quitarEmprestimos && emprestimos > 0 && <Linha label="Empréstimos" valor={emprestimos} />}
            {!quitarCarro && carro > 0 && <Linha label="Carro" valor={carro} />}
            <div className="flex justify-between border-t pt-2 font-semibold">
              <span>Total comprometido</span>
              <span className="tabular text-destructive">{formatCurrency(comprometimento)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Renda</span>
              <span className="tabular text-success">{formatCurrency(renda)}</span>
            </div>
            <div className={`flex justify-between font-bold ${folga >= 0 ? 'text-success' : 'text-destructive'}`}>
              <span>{folga >= 0 ? 'Sobra' : 'Falta'}</span>
              <span className="tabular">{formatCurrency(Math.abs(folga))}</span>
            </div>
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

function Linha({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{formatCurrency(valor)}</span>
    </div>
  );
}
