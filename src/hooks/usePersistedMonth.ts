import { useState, useCallback } from 'react';

const KEY = 'financaspro:mes-selecionado';

function ler(): { month: number; year: number } {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p?.month === 'number' && typeof p?.year === 'number' && p.month >= 0 && p.month <= 11) {
        return { month: p.month, year: p.year };
      }
    }
  } catch { /* ignore */ }
  const d = new Date();
  return { month: d.getMonth(), year: d.getFullYear() };
}

/**
 * Mês/ano selecionado COMPARTILHADO entre as páginas, via sessionStorage.
 *
 * Antes cada página tinha seu próprio useState inicializado em "hoje" — então
 * navegar (clicar num card → voltar) resetava pro mês atual, o que incomodava.
 * Agora o mês fica grudado durante a sessão do app. Some ao fechar a aba,
 * voltando pro mês atual numa nova sessão (comportamento esperado).
 *
 * Mantém a mesma assinatura do useState antigo (setMonth/setYear por valor),
 * então a troca nas páginas é 1-pra-1.
 */
export function usePersistedMonth() {
  const [{ month, year }, set] = useState(ler);

  const setMonth = useCallback((m: number) => set(s => {
    try { sessionStorage.setItem(KEY, JSON.stringify({ month: m, year: s.year })); } catch { /* ignore */ }
    return { month: m, year: s.year };
  }), []);

  const setYear = useCallback((y: number) => set(s => {
    try { sessionStorage.setItem(KEY, JSON.stringify({ month: s.month, year: y })); } catch { /* ignore */ }
    return { month: s.month, year: y };
  }), []);

  const setMonthYear = useCallback((m: number, y: number) => {
    try { sessionStorage.setItem(KEY, JSON.stringify({ month: m, year: y })); } catch { /* ignore */ }
    set({ month: m, year: y });
  }, []);

  return { month, year, setMonth, setYear, setMonthYear };
}
