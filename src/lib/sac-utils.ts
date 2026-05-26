/**
 * SAC Mortgage Calculation Utilities
 */

export interface SacParams {
  valorImovel: number;
  entrada: number;
  prazoMeses: number;
  taxaAnualNominal: number; // e.g. 11.19
  trAnual: number; // e.g. 0.5
  itbiPercent: number;
  escrituraPercent: number;
  rendaBruta: number;
  dividasMensais: number;
  limiteComprometimento: number; // e.g. 30
  capitalDisponivel: number;
  reservaMeses: number;
  aluguelAtual: number;
  condominioAtual: number;
  saldoDevedorCarro: number;
  parcelaCarro: number;
  // Venda do imóvel atual (gera o capital de entrada). Todos default 0 quando
  // não há venda envolvida — mantém compatibilidade com simulações antigas.
  valorVendaImovel: number;
  saldoDevedorImovelVender: number; // financiamento a quitar na venda
  iptuAtrasado: number;
  irVendaEstimado: number; // ganho de capital — valor informado pelo usuário
  outrosCustosVenda: number; // corretagem, etc.
  fgtsDisponivel: number;
}

export interface SacRow {
  mes: number;
  saldoDevedor: number;
  amortFixa: number;
  correcaoTR: number;
  juros: number;
  parcelaNormal: number;
  amortExtra: number;
  saldoComExtra: number;
  parcelaComExtra: number;
}

export function calcTaxaMensal(taxaAnual: number): number {
  return Math.pow(1 + taxaAnual / 100, 1 / 12) - 1;
}

export function calcParcelaSAC(
  valorFinanciado: number,
  prazo: number,
  taxaMensal: number,
  trMensal: number,
  mes: number
): number {
  const amortFixa = valorFinanciado / prazo;
  const saldo = valorFinanciado - amortFixa * (mes - 1);
  return amortFixa + saldo * (taxaMensal + trMensal);
}

export function buildAmortizationTable(
  valorFinanciado: number,
  prazo: number,
  taxaMensal: number,
  trMensal: number,
  extras?: Record<number, number>
): SacRow[] {
  const amortFixa = valorFinanciado / prazo;
  const rows: SacRow[] = [];
  let saldo = valorFinanciado;

  for (let i = 1; i <= prazo; i++) {
    if (saldo <= 0) break;
    const correcaoTR = saldo * trMensal;
    const juros = saldo * taxaMensal;
    const parcelaNormal = amortFixa + correcaoTR + juros;
    const amortExtra = extras?.[i] || 0;
    const saldoComExtra = Math.max(0, saldo - amortFixa - amortExtra);
    const parcelaComExtra = amortExtra > 0
      ? amortFixa + amortExtra + correcaoTR + juros
      : parcelaNormal;

    rows.push({
      mes: i,
      saldoDevedor: saldo,
      amortFixa,
      correcaoTR,
      juros,
      parcelaNormal,
      amortExtra,
      saldoComExtra,
      parcelaComExtra,
    });

    saldo = saldoComExtra;
  }

  return rows;
}

export function calcTotaisFinanciamento(rows: SacRow[]) {
  let totalAmortizado = 0;
  let totalTR = 0;
  let totalJuros = 0;

  for (const r of rows) {
    totalAmortizado += r.amortFixa + r.amortExtra;
    totalTR += r.correcaoTR;
    totalJuros += r.juros;
  }

  return { totalAmortizado, totalTR, totalJuros, totalGeralPago: totalAmortizado + totalTR + totalJuros };
}

export type DiagnosticoTipo = 'viavel' | 'parcial' | 'inviavel';

export interface ViabilidadeResult {
  valorFinanciado: number;
  entradaPercent: number;
  taxaMensal: number;
  trMensal: number;
  amortFixa: number;
  parcelaMes1: number;
  parcelaMes12: number;
  parcelaMes60: number;
  parcelaMes120: number;
  parcelaMes240: number;
  parcelaUltima: number;
  itbiRS: number;
  escrituraRS: number;
  totalDesembolso: number;
  maxDisponivel: number;
  percentComprometida: number;
  reservaNecessaria: number;
  capitalRestante: number;
  // Venda do imóvel atual
  temVenda: boolean;
  liquidoVenda: number;
  capitalParaCompra: number; // líquido da venda + FGTS + outras reservas
  totalAmortizado: number;
  totalTR: number;
  totalJuros: number;
  totalGeralPago: number;
  custoEfetivoTotal: number;
  checkEntrada: boolean;
  checkParcela: boolean;
  checkCapital: boolean;
  checkPrazo: boolean;
  totalHabitacaoHoje: number;
  custoAtualTotal: number;
  deltaMensal: number;
  // cenario carro
  capitalLiquidoSemCarro: number;
  percentSemQuitacao: number;
  percentComQuitacao: number;
  melhoraComprometimento: number;
  diagnostico: DiagnosticoTipo;
  diagnosticoTexto: string;
}

export function calcViabilidade(p: SacParams): ViabilidadeResult {
  const valorFinanciado = Math.max(0, p.valorImovel - p.entrada);
  const entradaPercent = p.valorImovel > 0 ? (p.entrada / p.valorImovel) * 100 : 0;
  const taxaMensal = calcTaxaMensal(p.taxaAnualNominal);
  const trMensal = calcTaxaMensal(p.trAnual);
  const prazoSeguro = Math.max(1, p.prazoMeses);
  const amortFixa = valorFinanciado / prazoSeguro;

  const parcelaN = (n: number) => {
    if (n > p.prazoMeses) n = p.prazoMeses;
    const saldo = valorFinanciado - amortFixa * (n - 1);
    return amortFixa + saldo * (taxaMensal + trMensal);
  };

  const parcelaMes1 = parcelaN(1);

  // Totals via full table
  const rows = buildAmortizationTable(valorFinanciado, p.prazoMeses, taxaMensal, trMensal);
  const totais = calcTotaisFinanciamento(rows);

  // Bloco B
  const itbiRS = (p.itbiPercent / 100) * p.valorImovel;
  const escrituraRS = (p.escrituraPercent / 100) * p.valorImovel;
  const totalDesembolso = p.entrada + itbiRS + escrituraRS;

  // Bloco C
  const maxDisponivel = (p.rendaBruta * p.limiteComprometimento / 100);
  const percentComprometida = p.rendaBruta > 0
    ? (parcelaMes1 / p.rendaBruta) * 100
    : 0;

  // Venda do imóvel atual → capital para a compra
  // Líquido = valor de venda menos o que precisa ser pago na transação
  // (saldo devedor a quitar, IPTU atrasado, IR sobre ganho de capital, outros custos).
  const temVenda = p.valorVendaImovel > 0;
  // NÃO piso em 0: se os custos da venda (saldo devedor + IPTU + IR + outros)
  // superarem o valor de venda, o líquido é NEGATIVO — o usuário sai devendo e
  // precisa pôr dinheiro do bolso na transação. Floorar em 0 escondia esse
  // déficit e deixava capitalParaCompra/checkCapital otimistas demais.
  const liquidoVenda =
    p.valorVendaImovel - p.saldoDevedorImovelVender - p.iptuAtrasado - p.irVendaEstimado - p.outrosCustosVenda;
  // Capital total disponível para a compra = líquido da venda + FGTS + outras reservas.
  const capitalParaCompra = liquidoVenda + p.fgtsDisponivel + p.capitalDisponivel;

  // Bloco D
  const reservaNecessaria = parcelaMes1 * p.reservaMeses;
  const capitalRestante = capitalParaCompra - totalDesembolso - reservaNecessaria;

  // CET
  const custoEfetivoTotal = totais.totalGeralPago + p.entrada + itbiRS + escrituraRS;

  // Checklist
  const checkEntrada = entradaPercent >= 20;
  const checkParcela = percentComprometida <= p.limiteComprometimento; // Only mortgage vs income
  const checkCapital = capitalRestante >= 0;
  const checkPrazo = p.prazoMeses <= 420;

  // Bloco I
  const totalHabitacaoHoje = p.aluguelAtual + p.condominioAtual;
  const custoAtualTotal = totalHabitacaoHoje + p.parcelaCarro;
  const deltaMensal = custoAtualTotal - parcelaMes1;

  // Bloco J - cenário carro
  // Quitar o carro NÃO altera entrada/financiamento — o imóvel já está definido.
  // A comparação é: comprometimento COM parcela do carro vs SEM parcela do carro.
  const capitalLiquidoSemCarro = capitalParaCompra - p.saldoDevedorCarro;
  const percentSemQuitacao = p.rendaBruta > 0
    ? ((parcelaMes1 + p.parcelaCarro) / p.rendaBruta) * 100
    : 0;
  const percentComQuitacao = percentComprometida; // só a parcela do imóvel
  const melhoraComprometimento = percentSemQuitacao - percentComQuitacao;

  // Diagnóstico
  const checks = [checkEntrada, checkParcela, checkCapital, checkPrazo];
  const falhas = checks.filter(c => !c).length;
  let diagnostico: DiagnosticoTipo;
  let diagnosticoTexto: string;

  if (falhas === 0) {
    diagnostico = 'viavel';
    diagnosticoTexto = `Financiamento viável! Entrada de ${entradaPercent.toFixed(0)}%, parcela inicial comprometendo ${percentComprometida.toFixed(1)}% da renda, e capital suficiente para cobrir todos os custos com reserva de emergência.`;
  } else if (falhas === 1 && !checkParcela) {
    diagnostico = 'parcial';
    diagnosticoTexto = `Parcialmente viável. A parcela compromete ${percentComprometida.toFixed(1)}% da renda (acima do limite de ${p.limiteComprometimento}%), mas entrada e capital estão adequados. Considere ampliar o prazo ou reduzir o valor do imóvel.`;
  } else {
    diagnostico = 'inviavel';
    const problemas: string[] = [];
    if (!checkEntrada) problemas.push(`entrada abaixo de 20% (${entradaPercent.toFixed(1)}%)`);
    if (!checkParcela) problemas.push(`parcela acima do limite (${percentComprometida.toFixed(1)}% da renda)`);
    if (!checkCapital) problemas.push(`capital insuficiente (faltam ${formatCurrencySimple(Math.abs(capitalRestante))})`);
    if (!checkPrazo) problemas.push('prazo acima de 420 meses');
    diagnosticoTexto = `Inviável no cenário atual: ${problemas.join('; ')}. Veja as sugestões de ajuste abaixo.`;
  }

  return {
    valorFinanciado, entradaPercent, taxaMensal, trMensal, amortFixa,
    parcelaMes1, parcelaMes12: parcelaN(12), parcelaMes60: parcelaN(60),
    parcelaMes120: parcelaN(120), parcelaMes240: parcelaN(Math.min(240, p.prazoMeses)),
    parcelaUltima: parcelaN(p.prazoMeses),
    itbiRS, escrituraRS, totalDesembolso,
    maxDisponivel, percentComprometida,
    reservaNecessaria, capitalRestante,
    temVenda, liquidoVenda, capitalParaCompra,
    ...totais, custoEfetivoTotal,
    checkEntrada, checkParcela, checkCapital, checkPrazo,
    totalHabitacaoHoje, custoAtualTotal, deltaMensal,
    capitalLiquidoSemCarro,
    percentSemQuitacao, percentComQuitacao, melhoraComprometimento,
    diagnostico, diagnosticoTexto,
  };
}

function formatCurrencySimple(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
