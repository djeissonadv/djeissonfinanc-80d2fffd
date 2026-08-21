/**
 * Aprendizado de categorias.
 *
 * Quando o usuário corrige a categoria de um lançamento na tela de revisão do
 * import, guardamos a associação "comerciante → categoria" e passamos a aplicá-la
 * automaticamente nas próximas importações (com prioridade sobre as regras fixas
 * do auto-categorize).
 *
 * Guardado em localStorage (por dispositivo) — é preferência de classificação,
 * não dado contábil, e evita mais uma tabela/mudança de schema por enquanto.
 * A chave normaliza a descrição (sem números, datas, acentos, pontuação) pra
 * um mesmo comerciante casar apesar de parcela/doc variarem entre linhas.
 */
const KEY = 'financas_categoria_aprendida_v1';

let cache: Record<string, string> | null = null;

function chave(descricao: string): string {
  return (descricao || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/\d+/g, ' ')        // números (parcelas, datas, CPF/CNPJ, docs)
    .replace(/[^a-z ]+/g, ' ')   // pontuação e símbolos (*, -, etc.)
    .replace(/\s+/g, ' ')
    .trim();
}

function load(): Record<string, string> {
  if (cache) return cache;
  try {
    if (typeof localStorage === 'undefined') return (cache = {});
    const raw = localStorage.getItem(KEY);
    cache = raw ? JSON.parse(raw) : {};
  } catch {
    cache = {};
  }
  return cache!;
}

function persist(map: Record<string, string>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* localStorage cheio/indisponível — segue só em memória */ }
}

/** Categoria aprendida pra essa descrição, ou null. */
export function getCategoriaAprendida(descricao: string): string | null {
  const k = chave(descricao);
  if (!k) return null;
  const map = load();
  return map[k] || null;
}

/** Ensina: dessa descrição em diante, use essa categoria. */
export function aprenderCategoria(descricao: string, categoria: string): void {
  const k = chave(descricao);
  if (!k || !categoria) return;
  const map = load();
  map[k] = categoria;
  persist(map);
}

/** Esquece a regra aprendida pra essa descrição (volta pro automático). */
export function esquecerCategoria(descricao: string): void {
  const k = chave(descricao);
  if (!k) return;
  const map = load();
  if (map[k] != null) {
    delete map[k];
    persist(map);
  }
}

/** Só pra teste: zera o cache em memória (força reler o localStorage). */
export function _resetCacheParaTeste(): void {
  cache = null;
}
