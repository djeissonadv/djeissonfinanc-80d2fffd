const PAGE_SIZE = 1000;

interface RangeableQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}

/**
 * Fetch every matching row from a Supabase/PostgREST query, paging past the
 * server's default 1000-row cap.
 *
 * Why: PostgREST returns at most 1000 rows per request. A plain
 * `await supabase.from('transacoes').select('*')...` silently truncates beyond
 * that, which corrupts all-time balance sums and multi-month analyses. This
 * loops with `.range()` until a short page signals the end.
 *
 * Pass a *factory* (not an awaited query): each page needs a fresh builder,
 * because awaiting a builder executes it and it cannot be re-ranged.
 *
 *   const rows = await fetchAllRows(() =>
 *     supabase.from('transacoes').select('*').eq('user_id', uid)
 *   );
 */
export async function fetchAllRows<T>(buildQuery: () => RangeableQuery<T>): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}
