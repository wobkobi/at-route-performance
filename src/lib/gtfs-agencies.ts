// src/lib/gtfs-agencies.ts
// The operator list, read from AT's GTFS `agency.txt` and merged into the list
// stored in the `setting` collection. An operator keeps the slug it was first
// given, so a rename leaves its page address alone, and one AT drops stays
// listed as not current, so the routes it ran still name it.

import type { Operator } from "@/lib/operators";

/** The `setting` row holding the operator list as JSON. */
export const AGENCIES_SETTING = "gtfs-agencies";

/** One row of `agency.txt`. */
export interface AgencyRecord {
  code: string;
  name: string;
}

/**
 * Split one CSV line, honouring double-quoted fields (a name with a comma in
 * it) and doubled quotes inside them.
 * @param line - The line.
 * @returns Its fields, trimmed.
 */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field.trim());
      field = "";
    } else field += ch;
  }
  out.push(field.trim());
  return out;
}

/**
 * Parse a GTFS `agency.txt`.
 * @param txt - The decompressed file.
 * @returns One record per row with both a code and a name.
 */
export function parseAgencies(txt: string): AgencyRecord[] {
  // A byte-order mark would otherwise glue itself to the first column name.
  const lines = (txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt).split(/\r?\n/);
  const header = csvFields(lines[0] ?? "");
  const iCode = header.indexOf("agency_id");
  const iName = header.indexOf("agency_name");
  if (iCode < 0 || iName < 0) return [];
  const out: AgencyRecord[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = csvFields(line);
    const code = c[iCode];
    const name = c[iName];
    if (code && name) out.push({ code, name });
  }
  return out;
}

/**
 * A published name without its company suffix: "Tranzit Group Ltd" reads as
 * "Tranzit Group", as the rest of AT's list does.
 * @param name - The name in `agency.txt`.
 * @returns The display name.
 */
export function operatorName(name: string): string {
  return name.replace(/\s+(Ltd\.?|Limited)$/i, "").trim() || name;
}

/**
 * A URL slug from a name: lower case, runs of anything else joined by one hyphen.
 * @param name - The display name.
 * @returns The slug, or "" when the name has no letters or digits.
 */
export function operatorSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The stored list with the latest feed merged in. Every operator in the feed is
 * current, under its latest name and the slug it was first given; a new one
 * gets a slug from its name (suffixed with its code if another operator holds
 * it). One missing from the feed stays, marked not current.
 * @param stored - The list stored so far.
 * @param feed - The rows of the latest `agency.txt`.
 * @returns The merged list, by name.
 */
export function mergeAgencies(
  stored: readonly Operator[],
  feed: readonly AgencyRecord[],
): Operator[] {
  const byCode = new Map(stored.map((o) => [o.code, o]));
  const taken = new Set(stored.map((o) => o.slug));
  const inFeed = new Set<string>();
  const out: Operator[] = [];
  for (const a of feed) {
    if (inFeed.has(a.code)) continue;
    inFeed.add(a.code);
    const name = operatorName(a.name);
    let slug = byCode.get(a.code)?.slug;
    if (slug === undefined) {
      const base = operatorSlug(name) || a.code.toLowerCase();
      slug = taken.has(base) ? `${base}-${a.code.toLowerCase()}` : base;
      taken.add(slug);
    }
    out.push({ code: a.code, name, slug, current: true });
  }
  for (const o of stored) if (!inFeed.has(o.code)) out.push({ ...o, current: false });
  return out.sort((a, b) => a.name.localeCompare(b.name, "en-NZ"));
}

/**
 * The stored list from its `setting` value. The value is JSON written by the
 * sync, but checked rather than trusted: a malformed row would otherwise name
 * every operator on the site wrongly.
 * @param raw - The setting's value, or null when absent.
 * @returns The operators, or none when the value is absent or malformed.
 */
export function parseStoredAgencies(raw: string | null): Operator[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.filter(
    (o): o is Operator =>
      typeof o === "object" &&
      o !== null &&
      typeof o.code === "string" &&
      typeof o.name === "string" &&
      typeof o.slug === "string" &&
      typeof o.current === "boolean",
  );
}
