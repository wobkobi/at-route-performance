// src/components/AlertBanner.tsx
/**
 * @description Region listing active service alerts, rendering nothing when there are none.
 */
import { cleanAlertHeader, extractText, type ServiceAlert } from "@/lib/at-alerts";
import { routeSlug } from "@/lib/route-slug";
import type { JSX } from "react";

/** Props for {@link AlertBanner}. */
export interface AlertBannerProps {
  /** Alerts to display. Renders nothing when the array is empty. */
  alerts: ServiceAlert[];
  /** Accessible heading for the alert region. Defaults to "Service alerts". */
  heading?: string;
  /** Short names keyed by route id; falls back to the raw id when absent. */
  routeNames?: Record<string, string>;
}

/**
 * Format a Unix timestamp as a short NZ local time (e.g. "8:45 pm").
 * @param unix - Seconds since epoch.
 * @returns Localised time string.
 */
function fmtTime(unix: number): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(unix * 1000));
}

/**
 * Collapsible service-disruption banner using `<details>/<summary>` - no
 * client JS required. Open by default for a single alert; closed when
 * multiple so the page doesn't open with a wall of text.
 *
 * Each alert shows a cleaned header (AT's schedule-time bracket stripped),
 * a short active-period line, an effect badge, description, and route pill
 * links for any `informed_entity` entries that carry a `route_id`.
 *
 * Returns null when no alerts are present so callers need no guard wrapper.
 * @param props - Component props.
 * @param props.alerts - Alerts to display.
 * @param props.heading - Accessible region label (defaults to "Service alerts").
 * @param props.routeNames - Map of route id to display name for the informed-entity pills.
 * @returns Collapsible alert banner, or null when the list is empty.
 */
export function AlertBanner({
  alerts,
  heading = "Service alerts",
  routeNames,
}: AlertBannerProps): JSX.Element | null {
  if (!alerts.length) return null;

  return (
    <details className="group overflow-hidden rounded-lg border border-at-disruption/30 bg-at-disruption/5">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3 select-none">
        {/* Exclamation icon */}
        <svg
          aria-hidden="true"
          className="size-4 shrink-0 text-at-disruption"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
        <span className="flex-1 text-sm font-bold text-at-disruption">{heading}</span>
        <span className="rounded-full bg-at-disruption px-2 py-0.5 text-xs text-white tabular-nums">
          {alerts.length}
        </span>
        {/* Chevron rotates when details is open */}
        <svg
          aria-hidden="true"
          className="size-4 shrink-0 text-at-disruption transition-transform group-open:rotate-180"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </summary>

      <div className="divide-y divide-at-disruption/15">
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
          const periodText =
            period?.start && period?.end
              ? `${fmtTime(period.start)} – ${fmtTime(period.end)}`
              : period?.start
                ? `From ${fmtTime(period.start)}`
                : period?.end
                  ? `Until ${fmtTime(period.end)}`
                  : null;

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
                <span className="inline-block rounded bg-at-disruption/15 px-1.5 py-0.5 text-xs text-at-disruption">
                  {alert.effect.replace(/_/g, " ")}
                </span>
              )}
              {cleanDesc && <p className="text-sm leading-snug text-at-muted">{cleanDesc}</p>}
              {routeIds.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {routeIds.map((id) => (
                    <a
                      key={id}
                      href={`/route/${routeSlug(id)}`}
                      className="rounded-full bg-at-shore-pale px-2 py-0.5 text-xs font-medium text-at-shore hover:underline"
                    >
                      {routeNames?.[id] ?? id}
                    </a>
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
