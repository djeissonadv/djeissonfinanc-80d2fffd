import { describe, it, expect } from 'vitest';
import { calcularSaldosContas, calcularSaldoTotal } from '@/lib/saldo';
import { eRealizada, ePendente, apareceNoDashboard, contaNoSaldo } from '@/lib/transacao-filters';

describe('eRealizada', () => {
  it('considera realizada quando pago=true', () => {
    expect(eRealizada({ pago: true })).toBe(true);
  });
  it('considera realizada quando pago=undefined (sem migration)', () => {
    expect(eRealizada({})).toBe(true);
  });
  it('considera realizada quando pago=null', () => {
    expect(eRealizada({ pago: null })).toBe(true);
  });
  it('considera pendente APENAS quando pago=false explícito', () => {
    expect(eRealizada({ pago: false })).toBe(false);
    expect(ePendente({ pago: false })).toBe(true);
    expect(ePendente({ pago: true })).toBe(false);
    expect(ePendente({})).toBe(false);
  });
});

describe('apareceNoDashboard', () => {
  it('ignora transferência interna', () => {
    expect(apareceNoDashboard({ ignorar_dashboard: true, pago: true })).toBe(false);
  });
  it('ignora Saldo Inicial', () => {
    expect(apareceNoDashboard({ categoria: 'Saldo Inicial', pago: true })).toBe(false);
  });
  it('ignora pendente', () => {
    expect(apareceNoDashboard({ pago: false })).toBe(false);
  });
  it('aceita despesa normal', () => {
    expect(apareceNoDashboard({ pago: true, tipo: 'despesa', categoria: 'Alimentação' })).toBe(true);
  });
});

describe('contaNoSaldo (afeta saldo bancário)', () => {
  it('transferência interna AFETA saldo (sai de uma, entra em outra)', () => {
    expect(contaNoSaldo({ ignorar_dashboard: true, pago: true })).toBe(true);
  });
  it('Saldo Inicial NÃO afeta (já está em contas.saldo_inicial)', () => {
    expect(contaNoSaldo({ categoria: 'Saldo Inicial', pago: true })).toBe(false);
  });
  it('pendente NÃO afeta saldo', () => {
    expect(contaNoSaldo({ pago: false })).toBe(false);
  });
});

describe('calcularSaldosContas', () => {
  const contas = [
    { id: 'sicredi', saldo_inicial: 1000, tipo: 'debito', data_abertura: '2024-01-01' },
    { id: 'nubank', saldo_inicial: 500, tipo: 'debito', data_abertura: '2024-01-01' },
  ];

  it('soma transações realizadas por conta', () => {
    const txs = [
      { conta_id: 'sicredi', tipo: 'receita', valor: 200, pago: true },
      { conta_id: 'sicredi', tipo: 'despesa', valor: 50, pago: true },
      { conta_id: 'nubank', tipo: 'despesa', valor: 100, pago: true },
    ];
    const saldos = calcularSaldosContas(contas, txs);
    expect(saldos.sicredi).toBe(1150); // 1000 + 200 - 50
    expect(saldos.nubank).toBe(400);   // 500 - 100
  });

  it('ignora transação pendente', () => {
    const txs = [
      { conta_id: 'sicredi', tipo: 'despesa', valor: 500, pago: false },
    ];
    const saldos = calcularSaldosContas(contas, txs);
    expect(saldos.sicredi).toBe(1000); // pendente não conta
  });

  it('funciona quando coluna pago não existe (undefined)', () => {
    const txs = [
      { conta_id: 'sicredi', tipo: 'despesa', valor: 50 }, // sem pago
    ];
    const saldos = calcularSaldosContas(contas, txs);
    expect(saldos.sicredi).toBe(950); // default true → conta
  });

  it('ignora linha Saldo Inicial duplicada', () => {
    const txs = [
      { conta_id: 'sicredi', tipo: 'receita', valor: 999, categoria: 'Saldo Inicial', pago: true },
    ];
    const saldos = calcularSaldosContas(contas, txs);
    expect(saldos.sicredi).toBe(1000); // só o saldo_inicial, sem a tx duplicada
  });

  it('saldo inicial só conta antes da cutoff date', () => {
    const contasComFuturo = [
      { id: 'nova', saldo_inicial: 5000, data_abertura: '2026-12-01' },
    ];
    const saldos = calcularSaldosContas(contasComFuturo, [], '2026-06-01');
    expect(saldos.nova).toBe(0); // aberta depois do cutoff
  });

  it('soma transferência interna no saldo (não ignora)', () => {
    const txs = [
      { conta_id: 'sicredi', tipo: 'despesa', valor: 300, ignorar_dashboard: true, pago: true },
      { conta_id: 'nubank',  tipo: 'receita', valor: 300, ignorar_dashboard: true, pago: true },
    ];
    const saldos = calcularSaldosContas(contas, txs);
    expect(saldos.sicredi).toBe(700);  // 1000 - 300
    expect(saldos.nubank).toBe(800);   // 500 + 300
    // Total preservado — transferência não cria nem destrói dinheiro
    expect(calcularSaldoTotal(contas, txs)).toBe(1500);
  });

  it('Dashboard e Contas devem chegar no mesmo número', () => {
    // Cenário realista: 1 receita, 2 despesas, 1 transferência interna, 1 pendente
    const txs = [
      { conta_id: 'sicredi', tipo: 'receita', valor: 5000, pago: true }, // salário
      { conta_id: 'sicredi', tipo: 'despesa', valor: 1200, pago: true }, // aluguel
      { conta_id: 'nubank',  tipo: 'despesa', valor: 300, pago: true },  // mercado
      { conta_id: 'sicredi', tipo: 'despesa', valor: 800, ignorar_dashboard: true, pago: true }, // pag fatura
      { conta_id: 'nubank',  tipo: 'despesa', valor: 999, pago: false }, // pendente
    ];
    const total = calcularSaldoTotal(contas, txs);
    // 1000 + 500 + 5000 - 1200 - 300 - 800 - 0(pendente) = 4200
    expect(total).toBe(4200);
  });
});
