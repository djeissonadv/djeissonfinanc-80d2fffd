import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Home, Table2, ArrowDownUp, BarChart3, Save, FolderOpen, Trash2, Plus, Wallet } from 'lucide-react';
import { FolgaMensalTab } from '@/components/calculadora/FolgaMensalTab';
import { ViabilidadeTab } from '@/components/calculadora/ViabilidadeTab';
import { AmortizacaoTab } from '@/components/calculadora/AmortizacaoTab';
import { SimuladorAmortizacaoTab } from '@/components/calculadora/SimuladorAmortizacaoTab';
import { CenariosTab } from '@/components/calculadora/CenariosTab';
import { SacParams } from '@/lib/sac-utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

const DEFAULT_PARAMS: SacParams = {
  valorImovel: 385000,
  entrada: 120000,
  prazoMeses: 360,
  taxaAnualNominal: 11.19,
  trAnual: 0.50,
  itbiPercent: 2.0,
  escrituraPercent: 2.0,
  rendaBruta: 14000,
  dividasMensais: 1300,
  limiteComprometimento: 30,
  capitalDisponivel: 170000,
  reservaMeses: 7,
  aluguelAtual: 1550,
  condominioAtual: 120,
  saldoDevedorCarro: 33000,
  parcelaCarro: 1263,
  valorVendaImovel: 0,
  saldoDevedorImovelVender: 0,
  iptuAtrasado: 0,
  irVendaEstimado: 0,
  outrosCustosVenda: 0,
  fgtsDisponivel: 0,
  dividasAbertasQuitar: 0,
};

interface SavedSimulation {
  id: string;
  nome: string;
  created_at: string;
  updated_at: string;
}

function paramsToRow(params: SacParams) {
  return {
    valor_imovel: params.valorImovel,
    entrada: params.entrada,
    prazo_meses: params.prazoMeses,
    taxa_anual_nominal: params.taxaAnualNominal,
    tr_anual: params.trAnual,
    itbi_percent: params.itbiPercent,
    escritura_percent: params.escrituraPercent,
    renda_bruta: params.rendaBruta,
    dividas_mensais: params.dividasMensais,
    limite_comprometimento: params.limiteComprometimento,
    capital_disponivel: params.capitalDisponivel,
    reserva_meses: params.reservaMeses,
    aluguel_atual: params.aluguelAtual,
    condominio_atual: params.condominioAtual,
    saldo_devedor_carro: params.saldoDevedorCarro,
    parcela_carro: params.parcelaCarro,
    valor_venda_imovel: params.valorVendaImovel,
    saldo_devedor_imovel_vender: params.saldoDevedorImovelVender,
    iptu_atrasado: params.iptuAtrasado,
    ir_venda_estimado: params.irVendaEstimado,
    outros_custos_venda: params.outrosCustosVenda,
    fgts_disponivel: params.fgtsDisponivel,
    dividas_abertas_quitar: params.dividasAbertasQuitar,
  };
}

function rowToParams(row: any): SacParams {
  return {
    valorImovel: Number(row.valor_imovel),
    entrada: Number(row.entrada),
    prazoMeses: Number(row.prazo_meses),
    taxaAnualNominal: Number(row.taxa_anual_nominal),
    trAnual: Number(row.tr_anual),
    itbiPercent: Number(row.itbi_percent),
    escrituraPercent: Number(row.escritura_percent),
    rendaBruta: Number(row.renda_bruta),
    dividasMensais: Number(row.dividas_mensais),
    limiteComprometimento: Number(row.limite_comprometimento),
    capitalDisponivel: Number(row.capital_disponivel),
    reservaMeses: Number(row.reserva_meses),
    aluguelAtual: Number(row.aluguel_atual),
    condominioAtual: Number(row.condominio_atual),
    saldoDevedorCarro: Number(row.saldo_devedor_carro),
    parcelaCarro: Number(row.parcela_carro ?? 1263),
    valorVendaImovel: Number(row.valor_venda_imovel ?? 0),
    saldoDevedorImovelVender: Number(row.saldo_devedor_imovel_vender ?? 0),
    iptuAtrasado: Number(row.iptu_atrasado ?? 0),
    irVendaEstimado: Number(row.ir_venda_estimado ?? 0),
    outrosCustosVenda: Number(row.outros_custos_venda ?? 0),
    fgtsDisponivel: Number(row.fgts_disponivel ?? 0),
    dividasAbertasQuitar: Number(row.dividas_abertas_quitar ?? 0),
  };
}

export default function CalculadoraPage() {
  const { user } = useAuth();
  const [params, setParams] = useState<SacParams>(DEFAULT_PARAMS);
  const [savedList, setSavedList] = useState<SavedSimulation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeName, setActiveName] = useState('');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchSaved = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('simulacoes_financiamento')
        .select('id, nome, created_at, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      if (data) setSavedList(data);
    } catch (err) {
      console.error('Erro ao carregar simulações:', err);
    }
  }, [user]);

  useEffect(() => { fetchSaved(); }, [fetchSaved]);

  const handleChange = (partial: Partial<SacParams>) => {
    setParams(prev => ({ ...prev, ...partial }));
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      if (activeId) {
        // Update existing
        const { error } = await supabase
          .from('simulacoes_financiamento')
          .update({ ...paramsToRow(params), nome: activeName })
          .eq('id', activeId);
        if (error) throw error;
        toast.success('Simulação atualizada');
      } else {
        setSaveDialogOpen(true);
        setSaving(false);
        return;
      }
      await fetchSaved();
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + e.message);
    }
    setSaving(false);
  };

  const handleSaveNew = async () => {
    if (!user || !newName.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('simulacoes_financiamento')
        .insert({ ...paramsToRow(params), nome: newName.trim(), user_id: user.id })
        .select('id, nome')
        .single();
      if (error) throw error;
      setActiveId(data.id);
      setActiveName(data.nome);
      toast.success('Simulação salva');
      setSaveDialogOpen(false);
      setNewName('');
      await fetchSaved();
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + e.message);
    }
    setSaving(false);
  };

  const handleLoad = async (id: string) => {
    const { data, error } = await supabase
      .from('simulacoes_financiamento')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) { toast.error('Erro ao carregar'); return; }
    setParams(rowToParams(data));
    setActiveId(data.id);
    setActiveName(data.nome);
    toast.success(`Carregada: ${data.nome}`);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('simulacoes_financiamento').delete().eq('id', id);
    if (error) { toast.error('Erro ao excluir'); return; }
    if (activeId === id) { setActiveId(null); setActiveName(''); }
    toast.success('Simulação excluída');
    await fetchSaved();
  };

  const handleNew = () => {
    setParams(DEFAULT_PARAMS);
    setActiveId(null);
    setActiveName('');
  };

  return (
    <div className="space-y-4 animate-fade-in max-w-4xl mx-auto">
      {/* Save/Load bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          {activeId ? (
            <span className="text-sm text-muted-foreground truncate block">
              📄 {activeName}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground italic">Nova simulação (não salva)</span>
          )}
        </div>

        <Button variant="outline" size="sm" onClick={handleNew} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Nova
        </Button>

        <Button variant="default" size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
          <Save className="h-3.5 w-3.5" /> {activeId ? 'Salvar' : 'Salvar como...'}
        </Button>

        {savedList.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <FolderOpen className="h-3.5 w-3.5" /> Carregar ({savedList.length})
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {savedList.map((sim) => (
                <DropdownMenuItem key={sim.id} className="flex items-center justify-between gap-2">
                  <button
                    className="flex-1 text-left truncate text-sm"
                    onClick={() => handleLoad(sim.id)}
                  >
                    {sim.nome}
                    <span className="block text-xs text-muted-foreground">
                      {new Date(sim.updated_at).toLocaleDateString('pt-BR')}
                    </span>
                  </button>
                  {/* Confirmação simples antes de excluir — sem dialog porque
                      o item já vive dentro de DropdownMenuItem (foco compete).
                      Aceitável: o sim.nome aparece no prompt pro user saber o que
                      tá apagando. */}
                  <button
                    className="text-destructive hover:text-destructive/80 p-1"
                    aria-label={`Excluir simulação ${sim.nome}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Excluir simulação "${sim.nome}"? Esta ação não pode ser desfeita.`)) {
                        handleDelete(sim.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setSaveDialogOpen(true); setNewName(''); }}>
                <Save className="h-3.5 w-3.5 mr-2" /> Salvar como nova...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Tabs defaultValue="folga" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="folga" className="flex-1 gap-1.5">
            <Wallet className="h-4 w-4" />
            Cabe no mês?
          </TabsTrigger>
          <TabsTrigger value="viabilidade" className="flex-1 gap-1.5">
            <Home className="h-4 w-4" />
            Viabilidade
          </TabsTrigger>
          <TabsTrigger value="amortizacao" className="flex-1 gap-1.5">
            <Table2 className="h-4 w-4" />
            Amortização
          </TabsTrigger>
          <TabsTrigger value="simulador" className="flex-1 gap-1.5">
            <ArrowDownUp className="h-4 w-4" />
            Simulador
          </TabsTrigger>
          <TabsTrigger value="cenarios" className="flex-1 gap-1.5">
            <BarChart3 className="h-4 w-4" />
            Cenários
          </TabsTrigger>
        </TabsList>

        <TabsContent value="folga" className="mt-4">
          <FolgaMensalTab />
        </TabsContent>

        <TabsContent value="viabilidade" className="mt-4">
          <ViabilidadeTab params={params} onChange={handleChange} />
        </TabsContent>

        <TabsContent value="amortizacao" className="mt-4">
          <AmortizacaoTab params={params} />
        </TabsContent>

        <TabsContent value="simulador" className="mt-4">
          <SimuladorAmortizacaoTab params={params} />
        </TabsContent>

        <TabsContent value="cenarios" className="mt-4">
          <CenariosTab params={params} />
        </TabsContent>
      </Tabs>

      {/* Save as dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Salvar simulação</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Nome da simulação</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ex: Apartamento Centro 2026"
              onKeyDown={(e) => e.key === 'Enter' && handleSaveNew()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveNew} disabled={saving || !newName.trim()}>
              <Save className="h-4 w-4 mr-1.5" /> Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
