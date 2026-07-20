// TEMPORÁRIO — vitrine do novo sistema visual. Remover depois de aprovado.
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader, Section, Stat, PageStack, EmptyState } from '@/components/ui/section';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wallet, TrendingDown, Inbox, Plus } from 'lucide-react';

const CATS = [
  { nome: 'Alimentação', valor: 'R$ 1.233', pct: 29, cor: '#ef4444' },
  { nome: 'Empréstimos', valor: 'R$ 890', pct: 21, cor: '#f97316' },
  { nome: 'Compras', valor: 'R$ 607', pct: 15, cor: '#a855f7' },
  { nome: 'Transporte', valor: 'R$ 346', pct: 8, cor: '#3b82f6' },
];

export default function DesignPreviewPage() {
  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-3xl mx-auto">
        <PageStack>
          <PageHeader
            title="Dashboard"
            description="Julho de 2026"
            actions={
              <>
                <Button variant="outline" size="sm">Jul/26</Button>
                <Button size="sm"><Plus className="h-4 w-4" /> Lançar</Button>
              </>
            }
          />

          {/* O card protagonista — único com elevação na tela */}
          <Section emphasis title="Disponível pra gastar" description="Depois das contas fixas do mês">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <Stat label="" value="R$ 2.847,30" size="lg" tone="accent" />
              <div className="flex gap-5">
                <Stat label="Entrou" value="R$ 8.200" size="sm" tone="positive" />
                <Stat label="Saiu" value="R$ 5.352" size="sm" tone="negative" />
              </div>
            </div>
          </Section>

          {/* Grade de métricas — mesmo tamanho, mesma estrutura */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { l: 'Gastos do mês', v: 'R$ 5.352', h: '12% acima da média' },
              { l: 'Parcelas', v: 'R$ 1.890', h: '8 ativas' },
              { l: 'Faturas', v: 'R$ 3.476', h: 'vence dia 20' },
              { l: 'Reserva', v: 'R$ 2.000', h: 'meta atingida' },
            ].map((m) => (
              <Card key={m.l}>
                <CardContent className="p-3">
                  <Stat label={m.l} value={m.v} hint={m.h} size="sm" />
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Seção com ação no cabeçalho */}
          <Section
            title="Onde você mais gasta"
            description="Média dos últimos 4 meses"
            action={<Button variant="ghost" size="sm" className="h-7 text-xs">Ver tudo</Button>}
          >
            <div className="space-y-2.5">
              {CATS.map((c) => (
                <div key={c.nome}>
                  <div className="flex items-center justify-between gap-2 text-sm mb-1">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.cor }} />
                      <span className="truncate">{c.nome}</span>
                    </span>
                    <span className="tabular font-medium shrink-0">{c.valor}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${c.pct * 3}%`, backgroundColor: c.cor }} />
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Lista sangrando até a borda */}
          <Section
            title="Últimos lançamentos"
            flush
            action={<Button variant="ghost" size="sm" className="h-7 text-xs mr-2">Ver todos</Button>}
          >
            <ul className="divide-y divide-border/60">
              {[
                { d: 'Mercado São Luiz', c: 'Alimentação', v: '- R$ 312,40', dt: '18/07' },
                { d: 'Salário', c: 'Receita', v: '+ R$ 8.200,00', dt: '05/07', pos: true },
                { d: 'Posto Ipiranga', c: 'Transporte', v: '- R$ 210,00', dt: '14/07' },
              ].map((t) => (
                <li key={t.d} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{t.d}</p>
                    <p className="text-xs text-muted-foreground">{t.c} · {t.dt}</p>
                  </div>
                  <span className={`text-sm tabular font-medium shrink-0 ${t.pos ? 'text-success' : ''}`}>
                    {t.v}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title="Estado vazio" flush>
              <EmptyState
                icon={<Inbox className="h-7 w-7" />}
                title="Nenhuma conta a pagar"
                description="Cadastre contas recorrentes pra não perder vencimento."
                action={<Button size="sm" variant="outline">Adicionar</Button>}
              />
            </Section>

            <Section title="Elementos" description="Botões, badges e tons">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm">Primário</Button>
                  <Button size="sm" variant="outline">Secundário</Button>
                  <Button size="sm" variant="ghost">Ghost</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="success">Pago</Badge>
                  <Badge variant="warning">Vence hoje</Badge>
                  <Badge variant="danger">Vencido</Badge>
                  <Badge variant="muted">Essencial</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5 items-center">
                  <Badge size="sm" variant="secondary">3/12</Badge>
                  <Badge size="sm" variant="muted">recorrente</Badge>
                  <Badge size="sm" variant="success">conciliado</Badge>
                </div>
                <div className="flex gap-4">
                  <Stat label="Positivo" value="+ R$ 1.200" size="sm" tone="positive" icon={<Wallet className="h-3 w-3" />} />
                  <Stat label="Negativo" value="- R$ 890" size="sm" tone="negative" icon={<TrendingDown className="h-3 w-3" />} />
                </div>
              </div>
            </Section>
          </div>
        </PageStack>
      </div>
    </div>
  );
}
