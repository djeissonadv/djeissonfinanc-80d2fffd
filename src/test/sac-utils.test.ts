import { describe, expect, it } from 'vitest';
import {
  calcTaxaMensal,
  calcParcelaSAC,
  buildAmortizationTable,
  calcTotaisFinanciamento,
  calcViabilidade,
  type SacParams,
} from '@/lib/sac-utils';

describe('calcTaxaMensal — conversão anual→mensal (juros compostos)', () => {
  it('compor 12 meses recupera a taxa anual', () => {
    const r = calcTaxaMensal(12.6825); // ~1%/mês
    expect(Math.pow(1 + r, 12)).toBeCloseTo(1.126825, 6);
  });
  it('taxa zero → 0', () => {
    expect(calcTaxaMensal(0)).toBe(0);
  });
});

describe('calcParcelaSAC — amortização constante + juros sobre saldo', () => {
  // valorFinanciado=120000, prazo=120, taxaMensal=1%, trMensal=0
  // amortFixa = 1000; parcela_i = 1000 + saldo_i * 0.01
  it('parcela do mês 1 (maior): 1000 + 120000*0,01 = 2200', () => {
    expect(calcParcelaSAC(120000, 120, 0.01, 0, 1)).toBeCloseTo(2200, 6);
  });
  it('parcela do mês 2: saldo 119000 → 2190', () => {
    expect(calcParcelaSAC(120000, 120, 0.01, 0, 2)).toBeCloseTo(2190, 6);
  });
  it('última parcela (mês 120, menor): saldo 1000 → 1010', () => {
    expect(calcParcelaSAC(120000, 120, 0.01, 0, 120)).toBeCloseTo(1010, 6);
  });
  it('SAC: parcela decresce mês a mês', () => {
    const p1 = calcParcelaSAC(120000, 120, 0.01, 0, 1);
    const p2 = calcParcelaSAC(120000, 120, 0.01, 0, 2);
    expect(p1).toBeGreaterThan(p2);
  });
});

describe('buildAmortizationTable', () => {
  const rows = buildAmortizationTable(120000, 120, 0.01, 0);

  it('gera uma linha por mês do prazo', () => {
    expect(rows).toHaveLength(120);
  });
  it('saldo devedor inicial = valor financiado; amortiza até ~zero', () => {
    expect(rows[0].saldoDevedor).toBeCloseTo(120000, 6);
    expect(rows[119].saldoComExtra).toBeCloseTo(0, 6);
  });
  it('amortização fixa = valorFinanciado/prazo em todas as linhas', () => {
    expect(rows.every(r => Math.abs(r.amortFixa - 1000) < 1e-9)).toBe(true);
  });
  it('parcelaNormal coincide com calcParcelaSAC para o mesmo mês', () => {
    expect(rows[0].parcelaNormal).toBeCloseTo(calcParcelaSAC(120000, 120, 0.01, 0, 1), 6);
    expect(rows[59].parcelaNormal).toBeCloseTo(calcParcelaSAC(120000, 120, 0.01, 0, 60), 6);
  });

  it('totais: amortizado = principal; juros = Σ saldo*taxa', () => {
    const t = calcTotaisFinanciamento(rows);
    expect(t.totalAmortizado).toBeCloseTo(120000, 4);
    // Σ saldo_i*0.01, saldo_i = 1000*(121-i) → 1000*(120*121/2)*0.01 = 72600
    expect(t.totalJuros).toBeCloseTo(72600, 4);
    expect(t.totalGeralPago).toBeCloseTo(192600, 4);
  });

  it('amortização extra encurta o financiamento (saldo zera antes)', () => {
    const comExtra = buildAmortizationTable(120000, 120, 0.01, 0, { 1: 60000 });
    expect(comExtra.length).toBeLessThan(120);
  });
});

describe('calcViabilidade — venda do imóvel e capital para compra', () => {
  const base: SacParams = {
    valorImovel: 500000,
    entrada: 100000,
    prazoMeses: 360,
    taxaAnualNominal: 11.19,
    trAnual: 0,
    itbiPercent: 3,
    escrituraPercent: 1.5,
    rendaBruta: 25000,
    dividasMensais: 0,
    limiteComprometimento: 30,
    capitalDisponivel: 0,
    reservaMeses: 6,
    aluguelAtual: 2000,
    condominioAtual: 500,
    saldoDevedorCarro: 0,
    parcelaCarro: 0,
    valorVendaImovel: 0,
    saldoDevedorImovelVender: 0,
    iptuAtrasado: 0,
    irVendaEstimado: 0,
    outrosCustosVenda: 0,
    fgtsDisponivel: 0,
  };

  it('valorFinanciado = imóvel - entrada; entradaPercent correto', () => {
    const r = calcViabilidade(base);
    expect(r.valorFinanciado).toBe(400000);
    expect(r.entradaPercent).toBeCloseTo(20, 6);
    expect(r.checkEntrada).toBe(true); // 20% >= 20%
  });

  it('líquido da venda desconta saldo devedor, IPTU, IR e outros custos', () => {
    const r = calcViabilidade({
      ...base,
      valorVendaImovel: 300000,
      saldoDevedorImovelVender: 80000,
      iptuAtrasado: 5000,
      irVendaEstimado: 10000,
      outrosCustosVenda: 15000,
      fgtsDisponivel: 20000,
    });
    expect(r.temVenda).toBe(true);
    // 300000 - 80000 - 5000 - 10000 - 15000 = 190000
    expect(r.liquidoVenda).toBeCloseTo(190000, 6);
    // capitalParaCompra = liquidoVenda + FGTS + capitalDisponivel = 190000 + 20000 + 0
    expect(r.capitalParaCompra).toBeCloseTo(210000, 6);
  });

  it('parcela SAC inicial maior que a última (decrescente)', () => {
    const r = calcViabilidade(base);
    expect(r.parcelaMes1).toBeGreaterThan(r.parcelaUltima);
  });

  it('entrada abaixo de 20% reprova o checkEntrada', () => {
    const r = calcViabilidade({ ...base, entrada: 50000 }); // 10%
    expect(r.checkEntrada).toBe(false);
  });
});
