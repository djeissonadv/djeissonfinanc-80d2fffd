import { describe, it, expect } from 'vitest';
import { parseNubankConta } from '@/lib/pdf-parser';

// Helper: monta uma "row" estruturada a partir de um texto simples (1 item).
function row(text: string): any {
  return { items: [{ str: text, x: 0, y: 0, fontName: 'f' }] };
}

// Reproduz as linhas-chave do extrato Nu Conta (jan/2026), onde "Saldo inicial"
// e o valor caem na MESMA linha (mesma posição Y na extração estruturada).
const pages = [{
  garbledFonts: new Set<string>(),
  rows: [
    row('01 DE JANEIRO DE 2026 a 31 DE JANEIRO DE 2026 VALORES EM R$'),
    row('Saldo inicial 1,53'),
    row('Total de entradas +854,70'),
    row('Total de saídas -772,09'),
    row('Saldo final do período 84,14'),
    row('08 JAN 2026 Total de entradas + 389,00'),
    row('Transferência recebida pelo Pix JOSE ANTONIO MARTINS 389,00'),
  ],
}];

describe('parseNubankConta — saldo inicial do PDF', () => {
  const r = parseNubankConta(pages as any, 'Maiara');

  it('captura o saldo inicial R$ 1,53', () => {
    expect(r.openingBalance).toBe(1.53);
  });
  it('captura a data inicial do período (01/01/2026)', () => {
    expect(r.openingDate).toBe('2026-01-01');
  });
  it('continua extraindo transações', () => {
    expect(r.transactions.length).toBeGreaterThan(0);
  });
});
