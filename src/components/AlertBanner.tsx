// src/components/AlertBanner.tsx
// Region listing active service alerts, rendering nothing when
// there are none. Built to inform without getting in the way: it stays
// collapsed, and it only takes the loud disruption styling when something is
// actually stopping - a feed where a line closure and a routine notice look
// identical is a feed people learn to ignore.
import {
  alertSeverity,
  cleanAlertHeader,
  extractText,
  hasSevereAlert,
  type ServiceAlert,
} from "@/lib/at-alerts";
import { cn } from "@/lib/cn";
import { routeSlug } from "@/lib/route-slug";
import { NZ_TZ } from "@/lib/time";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link AlertBanner}. */
export interface AlertBannerProps {
  /** Alerts to display. Renders nothing when the array is empty. */
  alerts: ServiceAlert[];
  /** Accessible heading for the alert region. Defaults to "Service alerts". */
  heading?: string;
  /** Short names keyed by route id; falls back to the raw id when absent. */
  routeNames?: Record<string, string>;
  /**
   * Whether the page is showing a past day or period. AT publishes only the
   * alerts running at this moment, so a past window has none of its own; this
   * labels them as current and dates every active period, because today is not
   * the day being read and a bare time there names nothing.
   */
  pastWindow?: boolean;
}

/**
 * Format a Unix timestamp as a short NZ local time, adding the date when the
 * instant falls outside today. An alert running for weeks otherwise renders as
 * a bare "8:45 pm - 6:00 am" and reads as though it is tonight.
 * @param unix - Seconds since epoch.
 * @param withDate - Include the day and month.
 * @returns Localised time string, e.g. "8:45 pm" or "12 Sep, 8:45 pm".
 */
function fmtTime(unix: number, withDate: boolean): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    ...(withDate ? { day: "numeric", month: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(unix * 1000));
}

/**
 * Auckland-local calendar date of an instant, for same-day comparison. `en-CA`
 * yields `YYYY-MM-DD`, which compares as a plain string.
 */
const NZ_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Whether an instant falls on today's Auckland-local calendar date.
 * @param unix - Seconds since epoch.
 * @returns True when it is today in Auckland.
 */
function isToday(unix: number): boolean {
  return NZ_DAY.format(new Date(unix * 1000)) === NZ_DAY.format(new Date());
}

/**
 * Describe an alert's active period, dating any bound that isn't today so a
 * long-running notice can't masquerade as tonight's disruption.
 * @param start - Period start, Unix seconds.
 * @param end - Period end, Unix seconds.
 * @param alwaysDate - Date both bounds whatever they are. Set on a page showing
 * a past window, where today is not the day being read.
 * @returns A period line, or null when the alert carries no bounds.
 */
function periodLabel(start?: number, end?: number, alwaysDate = false): string | null {
  // Date both ends together, so the two halves of a range stay comparable.
  const dated =
    alwaysDate || (start !== undefined && !isToday(start)) || (end !== undefined && !isToday(end));

  if (start !== undefined && end !== undefined) {
    return `${fmtTime(start, dated)} – ${fmtTime(end, dated)}`;
  }
  if (start !== undefined) return `From ${fmtTime(start, dated)}`;
  if (end !== undefined) return `Until ${fmtTime(end, dated)}`;
  return null;
}

/**
 * Collapsible service-disruption banner using `<details>`/`<summary>` - no
 * client JS required.
 *
 * Always closed on load, deliberately: alerts should be reachable without
 * displacing what the reader came for, and a set of them expanded on arrival is
 * a wall of text. The whole banner takes the disruption styling only when at
 * least one alert is service-stopping ({@link alertSeverity}); otherwise it
 * stays muted, and each row is tinted by its own severity.
 *
 * Each alert shows a cleaned header (AT's schedule-time bracket stripped), an
 * active-period line, an effect badge, description, and route pill links for any
 * `informed_entity` entries that carry a `route_id`.
 *
 * Returns null when no alerts are present so callers need no guard wrapper.
 * @param props - Component props.
 * @param props.alerts - Alerts to display.
 * @param props.heading - Accessible region label (defaults to "Service alerts").
 * @param props.routeNames - Map of route id to display name for the informed-entity pills.
 * @param props.pastWindow - Whether the page is showing a past day or period.
 * @returns Collapsible alert banner, or null when the list is empty.
 */
export function AlertBanner({
  alerts,
  heading = "Service alerts",
  routeNames,
  pastWindow = false,
}: AlertBannerProps): JSX.Element | null {
  if (!alerts.length) return null;
  const severe = hasSevereAlert(alerts);

  return (
    <details
      className={cn(
        "group overflow-hidden rounded-lg border",
        severe ? "border-at-disruption/30 bg-at-disruption/5" : "border-at-border bg-at-surface",
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3 select-none">
        {/* Exclamation icon */}
        <svg
          aria-hidden="true"
          className={cn("size-4 shrink-0", severe ? "text-at-disruption" : "text-at-muted")}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
          />
        </svg>
        <span
          className={cn(
            "flex-1 text-sm font-bold",
            severe ? "text-at-disruption" : "text-at-muted",
          )}
        >
          {heading}
          {pastWindow && <span className="font-normal"> - running now</span>}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs tabular-nums",
            severe ? "bg-at-disruption text-white" : "bg-at-border text-at-ink",
          )}
        >
          {alerts.length}
        </span>
        {/* Chevron rotates when details is open */}
        <svg
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 transition-transform group-open:rotate-180",
            severe ? "text-at-disruption" : "text-at-muted",
          )}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
          />
        </svg>
      </summary>

      <div className={cn("divide-y", severe ? "divide-at-disruption/15" : "divide-at-border")}>
        {pastWindow && (
          <p className="p-3 text-xs text-at-muted">
            Auckland Transport publishes only the alerts running at this moment, so these are the
            ones running now, not a record of what was disrupted in the period shown.
          </p>
        )}
        {alerts.map((alert, i) => {
          const rawHeader = extractText(alert.header_text);
          const headerText = rawHeader ? cleanAlertHeader(rawHeader) : null;
          const rawDesc = extractText(alert.description_text);
          const cleanDesc = rawDesc ? cleanAlertHeader(rawDesc) : null;
          const urlText = extractText(alert.url);
          const routeIds = [
            ...new Set(
              alert.informed_entity.map((e) => e.route_id).filter((id): id is string => !!id),
            ),
          ];
          const period = alert.active_period[0];
          const periodText = periodLabel(period?.start, period?.end, pastWindow);
          const rowSevere = alertSeverity(alert) === "severe";

          return (
            <div key={alert.id || i} className="space-y-1.5 p-3">
              {headerText && (
                <p className="text-sm font-semibold text-at-ink">
                  {urlText ? (
                    <a
                      href={urlText}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:no-underline"
                    >
                      {headerText}
                    </a>
                  ) : (
                    headerText
                  )}
                </p>
              )}
              {periodText && <p className="text-xs text-at-muted">{periodText}</p>}
              {alert.effect && (
                <span
                  className={cn(
                    "inline-block rounded px-1.5 py-0.5 text-xs",
                    rowSevere
                      ? "bg-at-disruption/15 text-at-disruption"
                      : "bg-at-border/60 text-at-muted",
                  )}
                >
                  {alert.effect.replace(/_/g, " ")}
                </span>
              )}
              {cleanDesc && <p className="text-sm leading-snug text-at-muted">{cleanDesc}</p>}
              {routeIds.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {routeIds.map((id) => (
                    <Link
                      key={id}
                      href={`/route/${encodeURIComponent(routeSlug(id))}`}
                      className="rounded-full bg-at-shore-pale px-2 py-0.5 text-xs font-medium text-at-shore hover:underline"
                    >
                      {routeNames?.[id] ?? id}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
