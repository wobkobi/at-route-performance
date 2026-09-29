// src/lib/day-type.ts
// The `days` query param: narrows a week or month to its weekdays, its
// Saturdays or its Sundays, since the three run different timetables and a
// month's figure mixes them in whatever proportion the calendar gives.

/** The query param holding the day type. */
export const DAYS_PARAM = "days";

/** A kind of service day. */
export type DayType = "weekday" | "sat" | "sun";

/** Every day type in display order, with its label. */
export const DAY_TYPES: ReadonlyArray<{ key: DayType; label: string }> = [
  { key: "weekday", label: "Weekdays" },
  { key: "sat", label: "Saturdays" },
  { key: "sun", label: "Sundays" },
];

/**
 * Read a day type from the `days` param.
 * @param raw - The param's value, if present.
 * @returns The day type, or null for every day (absent or unreadable).
 */
export function parseDayType(raw: string | undefined): DayType | null {
  return DAY_TYPES.find((d) => d.key === raw)?.key ?? null;
}

/**
 * The day type of a service date. The date is the service day's own calendar
 * date, so a 1am Saturday arrival on Friday's service day counts as a weekday,
 * which is the timetable it ran to.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns Its day type.
 */
export function dayTypeOf(date: string): DayType {
  // Noon UTC keeps the weekday clear of any offset question: the string is a
  // calendar date, not an instant.
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? "sun" : day === 6 ? "sat" : "weekday";
}

/**
 * The dates of one day type, or every date when there is no filter.
 * @param dates - Service dates (`YYYY-MM-DD`).
 * @param type - The day type, or null for every day.
 * @returns The matching dates, in their incoming order.
 */
export function datesOfType(dates: readonly string[], type: DayType | null): string[] {
  return type ? dates.filter((d) => dayTypeOf(d) === type) : [...dates];
}

/**
 * A day type in words, for a heading or a note.
 * @param type - The day type, or null for every day.
 * @returns The label, e.g. "Saturdays" or "Every day".
 */
export function dayTypeLabel(type: DayType | null): string {
  return DAY_TYPES.find((d) => d.key === type)?.label ?? "Every day";
}
