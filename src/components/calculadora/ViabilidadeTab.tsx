import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTodayIso } from '@/hooks/useTodayIso';
import { formatCurrency } from '@/lib/format';
import { fetchAllRows } from '@/lib/supabase-fetch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CheckCircle, XCircle, Info, ArrowRight, Car, ChevronDown, AlertTriangle, Wallet, Home, RefreshCw, Key } from 'lucide-react';
import { SacParams, calcViabilidade } from '@/lib/sac-utils';
import { AiFinancingAnalysis } from './AiFinancingAnalysis';

interface Props {
  params: SacParams;
  onChange: (p: Partial<SacParams>) => void;
}

function CurrencyInput({ value, onChange, label, tooltip }: { value: number; onChange: (v: number) => void; label: string; tooltip?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Label className="text-xs">{label}</Label>
        {tooltip && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
              <TooltipContent><p className="text-xs max-w-[200px]">{tooltip}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
        <Input
          value={value.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
          onChange={e => onChange(parseFloat(e.target.value.replace(/\./g, '').replace(',', '.')) || 0)}
          className="pl-8 h-9"
        />
      </div>
    </div>
  );
}

function PercentInput({ value, onChange, label, tooltip }: { value: number; onChange: (v: number) => void; label: string; tooltip?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Label className="text-xs">{label}</Label>
        {tooltip && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
              <TooltipContent><p className="text-xs max-w-[200px]">{tooltip}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="relative">
        <Input
          value={value.toFixed(2).replace('.', ',')}
          onChange={e => onChange(parseFloat(e.target.value.replace(',', '.')) || 0)}
          className="h-9 pr-8"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
      </div>
    </div>
  );
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle className="h-4 w-4 text-green-500 shrink-0" /> : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
      <span className={ok ? 'text-foreground' : 'text-destructive'}>{label}</span>
    </div>
  );
}

function StatRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${className || ''}`}>{value}</span>
    </div>
  );
}

export function ViabilidadeTab({ params, onChange }: Props) {
  const v = useMemo(() => calcViabilidade(params), [params]);
  const { user } = useAuth();
  const todayIso = useTodayIso();

  // Saldo total das dívidas em aberto = soma das parcelas futuras de
  // categoria 'Empréstimos' (mesmo critério da página Dívidas). Cartão
  // tem fluxo próprio (fatura) e não entra aqui.
  const { data: saldoDividasAtual } = useQuery({
    queryKey: ['saldo-dividas-em-aberto', user?.id, todayIso],
    queryFn: async () => {
      const rows = await fetchAllRows<{ valor: number }>(() => supabase
        .from('transacoes')
        .select('valor')
        .eq('user_id', user!.id)
        .eq('categoria', 'Empréstimos')
        .is('mes_competencia', null)
        .gte('data', todayIso));
      return rows.reduce((s, r) => s + Number(r.valor || 0), 0);
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const diagColor = v.diagnostico === 'viavel'
    ? 'border-green-500/50 bg-green-500/5'
    : v.diagnostico === 'parcial'
      ? 'border-amber-500/50 bg-amber-500/5'
      : 'border-destructive/50 bg-destructive/5';

  const diagEmoji = v.diagnostico === 'viavel' ? '🟢' : v.diagnostico === 'parcial' ? '🟡' : '🔴';
  const diagLabel = v.diagnostico === 'viavel' ? 'VIÁVEL' : v.diagnostico === 'parcial' ? 'PARCIALMENTE VIÁVEL' : 'INVIÁVEL';
  const showSuggestions = v.diagnostico !== 'viavel';

  return (
    <div className="space-y-4">
      {/* ORDEM CRONOLÓGICA: primeiro a VENDA (gera capital), depois a
          AQUISIÇÃO (usa o capital), depois o resumo. Antes a UI mostrava
          dados de aquisição no topo e venda embaixo — invertia o fluxo
          real da operação ("vendo apê pra comprar casa"). */}

      {/* Row 0: VENDA do imóvel atual — entra primeiro porque é o que gera
          capital pra entrada do próximo imóvel. */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Home className="h-4 w-4" />
            1. Venda do imóvel atual → gera capital
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <CurrencyInput label="Valor de venda" value={params.valorVendaImovel} onChange={val => onChange({ valorVendaImovel: val })} tooltip="Valor pelo qual você espera vender o apartamento atual." />
            <CurrencyInput label="Saldo devedor a quitar" value={params.saldoDevedorImovelVender} onChange={val => onChange({ saldoDevedorImovelVender: val })} tooltip="Saldo do financiamento do apartamento que será quitado na venda." />
            <CurrencyInput label="IPTU atrasado" value={params.iptuAtrasado} onChange={val => onChange({ iptuAtrasado: val })} />
            <CurrencyInput label="IR sobre ganho (estimado)" value={params.irVendaEstimado} onChange={val => onChange({ irVendaEstimado: val })} tooltip="Imposto de renda sobre ganho de capital. Confirme o valor com um contador — veja o aviso abaixo." />
            <CurrencyInput label="Outros custos (corretagem)" value={params.outrosCustosVenda} onChange={val => onChange({ outrosCustosVenda: val })} />
            <CurrencyInput label="FGTS disponível" value={params.fgtsDisponivel} onChange={val => onChange({ fgtsDisponivel: val })} tooltip="FGTS que pode ser usado na compra (regras da Caixa se aplicam)." />
          </div>
          {/* Bloco de dívidas a quitar com a venda — pode puxar do app */}
          <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Label className="text-xs font-medium">Dívidas em aberto que você vai quitar com a venda</Label>
              {(saldoDividasAtual ?? 0) > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => onChange({ dividasAbertasQuitar: saldoDividasAtual || 0 })}
                  title="Puxa a soma das parcelas futuras de Empréstimos (página Dívidas)"
                >
                  <RefreshCw className="h-3 w-3" />
                  Puxar de Dívidas ({formatCurrency(saldoDividasAtual || 0)})
                </Button>
              )}
            </div>
            <CurrencyInput
              label=""
              value={params.dividasAbertasQuitar}
              onChange={val => onChange({ dividasAbertasQuitar: val })}
              tooltip="Total de dívidas em aberto que serão quitadas com o líquido da venda (empréstimos, financiamentos, etc). Subtrai do capital disponível pra entrada do novo imóvel."
            />
            <p className="text-[11px] text-muted-foreground">
              Se sobrar dinheiro depois de quitar a dívida, vira capital pra entrada. Se faltar, a venda fica no negativo.
            </p>
          </div>
          <div className="bg-muted/50 rounded-lg p-2.5 space-y-0.5 text-sm">
            <StatRow label="Valor de venda" value={formatCurrency(params.valorVendaImovel)} />
            <StatRow label="(−) Saldo devedor + IPTU + IR + custos" value={`- ${formatCurrency(params.saldoDevedorImovelVender + params.iptuAtrasado + params.irVendaEstimado + params.outrosCustosVenda)}`} className="text-destructive" />
            {params.dividasAbertasQuitar > 0 && (
              <StatRow label="(−) Dívidas em aberto a quitar" value={`- ${formatCurrency(params.dividasAbertasQuitar)}`} className="text-destructive" />
            )}
            <div className="border-t pt-1 mt-1">
              <StatRow label="Líquido da venda" value={formatCurrency(v.liquidoVenda)} className={`font-bold ${v.liquidoVenda < 0 ? 'text-destructive' : ''}`} />
              <StatRow label="+ FGTS" value={formatCurrency(params.fgtsDisponivel)} />
              <StatRow label="+ Outras reservas" value={formatCurrency(params.capitalDisponivel)} />
              <StatRow label="= Capital para a compra" value={formatCurrency(v.capitalParaCompra)} className={`font-bold text-base ${v.capitalParaCompra < 0 ? 'text-destructive' : 'text-primary'}`} />
            </div>
          </div>
          {v.temVenda && v.liquidoVenda < 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-muted-foreground">
                <span className="font-medium text-destructive">Venda no negativo.</span> Os custos da venda{params.dividasAbertasQuitar > 0 ? ' + dívidas a quitar' : ''} superam o valor de venda
                em {formatCurrency(Math.abs(v.liquidoVenda))}. A venda exige dinheiro do bolso — considere quitar parte do saldo devedor antes ou renegociar o valor.
              </p>
            </div>
          )}
          {v.temVenda && (params.irVendaEstimado > 0 || params.saldoDevedorImovelVender > 0) && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Confirme com um contador.</span> O IR sobre ganho de capital e a forma de quitação dependem da titularidade do imóvel
                (no seu caso, em nome de terceiro com acordo de usufruto). Isenções podem mudar bastante o valor.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row 1: AQUISIÇÃO — Dados do Imóvel novo + Resumo SAC */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Key className="h-4 w-4" />
              2. Aquisição — Dados do Imóvel e Financiamento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <CurrencyInput label="Valor do imóvel" value={params.valorImovel} onChange={v => onChange({ valorImovel: v })} />
              <CurrencyInput label={`Entrada (${v.entradaPercent.toFixed(1)}%)`} value={params.entrada} onChange={v => onChange({ entrada: v })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Prazo: {Math.floor(params.prazoMeses / 12)}a ({params.prazoMeses}m)</Label>
              <Slider value={[params.prazoMeses]} onValueChange={([val]) => onChange({ prazoMeses: val })} min={120} max={420} step={12} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <PercentInput label="Taxa juros a.a." value={params.taxaAnualNominal} onChange={v => onChange({ taxaAnualNominal: v })} />
              <PercentInput label="TR a.a." value={params.trAnual} onChange={v => onChange({ trAnual: v })} tooltip="Use ~0% para cenário conservador" />
            </div>
            <div className="bg-muted/50 rounded-lg p-2.5 space-y-0.5 text-sm">
              <StatRow label="Financiado" value={formatCurrency(v.valorFinanciado)} />
              <StatRow label="Taxa mensal" value={`${(v.taxaMensal * 100).toFixed(4)}%`} />
              <StatRow label="Amort. fixa/mês" value={formatCurrency(v.amortFixa)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">3. Resumo de Parcelas SAC</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {[
                { label: 'Mês 1 (primeira)', val: v.parcelaMes1 },
                { label: 'Mês 12 (1 ano)', val: v.parcelaMes12 },
                { label: 'Mês 60 (5 anos)', val: v.parcelaMes60 },
                { label: 'Mês 120 (10 anos)', val: v.parcelaMes120 },
                ...(params.prazoMeses >= 240 ? [{ label: 'Mês 240 (20 anos)', val: v.parcelaMes240 }] : []),
                { label: 'Última parcela', val: v.parcelaUltima },
              ].map(item => (
                <StatRow key={item.label} label={item.label} value={formatCurrency(item.val)} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Custos + Capital | Totais */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Custos de Aquisição</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <PercentInput label="ITBI" value={params.itbiPercent} onChange={v => onChange({ itbiPercent: v })} tooltip="Imposto sobre Transmissão de Bens Imóveis" />
                <PercentInput label="Escritura + Registro" value={params.escrituraPercent} onChange={v => onChange({ escrituraPercent: v })} />
              </div>
              <div className="bg-muted/50 rounded-lg p-2.5 space-y-0.5 text-sm">
                <StatRow label="ITBI" value={formatCurrency(v.itbiRS)} />
                <StatRow label="Escritura" value={formatCurrency(v.escrituraRS)} />
                <StatRow label="Total desembolso" value={formatCurrency(v.totalDesembolso)} className="font-bold" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Capital e Reserva</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <CurrencyInput label="Outras reservas" value={params.capitalDisponivel} onChange={v => onChange({ capitalDisponivel: v })} tooltip="Poupança/investimentos além do líquido da venda e do FGTS (preenchidos no bloco de venda acima)." />
                <div className="space-y-1.5">
                  <Label className="text-xs">Reserva ({params.reservaMeses} meses)</Label>
                  <Slider value={[params.reservaMeses]} onValueChange={([val]) => onChange({ reservaMeses: val })} min={3} max={12} step={1} className="mt-1" />
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-2.5 space-y-0.5 text-sm">
                <StatRow label="Capital para a compra" value={formatCurrency(v.capitalParaCompra)} className="font-medium" />
                <StatRow label="(−) Entrada + ITBI + escritura" value={`- ${formatCurrency(v.totalDesembolso)}`} />
                <StatRow label="(−) Reserva de emergência" value={`- ${formatCurrency(v.reservaNecessaria)}`} />
                <div className="border-t pt-1 mt-1">
                  <StatRow label="Sobra após a compra" value={formatCurrency(v.capitalRestante)} className={v.capitalRestante >= 0 ? 'text-green-500 font-bold' : 'text-destructive font-bold'} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Totais do Financiamento</CardTitle></CardHeader>
          <CardContent>
            <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
              <StatRow label="Total amortizado" value={formatCurrency(v.totalAmortizado)} />
              <StatRow label="Total pago em TR" value={formatCurrency(v.totalTR)} />
              <StatRow label="Total pago em juros" value={formatCurrency(v.totalJuros)} className="text-destructive" />
              <div className="border-t pt-1 mt-1">
                <StatRow label="TOTAL GERAL PAGO" value={formatCurrency(v.totalGeralPago)} className="font-bold text-base" />
              </div>
              <StatRow label="CET (Custo Efetivo Total)" value={formatCurrency(v.custoEfetivoTotal)} className="text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Renda | Checklist + Diagnóstico */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Renda e Capacidade</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <CurrencyInput label="Renda bruta familiar" value={params.rendaBruta} onChange={v => onChange({ rendaBruta: v })} />
              <PercentInput label="Limite comprometimento" value={params.limiteComprometimento} onChange={v => onChange({ limiteComprometimento: v })} />
            </div>
            <CurrencyInput label="Dívidas mensais (carro, etc.)" value={params.dividasMensais} onChange={v => onChange({ dividasMensais: v })} tooltip="Usado no cenário de quitação do carro abaixo. Não entra no cálculo de comprometimento bancário." />
            <div className="bg-muted/50 rounded-lg p-2.5 space-y-0.5 text-sm">
              <StatRow label="Máx. parcela (limite)" value={formatCurrency(v.maxDisponivel)} />
              <StatRow
                label="% comprometida da renda"
                value={`${v.percentComprometida.toFixed(1)}%`}
                className={v.percentComprometida > params.limiteComprometimento ? 'text-destructive' : 'text-green-500'}
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Checklist de Viabilidade</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <CheckItem ok={v.checkEntrada} label={`Entrada ≥ 20% (${v.entradaPercent.toFixed(1)}%)`} />
              <CheckItem ok={v.checkParcela} label={`Parcela ≤ ${params.limiteComprometimento}% da renda (${v.percentComprometida.toFixed(1)}%)`} />
              <CheckItem ok={v.checkCapital} label={`Capital cobre desembolso + reserva (${formatCurrency(v.capitalRestante)})`} />
              <CheckItem ok={v.checkPrazo} label={`Prazo ≤ 420 meses (${params.prazoMeses}m)`} />
            </CardContent>
          </Card>

          <Card className={diagColor}>
            <CardContent className="p-4">
              <div className="text-lg font-bold mb-1">{diagEmoji} {diagLabel}</div>
              <p className="text-sm text-muted-foreground">{v.diagnosticoTexto}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Row 4: Custo de Transição + Impacto | Cenário Carro */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Custo de Transição</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <CurrencyInput label="Aluguel atual" value={params.aluguelAtual} onChange={v => onChange({ aluguelAtual: v })} />
                <CurrencyInput label="Condomínio atual" value={params.condominioAtual} onChange={v => onChange({ condominioAtual: v })} />
                <CurrencyInput label="Parcela carro" value={params.parcelaCarro} onChange={v => onChange({ parcelaCarro: v })} />
              </div>
              <div className="bg-muted/50 rounded-lg p-2.5 space-y-0.5 text-sm">
                <StatRow label="Custo atual (aluguel+condo+carro)" value={formatCurrency(v.custoAtualTotal)} />
                <StatRow label="Parcela imóvel mês 1" value={formatCurrency(v.parcelaMes1)} />
                <StatRow 
                  label="Variação mensal" 
                  value={`${v.deltaMensal >= 0 ? '+' : '-'} ${formatCurrency(Math.abs(v.deltaMensal))}`} 
                  className={v.deltaMensal >= 0 ? 'text-green-500' : 'text-destructive'} 
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {v.deltaMensal >= 0 ? 'Economia: você paga menos que hoje' : 'Custo extra: parcela maior que gastos atuais'}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                Impacto no Orçamento Mensal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/50 rounded-lg p-2.5 space-y-2 text-sm">
                {/* Sub-estado 1: Transição */}
                <div className="space-y-0.5 opacity-60">
                  <p className="text-xs font-medium text-muted-foreground">Durante a transição</p>
                  <StatRow label="Habitação atual (aluguel+condo)" value={formatCurrency(v.totalHabitacaoHoje)} />
                  <StatRow label="+ Parcela financiamento" value={formatCurrency(v.parcelaMes1)} />
                  <StatRow label="+ Outras dívidas" value={formatCurrency(params.dividasMensais)} />
                  <div className="border-t pt-1 mt-1">
                    <StatRow label="Custo total temporário" value={formatCurrency(v.totalHabitacaoHoje + v.parcelaMes1 + params.dividasMensais)} className="font-bold" />
                    <StatRow label="Saldo livre" value={formatCurrency(params.rendaBruta - v.totalHabitacaoHoje - v.parcelaMes1 - params.dividasMensais)} className={(params.rendaBruta - v.totalHabitacaoHoje - v.parcelaMes1 - params.dividasMensais) >= 0 ? 'text-green-500' : 'text-destructive'} />
                  </div>
                </div>
                {/* Sub-estado 2: Após mudança */}
                <div className="space-y-0.5 border-t pt-2">
                  <p className="text-xs font-medium">Após mudança</p>
                  <StatRow label="Parcela financiamento" value={formatCurrency(v.parcelaMes1)} />
                  <StatRow label="+ Outras dívidas" value={formatCurrency(params.dividasMensais)} />
                  <div className="border-t pt-1 mt-1">
                    <StatRow label="Custo mensal definitivo" value={formatCurrency(v.parcelaMes1 + params.dividasMensais)} className="font-bold" />
                    <StatRow label="Saldo livre estimado" value={formatCurrency(params.rendaBruta - v.parcelaMes1 - params.dividasMensais)} className={(params.rendaBruta - v.parcelaMes1 - params.dividasMensais) >= 0 ? 'text-green-500' : 'text-destructive'} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Car className="h-4 w-4" />
              Cenário: Quitação do Carro
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <CurrencyInput label="Saldo devedor do carro" value={params.saldoDevedorCarro} onChange={v => onChange({ saldoDevedorCarro: v })} />
            <div className="bg-muted/50 rounded-lg p-2.5 space-y-0.5 text-sm">
              <StatRow label="Capital líquido após quitar" value={formatCurrency(v.capitalLiquidoSemCarro)} />
              <div className="border-t pt-1 mt-1">
                <StatRow label="% renda SEM quitação" value={`${v.percentSemQuitacao.toFixed(1)}%`} className="text-destructive" />
                <StatRow label="% renda COM quitação" value={`${v.percentComQuitacao.toFixed(1)}%`} className="text-green-500" />
                <StatRow label="Melhora" value={`${v.melhoraComprometimento.toFixed(1)} p.p.`} className="font-bold text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bloco H - Sugestões (collapsible, only when not viable) */}
      {showSuggestions && (
        <Collapsible>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  O que Ajustar
                  <ChevronDown className="h-4 w-4 ml-auto transition-transform" />
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> Aumentar a entrada → reduz saldo financiado e parcela</li>
                  <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> Ampliar o prazo → parcela menor (mais juros no total)</li>
                  <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> Buscar imóvel de menor valor</li>
                  <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> Aumentar renda familiar (cônjuge, freelance, etc.)</li>
                  <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> Quitar outras dívidas antes → libera margem de renda</li>
                  <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> Acumular mais capital antes de comprar</li>
                </ul>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Row 5: AI Analysis (full width) */}
      <AiFinancingAnalysis context={{
        valorImovel: params.valorImovel,
        entrada: params.entrada,
        percEntrada: v.entradaPercent,
        financiado: v.valorFinanciado,
        taxaAnual: params.taxaAnualNominal,
        prazoAnos: Math.floor(params.prazoMeses / 12),
        sistema: 'sac',
        parcelaInicial: v.parcelaMes1,
        totalJuros: v.totalJuros,
        receitaMensal: params.rendaBruta,
        despesasMensais: params.dividasMensais,
        saldoLivre: params.rendaBruta - params.dividasMensais,
        saldoComFinanciamento: params.rendaBruta - params.dividasMensais - v.parcelaMes1,
        percRenda: v.percentComprometida,
        semaforo: v.diagnostico === 'viavel' ? 'verde' : v.diagnostico === 'parcial' ? 'amarelo' : 'vermelho',
        // Origem da entrada: venda do imóvel atual
        temVenda: v.temVenda,
        valorVendaImovel: params.valorVendaImovel,
        liquidoVenda: v.liquidoVenda,
        capitalParaCompra: v.capitalParaCompra,
        capitalRestante: v.capitalRestante,
        reservaNecessaria: v.reservaNecessaria,
      }} />
    </div>
  );
}
