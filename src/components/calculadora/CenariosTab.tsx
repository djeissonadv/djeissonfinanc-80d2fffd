import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency } from '@/lib/format';
import { SacParams, calcTaxaMensal, calcParcelaSAC } from '@/lib/sac-utils';
import { apareceNoDashboard } from '@/lib/transacao-filters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Info, AlertTriangle, TrendingUp, Home, Car, Sparkles, RefreshCw, Edit2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import {
  ChartContainer,
  ChartConfig,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer } from 'recharts';

interface Props {
  params: SacParams;
}

interface RealData {
  receitaMedia: number;
  receitaFonte: 'viabilidade' | 'banco' | 'manual';
  mesesAnalisados: number;
  totalTransacoes: number;
  fixos: {
    moradia: number;
    emprestimos: number;
    assinaturas: number;
    seguros: number;
    telecom: number;
    tarifas: number;
  };
  variaveis: {
    alimentacao: number;
    combustivel: number;
    saude: number;
    beleza: number;
    casa: number;
    comprasOnline: number;
    transporte: number;
    impostos: number;
    educacao: number;
    outros: number;
  };
  catMesesMap: Record<string, number>; // category key -> months with data
}

interface ScenarioParams {
  parcelaFinanciamento: number;
  saldoDevedorCarro: number;
  parcelaCarro: number;
  mesesRestantesCarro: number;
  fgts: number;
  novosGastosImovel: number;
}

// Flexible category matching: normalizes name to a scenario bucket key
// Handles singular/plural, case, accents, and subcategories
function normCatName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .trim();
}

type BucketKey = keyof RealData['fixos'] | keyof RealData['variaveis'] | 'excluded' | null;

function resolveBucket(catName: string): BucketKey {
  const n = normCatName(catName);

  // Excluded (receitas, transferências, operação bancária)
  if (n.startsWith('pagamento de fatura') || n === 'transferencia' || n.startsWith('transferencia entre')
    || n === 'receita' || n.startsWith('investimento') || n.startsWith('investimentos')
    || n === 'outras receitas' || n.startsWith('receita produtora')
    || n.startsWith('freelance') || n === 'devolucoes' || n === 'reembolsos'
    || n.startsWith('operacao bancaria') || n.startsWith('tarifa')
    || n === 'vendas' || n.startsWith('transferencia')) {
    return 'excluded';
  }

  // === FIXOS ===
  // Casa (canônica) engloba aluguel, condomínio, luz, gás, internet, etc.
  if (n === 'casa' || n === 'moradia' || n === 'aluguel' || n === 'condominio'
    || n === 'luz' || n === 'gas' || n === 'internet') return 'moradia';
  if (n.startsWith('emprestimo') || n === 'financiamento') return 'emprestimos';
  if (n.startsWith('assinatura')) return 'assinaturas';
  // Serviços (canônica) = celular/telecom — reaproveita bucket 'telecom'
  if (n === 'servicos' || n === 'telecom' || n === 'celular') return 'telecom';
  // Seguros (legados) — após consolidação a maioria vira Saúde/Transporte, mas mantém fallback
  if (n.startsWith('seguro')) return 'seguros';

  // === VARIÁVEIS ===
  if (n.startsWith('alimenta')) return 'alimentacao';
  if (n.startsWith('combustivel')) return 'combustivel';
  if (n.startsWith('saude')) return 'saude';
  if (n === 'beleza' || n === 'estetica') return 'beleza';
  if (n === 'moveis' || n === 'eletrodomesticos') return 'casa';
  if (n.startsWith('compras')) return 'comprasOnline';
  if (n === 'transporte' || n === 'pedagio' || n === 'manutencao') return 'transporte';
  if (n.startsWith('imposto') || n === 'ipva') return 'impostos';
  if (n.startsWith('educa')) return 'educacao';

  return null; // → vai pra "outros"
}

const FIXED_KEYS = new Set<string>(['moradia', 'emprestimos', 'assinaturas', 'seguros', 'telecom', 'tarifas']);
const VARIABLE_KEYS = new Set<string>(['alimentacao', 'combustivel', 'saude', 'beleza', 'casa', 'comprasOnline', 'transporte', 'impostos', 'educacao']);

function SmallCurrencyInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
        <Input
          value={value.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
          onChange={e => onChange(parseFloat(e.target.value.replace(/\./g, '').replace(',', '.')) || 0)}
          className="pl-8 h-8 text-xs"
        />
      </div>
    </div>
  );
}

export function CenariosTab({ params }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [realData, setRealData] = useState<RealData>({
    receitaMedia: 0, receitaFonte: 'banco', mesesAnalisados: 0, totalTransacoes: 0,
    fixos: { moradia: 0, emprestimos: 0, assinaturas: 0, seguros: 0, telecom: 0, tarifas: 0 },
    variaveis: { alimentacao: 0, combustivel: 0, saude: 0, beleza: 0, casa: 0, comprasOnline: 0, transporte: 0, impostos: 0, educacao: 0, outros: 0 },
    catMesesMap: {},
  });
  const [overrides, setOverrides] = useState<Partial<Record<string, number>>>({});
  const [scenarioParams, setScenarioParams] = useState<ScenarioParams>({
    parcelaFinanciamento: 0,
    saldoDevedorCarro: params.saldoDevedorCarro,
    parcelaCarro: params.dividasMensais,
    mesesRestantesCarro: 24,
    fgts: 0,
    novosGastosImovel: 800,
  });
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    const financiado = params.valorImovel - params.entrada;
    if (financiado > 0) {
      const taxaM = calcTaxaMensal(params.taxaAnualNominal);
      const trM = Math.pow(1 + params.trAnual / 100, 1 / 12) - 1;
      const parcela1 = calcParcelaSAC(financiado, params.prazoMeses, taxaM, trM, 1);
      setScenarioParams(prev => ({ ...prev, parcelaFinanciamento: Math.round(parcela1) }));
    }
  }, [params]);

  useEffect(() => {
    if (!user) return;
    fetchRealData();
  }, [user]);

  async function fetchRealData() {
    setLoading(true);
    try {
      // Fetch transactions with category names via join
      const { data: transactions, error: txError } = await supabase
        .from('transacoes')
        .select('data, valor, tipo, ignorar_dashboard, pago, categoria, categoria_id, categorias!transacoes_categoria_id_fkey(nome)')
        .eq('user_id', user!.id)
        .order('data', { ascending: true });

      if (txError) {
        console.error('[Cenários] Erro ao buscar transações:', txError);
      }

      console.log(`[Cenários] Total transações retornadas: ${transactions?.length || 0}`);

      if (!transactions || transactions.length === 0) {
        // Use rendaBruta from Viabilidade if available
        if (params.rendaBruta > 0) {
          setRealData(prev => ({ ...prev, receitaMedia: params.rendaBruta, receitaFonte: 'viabilidade' }));
        }
        setLoading(false);
        return;
      }

      // Get distinct months (only expense months count toward analysis)
      const expenseMonths = new Set<string>();

      // Build per-category totals and per-category month sets
      const catTotals: Record<string, number> = {};
      const catMonths: Record<string, Set<string>> = {};
      let totalTransacoes = 0;
      let skippedIgnored = 0;
      let skippedReceita = 0;
      let skippedExcluded = 0;

      for (const t of transactions) {
        // apareceNoDashboard exclui ignorar_dashboard=true, categoria='Saldo Inicial'
        // e pago=false. Centraliza o filtro pra acompanhar a regra geral.
        if (!apareceNoDashboard(t as any)) { skippedIgnored++; continue; }
        // NOTE: valor is stored as absolute value in DB — use tipo to distinguish receita/despesa
        if (t.tipo === 'receita') { skippedReceita++; continue; }

        // Get category name: prefer joined categorias.nome, fallback to categoria field
        const catRow = t.categorias as any;
        const catName = catRow?.nome || t.categoria || 'Outros';

        if (resolveBucket(catName) === 'excluded') { skippedExcluded++; continue; }

        const month = t.data.slice(0, 7);
        const absVal = Math.abs(t.valor);
        catTotals[catName] = (catTotals[catName] || 0) + absVal;
        if (!catMonths[catName]) catMonths[catName] = new Set();
        catMonths[catName].add(month);
        expenseMonths.add(month);
        totalTransacoes++;
      }

      const numMonths = expenseMonths.size || 1;

      console.log(`[Cenários] Despesas contabilizadas: ${totalTransacoes} | Ignoradas (dashboard): ${skippedIgnored} | Receitas puladas: ${skippedReceita} | Excluídas (transfer/fatura): ${skippedExcluded} | Meses com despesa: ${numMonths}`);

      const fixos = { moradia: 0, emprestimos: 0, assinaturas: 0, seguros: 0, telecom: 0, tarifas: 0 };
      const variaveis = { alimentacao: 0, combustivel: 0, saude: 0, beleza: 0, casa: 0, comprasOnline: 0, transporte: 0, impostos: 0, educacao: 0, outros: 0 };
      const catMesesMap: Record<string, number> = {};

      // Build per-bucket totals
      const bucketTotals: Record<string, number> = {};
      const bucketMonths: Record<string, Set<string>> = {};
      let totalMapped = 0;
      let unmappedTotal = 0;
      const unmappedMonths = new Set<string>();

      for (const [cat, total] of Object.entries(catTotals)) {
        const mesesComDados = catMonths[cat]?.size || 1;
        const bucket = resolveBucket(cat);
        
        console.log(`[Cenários] Cat: "${cat}" → bucket: "${bucket}", total: ${total.toFixed(2)}, meses: ${mesesComDados}`);
        
        if (bucket === 'excluded') continue;
        
        if (bucket) {
          bucketTotals[bucket] = (bucketTotals[bucket] || 0) + total;
          if (!bucketMonths[bucket]) bucketMonths[bucket] = new Set();
          catMonths[cat]?.forEach(m => bucketMonths[bucket].add(m));
          totalMapped += total;
        } else {
          unmappedTotal += total;
          catMonths[cat]?.forEach(m => unmappedMonths.add(m));
        }
      }

      // Distribute bucket totals into fixos/variaveis using weighted month average
      for (const [bucket, total] of Object.entries(bucketTotals)) {
        const months = bucketMonths[bucket]?.size || 1;
        const avg = Math.round(total / months);
        catMesesMap[bucket] = months;
        if (FIXED_KEYS.has(bucket)) {
          (fixos as any)[bucket] = avg;
        } else if (VARIABLE_KEYS.has(bucket)) {
          (variaveis as any)[bucket] = avg;
        }
      }

      // "Outros" = unmapped expenses
      if (unmappedTotal > 0) {
        variaveis.outros = Math.round(unmappedTotal / (unmappedMonths.size || 1));
        catMesesMap['outros'] = unmappedMonths.size;
      }

      // Revenue: priority 1 = rendaBruta from Viabilidade, priority 2 = avg credits
      let receitaMedia = 0;
      let receitaFonte: RealData['receitaFonte'] = 'banco';
      
      if (params.rendaBruta > 0) {
        receitaMedia = params.rendaBruta;
        receitaFonte = 'viabilidade';
      } else {
        // Average monthly income (tipo='receita') excluding transfers/refunds
        let totalReceita = 0;
        const receitaMonths = new Set<string>();
        for (const t of transactions) {
          if (!apareceNoDashboard(t as any)) continue;
          if (t.tipo !== 'receita') continue;
          const catRow = t.categorias as any;
          const catName = catRow?.nome || t.categoria || '';
          if (resolveBucket(catName) === 'excluded') continue;
          totalReceita += Math.abs(t.valor);
          receitaMonths.add(t.data.slice(0, 7));
        }
        receitaMedia = receitaMonths.size > 0 ? Math.round(totalReceita / receitaMonths.size) : 0;
      }

      setRealData({
        receitaMedia,
        receitaFonte,
        mesesAnalisados: numMonths,
        totalTransacoes,
        fixos,
        variaveis,
        catMesesMap,
      });
    } catch (e) {
      console.error('Error fetching real data:', e);
    } finally {
      setLoading(false);
    }
  }

  const getVal = (key: string, original: number) => overrides[key] ?? original;
  const isOverridden = (key: string) => overrides[key] !== undefined;

  const totalFixos = useMemo(() => {
    return getVal('moradia', realData.fixos.moradia)
      + getVal('emprestimos', realData.fixos.emprestimos)
      + getVal('assinaturas', realData.fixos.assinaturas)
      + getVal('seguros', realData.fixos.seguros)
      + getVal('telecom', realData.fixos.telecom)
      + getVal('tarifas', realData.fixos.tarifas);
  }, [realData, overrides]);

  const totalVariaveis = useMemo(() => {
    return getVal('alimentacao', realData.variaveis.alimentacao)
      + getVal('combustivel', realData.variaveis.combustivel)
      + getVal('saude', realData.variaveis.saude)
      + getVal('beleza', realData.variaveis.beleza)
      + getVal('casa', realData.variaveis.casa)
      + getVal('comprasOnline', realData.variaveis.comprasOnline)
      + getVal('transporte', realData.variaveis.transporte)
      + getVal('impostos', realData.variaveis.impostos)
      + getVal('educacao', realData.variaveis.educacao)
      + getVal('outros', realData.variaveis.outros);
  }, [realData, overrides]);

  const receita = getVal('receita', realData.receitaMedia);
  const moradiaAtual = getVal('moradia', realData.fixos.moradia);
  const parcelaCarro = scenarioParams.parcelaCarro;
  const emprestimosAtual = getVal('emprestimos', realData.fixos.emprestimos);
  const gastosFixosSemMoradia = getVal('assinaturas', realData.fixos.assinaturas) + getVal('seguros', realData.fixos.seguros) + getVal('telecom', realData.fixos.telecom) + getVal('tarifas', realData.fixos.tarifas);
  
  const scenarios = useMemo(() => {
    const empSemCarro = emprestimosAtual > parcelaCarro ? emprestimosAtual - parcelaCarro : 0;
    const fixosBase = gastosFixosSemMoradia;

    const c0Monthly = moradiaAtual + emprestimosAtual + fixosBase + totalVariaveis;
    const c0Saldo = receita - c0Monthly;

    const c1Monthly = scenarioParams.parcelaFinanciamento + scenarioParams.novosGastosImovel + parcelaCarro + empSemCarro + fixosBase + totalVariaveis;
    const c1Saldo = receita - c1Monthly;
    const c1Delta = c1Saldo - c0Saldo;

    const capitalComFgts = params.capitalDisponivel + scenarioParams.fgts;
    const capitalAposQuitarCarro = capitalComFgts - scenarioParams.saldoDevedorCarro;
    // C2: Same entrada & financing as C1, but no car payment (quita before buying)
    const parcela2 = scenarioParams.parcelaFinanciamento;
    const c2Monthly = parcela2 + scenarioParams.novosGastosImovel + empSemCarro + fixosBase + totalVariaveis;
    const c2Saldo = receita - c2Monthly;
    const c2Delta = c2Saldo - c0Saldo;
    // Comprometimento: parcela + carro / renda vs parcela only / renda
    const comprometSemQuitar = receita > 0 ? ((parcela2 + parcelaCarro + empSemCarro) / receita) * 100 : 0;
    const comprometComQuitar = receita > 0 ? ((parcela2 + empSemCarro) / receita) * 100 : 0;

    const mesesCarro = scenarioParams.mesesRestantesCarro;
    const c3SaldoComCarro = c1Saldo;
    const c3SaldoSemCarro = receita - (scenarioParams.parcelaFinanciamento + scenarioParams.novosGastosImovel + empSemCarro + fixosBase + totalVariaveis);
    const c3MesMelhora = mesesCarro;

    return {
      c0: { monthly: c0Monthly, saldo: c0Saldo, saldo12: c0Saldo * 12 },
      c1: { monthly: c1Monthly, saldo: c1Saldo, saldo12: c1Saldo * 12, delta: c1Delta },
      c2: {
        monthly: c2Monthly, saldo: c2Saldo, saldo12: c2Saldo * 12, delta: c2Delta,
        custoQuitar: scenarioParams.saldoDevedorCarro, capitalRestante: capitalAposQuitarCarro,
        parcela: parcela2, comprometSemQuitar, comprometComQuitar,
      },
      c3: {
        saldoComCarro: c3SaldoComCarro, saldoSemCarro: c3SaldoSemCarro,
        mesMelhora: c3MesMelhora, deltaApos: c3SaldoSemCarro - c0Saldo,
      },
      details: {
        receita, moradiaAtual, emprestimosAtual, parcelaCarro, empSemCarro,
        fixosBase, totalVariaveis, parcelaFinanciamento: scenarioParams.parcelaFinanciamento,
        novosGastosImovel: scenarioParams.novosGastosImovel,
      }
    };
  }, [receita, moradiaAtual, emprestimosAtual, parcelaCarro, gastosFixosSemMoradia, totalVariaveis, scenarioParams, params]);

  const chartData = useMemo(() => {
    const data = [];
    let acc0 = 0, acc1 = 0, acc2 = 0, acc3 = 0;
    const mesesCarro = scenarioParams.mesesRestantesCarro;

    for (let m = 1; m <= 24; m++) {
      acc0 += scenarios.c0.saldo;
      acc1 += scenarios.c1.saldo;
      acc2 += scenarios.c2.saldo;
      acc3 += m <= mesesCarro ? scenarios.c3.saldoComCarro : scenarios.c3.saldoSemCarro;

      data.push({
        mes: `Mês ${m}`,
        'Atual': Math.round(acc0),
        'Compra+Carro': Math.round(acc1),
        'Quita Carro': Math.round(acc2),
        'Carro Quita Só': Math.round(acc3),
      });
    }
    return data;
  }, [scenarios, scenarioParams.mesesRestantesCarro]);

  const chartConfig: ChartConfig = {
    'Atual': { label: 'Cenário 0 — Atual', color: 'hsl(var(--primary))' },
    'Compra+Carro': { label: 'Cenário 1 — Compra+Carro', color: 'hsl(220, 70%, 55%)' },
    'Quita Carro': { label: 'Cenário 2 — Quita Carro', color: 'hsl(142, 70%, 45%)' },
    'Carro Quita Só': { label: 'Cenário 3 — Carro Quita Só', color: 'hsl(35, 90%, 55%)' },
  };

  async function fetchAiAnalysis() {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-financial-advisor', {
        body: {
          type: 'scenario_analysis',
          context: {
            receita, mesesAnalisados: realData.mesesAnalisados,
            cenario0: scenarios.c0,
            cenario1: scenarios.c1,
            cenario2: scenarios.c2,
            cenario3: scenarios.c3,
            parametros: {
              valorImovel: params.valorImovel,
              entrada: params.entrada,
              saldoDevedorCarro: scenarioParams.saldoDevedorCarro,
              parcelaCarro,
              mesesRestantesCarro: scenarioParams.mesesRestantesCarro,
              emprestimosAtivos: emprestimosAtual,
            },
          },
        },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); return; }
      setAiAnalysis(data.analysis);
    } catch (e) {
      console.error('AI scenario error:', e);
      toast.error('Erro ao consultar o assistente financeiro');
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const renderEditableRow = (label: string, key: string, original: number) => (
    <div key={key} className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        {label}
        {original === 0 && !isOverridden(key) && key !== 'receita' && (
          <span title="Sem dados importados para esta categoria">
            <AlertTriangle className="h-3 w-3 text-yellow-500" />
          </span>
        )}
      </span>
      <div className="flex items-center gap-1">
        {isOverridden(key) ? (
          <>
            <Input
              value={(overrides[key] ?? 0).toLocaleString('pt-BR')}
              onChange={e => setOverrides(p => ({ ...p, [key]: parseFloat(e.target.value.replace(/\./g, '').replace(',', '.')) || 0 }))}
              className="h-6 w-24 text-xs text-right"
            />
            <button onClick={() => setOverrides(p => { const n = { ...p }; delete n[key]; return n; })} className="text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3 w-3" />
            </button>
          </>
        ) : (
          <>
            <span className="text-xs font-medium">{formatCurrency(original)}</span>
            <button onClick={() => setOverrides(p => ({ ...p, [key]: original }))} className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100">
              <Edit2 className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );

  const ScenarioColumn = ({ title, icon, color, items, saldo, saldo12, delta }: {
    title: string; icon: React.ReactNode; color: string;
    items: { label: string; value: number; isPositive?: boolean }[];
    saldo: number; saldo12: number; delta?: number;
  }) => (
    <Card className={`border-t-4 ${color}`}>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-xs flex items-center gap-1.5">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{item.isPositive ? '(+)' : '(-)'} {item.label}</span>
            <span className="font-mono">{formatCurrency(item.value)}</span>
          </div>
        ))}
        <div className="border-t pt-1.5 mt-1.5">
          <div className="flex justify-between text-xs font-semibold">
            <span>Saldo livre</span>
            <span className={saldo >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(saldo)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Em 12 meses</span>
            <span className="font-mono">{formatCurrency(saldo12)}</span>
          </div>
          {delta !== undefined && (
            <div className="flex justify-between text-xs mt-1">
              <span className="text-muted-foreground">Δ vs hoje</span>
              <span className={`font-mono font-semibold ${delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {delta >= 0 ? '+' : ''}{formatCurrency(delta)}/mês
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const d = scenarios.details;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Dados Reais do Sistema
            <Badge variant="secondary" className="ml-auto text-xs">
              {realData.totalTransacoes > 0
                ? `${realData.totalTransacoes} transações em ${realData.mesesAnalisados} meses`
                : 'Sem dados'}
            </Badge>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchRealData} title="Atualizar dados">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {realData.mesesAnalisados < 2 && (
            <div className="flex items-start gap-2 p-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
              <p className="text-xs text-yellow-700 dark:text-yellow-400">
                Poucos dados importados. Importe mais meses para uma análise mais precisa. Você pode ajustar os valores manualmente.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium mb-2">Receita</p>
              <div className="group">
                {renderEditableRow(
                  realData.receitaFonte === 'viabilidade'
                    ? 'Renda bruta (aba Viabilidade)'
                    : `Receita média mensal`,
                  'receita', realData.receitaMedia
                )}
              </div>
              <p className="text-xs font-medium mt-3 mb-2">Gastos Fixos</p>
              <div className="space-y-0.5">
                {[
                  ['Casa', 'moradia', realData.fixos.moradia],
                  ['Empréstimos', 'emprestimos', realData.fixos.emprestimos],
                  ['Assinatura', 'assinaturas', realData.fixos.assinaturas],
                  ['Seguros', 'seguros', realData.fixos.seguros],
                  ['Serviços', 'telecom', realData.fixos.telecom],
                  ['Outros fixos', 'tarifas', realData.fixos.tarifas],
                ].map(([l, k, v]) => (
                  <div key={k as string} className="group">{renderEditableRow(l as string, k as string, v as number)}</div>
                ))}
                <div className="flex justify-between text-xs font-semibold border-t pt-1">
                  <span>Total fixos</span>
                  <span>{formatCurrency(totalFixos)}</span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium mb-2">Gastos Variáveis (média mensal)</p>
              <div className="space-y-0.5">
                {[
                  ['Alimentação', 'alimentacao', realData.variaveis.alimentacao],
                  ['Combustível', 'combustivel', realData.variaveis.combustivel],
                  ['Saúde', 'saude', realData.variaveis.saude],
                  ['Beleza', 'beleza', realData.variaveis.beleza],
                  ['Móveis/Utensílios', 'casa', realData.variaveis.casa],
                  ['Compras', 'comprasOnline', realData.variaveis.comprasOnline],
                  ['Transporte', 'transporte', realData.variaveis.transporte],
                  ['Impostos', 'impostos', realData.variaveis.impostos],
                  ['Educação', 'educacao', realData.variaveis.educacao],
                  ['Outros', 'outros', realData.variaveis.outros],
                ].map(([l, k, v]) => (
                  <div key={k as string} className="group">{renderEditableRow(l as string, k as string, v as number)}</div>
                ))}
                <div className="flex justify-between text-xs font-semibold border-t pt-1">
                  <span>Total variáveis</span>
                  <span>{formatCurrency(totalVariaveis)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-2 border-t">
            <div className="flex justify-between text-sm font-semibold">
              <span>Total gastos</span>
              <span>{formatCurrency(totalFixos + totalVariaveis)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold">
              <span>Saldo livre atual</span>
              <span className={scenarios.c0.saldo >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(scenarios.c0.saldo)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Parâmetros dos Cenários</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <SmallCurrencyInput label="Parcela financ. mês 1" value={scenarioParams.parcelaFinanciamento} onChange={v => setScenarioParams(p => ({ ...p, parcelaFinanciamento: v }))} />
            <SmallCurrencyInput label="Saldo devedor carro" value={scenarioParams.saldoDevedorCarro} onChange={v => setScenarioParams(p => ({ ...p, saldoDevedorCarro: v }))} />
            <SmallCurrencyInput label="Parcela mensal carro" value={scenarioParams.parcelaCarro} onChange={v => setScenarioParams(p => ({ ...p, parcelaCarro: v }))} />
            <div className="space-y-1">
              <Label className="text-xs">Meses restantes carro</Label>
              <Input type="number" value={scenarioParams.mesesRestantesCarro} onChange={e => setScenarioParams(p => ({ ...p, mesesRestantesCarro: parseInt(e.target.value) || 0 }))} className="h-8 text-xs" />
            </div>
            <SmallCurrencyInput label="FGTS disponível" value={scenarioParams.fgts} onChange={v => setScenarioParams(p => ({ ...p, fgts: v }))} />
            <SmallCurrencyInput label="Novos gastos imóvel (cond+IPTU)" value={scenarioParams.novosGastosImovel} onChange={v => setScenarioParams(p => ({ ...p, novosGastosImovel: v }))} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <ScenarioColumn
          title="Cenário 0 — Atual"
          icon={<Home className="h-3.5 w-3.5" />}
          color="border-t-primary"
          saldo={scenarios.c0.saldo}
          saldo12={scenarios.c0.saldo12}
          items={[
            { label: 'Receita', value: receita, isPositive: true },
            { label: 'Moradia', value: moradiaAtual },
            { label: 'Empréstimos (incl. carro)', value: emprestimosAtual },
            { label: 'Fixos', value: gastosFixosSemMoradia },
            { label: 'Variáveis', value: totalVariaveis },
          ]}
        />
        <ScenarioColumn
          title="Cenário 1 — Compra+Carro"
          icon={<Home className="h-3.5 w-3.5" />}
          color="border-t-blue-500"
          saldo={scenarios.c1.saldo}
          saldo12={scenarios.c1.saldo12}
          delta={scenarios.c1.delta}
          items={[
            { label: 'Receita', value: receita, isPositive: true },
            { label: 'Financiamento', value: d.parcelaFinanciamento },
            { label: 'Novos custos imóvel', value: d.novosGastosImovel },
            { label: 'Carro', value: parcelaCarro },
            { label: 'Empréstimos', value: d.empSemCarro },
            { label: 'Fixos', value: gastosFixosSemMoradia },
            { label: 'Variáveis', value: totalVariaveis },
          ]}
        />
        <Card className="border-t-4 border-t-green-500">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Car className="h-3.5 w-3.5" /> Cenário 2 — Quita Carro
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-2">
            {/* Saldo devedor (input) */}
            <SmallCurrencyInput
              label="Saldo devedor do carro"
              value={scenarioParams.saldoDevedorCarro}
              onChange={v => setScenarioParams(p => ({ ...p, saldoDevedorCarro: v }))}
            />
            {/* Capital líquido */}
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Capital líquido após quitar</span>
              <span className={`font-mono font-semibold ${scenarios.c2.capitalRestante >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(scenarios.c2.capitalRestante)}
              </span>
            </div>
            {/* Comprometimento comparison */}
            <div className="border-t pt-1.5 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Comprom. sem quitar</span>
                <span className="font-mono text-red-600">{scenarios.c2.comprometSemQuitar.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Comprom. com quitação</span>
                <span className="font-mono text-green-600">{scenarios.c2.comprometComQuitar.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Redução</span>
                <span className="font-mono font-semibold text-green-600">
                  −{(scenarios.c2.comprometSemQuitar - scenarios.c2.comprometComQuitar).toFixed(1)} p.p.
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-4 border-t-orange-500">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Car className="h-3.5 w-3.5" /> Cenário 3 — Carro Quita Sozinho
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Saldo livre (com carro)</span>
              <span className={`font-mono ${scenarios.c3.saldoComCarro >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(scenarios.c3.saldoComCarro)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Saldo livre (sem carro)</span>
              <span className={`font-mono ${scenarios.c3.saldoSemCarro >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(scenarios.c3.saldoSemCarro)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Carro quita no mês</span>
              <span className="font-mono font-semibold">{scenarios.c3.mesMelhora}</span>
            </div>
            <div className="border-t pt-1.5 mt-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Δ vs hoje (com carro)</span>
                <span className={`font-mono font-semibold ${(scenarios.c3.saldoComCarro - scenarios.c0.saldo) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(scenarios.c3.saldoComCarro - scenarios.c0.saldo) >= 0 ? '+' : ''}{formatCurrency(scenarios.c3.saldoComCarro - scenarios.c0.saldo)}/mês
                </span>
              </div>
              <div className="flex justify-between text-xs mt-0.5">
                <span className="text-muted-foreground">Δ vs hoje (após quitação)</span>
                <span className={`font-mono font-semibold ${scenarios.c3.deltaApos >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {scenarios.c3.deltaApos >= 0 ? '+' : ''}{formatCurrency(scenarios.c3.deltaApos)}/mês
                </span>
              </div>
              <div className="flex justify-between text-xs mt-0.5">
                <span className="text-muted-foreground">Ganho com quitação</span>
                <span className="font-mono font-semibold text-green-600">
                  +{formatCurrency(parcelaCarro)}/mês
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Evolução do Saldo Acumulado (24 meses)</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[300px]">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="mes" tick={{ fontSize: 10 }} interval={2} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend />
              <Line type="monotone" dataKey="Atual" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Compra+Carro" stroke="hsl(220, 70%, 55%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Quita Carro" stroke="hsl(142, 70%, 45%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Carro Quita Só" stroke="hsl(35, 90%, 55%)" strokeWidth={2} dot={false} strokeDasharray="5 5" />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Diagnóstico da IA
            {aiAnalysis && (
              <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" onClick={fetchAiAnalysis} disabled={aiLoading}>
                <RefreshCw className={`h-3.5 w-3.5 ${aiLoading ? 'animate-spin' : ''}`} />
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {aiLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
              <p className="text-xs text-muted-foreground mt-2">Consultando o assistente financeiro...</p>
            </div>
          ) : aiAnalysis ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{aiAnalysis}</ReactMarkdown>
            </div>
          ) : (
            <Button variant="outline" onClick={fetchAiAnalysis} className="w-full">
              <Sparkles className="h-4 w-4 mr-2" />
              Analisar cenários com IA
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
