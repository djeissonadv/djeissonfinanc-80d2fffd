import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, ChevronDown, ChevronRight, Sparkles, ArrowDownLeft } from 'lucide-react';
import { useEnterSubmit } from '@/hooks/useEnterSubmit';
import { useState } from 'react';
import type { ClassifiedTransaction } from '@/lib/csv-parser';
import { autoCategorizarTransacao } from '@/lib/auto-categorize';

export interface InstallmentGroup {
  descricao: string;
  valorParcela: number;
  totalParcelas: number;
  valorTotal: number;
  dataInicio: string;
  pessoa: string;
  transactions: ClassifiedTransaction[];
}

export interface ImportPreviewData {
  /** Tipo 3: transações simples */
  simpleTransactions: ClassifiedTransaction[];
  /** Devoluções e estornos (valores negativos importados como receita) */
  refunds: ClassifiedTransaction[];
  /** Tipo 1: novos parcelamentos */
  newInstallments: InstallmentGroup[];
  /** Tipo 2: parcelas em andamento (não duplicadas) */
  ongoingInstallments: ClassifiedTransaction[];
  /** Tipo 2: parcelas duplicadas */
  duplicateInstallments: ClassifiedTransaction[];
  /** Tipo 4: pagamentos de fatura */
  payments: ClassifiedTransaction[];
  /** Linhas rejeitadas do CSV */
  rejectedLines: { lineNumber: number; content: string; reason: string }[];
  /** Total de linhas do arquivo */
  totalLines: number;
  /** Nome do arquivo */
  fileName: string;
  /** Quantas transações foram reconhecidas como JÁ EXISTENTES (dedup) e por isso
   *  não serão reimportadas. Reflete o resultado do detectConflicts no preview. */
  duplicateCount?: number;
}

interface Props {
  data: ImportPreviewData;
  onBack: () => void;
  onConfirm: () => void;
  confirming: boolean;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function SectionHeader({
  icon: Icon,
  iconClass,
  title,
  count,
  total,
  isOpen,
}: {
  icon: React.ElementType;
  iconClass: string;
  title: string;
  count: number;
  total?: number;
  isOpen: boolean;
}) {
  return (
    <div className="flex items-center justify-between w-full py-2">
      <div className="flex items-center gap-2">
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Icon className={`h-4 w-4 ${iconClass}`} />
        <span className="font-medium text-sm">{title}</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-xs">
          {count} {count === 1 ? 'item' : 'itens'}
        </Badge>
        {total !== undefined && (
          <span className="text-xs text-muted-foreground">{formatCurrency(total)}</span>
        )}
      </div>
    </div>
  );
}

export function CsvImportPreviewV2({ data, onBack, onConfirm, confirming }: Props) {
  const handleKeyDown = useEnterSubmit(onConfirm, confirming);
  const [openSections, setOpenSections] = useState({
    simple: true,
    refund: true,
    newInstallment: true,
    ongoing: true,
    ignored: false,
  });

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const totalNewTransactions =
    data.simpleTransactions.length +
    data.refunds.length +
    data.newInstallments.reduce((sum, g) => sum + g.totalParcelas, 0) +
    data.ongoingInstallments.length;

  const totalFutureGenerated = data.newInstallments.reduce(
    (sum, g) => sum + (g.totalParcelas - 1),
    0,
  );

  const totalIgnored =
    data.payments.length + data.duplicateInstallments.length + data.rejectedLines.length +
    (data.duplicateCount || 0);

  const monthlyImpact = data.newInstallments.reduce((sum, g) => sum + g.valorParcela, 0);

  const simpleTotal = data.simpleTransactions.reduce((s, t) => s + t.valor, 0);
  const refundTotal = data.refunds.reduce((s, t) => s + t.valor, 0);
  const ongoingTotal = data.ongoingInstallments.reduce((s, t) => s + t.valor, 0);
  const paymentTotal = data.payments.reduce((s, t) => s + t.valor, 0);

  return (
    <div className="space-y-4" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="space-y-1">
        <p className="text-lg font-semibold">Revisão da importação</p>
        <p className="text-sm text-muted-foreground">
          Revise cada seção antes de confirmar. Nada será salvo até você clicar em "Confirmar".
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Novas transações</p>
          <p className="text-lg font-semibold">{totalNewTransactions}</p>
        </div>
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Parcelas futuras</p>
          <p className="text-lg font-semibold">{totalFutureGenerated}</p>
        </div>
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Ignorados</p>
          <p className="text-lg font-semibold">{totalIgnored}</p>
        </div>
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Impacto mensal</p>
          <p className="text-lg font-semibold">{formatCurrency(monthlyImpact)}</p>
        </div>
      </div>

      <ScrollArea className="h-[420px]">
        <div className="space-y-2 pr-3">
          {/* Section 1: Simple transactions */}
          {data.simpleTransactions.length > 0 && (
            <Collapsible open={openSections.simple} onOpenChange={() => toggleSection('simple')}>
              <div className="rounded-lg border">
                <CollapsibleTrigger className="w-full px-3 hover:bg-muted/40 rounded-t-lg">
                  <SectionHeader
                    icon={CheckCircle2}
                    iconClass="text-primary"
                    title="Transações simples"
                    count={data.simpleTransactions.length}
                    total={simpleTotal}
                    isOpen={openSections.simple}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Data</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="w-36">Categoria</TableHead>
                        <TableHead className="w-28 text-right">Valor</TableHead>
                        <TableHead className="w-32">Pessoa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.simpleTransactions.map((t, i) => {
                        const autoCat = autoCategorizarTransacao(t.descricao);
                        return (
                          <TableRow key={i}>
                            <TableCell className="text-xs">{formatDate(t.data)}</TableCell>
                            <TableCell className="text-xs">{t.descricao}</TableCell>
                            <TableCell className="text-xs">
                              {autoCat ? (
                                <span className="flex items-center gap-1">
                                  <Badge variant="outline" className="text-xs">{autoCat}</Badge>
                                  <Sparkles className="h-3 w-3 text-amber-500" />
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Outros</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono">
                              {formatCurrency(t.valor)}
                            </TableCell>
                            <TableCell className="text-xs">{t.pessoa}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {/* Section: Refunds / Devoluções */}
          {data.refunds.length > 0 && (
            <Collapsible open={openSections.refund} onOpenChange={() => toggleSection('refund')}>
              <div className="rounded-lg border border-green-200">
                <CollapsibleTrigger className="w-full px-3 hover:bg-muted/40 rounded-t-lg">
                  <SectionHeader
                    icon={ArrowDownLeft}
                    iconClass="text-green-500"
                    title="Devoluções / Estornos"
                    count={data.refunds.length}
                    total={refundTotal}
                    isOpen={openSections.refund}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Data</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="w-28 text-right">Valor</TableHead>
                        <TableHead className="w-32">Pessoa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.refunds.map((t, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">{formatDate(t.data)}</TableCell>
                          <TableCell className="text-xs">{t.descricao}</TableCell>
                          <TableCell className="text-xs text-right font-mono text-green-600">
                            -{formatCurrency(t.valor)}
                          </TableCell>
                          <TableCell className="text-xs">{t.pessoa}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="px-3 pb-2 text-xs text-muted-foreground italic">
                    Devoluções serão subtraídas do valor total da fatura.
                  </p>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {/* Section 2: New installments */}
          {data.newInstallments.length > 0 && (
            <Collapsible
              open={openSections.newInstallment}
              onOpenChange={() => toggleSection('newInstallment')}
            >
              <div className="rounded-lg border">
                <CollapsibleTrigger className="w-full px-3 hover:bg-muted/40 rounded-t-lg">
                  <SectionHeader
                    icon={RefreshCw}
                    iconClass="text-blue-500"
                    title="Novos parcelamentos detectados"
                    count={data.newInstallments.length}
                    total={data.newInstallments.reduce((s, g) => s + g.valorTotal, 0)}
                    isOpen={openSections.newInstallment}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="divide-y">
                    {data.newInstallments.map((group, i) => (
                      <div key={i} className="p-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">{group.descricao}</p>
                          <Badge variant="outline" className="text-xs">
                            {group.totalParcelas}x de {formatCurrency(group.valorParcela)}
                          </Badge>
                        </div>
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          <span>Total: {formatCurrency(group.valorTotal)}</span>
                          <span>Início: {formatDate(group.dataInicio)}</span>
                          <span>Titular: {group.pessoa}</span>
                        </div>
                        <p className="text-xs text-muted-foreground italic">
                          → Serão geradas {group.totalParcelas - 1} parcelas futuras automaticamente
                        </p>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {/* Section 3: Ongoing installments */}
          {data.ongoingInstallments.length > 0 && (
            <Collapsible open={openSections.ongoing} onOpenChange={() => toggleSection('ongoing')}>
              <div className="rounded-lg border">
                <CollapsibleTrigger className="w-full px-3 hover:bg-muted/40 rounded-t-lg">
                  <SectionHeader
                    icon={AlertTriangle}
                    iconClass="text-yellow-500"
                    title="Parcelas em andamento (não duplicadas)"
                    count={data.ongoingInstallments.length}
                    total={ongoingTotal}
                    isOpen={openSections.ongoing}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Data</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="w-20">Parcela</TableHead>
                        <TableHead className="w-36">Categoria</TableHead>
                        <TableHead className="w-28 text-right">Valor</TableHead>
                        <TableHead className="w-32">Pessoa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.ongoingInstallments.map((t, i) => {
                        const autoCat = autoCategorizarTransacao(t.descricao);
                        return (
                          <TableRow key={i}>
                            <TableCell className="text-xs">{formatDate(t.data)}</TableCell>
                            <TableCell className="text-xs">{t.descricao}</TableCell>
                            <TableCell className="text-xs">
                              {t.parcela_atual}/{t.parcela_total}
                            </TableCell>
                            <TableCell className="text-xs">
                              {autoCat ? (
                                <span className="flex items-center gap-1">
                                  <Badge variant="outline" className="text-xs">{autoCat}</Badge>
                                  <Sparkles className="h-3 w-3 text-amber-500" />
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Outros</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono">
                              {formatCurrency(t.valor)}
                            </TableCell>
                            <TableCell className="text-xs">{t.pessoa}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {/* Section 4: Ignored (payments + duplicates + rejected) */}
          {totalIgnored > 0 && (
            <Collapsible open={openSections.ignored} onOpenChange={() => toggleSection('ignored')}>
              <div className="rounded-lg border">
                <CollapsibleTrigger className="w-full px-3 hover:bg-muted/40 rounded-t-lg">
                  <SectionHeader
                    icon={XCircle}
                    iconClass="text-destructive"
                    title="Ignorados"
                    count={totalIgnored}
                    total={paymentTotal > 0 ? paymentTotal : undefined}
                    isOpen={openSections.ignored}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="divide-y">
                    {(data.duplicateCount || 0) > 0 && (
                      <div className="p-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          Já existentes (não serão reimportadas): {data.duplicateCount}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Estas transações já estão na conta selecionada — o sistema reconheceu e vai pular.
                        </p>
                      </div>
                    )}
                    {data.payments.length > 0 && (
                      <div className="p-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Pagamentos de fatura ({data.payments.length})
                        </p>
                        {data.payments.map((t, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span>
                              {formatDate(t.data)} — {t.descricao}
                            </span>
                            <span className="font-mono text-primary">
                              {formatCurrency(t.valor)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {data.duplicateInstallments.length > 0 && (
                      <div className="p-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Duplicatas ({data.duplicateInstallments.length})
                        </p>
                        {data.duplicateInstallments.map((t, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span>
                              {formatDate(t.data)} — {t.descricao} ({t.parcela_atual}/{t.parcela_total})
                            </span>
                            <span className="font-mono">{formatCurrency(t.valor)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {data.rejectedLines.length > 0 && (
                      <div className="p-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Linhas rejeitadas ({data.rejectedLines.length})
                        </p>
                        {data.rejectedLines.map((l, i) => (
                          <div key={i} className="text-xs text-muted-foreground">
                            <span className="font-mono">L{l.lineNumber}:</span> {l.reason}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}
        </div>
      </ScrollArea>

      {/* Footer summary */}
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{data.fileName}</span>
        {' — '}
        {totalNewTransactions} transações novas | {totalFutureGenerated} lançamentos futuros |{' '}
        {totalIgnored} ignorados
        {monthlyImpact > 0 && ` | Impacto: ${formatCurrency(monthlyImpact)}/mês`}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button variant="outline" className="flex-1" onClick={onBack} disabled={confirming}>
          Voltar
        </Button>
        <Button className="flex-1" onClick={onConfirm} disabled={confirming}>
          {confirming ? 'Salvando...' : 'Confirmar importação'}
        </Button>
      </div>
    </div>
  );
}
