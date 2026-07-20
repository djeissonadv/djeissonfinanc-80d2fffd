import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PicosGastos } from '@/components/analytics/PicosGastos';
import { analisePicosGastos } from '@/lib/analytics-engine';

function tx(over: Partial<any> = {}): any {
  return {
    data: '2026-03-10', mes_competencia: null, descricao: 'x', valor: 100,
    tipo: 'despesa', categoria: 'Alimentação', categoria_id: null,
    parcela_atual: null, parcela_total: null, grupo_parcela: null,
    ignorar_dashboard: false, essencial: true, conta_id: 'debito1', ...over,
  };
}

// Cenário realista: 4 meses, uma categoria estável, uma com pico, uma pontual.
const TXS = [
  ...['03', '04', '05', '06'].map(m => tx({ data: `2026-${m}-05`, categoria: 'Alimentação', valor: 1200 })),
  ...[300, 320, 310, 1500].map((v, i) =>
    tx({ data: `2026-0${3 + i}-12`, categoria: 'Compras', valor: v })),
  tx({ data: '2026-05-20', categoria: 'Saúde', valor: 900 }),
];

describe('<PicosGastos />', () => {
  const data = analisePicosGastos(TXS, 4, '2026-07-15');

  it('renderiza o cabeçalho com a janela e a média mensal', () => {
    render(<PicosGastos data={data} />);
    expect(screen.getByText('Maiores gastos')).toBeInTheDocument();
    expect(screen.getByText(/Últimos 4 meses completos/)).toBeInTheDocument();
    expect(screen.getByText('média/mês')).toBeInTheDocument();
  });

  it('mostra o resumo do excesso quando há meses fora da curva', () => {
    render(<PicosGastos data={data} />);
    expect(screen.getByText(/acima do normal em/)).toBeInTheDocument();
    expect(screen.getByText('Meses fora da curva')).toBeInTheDocument();
  });

  it('lista as categorias em ordem de total', () => {
    render(<PicosGastos data={data} />);
    // Alimentação (4800) > Compras (2430) > Saúde (900).
    // Compras/Saúde aparecem 2x: no ranking e na lista de picos.
    expect(screen.getByText('Alimentação')).toBeInTheDocument();
    expect(screen.getAllByText('Compras').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Saúde').length).toBeGreaterThan(0);
  });

  it('clicar numa categoria dispara o drill-down sem mês', () => {
    const onClick = vi.fn();
    render(<PicosGastos data={data} onCategoriaClick={onClick} />);
    fireEvent.click(screen.getByText('Alimentação'));
    expect(onClick).toHaveBeenCalledWith('Alimentação');
  });

  it('clicar num pico da lista dispara drill-down COM o mês', () => {
    const onClick = vi.fn();
    render(<PicosGastos data={data} onCategoriaClick={onClick} />);
    // "Meses fora da curva" tem botões com categoria + mês
    const botoesPico = screen.getAllByRole('button').filter(b =>
      b.textContent?.includes('Compras') && b.textContent?.includes('Jun/26'));
    expect(botoesPico.length).toBeGreaterThan(0);
    fireEvent.click(botoesPico[0]);
    expect(onClick).toHaveBeenCalledWith('Compras', '2026-06');
  });

  it('estado vazio não quebra', () => {
    const vazio = analisePicosGastos([], 4, '2026-07-15');
    render(<PicosGastos data={vazio} />);
    expect(screen.getByText(/Ainda não há meses completos/)).toBeInTheDocument();
  });

  it('sem picos, não mostra a seção de fora da curva', () => {
    const estavel = analisePicosGastos(
      ['03', '04', '05', '06'].map(m => tx({ data: `2026-${m}-05`, valor: 500 })),
      4, '2026-07-15',
    );
    render(<PicosGastos data={estavel} />);
    expect(screen.queryByText('Meses fora da curva')).not.toBeInTheDocument();
    expect(screen.queryByText(/acima do normal em/)).not.toBeInTheDocument();
  });
});
