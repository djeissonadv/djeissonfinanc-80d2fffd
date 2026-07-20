import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PicosGastos } from '@/components/analytics/PicosGastos';
import { analisePicosGastos, mesesComGasto } from '@/lib/analytics-engine';

function tx(over: Partial<any> = {}): any {
  return {
    data: '2026-03-10', mes_competencia: null, descricao: 'x', valor: 100,
    tipo: 'despesa', categoria: 'Alimentação', categoria_id: null,
    parcela_atual: null, parcela_total: null, grupo_parcela: null,
    ignorar_dashboard: false, essencial: true, conta_id: 'debito1', ...over,
  };
}

const M = ['03', '04', '05', '06'];

// Cenário realista: categoria estável, uma com pico em junho, uma pontual.
const TXS = [
  ...M.map(m => tx({ data: `2026-${m}-05`, categoria: 'Alimentação', descricao: 'Mercado', valor: 1200 })),
  ...[300, 320, 310, 1500].map((v, i) =>
    tx({ data: `2026-${M[i]}-12`, categoria: 'Compras', descricao: `Compra ${i}`, valor: v })),
  tx({ data: '2026-05-20', categoria: 'Saúde', descricao: 'Dentista', valor: 900 }),
];

const RANGE = { inicio: '2026-03', fim: '2026-06' };

/** A linha do ranking é o único botão com aria-expanded — desambigua da lista
 *  de picos, onde o nome da categoria também aparece. */
function linhaRanking(nome: string): HTMLElement {
  const btn = screen.getAllByRole('button', { expanded: false })
    .concat(screen.queryAllByRole('button', { expanded: true }))
    .find((b) => b.textContent?.includes(nome));
  if (!btn) throw new Error(`linha de ranking não encontrada: ${nome}`);
  return btn;
}

function renderPainel(over: Partial<React.ComponentProps<typeof PicosGastos>> = {}) {
  const data = analisePicosGastos(TXS, 4, '2026-07-15', RANGE);
  const props = {
    data,
    transactions: TXS,
    mesesDisponiveis: mesesComGasto(TXS),
    inicio: RANGE.inicio,
    fim: RANGE.fim,
    onRangeChange: vi.fn(),
    ...over,
  };
  return { ...render(<PicosGastos {...props} />), props };
}

describe('<PicosGastos />', () => {
  it('renderiza cabeçalho com nº de meses e média', () => {
    renderPainel();
    expect(screen.getByText('Maiores gastos')).toBeInTheDocument();
    expect(screen.getByText(/4 meses · média/)).toBeInTheDocument();
  });

  it('mostra o resumo do excesso e a lista de meses fora da curva', () => {
    renderPainel();
    expect(screen.getByText(/acima do normal em/)).toBeInTheDocument();
    expect(screen.getByText('Meses fora da curva')).toBeInTheDocument();
  });

  it('expande a categoria mostrando totais por mês e lançamentos', () => {
    renderPainel();
    // fechado: detalhe não existe
    expect(screen.queryByText('Totais por mês')).not.toBeInTheDocument();

    fireEvent.click(linhaRanking('Compras'));

    expect(screen.getByText('Totais por mês')).toBeInTheDocument();
    // o mês do pico (junho) já abre expandido → mostra o lançamento dele
    expect(screen.getByText('Compra 3')).toBeInTheDocument();
    expect(screen.getByText('Ver todos em Transações')).toBeInTheDocument();
  });

  it('fecha ao clicar de novo (accordion)', () => {
    renderPainel();
    fireEvent.click(linhaRanking('Compras'));
    expect(screen.getByText('Totais por mês')).toBeInTheDocument();
    fireEvent.click(linhaRanking('Compras'));
    expect(screen.queryByText('Totais por mês')).not.toBeInTheDocument();
  });

  it('abrir outra categoria fecha a anterior', () => {
    renderPainel();
    fireEvent.click(linhaRanking('Compras'));
    expect(screen.getByText('Compra 3')).toBeInTheDocument();
    fireEvent.click(linhaRanking('Alimentação'));
    expect(screen.queryByText('Compra 3')).not.toBeInTheDocument();
    // o detalhe agora é o da Alimentação (sem pico → nenhum mês auto-aberto)
    expect(screen.getByText('Totais por mês')).toBeInTheDocument();
  });

  it('clicar num mês dentro do detalhe abre os lançamentos daquele mês', () => {
    renderPainel();
    fireEvent.click(linhaRanking('Alimentação'));
    const detalhe = screen.getByText('Totais por mês').closest('div')!;
    // Alimentação não tem pico → nenhum mês abre sozinho
    expect(screen.queryByText('Mercado')).not.toBeInTheDocument();
    fireEvent.click(within(detalhe).getByText('Mar/26'));
    expect(screen.getByText('Mercado')).toBeInTheDocument();
  });

  it('drill-down por mês passa categoria E mês', () => {
    const onCategoriaClick = vi.fn();
    renderPainel({ onCategoriaClick });
    const botoesPico = screen.getAllByRole('button').filter(b =>
      b.textContent?.includes('Compras') && b.textContent?.includes('Jun/26'));
    fireEvent.click(botoesPico[0]);
    expect(onCategoriaClick).toHaveBeenCalledWith('Compras', '2026-06');
  });

  it('período vazio mostra mensagem pedindo pra ajustar o intervalo', () => {
    const vazio = analisePicosGastos(TXS, 4, '2026-07-15', { inicio: '2025-01', fim: '2025-02' });
    render(
      <PicosGastos
        data={vazio}
        transactions={TXS}
        mesesDisponiveis={mesesComGasto(TXS)}
        inicio="2025-01"
        fim="2025-02"
        onRangeChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Nenhum gasto no período selecionado/)).toBeInTheDocument();
  });

  it('sem picos, não mostra a seção de fora da curva', () => {
    const txsEstaveis = M.map(m => tx({ data: `2026-${m}-05`, valor: 500 }));
    const estavel = analisePicosGastos(txsEstaveis, 4, '2026-07-15', RANGE);
    render(
      <PicosGastos
        data={estavel}
        transactions={txsEstaveis}
        mesesDisponiveis={mesesComGasto(txsEstaveis)}
        inicio={RANGE.inicio}
        fim={RANGE.fim}
        onRangeChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Meses fora da curva')).not.toBeInTheDocument();
  });
});
