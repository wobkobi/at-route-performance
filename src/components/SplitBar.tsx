"use client";
// src/components/SplitBar.tsx
// The verdict panel's on time / late / early bar, with a note per segment on
// hover, focus or tap.

import { cn } from "@/lib/cn";
import { onTimeWindowMinutes, onTimeWindowPhrase } from "@/lib/copy";
import { formatPct } from "@/lib/format";
import { useState, type FocusEvent, type JSX, type PointerEvent } from "react";

/** The three bands a measured arrival can fall in, in the order they are drawn. */
const SPLIT_BANDS = [
  { key: "onTime", label: "On time", barClass: "bg-at-ontime", toneClass: "text-at-ontime" },
  { key: "late", label: "Late", barClass: "bg-at-late", toneClass: "text-at-late" },
  { key: "early", label: "Early", barClass: "bg-at-early", toneClass: "text-at-early-strong" },
] as const;

type BandKey = (typeof SPLIT_BANDS)[number]["key"];

/**
 * "About 1 in 4" for a share, so a segment's note says how often a rider meets
 * it rather than restating the percentage. Null under 1%, where "1 in 150"
 * reads as more precise than the share it came from.
 * @param pct - The share, 0-100.
 * @returns The phrase, or null for a share too small to put that way.
 */
function oneIn(pct: number): string | null {
  if (pct < 1) return null;
  return pct >= 50 ? `about ${Math.round(pct / 10)} in 10` : `about 1 in ${Math.round(100 / pct)}`;
}

/**
 * What each band means, in the window of the mode being looked at. A mixed-mode
 * view names the ferry window too, since its early edge is five minutes, not one.
 * @param mode - The mode filter, or undefined for every mode.
 * @returns One line per band.
 */
function bandMeaning(mode: string | undefined): Record<BandKey, string> {
  const { early, late } = onTimeWindowMinutes(mode);
  const ferry = mode === undefined ? ` (ferries ${onTimeWindowMinutes("FERRY").early})` : "";
  const ferries = mode === undefined ? ` (ferries: ${onTimeWindowPhrase("FERRY")})` : "";
  return {
    onTime: `Within ${onTimeWindowPhrase(mode)}${ferries}.`,
    late: `More than ${late} min late, so riders waited longer than the timetable said.`,
    early: `More than ${early} min early${ferry}, so a rider who arrived on time could have missed it.`,
  };
}

/**
 * The day's shape: one bar of on time / late / early with each share printed
 * under its own colour. The bands and their order are the on-time popover's, so
 * the bar on the page and the bar behind the ⓘ cannot read as two different
 * splits of the same day.
 *
 * Hovering, focusing or tapping a segment (or its figure below) opens a note on
 * what that band means and how often it came up. A touch toggles on
 * `pointerdown`, since a phone has no hover to take it away again; a mouse is
 * left to hover alone, so clicking a segment it already shows cannot hide it.
 * @param props - Component props.
 * @param props.onTime - Share of measured arrivals inside the on-time window.
 * @param props.late - Share that ran late.
 * @param props.early - Share that ran early.
 * @param props.mode - The mode filter, for the window the notes quote.
 * @returns The bar and its figures.
 */
export function SplitBar({
  onTime,
  late,
  early,
  mode,
}: {
  onTime: number;
  late: number;
  early: number;
  mode?: string;
}): JSX.Element {
  const [shown, setShown] = useState<BandKey | null>(null);
  const shares = { onTime, late, early };
  const meaning = bandMeaning(mode);
  const active = shown === null ? null : SPLIT_BANDS.find((b) => b.key === shown)!;
  // The note centres under its own segment (the shares before it, plus half its
  // own), held inside the bar at either end; a bar narrower than the note gives
  // a negative upper bound, and clamp() then settles on 0.
  const before = active
    ? SPLIT_BANDS.slice(0, SPLIT_BANDS.indexOf(active)).reduce(
        (sum, b) => sum + Math.max(0, shares[b.key]),
        0,
      )
    : 0;
  const centre = active ? before + Math.max(0, shares[active.key]) / 2 : 0;

  // Each segment and figure carries its band in `data-band`, so one set of
  // handlers serves all six buttons.
  const handlers = {
    onPointerEnter: enter,
    onPointerLeave: leave,
    onPointerDown: tap,
    onFocus: focus,
    onBlur: blur,
  };

  /**
   * The band a segment or figure button stands for.
   * @param el - The button.
   * @returns Its band.
   */
  function bandOf(el: HTMLElement): BandKey {
    return el.dataset.band as BandKey;
  }

  /**
   * Show a band while a mouse is over it.
   * @param e - The pointer event.
   */
  function enter(e: PointerEvent<HTMLButtonElement>): void {
    if (e.pointerType === "mouse") setShown(bandOf(e.currentTarget));
  }

  /**
   * Hide it when the mouse leaves.
   * @param e - The pointer event.
   */
  function leave(e: PointerEvent<HTMLButtonElement>): void {
    if (e.pointerType === "mouse") setShown(null);
  }

  /**
   * Toggle a band on touch or pen, which has no hover to take it away again.
   * @param e - The pointer event.
   */
  function tap(e: PointerEvent<HTMLButtonElement>): void {
    if (e.pointerType === "mouse") return;
    const key = bandOf(e.currentTarget);
    setShown((cur) => (cur === key ? null : key));
  }

  /**
   * Show a band reached by keyboard.
   * @param e - The focus event.
   */
  function focus(e: FocusEvent<HTMLButtonElement>): void {
    setShown(bandOf(e.currentTarget));
  }

  /** Hide the note when focus moves on. */
  function blur(): void {
    setShown(null);
  }

  return (
    <div className="relative lg:col-span-4">
      <div className="flex h-3 bg-at-bg">
        {SPLIT_BANDS.map((b) => (
          <button
            key={b.key}
            type="button"
            aria-label={`${b.label} ${formatPct(shares[b.key])}`}
            className={cn(
              "hit-44 h-full cursor-pointer transition-opacity",
              b.barClass,
              shown !== null && shown !== b.key && "opacity-40",
            )}
            style={{ width: `${Math.max(0, shares[b.key])}%` }}
            data-band={b.key}
            aria-expanded={shown === b.key}
            {...handlers}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
        {SPLIT_BANDS.map((b) => (
          <button
            key={b.key}
            type="button"
            tabIndex={-1}
            className="flex cursor-pointer items-baseline gap-2"
            data-band={b.key}
            aria-expanded={shown === b.key}
            {...handlers}
          >
            <span className="at-eyebrow text-at-muted">{b.label}</span>
            <span className={cn("text-base font-semibold tabular-nums", b.toneClass)}>
              {formatPct(shares[b.key])}
            </span>
          </button>
        ))}
      </div>
      {active && (
        <div
          role="status"
          className="absolute top-5 z-30 w-xs max-w-full border border-at-border bg-at-surface p-3 text-sm shadow-lg"
          style={{ left: `clamp(0px, calc(${centre}% - 10rem), calc(100% - 20rem))` }}
        >
          <p className={cn("font-semibold", active.toneClass)}>
            {active.label} {formatPct(shares[active.key])}
            {oneIn(shares[active.key]) && (
              <span className="font-normal text-at-muted">
                {" "}
                · {oneIn(shares[active.key])} arrivals
              </span>
            )}
          </p>
          <p className="mt-1 text-at-muted">{meaning[active.key]}</p>
        </div>
      )}
    </div>
  );
}
