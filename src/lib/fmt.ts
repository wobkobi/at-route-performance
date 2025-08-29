/**
 * Format seconds as a signed mm:ss (e.g. +02:30 or -00:45).
 * @param sec - Seconds (can be negative).
 * @returns Formatted string or "—" for null/undefined.
 */
export function fmtSecSigned(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "—";
  const sign = sec >= 0 ? "+" : "-";
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);
  return `${sign}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Format a percentage with one decimal place.
 * @param pct - Percentage value.
 * @returns Formatted string or "—" for null/undefined.
 */
export function fmtPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return "—";
  return `${pct.toFixed(1)}%`;
}
