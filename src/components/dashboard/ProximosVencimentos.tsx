import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/format';
import { CalendarClock, ChevronRight, AlertCircle, ArrowUpRight, ArrowDownRight, CreditCard } from 'lucide-react';
import { labelVencimento, type Vencimento } from '@/lib/vencimentos';
import { useVencimentos } from '@/hooks/useVencimentos';

interface Props {
  /** Saldo realizado atual — usado pra mostrar "ficará em R$ X depois". Opcional. */
  saldoAtual?: number;
  /** Vencimentos extras (ex: faturas de cartão) calculados pelo pai. */
  vencimentosExtras?: Vencimento[];
}

/**
 * Widget "Próximos vencimentos" no Dashboard.
 *
 * Responde à pergunta "o que sai/cai da minha conta nos próximos dias?".
 * Fontes:
 *  - Transações pendentes (pago=false) com data dentro do range
 *  - contas_pagar_receber em aberto
 *
 * Filtros: 7d / 30d (toggle). Mostra atrasados sempre.
 */
export function ProximosVencimentos({ saldoAtual, vencimentosExtras = [] }: Props) {
  const navigate = useNavigate();
  const [range, setRange] = useState<7 | 30>(30);
  const { vencimentos, impacto } = useVencimentos(range, vencimentosExtras);
  const atrasados = vencimentos.filter(v => v.diasAteVencer < 0);
  const saldoProjetado = saldoAtual != null ? saldoAtual + impacto.impactoLiquido : null;

  if (!vencimentos.length) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Próximos vencimentos</p>
              <p className="text-sm font-medium mt-0.5">Nada pendente nos próximos {range} dias</p>
            </div>
            <CalendarClock className="h-5 w-5 text-muted-foreground shrink-0" />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Tudo em dia. Lançamentos futuros pendentes aparecem aqui automaticamente.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Próximos vencimentos</p>
            <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
              <p className="text-sm font-medium">
                {vencimentos.length} {vencimentos.length === 1 ? 'item' : 'itens'}
              </p>
              {atrasados.length > 0 && (
                <Badge variant="destructive" className="text-[10px] gap-1 px-1.5">
                  <AlertCircle className="h-2.5 w-2.5" />
                  {atrasados.length} atrasado{atrasados.length === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button
              variant={range === 7 ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs rounded-full px-2.5"
              onClick={() => setRange(7)}
            >
              7d
            </Button>
            <Button
              variant={range === 30 ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs rounded-full px-2.5"
              onClick={() => setRange(30)}
            >
              30d
            </Button>
          </div>
        </div>

        {/* Resumo: impacto líquido + saldo projetado */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="rounded-xl bg-secondary/30 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">A pagar</p>
            <p className="text-base font-semibold tabular text-destructive mt-0.5">
              −{formatCurrency(impacto.totalAPagar)}
            </p>
            {impacto.totalAReceber > 0 && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                +{formatCurrency(impacto.totalAReceber)} a receber
              </p>
            )}
          </div>
          <div className="rounded-xl bg-secondary/30 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {saldoProjetado != null ? 'Saldo projetado' : 'Saldo após'}
            </p>
            <p className={`text-base font-semibold tabular mt-0.5 ${
              saldoProjetado != null && saldoProjetado < 0 ? 'text-destructive' : 'text-foreground'
            }`}>
              {saldoProjetado != null ? formatCurrency(saldoProjetado) : formatCurrency(impacto.impactoLiquido)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              se tudo rolar até {range}d
            </p>
          </div>
        </div>

        {/* Lista de itens (top 5, com link pra ver tudo) */}
        <div className="space-y-1">
          {vencimentos.slice(0, 5).map(v => {
            const label = labelVencimento(v.diasAteVencer);
            const colorClass =
              label.nivel === 'atrasado' ? 'text-destructive' :
              label.nivel === 'urgente' ? 'text-warning' :
              label.nivel === 'proximo' ? 'text-foreground' : 'text-muted-foreground';
            const Icon = v.fonte === 'fatura'
              ? CreditCard
              : (v.tipo === 'pagar' ? ArrowDownRight : ArrowUpRight);
            const valorClass = v.tipo === 'pagar' ? 'text-destructive' : 'text-success';

            const onClick = () => {
              if (v.fonte === 'fatura') {
                navigate('/contas');
              } else if (v.fonte === 'conta_pr') {
                navigate('/a-pagar-receber');
              } else {
                navigate(`/transacoes?status=pendente`);
              }
            };

            return (
              <button
                key={v.id}
                type="button"
                onClick={onClick}
                className="w-full flex items-center gap-2 rounded-lg px-2 py-2 -mx-2 hover:bg-secondary/40 transition-colors text-left"
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${valorClass}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{v.descricao}</p>
                  <p className={`text-[11px] ${colorClass}`}>{label.texto}</p>
                </div>
                <span className={`text-sm font-medium tabular shrink-0 ${valorClass}`}>
                  {v.tipo === 'pagar' ? '−' : '+'}{formatCurrency(v.valor)}
                </span>
              </button>
            );
          })}
        </div>

        {vencimentos.length > 5 && (
          <button
            type="button"
            onClick={() => navigate('/a-pagar-receber')}
            className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 border-t"
          >
            Ver todos ({vencimentos.length}) <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </CardContent>
    </Card>
  );
}
