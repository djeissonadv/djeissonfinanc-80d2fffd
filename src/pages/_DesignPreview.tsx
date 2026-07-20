// TEMPORÁRIO — vitrine do sistema visual. Remover depois de aprovado.
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Plus, ArrowUpRight, CreditCard } from 'lucide-react';

const CATS = [
  { nome: 'Alimentação', valor: 'R$ 1.233', pct: 29, cor: '#f87171' },
  { nome: 'Empréstimos', valor: 'R$ 890', pct: 21, cor: '#fb923c' },
  { nome: 'Compras', valor: 'R$ 607', pct: 15, cor: '#c084fc' },
  { nome: 'Transporte', valor: 'R$ 346', pct: 8, cor: '#60a5fa' },
];

const TXS = [
  { d: 'Mercado São Luiz', c: 'Alimentação', v: '312,40', dt: '18/07' },
  { d: 'Salário', c: 'Receita', v: '8.200,00', dt: '05/07', pos: true },
  { d: 'Posto Ipiranga', c: 'Transporte', v: '210,00', dt: '14/07' },
  { d: 'Mercado Livre', c: 'Compras', v: '152,33', dt: '12/07', parc: '3/12' },
];

/** Rótulo de seção — pequeno, em caixa alta espaçada, discreto.
 *  Não compete com o conteúdo; só organiza. */
function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-2.5">
      <h2 className="text-2xs uppercase tracking-[0.12em] text-muted-foreground font-medium">
        {children}
      </h2>
      {action}
    </div>
  );
}

export default function DesignPreviewPage() {
  return (
    <div className="min-h-screen p-5 md:p-8">
      <div className="max-w-2xl mx-auto space-y-9">

        {/* ── Cabeçalho ────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Julho de 2026</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8">Jul/26</Button>
            <Button size="sm" className="h-8"><Plus className="h-4 w-4" />Lançar</Button>
          </div>
        </header>

        {/* ── HERO: sem caixa. O número É o design. ────────────── */}
        <section>
          <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground font-medium">
            Disponível pra gastar
          </p>
          <p className="num-hero text-5xl md:text-6xl mt-1.5 text-primary">
            R$ 2.847<span className="text-muted-foreground/50">,30</span>
          </p>
          {/* Barra de proporção entrou/saiu — conta a história em 1 linha */}
          <div className="mt-4 flex h-1 rounded-full overflow-hidden bg-secondary">
            <div className="bg-success" style={{ width: '61%' }} />
            <div className="bg-destructive/70" style={{ width: '39%' }} />
          </div>
          <div className="mt-2 flex items-center gap-5 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="text-muted-foreground">Entrou</span>
              <span className="tabular font-medium">R$ 8.200</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive/70" />
              <span className="text-muted-foreground">Saiu</span>
              <span className="tabular font-medium">R$ 5.352</span>
            </span>
          </div>
        </section>

        {/* ── Métricas: uma faixa dividida, não 4 caixas ───────── */}
        <section className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-border/60 border-y border-border/60">
          {[
            { l: 'Gastos do mês', v: 'R$ 5.352', h: '12% acima da média' },
            { l: 'Parcelas', v: 'R$ 1.890', h: '8 ativas' },
            { l: 'Faturas', v: 'R$ 3.476', h: 'vence dia 20' },
            { l: 'Reserva', v: 'R$ 2.000', h: 'meta atingida' },
          ].map((m, i) => (
            <div key={m.l} className={`py-3 ${i % 2 === 0 ? 'pr-3 md:px-4' : 'pl-3 md:px-4'} ${i === 0 ? 'md:pl-0' : ''}`}>
              <p className="text-2xs uppercase tracking-wider text-muted-foreground truncate">{m.l}</p>
              <p className="num-display text-xl mt-1 tabular">{m.v}</p>
              <p className="text-2xs text-muted-foreground mt-0.5 truncate">{m.h}</p>
            </div>
          ))}
        </section>

        {/* ── Cartões: AQUI card faz sentido (objeto discreto) ── */}
        <section>
          <SectionLabel action={<Button variant="ghost" size="sm" className="h-6 text-2xs px-2">Ver contas</Button>}>
            Cartões
          </SectionLabel>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {[
              { n: 'Nubank', v: 'R$ 1.284,90', d: 'vence 10/08', pct: 32 },
              { n: 'Mercado Pago', v: 'R$ 3.476,21', d: 'vence 20/08', pct: 78, alerta: true },
            ].map((c) => (
              <Card key={c.n}>
                <CardContent className="p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm min-w-0">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{c.n}</span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </div>
                  <p className={`num-display text-2xl mt-2 tabular ${c.alerta ? 'text-destructive' : ''}`}>{c.v}</p>
                  <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full rounded-full ${c.alerta ? 'bg-destructive' : 'bg-foreground/25'}`} style={{ width: `${c.pct}%` }} />
                  </div>
                  <p className="text-2xs text-muted-foreground mt-1.5">{c.d}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Categorias: lista limpa, sem caixa ───────────────── */}
        <section>
          <SectionLabel action={<Button variant="ghost" size="sm" className="h-6 text-2xs px-2">Ver tudo</Button>}>
            Onde você mais gasta · 4 meses
          </SectionLabel>
          <div className="space-y-2.5">
            {CATS.map((c) => (
              <div key={c.nome}>
                <div className="flex items-baseline justify-between gap-2 text-sm mb-1">
                  <span className="truncate">{c.nome}</span>
                  <span className="flex items-baseline gap-2 shrink-0">
                    <span className="text-2xs text-muted-foreground tabular">{c.pct}%</span>
                    <span className="tabular font-medium">{c.valor}</span>
                  </span>
                </div>
                {/* Traço fino, largura relativa ao MAIOR item (não a um
                    multiplicador mágico) e cor em opacidade reduzida — a barra
                    é indicador de proporção, não bloco de cor. */}
                <div className="h-[2px] rounded-full bg-secondary/50 overflow-hidden">
                  <div
                    className="h-full rounded-full opacity-70"
                    style={{ width: `${(c.pct / CATS[0].pct) * 100}%`, backgroundColor: c.cor }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Lançamentos: linhas com hairline, sem caixa ─────── */}
        <section>
          <SectionLabel action={<Button variant="ghost" size="sm" className="h-6 text-2xs px-2">Ver todos <ArrowUpRight className="h-3 w-3" /></Button>}>
            Últimos lançamentos
          </SectionLabel>
          <ul className="divide-y divide-border/50 border-t border-border/50">
            {TXS.map((t) => (
              <li key={t.d} className="flex items-center justify-between gap-3 py-2.5 hover:bg-secondary/25 -mx-2 px-2 rounded-md transition-colors cursor-pointer">
                <div className="min-w-0">
                  <p className="text-sm truncate flex items-center gap-1.5">
                    {t.d}
                    {t.parc && <Badge size="sm" variant="muted">{t.parc}</Badge>}
                  </p>
                  <p className="text-2xs text-muted-foreground mt-0.5">{t.c} · {t.dt}</p>
                </div>
                <span className={`text-sm tabular shrink-0 ${t.pos ? 'text-success' : 'text-foreground'}`}>
                  {t.pos ? '+' : '−'} R$ {t.v}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Alerta: cor só quando significa algo ─────────────── */}
        <section>
          <SectionLabel>Precisa de atenção</SectionLabel>
          <div className="rounded-lg border border-destructive/25 bg-destructive/[0.07] px-3.5 py-3">
            <p className="text-sm font-medium">Fatura do Mercado Pago vence em 2 dias</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              R$ 3.476,21 · pagar até 20/08 evita R$ 496 de juros
            </p>
            <Button size="sm" variant="outline" className="h-7 text-xs mt-2.5">Pagar fatura</Button>
          </div>
        </section>

        {/* ── Referência de elementos ──────────────────────────── */}
        <section>
          <SectionLabel>Elementos</SectionLabel>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="h-8">Primário</Button>
              <Button size="sm" variant="outline" className="h-8">Secundário</Button>
              <Button size="sm" variant="ghost" className="h-8">Ghost</Button>
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <Badge size="sm" variant="success">pago</Badge>
              <Badge size="sm" variant="warning">vence hoje</Badge>
              <Badge size="sm" variant="danger">vencido</Badge>
              <Badge size="sm" variant="muted">3/12</Badge>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
