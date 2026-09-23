// src/lib/time-of-day.ts
// The `hours` query param: a part of the service day to narrow a page to.
// A range is a pair of Auckland clock hours and may wrap past midnight, because
// the service day runs 4am to 4am and the useful late ranges cross midnight.

import { nzHourLabel, SERVICE_START_HOUR } from "@/lib/time";

/** The query param holding the time-of-day range. */
export const HOURS_PARAM = "hours";

/**
 * A part of the day as Auckland clock hours: `from` inclusive, `to` exclusive,
 * both 0-23. `from` greater than `to` wraps past midnight, so 18>4 is six in
 * the evening to four the next morning - one stretch of the same service day.
 */
export interface HourRange {
  from: number;
  to: number;
}

/** A named part of the day, as the chips offer it. */
export interface TimePreset {
  key: string;
  label: string;
  range: HourRange;
}

/**
 * The presets, in the order the chips show them. They partition the service day
 * exactly once - 4-7, 7-9, 9-15, 15-18 and 18-4 cover all 24 hours with no
 * overlap - so "the rest of the day" is always some run of them, and a reader
 * stepping along the chips sees every arrival exactly once.
 */
export const TIME_PRESETS: readonly TimePreset[] = [
  { key: "early", label: "Early", range: { from: SERVICE_START_HOUR, to: 7 } },
  { key: "am-peak", label: "Morning peak", range: { from: 7, to: 9 } },
  { key: "midday", label: "Midday", range: { from: 9, to: 15 } },
  { key: "pm-peak", label: "Evening peak", range: { from: 15, to: 18 } },
  { key: "night", label: "Night", range: { from: 18, to: SERVICE_START_HOUR } },
];

/**
 * Two runs of digits either side of one hyphen, and nothing else. Splitting on
 * the hyphen is not enough on its own: `Number("")` is 0, so "-9" and "7-"
 * would both read as real ranges.
 */
const RANGE_PATTERN = /^(\d{1,2})-(\d{1,2})$/;

/**
 * Whether a value is an hour of the day.
 * @param n - The candidate.
 * @returns True for a whole number from 0 to 23.
 */
function isHour(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 23;
}

/**
 * Read an {@link HourRange} from the `hours` param, e.g. `7-9`. Anything that
 * is not two hours of the day separated by a hyphen is refused, including a
 * range with the same hour at both ends: it would read as either no hours or
 * every hour, and a filter that cannot be told apart from no filter is worse
 * than none. A refusal is null, which every caller treats as all day.
 * @param raw - The param's value, if present.
 * @returns The range, or null when absent or unreadable.
 */
export function parseHourRange(raw: string | undefined): HourRange | null {
  const match = raw ? RANGE_PATTERN.exec(raw) : null;
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (!isHour(from) || !isHour(to) || from === to) return null;
  return { from, to };
}

/**
 * The `hours` param for a range, for building a link.
 * @param range - The range, or null for all day.
 * @returns The param value, or undefined when the range is all day and the
 *   param should be left off the link entirely.
 */
export function hourRangeParam(range: HourRange | null): string | undefined {
  return range ? `${range.from}-${range.to}` : undefined;
}

/**
 * Whether an hour falls in a range, wrapping included.
 * @param hour - Auckland clock hour, 0-23.
 * @param range - The range.
 * @returns True when the hour is covered.
 */
export function isHourInRange(hour: number, range: HourRange): boolean {
  return range.from < range.to
    ? hour >= range.from && hour < range.to
    : hour >= range.from || hour < range.to;
}

/**
 * Every hour a range covers, ascending. A wrapping range lists its evening
 * hours first and its post-midnight hours after, so 22>2 gives 22, 23, 0, 1.
 * This is the form the database match wants: an explicit set is one `$in`
 * against `$hour`, where a wrapping comparison would need two branches.
 * @param range - The range.
 * @returns The hours, 0-23.
 */
export function hoursInRange(range: HourRange): number[] {
  const out: number[] = [];
  for (let h = range.from; out.length < 24; h = (h + 1) % 24) {
    out.push(h);
    if ((h + 1) % 24 === range.to) break;
  }
  return out;
}

/**
 * The preset a range matches, if it is one of them.
 * @param range - The range, or null for all day.
 * @returns The preset, or null for all day or a hand-typed range.
 */
export function activePreset(range: HourRange | null): TimePreset | null {
  if (!range) return null;
  return TIME_PRESETS.find((p) => p.range.from === range.from && p.range.to === range.to) ?? null;
}

/**
 * A range in words, for a chip or a heading. A preset gives its own name; any
 * other range is written as its clock hours.
 * @param range - The range, or null for all day.
 * @returns The label, e.g. "Morning peak", "10pm to 2am" or "All day".
 */
export function hourRangeLabel(range: HourRange | null): string {
  if (!range) return "All day";
  const preset = activePreset(range);
  if (preset) return preset.label;
  return `${nzHourLabel(range.from)} to ${nzHourLabel(range.to)}`;
}
