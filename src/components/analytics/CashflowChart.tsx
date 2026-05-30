import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Line, ComposedChart } from 'recharts';
import type { MonthFlow } from '@/lib/analytics-engine';

interface CashflowChartProps {
  flow: MonthFlow[];
  title?: string;
  description?: string;
}

const chartConfig = {
  receita: { label: 'Receita', color: 'hsl(142, 71%, 45%)' },
  despesa: { label: 'Despesa', color: 'hsl(0, 84%, 60%)' },
  sobra:   { label: 'Sobra',   color: 'hsl(220, 70%, 50%)' },
};

/**
 * Bar chart de 12 meses sobrepondo receita (verde) + despesa (vermelho) + linha
 * da sobra (azul). Faz visível o trend ao longo do ano de um só olhar.
 */
export function CashflowChart({ flow, title = 'Fluxo de caixa (12 meses)', description }: CashflowChartProps) {
  if (flow.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Sem dados suficientes pra montar o gráfico.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[260px] w-full">
          <ComposedChart data={flow} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <ChartTooltip content={<ChartTooltipContent
              formatter={(value, name) => [
                Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                chartConfig[name as keyof typeof chartConfig]?.label || String(name),
              ]}
            />} />
            <Bar dataKey="receita" fill="var(--color-receita)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="despesa" fill="var(--color-despesa)" radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="sobra" stroke="var(--color-sobra)" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
