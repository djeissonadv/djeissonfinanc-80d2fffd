import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/format';
import { Plus, Trash2, Copy, ArrowDownLeft, ArrowUpRight, GripVertical } from 'lucide-react';

/**
 * Cenários — uma "planilha de contas de padeiro" dentro do app.
 *
 * Monta um cálculo livre de "entra − sai = sobra" (ex.: venda do apê menos o
 * que a gente paga/quita = quanto resta pra casa nova). Vários cenários salvos
 * com nome, tudo em localStorage — é ferramenta de decisão, não dado contábil,
 * então não precisa ir pro banco nem sujar os lançamentos.
 */

type Tipo = 'entra' | 'sai';
interface Linha { id: string; descricao: string; valor: number; tipo: Tipo }
interface Cenario { id: string; nome: string; linhas: Linha[] }

const STORAGE = 'financas_cenarios_v1';

// id sem Date.now()/Math.random() de forma robusta o suficiente pra localStorage
let _seq = 0;
const novoId = () => `${Date.now?.() ?? ''}_${_seq++}`;

function cenarioExemplo(): Cenario {
  return {
    id: novoId(),
    nome: 'Venda do apê → casa nova',
    linhas: [
      { id: novoId(), descricao: 'Venda do apê', valor: 350000, tipo: 'entra' },
      { id: novoId(), descricao: 'Comissão do corretor (~6%)', valor: 21000, tipo: 'sai' },
      { id: novoId(), descricao: 'Quitar saldo do apê (se houver)', valor: 0, tipo: 'sai' },
      { id: novoId(), descricao: 'Quitar dívidas (Sicredi + cartões)', valor: 30000, tipo: 'sai' },
      { id: novoId(), descricao: 'Entrada da casa nova', valor: 200000, tipo: 'sai' },
    ],
  };
}

function carregar(): { cenarios: Cenario[]; selId: string } {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) {
      const p = JSON.parse(raw);
      if (p?.cenarios?.length) return { cenarios: p.cenarios, selId: p.selId || p.cenarios[0].id };
    }
  } catch { /* localStorage indisponível / json inválido → cai no exemplo */ }
  const ex = cenarioExemplo();
  return { cenarios: [ex], selId: ex.id };
}

export default function CenariosPage() {
  const [{ cenarios, selId }, setState] = useState(carregar);

  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify({ cenarios, selId })); } catch { /* ok */ }
  }, [cenarios, selId]);

  const atual = cenarios.find((c) => c.id === selId) ?? cenarios[0];

  const totais = useMemo(() => {
    const entra = atual.linhas.filter((l) => l.tipo === 'entra').reduce((s, l) => s + l.valor, 0);
    const sai = atual.linhas.filter((l) => l.tipo === 'sai').reduce((s, l) => s + l.valor, 0);
    return { entra, sai, sobra: Math.round((entra - sai) * 100) / 100 };
  }, [atual]);

  // ---- mutadores (imutáveis) ----
  const patchAtual = (fn: (c: Cenario) => Cenario) =>
    setState((s) => ({ ...s, cenarios: s.cenarios.map((c) => (c.id === s.selId ? fn(c) : c)) }));

  const setLinha = (id: string, patch: Partial<Linha>) =>
    patchAtual((c) => ({ ...c, linhas: c.linhas.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const addLinha = (tipo: Tipo) =>
    patchAtual((c) => ({ ...c, linhas: [...c.linhas, { id: novoId(), descricao: '', valor: 0, tipo }] }));
  const delLinha = (id: string) =>
    patchAtual((c) => ({ ...c, linhas: c.linhas.filter((l) => l.id !== id) }));
  const renomear = (nome: string) => patchAtual((c) => ({ ...c, nome }));

  const novoCenario = () => {
    const c: Cenario = { id: novoId(), nome: 'Novo cenário', linhas: [] };
    setState((s) => ({ cenarios: [...s.cenarios, c], selId: c.id }));
  };
  const duplicar = () => {
    const c: Cenario = { ...atual, id: novoId(), nome: `${atual.nome} (cópia)`,
      linhas: atual.linhas.map((l) => ({ ...l, id: novoId() })) };
    setState((s) => ({ cenarios: [...s.cenarios, c], selId: c.id }));
  };
  const excluir = () => setState((s) => {
    const rest = s.cenarios.filter((c) => c.id !== s.selId);
    if (!rest.length) { const ex = cenarioExemplo(); return { cenarios: [ex], selId: ex.id }; }
    return { cenarios: rest, selId: rest[0].id };
  });

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Cabeçalho + seletor de cenário */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cenários</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Calcule "entra − sai = sobra". Ex.: venda do apê menos o que quita = quanto resta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={atual.id} onValueChange={(v) => setState((s) => ({ ...s, selId: v }))}>
            <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {cenarios.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8" onClick={novoCenario}>
            <Plus className="h-4 w-4" /> Novo
          </Button>
        </div>
      </div>

      {/* Resultado em destaque — a resposta ("quanto sobra") é o herói */}
      <section>
        <input
          value={atual.nome}
          onChange={(e) => renomear(e.target.value)}
          className="bg-transparent text-sm font-medium outline-none border-b border-transparent focus:border-border w-full max-w-md mb-3"
          aria-label="Nome do cenário"
        />
        <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground font-medium">Sobra</p>
        <p className={`num-hero text-5xl md:text-6xl mt-1 ${totais.sobra >= 0 ? 'text-primary' : 'text-destructive'}`}>
          {formatCurrency(totais.sobra)}
        </p>
        <div className="mt-4 flex h-1 rounded-full overflow-hidden bg-secondary/60">
          <div className="bg-success" style={{ width: `${pct(totais.entra, totais.entra + totais.sai)}%` }} />
          <div className="bg-destructive/70" style={{ width: `${pct(totais.sai, totais.entra + totais.sai)}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            <span className="text-muted-foreground">Entra</span>
            <span className="tabular font-medium">{formatCurrency(totais.entra)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-destructive/70" />
            <span className="text-muted-foreground">Sai</span>
            <span className="tabular font-medium">{formatCurrency(totais.sai)}</span>
          </span>
        </div>
      </section>

      {/* Linhas */}
      <section className="space-y-4">
        <BlocoLinhas
          titulo="O que entra" tipo="entra" cor="text-success" icon={<ArrowDownLeft className="h-3.5 w-3.5" />}
          linhas={atual.linhas.filter((l) => l.tipo === 'entra')}
          onSet={setLinha} onDel={delLinha} onAdd={() => addLinha('entra')}
        />
        <BlocoLinhas
          titulo="O que sai" tipo="sai" cor="text-destructive" icon={<ArrowUpRight className="h-3.5 w-3.5" />}
          linhas={atual.linhas.filter((l) => l.tipo === 'sai')}
          onSet={setLinha} onDel={delLinha} onAdd={() => addLinha('sai')}
        />
      </section>

      {/* Ações do cenário */}
      <div className="flex items-center gap-2 pt-2 border-t border-border/60">
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={duplicar}>
          <Copy className="h-3.5 w-3.5" /> Duplicar
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:text-destructive" onClick={excluir}>
          <Trash2 className="h-3.5 w-3.5" /> Excluir cenário
        </Button>
        <span className="text-2xs text-muted-foreground ml-auto">Salva sozinho neste dispositivo.</span>
      </div>
    </div>
  );
}

function pct(v: number, total: number) {
  return total > 0 ? (v / total) * 100 : 0;
}

function BlocoLinhas({
  titulo, cor, icon, linhas, onSet, onDel, onAdd,
}: {
  titulo: string; tipo: Tipo; cor: string; icon: React.ReactNode;
  linhas: Linha[];
  onSet: (id: string, p: Partial<Linha>) => void;
  onDel: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <div className={`flex items-center gap-1.5 mb-2 text-2xs uppercase tracking-wider font-medium ${cor}`}>
        {icon}{titulo}
      </div>
      <div className="divide-y divide-border/50 border-y border-border/50">
        {linhas.map((l) => (
          <div key={l.id} className="flex items-center gap-2 py-1.5 group">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
            <Input
              value={l.descricao}
              onChange={(e) => onSet(l.id, { descricao: e.target.value })}
              placeholder="Descrição"
              className="h-8 border-0 bg-transparent px-0 focus-visible:ring-0 shadow-none flex-1 min-w-0"
            />
            <MoneyInput
              value={l.valor}
              onChange={(v) => onSet(l.id, { valor: v })}
              className="h-8 w-32 text-right tabular shrink-0"
            />
            <button
              type="button"
              onClick={() => onDel(l.id)}
              className="text-muted-foreground/40 hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Remover linha"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {linhas.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">Nenhuma linha ainda.</p>
        )}
      </div>
      <Button size="sm" variant="ghost" className="h-7 text-xs mt-1.5 px-2 text-muted-foreground" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" /> Adicionar linha
      </Button>
    </div>
  );
}
