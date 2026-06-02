import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, DollarSign, PenLine } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { getFaturaStatus, getFaturaTotalAPagar } from '@/lib/fatura-status';

interface FaturaData {
  saldoAnterior: number;
  despesasMes: number;
  pagamentosMes: number;
  totalAPagar: number;
  valorFatura?: number; // ignorado — usado só pra retrocompat
}

interface Props {
  cardId: string;
  cardName: string;
  diaVencimento?: number | null;
  month: number; // 0-11
  fatura: FaturaData;
  /** Click no card abre o drawer da fatura */
  onCardClick?: () => void;
  /** Click no botão "Pagar fatura" */
  onPagarClick?: () => void;
  /** Click no botão "Lançamento" */
  onLancarClick?: () => void;
  /** Variante compacta — esconde botões */
  compact?: boolean;
}

/**
 * Card de cartão de crédito — fonte ÚNICA pra Dashboard + Contas.
 * Todos os 3 lugares mostram os mesmos números pra mesma fatura,
 * usando getFaturaStatus + getFaturaTotalAPagar.
 */
export function CardFatura({ cardName, diaVencimento, month, fatura, onCardClick, onPagarClick, onLancarClick, compact }: Props) {
  const saldoAnt = fatura.saldoAnterior || 0;
  const despesasMes = fatura.despesasMes || 0;
  const pagMes = fatura.pagamentosMes || 0;
  const totalAPagar = getFaturaTotalAPagar(fatura);
  const status = getFaturaStatus(fatura);

  return (
    <Card className={`${onCardClick ? 'cursor-pointer hover-lift' : ''}`} onClick={onCardClick}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{cardName}</span>
          <Badge variant="outline" className={`ml-auto text-xs ${status.className}`}>
            {status.emoji} {status.label}
          </Badge>
        </div>

        {diaVencimento && (
          <p className="text-xs text-muted-foreground mb-2 tabular">
            Vence dia {diaVencimento} · {String(diaVencimento).padStart(2, '0')}/{String(month + 1).padStart(2, '0')}
          </p>
        )}

        {saldoAnt > 0 && (
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Saldo anterior</span>
            <span className="text-warning font-medium tabular">{formatCurrency(saldoAnt)}</span>
          </div>
        )}
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">Despesas do mês</span>
          <span className="font-medium tabular">{formatCurrency(despesasMes)}</span>
        </div>
        {pagMes > 0 && (
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Pagamentos</span>
            <span className="text-success font-medium tabular">-{formatCurrency(pagMes)}</span>
          </div>
        )}
        {(saldoAnt > 0 || pagMes > 0) && <div className="border-t border-border/50 mt-1 pt-1" />}
        <div className="flex justify-between items-baseline">
          <span className="text-xs text-muted-foreground">Total a pagar</span>
          <span className={`text-lg font-bold tabular ${totalAPagar > 0 ? 'text-destructive' : 'text-success'}`}>
            {formatCurrency(totalAPagar)}
          </span>
        </div>

        {!compact && (onPagarClick || onLancarClick) && (
          <div className="flex gap-2 mt-3">
            {totalAPagar > 0 && onPagarClick && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                onClick={(e) => { e.stopPropagation(); onPagarClick(); }}
              >
                <DollarSign className="h-3 w-3 mr-1" /> Pagar
              </Button>
            )}
            {onLancarClick && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                onClick={(e) => { e.stopPropagation(); onLancarClick(); }}
              >
                <PenLine className="h-3 w-3 mr-1" /> Lançamento
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
