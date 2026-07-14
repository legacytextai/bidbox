export interface RangePage<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

export interface FetchAllPagesOptions {
  pageSize?: number;
  maxRows?: number;
}

/** Load a Supabase/PostgREST result without silently accepting its 1,000 row cap. */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<RangePage<T>>,
  { pageSize = 1000, maxRows = 50_000 }: FetchAllPagesOptions = {},
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("pageSize must be a positive integer");
  if (!Number.isInteger(maxRows) || maxRows < pageSize) throw new Error("maxRows must be at least pageSize");

  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await fetchPage(from, Math.min(from + pageSize - 1, maxRows - 1));
    if (error) throw new Error(error.message || "paginated query failed");
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throw new Error(`paginated query exceeded the ${maxRows}-row safety ceiling`);
}
