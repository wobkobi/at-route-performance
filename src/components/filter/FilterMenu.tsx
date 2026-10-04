"use client";
// src/components/filter/FilterMenu.tsx
// One filter as a dropdown: a box naming the filter (and its choice, once it
// has one) that opens a list of options, with a reset beside the box and in
// the list. Folds a chip row that wraps to three lines on a phone into one
// button, so a panel of filters reads as a single row.

import { ChevronDown } from "@/components/icons";
import { PopoverPanel, usePopover } from "@/components/ui/Popover";
import { cn } from "@/lib/cn";
import { useRef, type JSX, type ReactNode } from "react";

/**
 * What a filter box says for a multi-choice filter: the first choice by name
 * and a count of the rest, as in "Central +2", so the box stays one line.
 * @param labels - The chosen options' labels, in display order.
 * @returns The summary, or null with nothing chosen.
 */
export function choiceSummary(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  return labels.length === 1 ? labels[0]! : `${labels[0]} +${labels.length - 1}`;
}

/** Shape shared by the box and its reset, square-cornered like the search field. */
const BOX = "inline-flex tap-h items-center border py-1 text-sm transition-colors";

/**
 * A filter box and the option list it opens. The list anchors under the box
 * from `sm` up; a phone gets a sheet across the bottom of the viewport, since
 * an anchored list off a right-hand box would run off a 390px screen.
 * @param props - Component props.
 * @param props.label - The filter's name, shown on the box and naming the list.
 * @param props.summary - The current choice in a word or two, or null at the default.
 * @param props.onReset - Put the filter back to its default.
 * @param props.activeClass - Border, fill and text for the box once it has a
 *   choice, for a filter that colours its choice (late red, early green).
 * @param props.wide - Give the list a wider panel with no height cap, for a
 *   grid of options rather than a column of them.
 * @param props.children - The options, usually {@link FilterOption}s.
 * @returns The box and, while open, the list.
 */
export function FilterMenu({
  label,
  summary,
  onReset,
  activeClass = "border-at-shore bg-at-shore-pale text-at-shore",
  wide = false,
  children,
}: {
  label: string;
  summary: string | null;
  onReset: () => void;
  activeClass?: string;
  wide?: boolean;
  children: ReactNode;
}): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popover = usePopover(buttonRef);
  const active = summary !== null;

  return (
    <div className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={popover.toggle}
        onKeyDown={popover.onKeyDown}
        aria-expanded={popover.open}
        aria-controls={popover.panelId}
        className={cn(
          BOX,
          "gap-1.5 px-3",
          active
            ? cn("font-semibold", activeClass)
            : "border-at-border bg-at-surface text-at-ink hover:border-at-shore",
        )}
      >
        <span>{active ? `${label}: ${summary}` : label}</span>
        <ChevronDown />
      </button>
      {active && (
        <button
          type="button"
          onClick={onReset}
          aria-label={`Reset ${label.toLowerCase()}`}
          title={`Reset ${label.toLowerCase()}`}
          className={cn(BOX, "border-l-0 px-2.5 font-semibold hover:opacity-70", activeClass)}
        >
          <span aria-hidden>×</span>
        </button>
      )}

      <PopoverPanel
        popover={popover}
        role="group"
        label={label}
        className={wide ? "sm:w-96" : "sm:w-64"}
      >
        <p className="at-eyebrow px-3 pt-3 text-at-muted">{label}</p>
        <div className={cn("max-h-[60vh] overflow-y-auto p-1.5", !wide && "sm:max-h-72")}>
          {children}
        </div>
        <div className="flex items-center justify-between border-t border-at-border px-3 py-2">
          <button
            type="button"
            onClick={onReset}
            disabled={!active}
            className="at-link tap-h text-sm font-semibold disabled:text-at-muted disabled:no-underline"
          >
            Reset
          </button>
          <button type="button" onClick={popover.close} className="at-btn at-btn-primary">
            Done
          </button>
        </div>
      </PopoverPanel>
    </div>
  );
}

/**
 * One option in a {@link FilterMenu}: a checkbox for a filter that takes
 * several choices, a radio for one that takes a single choice.
 * @param props - Component props.
 * @param props.type - `checkbox` or `radio`.
 * @param props.name - The radio group's name; every option of one filter shares it.
 * @param props.checked - Whether the option is chosen.
 * @param props.onChange - Choose or unchoose it.
 * @param props.children - The option's label.
 * @returns The option.
 */
export function FilterOption({
  type,
  name,
  checked,
  onChange,
  children,
}: {
  type: "checkbox" | "radio";
  name?: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-2.5 px-1.5 text-sm hover:bg-at-shore-pale">
      <input
        type={type}
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 accent-at-shore"
      />
      <span>{children}</span>
    </label>
  );
}
