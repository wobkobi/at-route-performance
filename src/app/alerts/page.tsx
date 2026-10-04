// Service alerts page: every alert in AT's feed, running now or coming up,
// each opened out with links to the routes and stops it names. Mode and a
// search narrow the list; AT publishes no history, so there is no date to pick.

import { AlertItem } from "@/components/AlertBanner";
import { ChipGroup, ChipTab } from "@/components/Chip";
import { ModeFilter } from "@/components/filter/ModeFilter";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ShowMore } from "@/components/ui/ShowMore";
import {
  alertMatches,
  alertsForMode,
  getServiceAlerts,
  getUpcomingAlerts,
  rankAlerts,
  type ServiceAlert,
} from "@/lib/feed/at-alerts";
import { formatCount } from "@/lib/format";
import { parseMode } from "@/lib/mode";
import { pageMetadata } from "@/lib/og";
import { LIST_PAGE_SIZE, parseShown, SHOWN_PARAM } from "@/lib/page/filter-params";
import { buildHref, stripUnset } from "@/lib/utils";
import type { Metadata } from "next";
import type { JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

export const metadata: Metadata = pageMetadata({
  title: "Service alerts",
  description:
    "Every AT service alert running now or coming up this week, with the routes and stops each one touches.",
});

/** The page's own path, for its links and search form. */
const BASE = "/alerts";

/** The longest search kept; anything longer is cut, not refused. */
const MAX_QUERY = 100;

/** Query params for the alerts page. */
interface AlertsSearchParams {
  /** "next" lists the alerts coming up; absent lists those running now. */
  when?: string;
  mode?: string;
  q?: string;
  show?: string;
}

/**
 * Service alerts page.
 * @param root0 - Page props.
 * @param root0.searchParams - `when`, `mode`, search (`q`) and list length (`show`).
 * @returns Page markup.
 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams?: Promise<AlertsSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const upcoming = sp.when === "next";
  const mode = parseMode(sp.mode);
  const q = (sp.q ?? "").trim().slice(0, MAX_QUERY);
  const shown = parseShown(sp.show);
  // One fetch serves both lists (see getAlertSnapshot), so they fail together.
  const feed = await Promise.all([getServiceAlerts(), getUpcomingAlerts()]).catch((): null => null);

  const header = (
    <PageHeader
      title="Service alerts"
      subtitle="Disruptions AT has published, with the routes and stops each one touches."
    />
  );
  if (!feed) {
    return (
      <main className="space-y-4">
        {header}
        <EmptyState>AT&apos;s alerts feed did not answer. Try again in a few minutes.</EmptyState>
      </main>
    );
  }

  const [running, next] = feed;
  /**
   * The alerts a list keeps under the mode and search.
   * @param alerts - The list.
   * @returns The alerts kept, in order.
   */
  const narrow = (alerts: ServiceAlert[]): ServiceAlert[] =>
    alertsForMode(alerts, mode).filter((a) => alertMatches(a, q));
  // Running now leads with what is stopping; coming up stays soonest first.
  const runningKept = narrow(rankAlerts(running));
  const nextKept = narrow(next);
  const list = upcoming ? nextKept : runningKept;
  const modes = new Set((upcoming ? next : running).flatMap((a) => a.modes ?? []));

  const filters = stripUnset({ mode: mode ?? undefined, q: q || undefined });
  const whenParams = upcoming ? { when: "next" } : {};

  return (
    <main className="space-y-4">
      {header}

      <div className="flex flex-wrap items-center gap-3">
        <ChipGroup label="When">
          <ChipTab href={buildHref(BASE, filters)} active={!upcoming}>
            Running now{" "}
            <span className="ml-1.5 tabular-nums">{formatCount(runningKept.length)}</span>
          </ChipTab>
          <ChipTab href={buildHref(BASE, { ...filters, when: "next" })} active={upcoming}>
            Coming up <span className="ml-1.5 tabular-nums">{formatCount(nextKept.length)}</span>
          </ChipTab>
        </ChipGroup>
        <ModeFilter
          active={mode}
          basePath={BASE}
          preservedParams={stripUnset({ ...whenParams, q: q || undefined })}
          availableModes={modes}
        />
      </div>

      <form action={BASE} className="flex flex-wrap gap-2">
        {upcoming && <input type="hidden" name="when" value="next" />}
        {mode && <input type="hidden" name="mode" value={mode} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search: a route, a stop or a street"
          aria-label="Search alerts"
          className="at-field min-w-0 flex-1"
        />
        <button type="submit" className="at-btn at-btn-primary">
          Search
        </button>
      </form>

      {list.length === 0 ? (
        <EmptyState>
          {q
            ? `No alert ${upcoming ? "coming up" : "running now"} matches “${q}”.`
            : `No alerts ${upcoming ? "coming up this week" : "running now"}.`}
        </EmptyState>
      ) : (
        <Panel aria-label={upcoming ? "Alerts coming up" : "Alerts running now"}>
          <ul className="divide-y divide-at-border">
            {list.slice(0, shown).map((alert, i) => (
              <li key={alert.id || i}>
                <AlertItem alert={alert} className="p-4" />
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {list.length > shown && (
        <ShowMore
          remaining={list.length - shown}
          href={buildHref(BASE, {
            ...whenParams,
            ...filters,
            [SHOWN_PARAM]: String(shown + LIST_PAGE_SIZE),
          })}
        />
      )}

      <p className="text-xs text-at-muted">
        AT publishes only the alerts running now and those booked ahead, so this page has no record
        of past disruptions. Coming up reaches a week ahead.
      </p>
    </main>
  );
}
