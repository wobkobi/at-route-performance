"use client";
// src/components/cancellation/CancelledTripList.tsx
// The Cancellations page's trip list: every flagged trip in the window with its
// route, destination and stage, filterable by stage and linking to the trip
// page. A week or month runs to thousands of trips, so the list shows a page at
// a time behind a "Show more" button. The stage is a URL param the chips link
// to; how far the list is opened is client state mirrored into `show`, so Back
// from a trip returns to the same stretch of the list.

import { BadgeKey, type BadgeKeyItem } from "@/components/BadgeKey";
import { ChipGroup, ChipLink } from "@/components/Chip";
import { ChevronRight } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import { CANCELLATION_TONE, CancellationBadge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ShowMore } from "@/components/ui/ShowMore";
import type { NetworkCancelledTrip } from "@/lib/data";
import { formatCount, UNKNOWN_VALUE } from "@/lib/format";
import { LIST_PAGE_SIZE, parseShown, SHOWN_PARAM } from "@/lib/page/filter-params";
import { tripHref } from "@/lib/page/hrefs";
import {
  TRIP_NAME_CLASS,
  TRIP_NAME_GROUP_CLASS,
  TRIP_ROW_CLASS,
  TRIP_ROW_LINK_CLASS,
} from "@/lib/page/row";
import { useUrlParam } from "@/lib/page/use-url-param";
import { routeDisplayName } from "@/lib/route/slug";
import { nzClockTime } from "@/lib/time/format";
import { nzServiceDayRange, serviceDayLabel } from "@/lib/time/service-day";
import {
  CANCELLATION_BADGE,
  CANCELLATION_BADGE_MEANING,
  CANCELLATION_LABEL,
  CANCELLATION_STAGES,
  type CancellationStage,
} from "@/lib/trip/cancellation";
import { boundFor } from "@/lib/trip/departure-label";
import { buildHref } from "@/lib/utils";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useMemo, useState, type JSX } from "react";

/** Props for {@link CancelledTripList}. */
export interface CancelledTripListProps {
  /** The window's flagged trips, already filtered by mode and school services. */
  trips: NetworkCancelledTrip[];
  /** Whether the window spans several days, so each row names its day. */
  multiDay: boolean;
  /**
   * The request's instant in epoch ms while the window is the live day, else
   * null. The list then splits there: trips AT has already called off for later
   * today first, then the ones already due.
   */
  liveAt: number | null;
  /** The stage the list is filtered to, or null for every stage. */
  stage: CancellationStage | null;
  /** The page path the stage chips link to. */
  basePath: string;
  /** The page's other params (window and filters), carried on the stage chips. */
  preservedParams: Readonly<Record<string, string>>;
}

const STAGES: ReadonlyArray<{ key: CancellationStage | null; label: string }> = [
  { key: null, label: "All" },
  { key: "before", label: CANCELLATION_LABEL.before },
  { key: "mid-trip", label: CANCELLATION_LABEL["mid-trip"] },
  { key: "ran", label: CANCELLATION_LABEL.ran },
];

/**
 * Whether a flagged trip has yet to reach its scheduled start.
 * @param t - The trip.
 * @param at - The instant to test, epoch ms.
 * @returns True when it starts after `at`.
 */
function notDueYet(t: NetworkCancelledTrip, at: number): boolean {
  return t.scheduled_start !== null && Date.parse(t.scheduled_start) > at;
}

/**
 * List a window's flagged trips, filterable by stage. A past day reads in
 * departure order and a week or month puts the most recent first. The live day
 * leads with the trips not due yet, soonest first, then the ones already due,
 * most recent first: in departure order the trips a rider could still be
 * waiting for sat at the foot of the list, behind "Show more".
 * @param props - Component props.
 * @param props.trips - The flagged trips.
 * @param props.multiDay - Whether each row names its day.
 * @param props.liveAt - The instant the live day splits at, or null for any other window.
 * @param props.stage - The stage filtered to, or null for all.
 * @param props.basePath - The page path the stage chips link to.
 * @param props.preservedParams - The page's other params, carried on the chips.
 * @returns The list section.
 */
export function CancelledTripList({
  trips,
  multiDay,
  liveAt,
  stage,
  basePath,
  preservedParams,
}: CancelledTripListProps): JSX.Element {
  // Seeded from the live URL rather than a server prop: Back restores the page
  // from the router cache, rendered before `show` was written into the URL.
  const searchParams = useSearchParams();
  const [shown, setShown] = useState(() => parseShown(searchParams.get(SHOWN_PARAM)));
  useUrlParam(SHOWN_PARAM, shown > LIST_PAGE_SIZE ? String(shown) : null);
  const { visible, notDue } = useMemo(() => {
    const staged = stage ? trips.filter((t) => t.stage === stage) : trips;
    if (multiDay) return { visible: [...staged].reverse(), notDue: 0 };
    if (liveAt === null) return { visible: staged, notDue: 0 };
    const later = staged.filter((t) => notDueYet(t, liveAt));
    const due = staged.filter((t) => !notDueYet(t, liveAt)).reverse();
    return { visible: [...later, ...due], notDue: later.length };
  }, [trips, stage, multiDay, liveAt]);
  // Key entries for the stages on screen, so no badge is explained in a hover a
  // phone cannot reach - and none is explained that the reader cannot see.
  const keyItems: BadgeKeyItem[] = useMemo(() => {
    const shownStages = new Set(visible.slice(0, shown).map((t) => t.stage));
    return CANCELLATION_STAGES.filter((s) => shownStages.has(s)).map((s) => ({
      label: CANCELLATION_BADGE[s],
      tone: CANCELLATION_TONE[s],
      meaning: CANCELLATION_BADGE_MEANING[s],
    }));
  }, [visible, shown]);
  const counts = useMemo(() => {
    const c: Record<CancellationStage, number> = { before: 0, "mid-trip": 0, ran: 0 };
    for (const t of trips) c[t.stage]++;
    return c;
  }, [trips]);

  return (
    <Panel pad="sm" className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionHeading>Cancelled trips</SectionHeading>
        <ChipGroup label="Stage" className="gap-1">
          {STAGES.map((s) => (
            <ChipLink
              key={s.label}
              href={buildHref(basePath, { ...preservedParams, stage: s.key })}
              active={stage === s.key}
              className="text-xs"
            >
              {s.label}
              <span className="ml-1 tabular-nums opacity-70">
                {s.key ? counts[s.key] : trips.length}
              </span>
            </ChipLink>
          ))}
        </ChipGroup>
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
                Show all {formatCount(trips.length)}
              </Link>
              .
            </>
          ) : (
            "No trips were flagged cancelled in this window."
          )}
        </p>
      ) : (
        <ol className="striped">
          {visible.slice(0, shown).map((t, i) => {
            const at = t.scheduled_start ?? nzServiceDayRange(t.service_date).start.toISOString();
            // Group labels only when the live day has trips on both sides of now,
            // or a lone "Not due yet" group; a list of due trips needs none.
            const label =
              notDue > 0 && i === 0
                ? `Not due yet · ${notDue}`
                : notDue > 0 && i === notDue
                  ? "Already due"
                  : null;
            return (
              <Fragment key={`${t.service_date}-${t.trip_id}`}>
                {label && (
                  <li className="no-stripe at-eyebrow pt-3 pb-1 text-at-muted first:pt-0">
                    {label}
                  </li>
                )}
                <li className={TRIP_ROW_CLASS}>
                  <Link
                    href={tripHref(t.slug, t.trip_id, at)}
                    prefetch={false}
                    className={TRIP_ROW_LINK_CLASS}
                  >
                    <span className="w-16 shrink-0 tabular-nums">
                      {multiDay && (
                        <span className="block text-xs text-at-muted">
                          {serviceDayLabel(t.service_date)}
                        </span>
                      )}
                      <span className="font-semibold text-at-shore">
                        {t.scheduled_start ? nzClockTime(t.scheduled_start) : UNKNOWN_VALUE}
                      </span>
                    </span>
                    <ModeIcon mode={t.mode} shortName={t.shortName} longName={t.longName} />
                    <span className={TRIP_NAME_GROUP_CLASS}>
                      <span className={TRIP_NAME_CLASS}>
                        <span className="font-semibold text-at-ink">{routeDisplayName(t)}</span>
                        <span className="text-at-muted"> {boundFor(t.headsign, t.mode)}</span>
                      </span>
                      <CancellationBadge stage={t.stage} />
                    </span>
                    <ChevronRight className="shrink-0 text-at-muted" />
                  </Link>
                </li>
              </Fragment>
            );
          })}
        </ol>
      )}
      <BadgeKey items={keyItems} />
      {visible.length > shown && (
        <ShowMore
          remaining={visible.length - shown}
          onClick={() => setShown((n) => n + LIST_PAGE_SIZE)}
          className="mt-3"
        />
      )}
    </Panel>
  );
}
