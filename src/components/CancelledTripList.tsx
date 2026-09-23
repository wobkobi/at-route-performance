"use client";
// src/components/CancelledTripList.tsx
// The Cancellations page's trip list: every flagged trip in the window with its
// route, destination and stage, filterable by stage and linking to the trip
// page. A week or month runs to thousands of trips, so the list shows a page at
// a time behind a "Show more" button. The stage is a URL param the chips link
// to; how far the list is opened is client state mirrored into `show`, so Back
// from a trip returns to the same stretch of the list.

import { BadgeKey, type BadgeKeyItem } from "@/components/BadgeKey";
import { ChevronRight } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import {
  CANCELLATION_BADGE,
  CANCELLATION_BADGE_CLASS,
  CANCELLATION_BADGE_MEANING,
  CANCELLATION_BADGE_SHORT,
  CANCELLATION_STAGES,
  type CancellationStage,
} from "@/lib/cancellation";
import { cn } from "@/lib/cn";
import type { NetworkCancelledTrip } from "@/lib/data/cancelled";
import { nzClockTime, nzServiceDayRange, serviceDayLabel } from "@/lib/time";
import { useUrlParam } from "@/lib/use-url-param";
import { buildHref } from "@/lib/utils";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type JSX } from "react";

/** Trips shown before "Show more", and how many each press adds. */
const PAGE_SIZE = 30;

/** Props for {@link CancelledTripList}. */
export interface CancelledTripListProps {
  /** The window's flagged trips, already filtered by mode and school services. */
  trips: NetworkCancelledTrip[];
  /** Whether the window spans several days, so each row names its day. */
  multiDay: boolean;
  /** The stage the list is filtered to, or null for every stage. */
  stage: CancellationStage | null;
  /** The page path the stage chips link to. */
  basePath: string;
  /** The page's other params (window and filters), carried on the stage chips. */
  preservedParams: Readonly<Record<string, string>>;
}

const STAGES: ReadonlyArray<{ key: CancellationStage | null; label: string }> = [
  { key: null, label: "All" },
  { key: "before", label: "Never ran" },
  { key: "mid-trip", label: "Cut short" },
  { key: "ran", label: "Reinstated" },
];

/**
 * How many rows a `show` param opens the list to: a whole number above the
 * first page, or the first page for anything else.
 * @param raw - The param, or null when absent.
 * @returns Rows to show.
 */
function parseShown(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > PAGE_SIZE ? n : PAGE_SIZE;
}

/**
 * List a window's flagged trips, filterable by stage. A single day reads in
 * departure order; a week or month puts the most recent first.
 * @param props - Component props.
 * @param props.trips - The flagged trips.
 * @param props.multiDay - Whether each row names its day.
 * @param props.stage - The stage filtered to, or null for all.
 * @param props.basePath - The page path the stage chips link to.
 * @param props.preservedParams - The page's other params, carried on the chips.
 * @returns The list section.
 */
export function CancelledTripList({
  trips,
  multiDay,
  stage,
  basePath,
  preservedParams,
}: CancelledTripListProps): JSX.Element {
  // Seeded from the live URL rather than a server prop: Back restores the page
  // from the router cache, rendered before `show` was written into the URL.
  const searchParams = useSearchParams();
  const [shown, setShown] = useState(() => parseShown(searchParams.get("show")));
  useUrlParam("show", shown > PAGE_SIZE ? String(shown) : null);
  const ordered = useMemo(() => (multiDay ? [...trips].reverse() : trips), [trips, multiDay]);
  const visible = stage ? ordered.filter((t) => t.stage === stage) : ordered;
  // Key entries for the stages on screen, so no badge is explained in a hover a
  // phone cannot reach - and none is explained that the reader cannot see. The
  // filter chips name the stages in their own words ("Never ran", "Cut short"),
  // which is not the same vocabulary as the badges.
  const keyItems: BadgeKeyItem[] = useMemo(() => {
    const shownStages = new Set(visible.slice(0, shown).map((t) => t.stage));
    return CANCELLATION_STAGES.filter((s) => shownStages.has(s)).map((s) => ({
      label: CANCELLATION_BADGE[s],
      shortLabel: CANCELLATION_BADGE_SHORT[s],
      className: CANCELLATION_BADGE_CLASS[s],
      meaning: CANCELLATION_BADGE_MEANING[s],
    }));
  }, [visible, shown]);
  const counts = useMemo(() => {
    const c: Record<CancellationStage, number> = { before: 0, "mid-trip": 0, ran: 0 };
    for (const t of trips) c[t.stage]++;
    return c;
  }, [trips]);

  return (
    <section className="min-w-0 border border-at-border bg-at-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-ultra tracking-zero text-at-ink">Cancelled trips</h2>
        <div className="flex flex-wrap gap-1">
          {STAGES.map((s) => (
            <Link
              key={s.label}
              href={buildHref(basePath, { ...preservedParams, stage: s.key })}
              scroll={false}
              aria-current={stage === s.key ? "true" : undefined}
              className={cn("chip text-xs", stage === s.key ? "chip-on" : "chip-off")}
            >
              {s.label}
              <span className="ml-1 tabular-nums opacity-70">
                {s.key ? counts[s.key] : trips.length}
              </span>
            </Link>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        // An empty list under a chosen stage is the chip's doing, not the
        // window's, so it names the chip and offers the way back out. The counts
        // on the chips say the same thing, but only to a reader who reads them.
        <p className="text-sm text-at-muted">
          {stage !== null && trips.length > 0 ? (
            <>
              No trips at this stage.{" "}
              <Link
                href={buildHref(basePath, preservedParams)}
                scroll={false}
                className="underline"
              >
                Show all {trips.length.toLocaleString()}
              </Link>
              .
            </>
          ) : (
            "No trips were flagged cancelled in this window."
          )}
        </p>
      ) : (
        <ol>
          {visible.slice(0, shown).map((t) => {
            const at = t.scheduled_start ?? nzServiceDayRange(t.service_date).start.toISOString();
            return (
              <li
                key={`${t.service_date}-${t.trip_id}`}
                className="border-t border-at-border first:border-0"
              >
                <Link
                  href={`/route/${encodeURIComponent(t.route_id)}/trip/${encodeURIComponent(t.trip_id)}?d=${encodeURIComponent(at)}`}
                  prefetch={false}
                  className="-mx-4 flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-at-shore-pale"
                >
                  <span className="w-16 shrink-0 tabular-nums">
                    {multiDay && (
                      <span className="block text-xs text-at-muted">
                        {serviceDayLabel(t.service_date)}
                      </span>
                    )}
                    <span className="font-semibold text-at-shore">
                      {t.scheduled_start ? nzClockTime(t.scheduled_start) : "—"}
                    </span>
                  </span>
                  <ModeIcon
                    mode={t.mode}
                    shortName={t.short_name}
                    longName={t.long_name}
                    colour={t.colour}
                  />
                  {/* Name and badge share a wrapping line: the badge is `shrink-0`, so
                      as a sibling of the name it left the name as the only column that
                      could give, truncating a route to "32 to Manger...". `min-w-40` on
                      the name is what makes the badge wrap instead - a `flex-1` item has
                      a zero flex basis, so without a floor nothing would ever wrap. */}
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-40 flex-1 truncate">
                      <span className="font-semibold text-at-ink">
                        {t.short_name ?? t.route_id}
                      </span>
                      <span className="text-at-muted">{t.headsign ? ` to ${t.headsign}` : ""}</span>
                    </span>
                    <span
                      title={CANCELLATION_BADGE_MEANING[t.stage]}
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-xs font-bold",
                        CANCELLATION_BADGE_CLASS[t.stage],
                      )}
                    >
                      <span className="sm:hidden">{CANCELLATION_BADGE_SHORT[t.stage]}</span>
                      <span className="hidden sm:inline">{CANCELLATION_BADGE[t.stage]}</span>
                    </span>
                  </span>
                  <ChevronRight className="shrink-0 text-at-muted" />
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      <BadgeKey items={keyItems} />
      {visible.length > shown && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE_SIZE)}
            className="chip chip-off"
          >
            Show {Math.min(PAGE_SIZE, visible.length - shown)} more of {visible.length - shown}
          </button>
        </div>
      )}
    </section>
  );
}
