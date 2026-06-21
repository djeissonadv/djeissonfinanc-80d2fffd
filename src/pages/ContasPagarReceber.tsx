import { useState, useMemo } from 'react';
import { usePersistedMonth } from '@/hooks/usePersistedMonth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { MonthSelector } from '@/components/MonthSelector';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { formatCurrency, toLocalIso } from '@/lib/format';
import { CalendarClock, Plus, Pencil, Trash2, CheckCircle2, Circle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { CATEGORIAS } from '@/types/database.types';

type Tipo = 'pagar' | 'receber';
type FiltroStatus = 'todos' | 'pendentes' | 'pagos';
type FiltroTipo = 'todos' | 'pagar' | 'receber';

interface CPR {
  id: string;
  user_id: string;
  descricao: string;
  valor: number;
  tipo: Tipo;
  mes: string;            // YYYY-MM
  pago: boolean;
  data_vencimento: string | null;
  categoria: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Página de "Contas a pagar / Contas a receber".
 *
 * Cobre o gap que o Dashboard já mostrava ("X a pagar / Y a receber" como
 * subtítulo) mas que NÃO tinha UI pra gerenciar. Agora dá pra:
 *   - criar lançamento de compromisso futuro (boleto, mesada, conta de luz que
 *     ainda vai chegar, freela que ainda vai entrar)
 *   - marcar como pago/recebido (toggle único)
 *   - editar (descrição, valor, vencimento, categoria)
 *   - deletar
 *
 * `mes` é a competência (YYYY-MM) — usada pelo Dashboard pra somar o do mês
 * corrente. `data_vencimento` é opcional pra organizar visualmente.
 */
export default function ContasPagarReceberPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const now = new Date();
  const { month, year, setMonth, setYear } = usePersistedMonth();
  const billingMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos');
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CPR | null>(null);

  // Form state
  const [tipo, setTipo] = useState<Tipo>('pagar');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState<number>(0);
  const [dataVencimento, setDataVencimento] = useState<string>('');
  const [categoria, setCategoria] = useState<string>('');

  const { data: itens, isLoading } = useQuery({
    queryKey: ['contas-pagar-receber', user?.id, billingMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contas_pagar_receber')
        .select('*')
        .eq('user_id', user!.id)
        .eq('mes', billingMonth)
        .order('data_vencimento', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as CPR[];
    },
    enabled: !!user,
  });

  const resetForm = () => {
    setEditing(null);
    setTipo('pagar');
    setDescricao('');
    setValor(0);
    setDataVencimento('');
    setCategoria('');
  };

  const openNew = (tipoDefault: Tipo = 'pagar') => {
    resetForm();
    setTipo(tipoDefault);
    setDialogOpen(true);
  };

  const openEdit = (item: CPR) => {
    setEditing(item);
    setTipo(item.tipo);
    setDescricao(item.descricao);
    setValor(Number(item.valor) || 0);
    setDataVencimento(item.data_vencimento || '');
    setCategoria(item.categoria || '');
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user || !descricao.trim() || !valor) {
        throw new Error('Preencha descrição e valor');
      }
      const valorNum = valor;
      if (!isFinite(valorNum) || valorNum <= 0) {
        throw new Error('Valor inválido');
      }
      const payload = {
        user_id: user.id,
        descricao: descricao.trim(),
        valor: valorNum,
        tipo,
        mes: billingMonth,
        data_vencimento: dataVencimento || null,
        categoria: categoria || null,
      };
      if (editing) {
        const { error } = await supabase
          .from('contas_pagar_receber')
          .update(payload)
          .eq('id', editing.id)
          .eq('user_id', user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('contas_pagar_receber')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contas-pagar-receber'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast({ title: editing ? 'Lançamento atualizado' : 'Lançamento criado' });
      setDialogOpen(false);
      resetForm();
    },
    onError: (e: any) => toast({ title: 'Erro ao salvar', description: e?.message?.slice(0, 200), variant: 'destructive' }),
  });

  const togglePagoMutation = useMutation({
    mutationFn: async ({ id, pago }: { id: string; pago: boolean }) => {
      const { error } = await supabase
        .from('contas_pagar_receber')
        .update({ pago })
        .eq('id', id)
        .eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contas-pagar-receber'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: any) => toast({ title: 'Erro ao marcar', description: e?.message?.slice(0, 200), variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('contas_pagar_receber')
        .delete()
        .eq('id', id)
        .eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contas-pagar-receber'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast({ title: 'Lançamento excluído' });
    },
    onError: (e: any) => toast({ title: 'Erro ao excluir', description: e?.message?.slice(0, 200), variant: 'destructive' }),
  });

  // KPIs do mês — mesma lógica do Dashboard pra agregar visualmente
  const filtered = useMemo(() => {
    return (itens || []).filter((i) => {
      if (filtroStatus === 'pendentes' && i.pago) return false;
      if (filtroStatus === 'pagos' && !i.pago) return false;
      if (filtroTipo !== 'todos' && i.tipo !== filtroTipo) return false;
      return true;
    });
  }, [itens, filtroStatus, filtroTipo]);

  const aPagarPendente = (itens || [])
    .filter((i) => i.tipo === 'pagar' && !i.pago)
    .reduce((s, i) => s + Number(i.valor), 0);
  const aReceberPendente = (itens || [])
    .filter((i) => i.tipo === 'receber' && !i.pago)
    .reduce((s, i) => s + Number(i.valor), 0);
  const pagoMes = (itens || [])
    .filter((i) => i.pago)
    .reduce((s, i) => s + Number(i.valor), 0);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarClock className="h-6 w-6" />
            A pagar / a receber
          </h1>
          <p className="text-sm text-muted-foreground">Compromissos do mês — boletos pendentes, freelas a receber, contas marcadas como pagas</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
          <Button size="sm" onClick={() => openNew('pagar')} aria-label="Novo lançamento a pagar">
            <Plus className="h-4 w-4 mr-1" /> Novo
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="text-xs text-muted-foreground">A pagar pendente</div>
              <ArrowDownRight className="h-5 w-5 text-red-600" />
            </div>
            <div className="text-2xl font-bold mt-1 text-red-600">{formatCurrency(aPagarPendente)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="text-xs text-muted-foreground">A receber pendente</div>
              <ArrowUpRight className="h-5 w-5 text-green-600" />
            </div>
            <div className="text-2xl font-bold mt-1 text-green-600">{formatCurrency(aReceberPendente)}</div>
          </CardContent>
        </Card>
        <Card className="col-span-2 md:col-span-1">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="text-xs text-muted-foreground">Já pago/recebido</div>
              <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold mt-1">{formatCurrency(pagoMes)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Select value={filtroStatus} onValueChange={(v: FiltroStatus) => setFiltroStatus(v)}>
          <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filtrar por status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="pendentes">Só pendentes</SelectItem>
            <SelectItem value="pagos">Só pagos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroTipo} onValueChange={(v: FiltroTipo) => setFiltroTipo(v)}>
          <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filtrar por tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Pagar e receber</SelectItem>
            <SelectItem value="pagar">Só a pagar</SelectItem>
            <SelectItem value="receber">Só a receber</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CalendarClock className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              {(itens?.length || 0) === 0
                ? 'Sem lançamentos no mês — crie o primeiro.'
                : 'Nenhum lançamento corresponde ao filtro atual.'}
            </p>
            <div className="flex gap-2 justify-center">
              <Button size="sm" onClick={() => openNew('pagar')}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar a pagar
              </Button>
              <Button size="sm" variant="outline" onClick={() => openNew('receber')}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar a receber
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <Card key={item.id} className={item.pago ? 'opacity-70' : ''}>
              <CardContent className="p-3 flex items-center gap-3">
                <Checkbox
                  checked={item.pago}
                  onCheckedChange={(v) => togglePagoMutation.mutate({ id: item.id, pago: !!v })}
                  aria-label={item.pago ? `Desmarcar ${item.descricao} como pago` : `Marcar ${item.descricao} como pago`}
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${item.pago ? 'line-through' : ''}`}>
                      {item.descricao}
                    </span>
                    <Badge variant={item.tipo === 'pagar' ? 'destructive' : 'default'} className="text-[10px] px-1.5 py-0 h-4">
                      {item.tipo === 'pagar' ? '↓ A pagar' : '↑ A receber'}
                    </Badge>
                    {item.categoria && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{item.categoria}</Badge>
                    )}
                  </div>
                  {item.data_vencimento && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Vence em {new Date(item.data_vencimento + 'T00:00').toLocaleDateString('pt-BR')}
                    </div>
                  )}
                </div>
                <div className={`text-sm font-semibold tabular-nums shrink-0 ${item.tipo === 'pagar' ? 'text-red-600' : 'text-green-600'}`}>
                  {item.tipo === 'pagar' ? '-' : '+'}{formatCurrency(Number(item.valor))}
                </div>
                <Button size="icon" variant="ghost" onClick={() => openEdit(item)} aria-label={`Editar ${item.descricao}`} className="shrink-0">
                  <Pencil className="h-4 w-4" />
                </Button>
                <ConfirmDelete
                  onConfirm={() => deleteMutation.mutate(item.id)}
                  title={`Excluir "${item.descricao}"?`}
                  description="Este lançamento será removido permanentemente."
                  trigger={
                    <Button size="icon" variant="ghost" className="text-destructive shrink-0" aria-label={`Excluir ${item.descricao}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog novo/editar */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar lançamento' : 'Novo lançamento'}</DialogTitle>
            <DialogDescription>Mês de competência: {billingMonth}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }} className="space-y-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v: Tipo) => setTipo(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pagar">A pagar (saída futura)</SelectItem>
                  <SelectItem value="receber">A receber (entrada futura)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Boleto IPTU" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Valor (R$)</Label>
                <MoneyInput value={valor} onChange={setValor} placeholder="0,00" />
              </div>
              <div className="space-y-2">
                <Label>Vencimento</Label>
                <Input type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Categoria (opcional)</Label>
              <Select value={categoria || '__none__'} onValueChange={(v) => setCategoria(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem categoria</SelectItem>
                  {CATEGORIAS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saveMutation.isPending || !descricao.trim() || !valor}>
                {saveMutation.isPending ? 'Salvando…' : editing ? 'Salvar' : 'Adicionar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Hoje só lançamentos atendem ao mês selecionado pelo MonthSelector — pra
          ver outro mês, é só trocar. Histórico não é separado, vive em cada mes. */}
      {!isLoading && (itens?.length || 0) > 0 && (
        <p className="text-xs text-muted-foreground text-center pt-2">
          {filtered.length} de {itens?.length} lançamentos · {billingMonth}
        </p>
      )}
    </div>
  );
}
