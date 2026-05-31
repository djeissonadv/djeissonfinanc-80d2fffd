import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/format';
import { TrendingUp, TrendingDown, Wallet, Target } from 'lucide-react';

interface Kpi {
  label: string;
  value: string;
  hint?: string;
  trend?: 'up' | 'down' | 'flat';
  icon: React.ReactNode;
}

interface KpiHeroStripProps {
  saldoLivreMes: number;
  taxaPoupanca: number;          // 0..1
  healthScore: number;           // 0..100
  healthNivel: string;
  destaqueMes?: { titulo: string; valor: string; onClick?: () => void };
}

/**
 * Faixa de 4 KPIs no topo da página Análises. Mostra o que importa SEM scroll:
 * saldo livre do mês, taxa de poupança, score de saúde e o maior destaque (ex:
 * maior categoria, anomalia, oportunidade). Cores indicam saúde do número.
 */
export function KpiHeroStrip({
  saldoLivreMes,
  taxaPoupanca,
  healthScore,
  healthNivel,
  destaqueMes,
}: KpiHeroStripProps) {
  const saldoColor = saldoLivreMes > 0 ? 'text-green-600' : saldoLivreMes < 0 ? 'text-red-600' : 'text-foreground';
  const poupColor = taxaPoupanca >= 0.2 ? 'text-green-600' : taxaPoupanca >= 0.05 ? 'text-amber-600' : 'text-red-600';
  const scoreColor = healthScore >= 75 ? 'text-green-600' : healthScore >= 50 ? 'text-amber-600' : 'text-red-600';

  const kpis: Kpi[] = [
    {
      label: 'Sobra do mês',
      value: formatCurrency(saldoLivreMes),
      hint: saldoLivreMes >= 0 ? 'no azul' : 'no vermelho',
      trend: saldoLivreMes > 0 ? 'up' : 'down',
      icon: <Wallet className={`h-5 w-5 ${saldoColor}`} />,
    },
    {
      label: 'Taxa de poupança',
      value: `${(taxaPoupanca * 100).toFixed(1)}%`,
      hint: taxaPoupanca >= 0.2 ? 'meta atingida' : 'meta 20%',
      trend: taxaPoupanca >= 0.2 ? 'up' : 'down',
      icon: <Target className={`h-5 w-5 ${poupColor}`} />,
    },
    {
      label: 'Saúde financeira',
      value: `${healthScore}/100`,
      hint: healthNivel,
      trend: healthScore >= 50 ? 'up' : 'down',
      icon: healthScore >= 50
        ? <TrendingUp className={`h-5 w-5 ${scoreColor}`} />
        : <TrendingDown className={`h-5 w-5 ${scoreColor}`} />,
    },
  ];

  if (destaqueMes) {
    kpis.push({
      label: destaqueMes.titulo,
      value: destaqueMes.valor,
      icon: <TrendingUp className="h-5 w-5 text-primary" />,
    });
  }

  const destaqueClickable = destaqueMes?.onClick;

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
      {kpis.map((k, i) => (
        <Card
          key={i}
          className={i === 3 && destaqueClickable ? 'cursor-pointer hover:bg-muted/40 transition-colors' : ''}
          onClick={i === 3 && destaqueClickable ? destaqueClickable : undefined}
          role={i === 3 && destaqueClickable ? 'button' : undefined}
          tabIndex={i === 3 && destaqueClickable ? 0 : undefined}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              {k.icon}
            </div>
            <div className={`text-2xl font-bold mt-1 ${
              k.label === 'Sobra do mês' ? saldoColor :
              k.label === 'Taxa de poupança' ? poupColor :
              k.label === 'Saúde financeira' ? scoreColor : ''
            }`}>
              {k.value}
            </div>
            {k.hint && <div className="text-xs text-muted-foreground mt-0.5">{k.hint}</div>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
