import { getJson } from "@/lib/at-static";

// Attributes for a single GTFS feed version entry from AT v3 /versions.
export interface GtfsVersionAttr {
  version: string;
  is_current?: boolean;
  [key: string]: unknown;
}

/**
 * Fetch the current GTFS feed version string from the AT v3 `/versions` endpoint.
 * Selects the entry where `is_current === true`; falls back to the last entry.
 * @returns Version string, or null when the endpoint returns an empty list.
 */
export async function fetchCurrentGtfsVersion(): Promise<string | null> {
  const page = await getJson<GtfsVersionAttr>("/versions");
  const versions = page.data.map((d) => d.attributes);
  if (!versions.length) return null;
  const current = versions.find((v) => v.is_current === true) ?? versions[versions.length - 1];
  return current.version;
}
