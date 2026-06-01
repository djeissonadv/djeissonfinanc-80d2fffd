import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { generateHash } from '@/lib/csv-parser';
import { autoCategorizarTransacao, isTransferenciaInterna } from '@/lib/auto-categorize';
import { toLocalIso } from '@/lib/format';
import { criarReembolsoVinculado } from '@/lib/reembolso';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When omitted, the modal lets the user pick an account. */
  contaId?: string;
  contaNome?: string;
  contaTipo?: 'credito' | 'debito';
  defaultMesCompetencia?: string; // YYYY-MM for credit cards
  defaultTipo?: 'despesa' | 'receita';
}

export function ManualTransactionModal({
  open, onOpenChange, contaId, contaNome, contaTipo, defaultMesCompetencia, defaultTipo,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [tipo, setTipo] = useState<'despesa' | 'receita'>(defaultTipo || 'despesa');
  // toLocalIso (não toISOString): no fuso BR, à noite o toISOString() avança pro
  // dia seguinte, defaultando a data pra "amanhã" e deixando a transação fora do
  // saldo (que filtra <= hoje) até a data chegar.
  const [data, setData] = useState(toLocalIso(new Date()));
  const [essencial, setEssencial] = useState(false);
  const [selectedContaId, setSelectedContaId] = useState<string>(contaId || '');
  const [recorrente, setRecorrente] = useState(false);
  const [meses, setMeses] = useState('12');
  // Parcelamento de compra de cartão — só faz sentido quando isCredito.
  // Ex: comprou em jan/2026, está pagando a parcela 6 de 12. O sistema cria
  // a parcela 6 em jan + automaticamente projeta 7,8,9,10,11,12 nos meses
  // seguintes, todas com mesmo valor e mesmo grupo_parcela.
  const [parcelado, setParcelado] = useState(false);
  const [parcelaAtual, setParcelaAtual] = useState('1');
  const [parcelaTotal, setParcelaTotal] = useState('12');
  const [submitting, setSubmitting] = useState(false);
  // Reembolso por outra pessoa — só faz sentido quando tipo='despesa'.
  // Quando ligado, criamos uma receita vinculada com categoria='Reembolsos'.
  const [reembolsoOn, setReembolsoOn] = useState(false);
  const [reembolsoPessoa, setReembolsoPessoa] = useState('');
  const [reembolsoValor, setReembolsoValor] = useState('');
  const [contaReembolsoId, setContaReembolsoId] = useState('');

  const pessoaNome = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Titular';

  // Reset selected account when contaId changes (passed in from parent)
  useEffect(() => {
    if (contaId) setSelectedContaId(contaId);
  }, [contaId]);

  // Fetch accounts list when needed (no contaId provided)
  const { data: contas } = useQuery({
    queryKey: ['contas-for-manual-tx', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('contas')
        .select('id, nome, tipo')
        .eq('user_id', user!.id)
        .order('nome');
      return data || [];
    },
    enabled: !!user && open && !contaId,
  });

  const contaSelecionada = contas?.find(c => c.id === selectedContaId);
  const effectiveContaTipo: 'credito' | 'debito' | undefined =
    contaTipo || (contaSelecionada?.tipo as 'credito' | 'debito' | undefined);
  const effectiveContaNome = contaNome || contaSelecionada?.nome || '';
  const isCredito = effectiveContaTipo === 'credito';

  const handleSubmit = async () => {
    if (!user || !descricao || !valor || !data || !selectedContaId) return;
    setSubmitting(true);

    try {
      const valorNum = Number(valor);
      const autoCat = autoCategorizarTransacao(descricao);
      const mesesNum = recorrente ? Math.max(1, Math.min(60, parseInt(meses) || 1)) : 1;
      const grupoRec = recorrente ? crypto.randomUUID() : null;

      // ── Parcelamento de cartão ────────────────────────────────────────
      // Parcela X de Y: cria a parcela X no mês selecionado + projeta Y-X
      // parcelas restantes nos meses seguintes (mesmo grupo_parcela).
      // Ex: lançou parcela 6 de 12 em janeiro/2026 → cria 6/12 em jan e
      // projeta 7/12 em fev, 8/12 em mar, ..., 12/12 em jul.
      const ehParcelado = parcelado && isCredito && !recorrente;
      const pAtual = ehParcelado ? Math.max(1, parseInt(parcelaAtual) || 1) : 0;
      const pTotal = ehParcelado ? Math.max(pAtual, parseInt(parcelaTotal) || pAtual) : 0;
      const totalRows = ehParcelado ? (pTotal - pAtual + 1) : mesesNum;
      const grupoParc = ehParcelado ? crypto.randomUUID() : grupoRec;

      // Build N rows (1 if simple, N if recurring/parcelado)
      const baseDate = new Date(data + 'T00:00:00');
      const rows = [];
      for (let i = 0; i < totalRows; i++) {
        const d = new Date(baseDate);
        d.setMonth(d.getMonth() + i);
        const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const mesComp = isCredito
          ? (defaultMesCompetencia && i === 0
              ? defaultMesCompetencia
              : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
          : null;

        // Número da parcela: i=0 → pAtual, i=1 → pAtual+1, etc.
        const parcelaIdx = ehParcelado ? pAtual + i : null;

        const hashSeed = ehParcelado
          ? `${grupoParc}_${parcelaIdx}`
          : recorrente
            ? `${grupoRec}_${i}`
            : `${descricao}_${valorNum}_${isoDate}`;
        const hash = generateHash(isoDate, descricao, valorNum, pessoaNome) + '_manual_' + hashSeed.substring(0, 12);

        // Transferência interna (PIX entre cônjuges, entre contas próprias) NÃO
        // pode contar como receita/despesa real — vira "ruído" no Dashboard.
        // O auto-categorize já marca a categoria certa; aqui completamos com a
        // flag que ele não tem como setar.
        const ehTransferencia = isTransferenciaInterna(descricao);

        // Descrição da parcela: "Compra X (N/M)" pra fácil identificação.
        const descricaoFinal = ehParcelado
          ? `${descricao} (${parcelaIdx}/${pTotal})`
          : descricao;

        rows.push({
          user_id: user.id,
          conta_id: selectedContaId,
          data: isoDate,
          descricao: descricaoFinal,
          descricao_normalizada: descricaoFinal.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(),
          valor: valorNum,
          tipo,
          categoria: autoCat || 'Outros',
          essencial,
          parcela_atual: parcelaIdx,
          parcela_total: ehParcelado ? pTotal : null,
          hash_transacao: hash,
          pessoa: pessoaNome,
          mes_competencia: mesComp,
          grupo_parcela: grupoParc,
          ignorar_dashboard: ehTransferencia,
          observacoes: recorrente
            ? `Recorrente ${i + 1}/${mesesNum}`
            : ehParcelado
              ? `Parcelado ${parcelaIdx}/${pTotal}`
              : null,
        });
      }

      // Insert e retorna os IDs criados (precisamos do ID pra vincular o reembolso
      // só na 1ª transação da série recorrente; o resto não tem reembolso).
      const { data: inseridas, error } = await supabase
        .from('transacoes')
        .insert(rows)
        .select('id, data, descricao');
      if (error) throw error;

      // Reembolso só pra despesa não recorrente (recorrentes geralmente são
      // assinaturas/contas fixas; reembolso pontual fica fora desse caminho).
      let reembolsoCriado = false;
      if (
        reembolsoOn &&
        tipo === 'despesa' &&
        !recorrente &&
        reembolsoPessoa.trim() &&
        Number(reembolsoValor) > 0 &&
        contaReembolsoId &&
        inseridas?.[0]?.id
      ) {
        try {
          await criarReembolsoVinculado({
            userId: user.id,
            despesaId: inseridas[0].id,
            despesaDescricao: descricao,
            despesaData: inseridas[0].data,
            despesaConta: selectedContaId,
            contaReceitaId: contaReembolsoId,
            pessoa: reembolsoPessoa.trim(),
            valor: Number(reembolsoValor),
            pessoaTitular: pessoaNome,
          });
          reembolsoCriado = true;
        } catch (e: any) {
          toast({
            title: 'Despesa salva, mas o reembolso falhou',
            description: e?.message?.slice(0, 200),
            variant: 'destructive',
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['faturas'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-detail'] });
      queryClient.invalidateQueries({ queryKey: ['saldos'] });
      queryClient.invalidateQueries({ queryKey: ['fatura-acumulada'] });

      toast({
        title: ehParcelado
          ? `Parcela ${pAtual}/${pTotal} adicionada + ${totalRows - 1} parcela${totalRows === 2 ? '' : 's'} projetada${totalRows === 2 ? '' : 's'}`
          : recorrente
          ? `${mesesNum} lançamentos recorrentes adicionados`
          : reembolsoCriado
          ? 'Lançamento + reembolso criados'
          : 'Lançamento adicionado',
      });

      // Reset form
      setDescricao('');
      setValor('');
      setTipo(defaultTipo || 'despesa');
      setEssencial(false);
      setRecorrente(false);
      setMeses('12');
      setParcelado(false);
      setParcelaAtual('1');
      setParcelaTotal('12');
      setReembolsoOn(false);
      setReembolsoPessoa('');
      setReembolsoValor('');
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast({ title: 'Erro ao adicionar lançamento', variant: 'destructive' });
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>
            Novo Lançamento{effectiveContaNome ? ` — ${effectiveContaNome}` : ''}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4">
          {!contaId && (
            <div className="space-y-2">
              <Label>Conta</Label>
              <Select value={selectedContaId} onValueChange={setSelectedContaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma conta" />
                </SelectTrigger>
                <SelectContent>
                  {contas?.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome} ({c.tipo === 'credito' ? 'Cartão' : 'Conta'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Descrição</Label>
            <Input
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              placeholder="Ex: Aluguel, Internet, Salário..."
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={valor}
                onChange={e => setValor(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v: 'despesa' | 'receita') => setTipo(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="despesa">Despesa</SelectItem>
                  <SelectItem value="receita">Receita</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Data{isCredito ? ' da compra' : ''}</Label>
            <Input
              type="date"
              value={data}
              onChange={e => setData(e.target.value)}
            />
          </div>

          {defaultMesCompetencia && (
            <p className="text-xs text-muted-foreground">
              Competência: {defaultMesCompetencia}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="essencial"
              checked={essencial}
              onCheckedChange={(v) => setEssencial(!!v)}
            />
            <Label htmlFor="essencial" className="cursor-pointer text-sm font-normal">
              Marcar como essencial
            </Label>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="recorrente"
                checked={recorrente}
                onCheckedChange={(v) => {
                  const on = !!v;
                  setRecorrente(on);
                  if (on) setParcelado(false);
                }}
                disabled={parcelado}
              />
              <Label htmlFor="recorrente" className="cursor-pointer text-sm font-medium">
                Repetir todos os meses
              </Label>
            </div>
            {recorrente && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Por quantos meses?</Label>
                <Input
                  type="number"
                  min="1"
                  max="60"
                  value={meses}
                  onChange={e => setMeses(e.target.value)}
                  placeholder="12"
                />
                <p className="text-xs text-muted-foreground">
                  Serão criados {Math.max(1, Math.min(60, parseInt(meses) || 1))} lançamentos
                  iguais, um por mês a partir da data informada.
                </p>
              </div>
            )}
          </div>

          {/* Compra parcelada — só faz sentido em cartão de crédito.
              Lança a parcela atual (X de Y) + projeta as Y-X parcelas
              restantes automaticamente nos meses seguintes. */}
          {isCredito && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="parcelado"
                  checked={parcelado}
                  onCheckedChange={(v) => {
                    const on = !!v;
                    setParcelado(on);
                    if (on) setRecorrente(false);
                  }}
                  disabled={recorrente}
                />
                <Label htmlFor="parcelado" className="cursor-pointer text-sm font-medium">
                  Compra parcelada
                </Label>
              </div>
              {parcelado && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Parcela atual</Label>
                      <Input
                        type="number"
                        min="1"
                        max={parcelaTotal || undefined}
                        value={parcelaAtual}
                        onChange={e => setParcelaAtual(e.target.value)}
                        placeholder="6"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Total de parcelas</Label>
                      <Input
                        type="number"
                        min={parcelaAtual || '1'}
                        value={parcelaTotal}
                        onChange={e => setParcelaTotal(e.target.value)}
                        placeholder="12"
                      />
                    </div>
                  </div>
                  {(() => {
                    const a = Math.max(1, parseInt(parcelaAtual) || 1);
                    const t = Math.max(a, parseInt(parcelaTotal) || a);
                    const restantes = t - a;
                    const v = Number(valor) || 0;
                    return (
                      <p className="text-xs text-muted-foreground">
                        Lança a parcela <strong>{a}/{t}</strong> em {data}
                        {restantes > 0 && (
                          <> + projeta <strong>{restantes}</strong> parcela{restantes === 1 ? '' : 's'} ({a + 1}/{t} até {t}/{t}) nos meses seguintes</>
                        )}.
                        {v > 0 && t > a && (
                          <> Total restante a pagar: <strong>{(v * (restantes + 1)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>.</>
                        )}
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Reembolso por outra pessoa — só faz sentido em despesa. Quando
              ligado, cria automaticamente uma receita vinculada com categoria
              'Reembolsos' pra refletir o dinheiro que vai voltar. */}
          {tipo === 'despesa' && !recorrente && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="reembolso"
                  checked={reembolsoOn}
                  onCheckedChange={(v) => {
                    const on = !!v;
                    setReembolsoOn(on);
                    if (on && !reembolsoValor && valor) setReembolsoValor(valor);
                    if (on && !contaReembolsoId) {
                      // default = primeira conta de débito
                      const debito = contas?.find(c => c.tipo === 'debito');
                      if (debito) setContaReembolsoId(debito.id);
                    }
                  }}
                />
                <Label htmlFor="reembolso" className="cursor-pointer text-sm font-medium">
                  Outra pessoa paga (parte ou total) — cria receita
                </Label>
              </div>
              {reembolsoOn && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Pessoa</Label>
                      <Input
                        value={reembolsoPessoa}
                        onChange={(e) => setReembolsoPessoa(e.target.value)}
                        placeholder="Ex: Maiara"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Valor a receber {valor && `(de ${Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`}
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={valor || undefined}
                        value={reembolsoValor}
                        onChange={(e) => setReembolsoValor(e.target.value)}
                        placeholder="0,00"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Receber em qual conta?</Label>
                    <Select value={contaReembolsoId} onValueChange={setContaReembolsoId}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {contas?.filter(c => c.tipo === 'debito').map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Vai criar duas transações: a despesa acima e uma receita "Reembolso de {reembolsoPessoa || '...'} - {descricao || '...'}" na conta escolhida.
                  </p>
                </div>
              )}
            </div>
          )}

          <Button
            className="w-full"
            type="submit"
            disabled={submitting || !descricao || !valor || !selectedContaId}
          >
            {submitting ? 'Adicionando...' : 'Adicionar Lançamento'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
