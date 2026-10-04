"use client";

// The compare picker: a search box whose matches update as you type, routes
// filtered in the browser from the rows the page already holds, stops looked
// up through /api/stops. The box is still a GET form, so Enter and a page with
// no script both land on the same list from the server.

import { ModeIcon } from "@/components/ModeIcon";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  COMPARE_SEARCH_LIMIT,
  MAX_COMPARE,
  matchRoutes,
  stopCandidate,
  toggleCompareId,
  type CompareCandidate,
  type CompareKind,
} from "@/lib/compare";
import type { StopMatch } from "@/lib/data";
import { formatPct } from "@/lib/format";
import { buildHref } from "@/lib/utils";
import Link from "next/link";
import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from "react";

/** Wait after the last keystroke before a stop lookup, so a word is one request. */
const STOP_DEBOUNCE_MS = 200;

/** A stop search can start from two characters, as {@link stopCandidate}'s source does. */
const MIN_STOP_QUERY = 2;

/** The last stop lookup: the text it was for and what came back. */
interface StopResult {
  q: string;
  items: CompareCandidate[];
  /** The lookup did not answer, so an empty list is not "no match". */
  failed: boolean;
}

/** Props for {@link CompareSearch}. */
export interface CompareSearchProps {
  kind: CompareKind;
  /** The ids being compared. */
  ids: string[];
  /** The window params (`window`, `day`, `period`) every link keeps. */
  view: Record<string, string | undefined>;
  /** The search the page was opened with. */
  q: string;
  /** Every route with arrivals in the window, busiest first; empty for stops. */
  routes: CompareCandidate[];
  /** The server's stop matches for `q`, so the first paint needs no lookup. */
  stopMatches: CompareCandidate[];
  /** What to offer before anything is typed: the busiest routes; none for stops. */
  suggestions: CompareCandidate[];
  /** How the empty route search reads its window, e.g. "today". */
  phrase: string;
}

/**
 * The compare picker's search box and its live list of matches.
 * @param props - Component props.
 * @param props.kind - Routes or stops.
 * @param props.ids - The ids being compared.
 * @param props.view - The window params every link keeps.
 * @param props.q - The search the page was opened with.
 * @param props.routes - Every route with arrivals in the window, busiest first.
 * @param props.stopMatches - The server's stop matches for `q`.
 * @param props.suggestions - What to offer before anything is typed.
 * @param props.phrase - How the window reads, for the empty route search.
 * @returns The picker.
 */
export function CompareSearch({
  kind,
  ids,
  view,
  q,
  routes,
  stopMatches,
  suggestions,
  phrase,
}: CompareSearchProps): JSX.Element {
  const [text, setText] = useState(q);
  const [stops, setStops] = useState<StopResult>({ q, items: stopMatches, failed: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const want = text.trim();

  // Stop lookups: debounced, and the one in flight is dropped on the next key.
  useEffect(() => {
    if (kind !== "stops" || want.length < MIN_STOP_QUERY || want === stops.q) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        buildHref("/api/stops", { q: want, limit: String(COMPARE_SEARCH_LIMIT + MAX_COMPARE) }),
        {
          signal: ctl.signal,
        },
      )
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((body: { stops: StopMatch[] }) =>
          setStops({ q: want, items: body.stops.map(stopCandidate), failed: false }),
        )
        .catch((err: unknown) => {
          if (!ctl.signal.aborted) {
            console.warn("[COMPARE] stop search failed", err);
            setStops({ q: want, items: [], failed: true });
          }
        });
    }, STOP_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [kind, want, stops.q]);

  let matches: CompareCandidate[] = [];
  let pending = false;
  if (kind === "routes") {
    matches = matchRoutes(routes, want, ids);
  } else if (want.length >= MIN_STOP_QUERY) {
    // While a lookup runs, keep showing the last list rather than flashing empty.
    pending = stops.q !== want;
    matches = stops.items.filter((m) => !ids.includes(m.id)).slice(0, COMPARE_SEARCH_LIMIT);
  }
  const typed = want.length > 0;
  const shown = typed ? matches : suggestions;

  /**
   * This page with one more id. The search is dropped, so the box is empty for
   * the next pick.
   * @param id - The id to add.
   * @returns The href.
   */
  const addHref = (id: string): string =>
    buildHref("/compare", { ...view, kind, ids: toggleCompareId(ids, id) });

  /**
   * The links in the list, in order, for arrow-key moves.
   * @returns The links.
   */
  const links = (): HTMLAnchorElement[] => [
    ...(listRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []),
  ];

  /**
   * Down from the box moves into the list.
   * @param e - The key event.
   */
  const onInputKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== "ArrowDown") return;
    const first = links()[0];
    if (!first) return;
    e.preventDefault();
    first.focus();
  };

  /**
   * Up and down move through the list; up from the first goes back to the box.
   * @param e - The key event.
   */
  const onListKey = (e: KeyboardEvent<HTMLUListElement>): void => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const all = links();
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (at < 0) return;
    e.preventDefault();
    if (e.key === "ArrowDown") all[at + 1]?.focus();
    else if (at === 0) inputRef.current?.focus();
    else all[at - 1]?.focus();
  };

  let empty: ReactNode = null;
  if (typed && matches.length === 0 && !pending) {
    if (kind === "routes") empty = `No route ran ${phrase} matching “${want}”.`;
    else if (want.length < MIN_STOP_QUERY) empty = null;
    else if (stops.failed) empty = "The stop search did not answer. Press Search to try again.";
    else empty = `No stop matches “${want}”.`;
  }

  return (
    <div className="space-y-3">
      <form action="/compare" className="flex flex-wrap gap-2">
        <input type="hidden" name="kind" value={kind} />
        {ids.length > 0 && <input type="hidden" name="ids" value={ids.join(",")} />}
        {Object.entries(view).map(([k, v]) =>
          v ? <input key={k} type="hidden" name={k} value={v} /> : null,
        )}
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onInputKey}
          autoComplete="off"
          placeholder={kind === "routes" ? "Route number or name" : "Stop name or number"}
          aria-label={kind === "routes" ? "Search routes" : "Search stops"}
          aria-describedby="compare-search-hint"
          className="at-field min-w-0 flex-1"
        />
        <button type="submit" className="at-btn at-btn-primary">
          Search
        </button>
      </form>
      <p id="compare-search-hint" className="sr-only">
        Matches list below as you type. Press the down arrow to move into them.
      </p>

      {empty && <EmptyState inset>{empty}</EmptyState>}
      {!typed && kind === "stops" && (
        <p className="text-sm text-at-muted">
          Search by a stop&apos;s name or the number on its pole. A station takes in every platform.
        </p>
      )}
      <p role="status" className="sr-only">
        {typed && !pending ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}` : ""}
      </p>
      {shown.length > 0 && (
        <div aria-busy={pending}>
          <p className="at-eyebrow text-at-muted">{typed ? "Matches" : "Busiest routes"}</p>
          <ul
            ref={listRef}
            onKeyDown={onListKey}
            className="striped mt-1 divide-y divide-at-border"
          >
            {shown.map((c) => (
              <li key={c.id}>
                <Link
                  href={addHref(c.id)}
                  scroll={false}
                  className="flex items-center justify-between gap-3 py-2 text-sm hover:text-at-shore"
                >
                  <CandidateLabel candidate={c} />
                  <span className="flex shrink-0 items-center gap-3">
                    {c.onTimePct !== undefined && (
                      <span className="text-xs text-at-muted tabular-nums">
                        {formatPct(c.onTimePct)} on time
                      </span>
                    )}
                    <span className="font-semibold text-at-shore">+ Add</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * A candidate's badge and name with its detail beside it, the detail cut short
 * first on a narrow screen.
 * @param props - Component props.
 * @param props.candidate - The candidate.
 * @returns The label.
 */
function CandidateLabel({ candidate: c }: { candidate: CompareCandidate }): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {c.route && (
        <ModeIcon
          mode={c.route.mode}
          shortName={c.route.shortName}
          longName={c.route.longName}
          colour={c.route.colour}
          className="h-4 w-4 shrink-0"
        />
      )}
      <span className="shrink-0 font-semibold">{c.name}</span>
      {c.detail && c.detail !== c.name && (
        <span className="ml-0.5 min-w-0 truncate text-at-muted">{c.detail}</span>
      )}
    </span>
  );
}
