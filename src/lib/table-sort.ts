// src/lib/table-sort.ts
// Column sorting for the server-rendered tables. The column and direction live
// in the URL (`sort`, plus `rev=1` for the other way), so a sorted table is a
// link and the sort happens on the server before any row is cut.

/** Which way a column is sorted. */
export type SortDir = "asc" | "desc";

/** One sortable column. */
export interface SortColumn<T> {
  /** The column's `sort` value in the URL. */
  key: string;
  /**
   * The value sorted on: a row field, or a function for anything nested. Null
   * (or a missing field) always sorts last, whichever way.
   */
  value: keyof T | ((row: T) => number | string | null);
  /**
   * The direction a first click sorts in: counts and delays default to biggest
   * first, so names and dates set "asc" (or "desc" for newest first) themselves.
   */
  first?: SortDir;
}

/** The active sort: a column's key and its direction. */
export interface TableSort {
  key: string;
  dir: SortDir;
}

/** The URL param names for one table, so two tables on a page sort apart. */
export interface SortParamNames {
  sort: string;
  rev: string;
}

/** The names a page's only table uses. */
export const SORT_PARAMS: SortParamNames = { sort: "sort", rev: "rev" };

/**
 * One param from a page's search params. Pages type their params as interfaces,
 * which carry no index signature, so the lookup goes through `object`.
 * @param sp - The search params.
 * @param name - The param.
 * @returns Its value when it is a single string.
 */
function param(sp: object, name: string): string | undefined {
  const v = (sp as Record<string, unknown>)[name];
  return typeof v === "string" ? v : undefined;
}

/**
 * A row's value in a column, as a number or string, or null.
 * @param col - The column.
 * @param row - The row.
 * @returns The value.
 */
function valueOf<T>(col: SortColumn<T>, row: T): number | string | null {
  const v = typeof col.value === "function" ? col.value(row) : row[col.value];
  return typeof v === "number" || typeof v === "string" ? v : null;
}

/**
 * A column's first-click direction.
 * @param col - The column.
 * @returns Its direction.
 */
function firstDir<T>(col: SortColumn<T>): SortDir {
  return col.first ?? "desc";
}

/**
 * Read a table's sort from the URL. An unknown key falls back to the table's
 * default column, and `rev` flips the column's first-click direction.
 * @param sortRaw - The `sort` param.
 * @param revRaw - The `rev` param; "1" reverses.
 * @param columns - The table's sortable columns.
 * @param fallback - The default column's key, or null to keep the rows' own order.
 * @returns The sort, or null for the rows' own order.
 */
export function parseTableSort<T>(
  sortRaw: string | undefined,
  revRaw: string | undefined,
  columns: readonly SortColumn<T>[],
  fallback: string | null,
): TableSort | null {
  const col = columns.find((c) => c.key === sortRaw) ?? columns.find((c) => c.key === fallback);
  if (!col) return null;
  const dir = firstDir(col);
  return { key: col.key, dir: revRaw === "1" ? (dir === "asc" ? "desc" : "asc") : dir };
}

/**
 * Sort rows by the active column. The sort is stable, so rows level on the
 * column keep the order they came in, which each page sets to its own ranking.
 * @param rows - The rows, in the page's own order.
 * @param columns - The table's sortable columns.
 * @param sort - The active sort, or null to leave the order alone.
 * @param last - Rows that always go after the rest (a board's too-thin rows).
 * @returns A new, sorted array.
 */
export function sortRows<T>(
  rows: readonly T[],
  columns: readonly SortColumn<T>[],
  sort: TableSort | null,
  last?: (row: T) => boolean,
): T[] {
  const col = sort && columns.find((c) => c.key === sort.key);
  const out = [...rows];
  if (!col && !last) return out;
  const sign = sort?.dir === "asc" ? 1 : -1;
  return out.sort((a, b) => {
    const pin = last ? Number(last(a)) - Number(last(b)) : 0;
    if (pin !== 0 || !col) return pin;
    const x = valueOf(col, a);
    const y = valueOf(col, b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const cmp =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), "en-NZ", { numeric: true });
    return cmp * sign;
  });
}

/**
 * The params a column heading's link sets. The active column flips; any other
 * column starts in its first-click direction. The default column in its first
 * direction drops both params, so the plain URL stays the canonical one.
 * @param sort - The active sort.
 * @param key - The heading's column.
 * @param columns - The table's sortable columns.
 * @param fallback - The default column's key, or null when there is none.
 * @param names - The table's param names.
 * @returns The params to merge into the page's own.
 */
export function sortParams<T>(
  sort: TableSort | null,
  key: string,
  columns: readonly SortColumn<T>[],
  fallback: string | null,
  names: SortParamNames = SORT_PARAMS,
): Record<string, string | undefined> {
  const col = columns.find((c) => c.key === key);
  const first = col ? firstDir(col) : "desc";
  const dir = sort?.key === key ? (sort.dir === "asc" ? "desc" : "asc") : first;
  const rev = dir !== first;
  return {
    [names.sort]: key === fallback && !rev ? undefined : key,
    [names.rev]: rev ? "1" : undefined,
  };
}

/**
 * The params that reproduce a sort, cleaned of unknown keys, for the page's
 * other links (filters, tabs, another table's headings) to carry.
 * @param sp - The page's search params.
 * @param columns - The table's sortable columns.
 * @param fallback - The default column's key, or null when there is none.
 * @param names - The table's param names.
 * @returns The params, both unset for the default sort.
 */
export function keepSort<T>(
  sp: object,
  columns: readonly SortColumn<T>[],
  fallback: string | null,
  names: SortParamNames = SORT_PARAMS,
): Record<string, string | undefined> {
  const sort = parseTableSort(param(sp, names.sort), param(sp, names.rev), columns, fallback);
  const col = sort && columns.find((c) => c.key === sort.key);
  const rev = col ? sort.dir !== firstDir(col) : false;
  return {
    [names.sort]: sort && (sort.key !== fallback || rev) ? sort.key : undefined,
    [names.rev]: rev ? "1" : undefined,
  };
}

/**
 * Everything one table's headings need: the sort, and an href per column.
 * @param sp - The page's search params, read for the table's two names.
 * @param columns - The table's sortable columns.
 * @param fallback - The default column's key, or null for the rows' own order.
 * @param hrefFor - Builds the page URL from the sort params to set.
 * @param names - The table's param names.
 * @returns The sort, a heading-props builder, and the params that keep the
 *   sort on the page's other links (see {@link keepSort}).
 */
export function tableSort<T>(
  sp: object,
  columns: readonly SortColumn<T>[],
  fallback: string | null,
  hrefFor: (params: Record<string, string | undefined>) => string,
  names: SortParamNames = SORT_PARAMS,
): {
  sort: TableSort | null;
  head: (key: string) => { href: string; dir: SortDir | null };
  keep: Record<string, string | undefined>;
} {
  const sort = parseTableSort(param(sp, names.sort), param(sp, names.rev), columns, fallback);
  return {
    sort,
    keep: keepSort(sp, columns, fallback, names),
    /**
     * One heading's props, spread onto a SortHeader.
     * @param key - The heading's column.
     * @returns Its link and, when it is the sorted column, its direction.
     */
    head: (key) => ({
      href: hrefFor(sortParams(sort, key, columns, fallback, names)),
      dir: sort?.key === key ? sort.dir : null,
    }),
  };
}
