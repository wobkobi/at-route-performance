"use client";
// src/components/filter/OperatorSelect.tsx
// A drop-down of operators for a server-rendered board: choosing one navigates
// to the same page with `?op=<slug>`. Seventeen operators make too long a list
// for a filter menu of radio options, so this is a native select.

import { buildHref } from "@/lib/utils";
import { useRouter } from "next/navigation";
import type { ChangeEvent, JSX } from "react";

/**
 * The operator filter.
 * @param props - Component props.
 * @param props.options - Operators to offer, in display order.
 * @param props.active - The chosen operator's slug, or null for every operator.
 * @param props.basePath - Page path the choice navigates to.
 * @param props.preservedParams - Query params to keep (the `op` and `show` params are set here).
 * @returns The labelled select.
 */
export function OperatorSelect({
  options,
  active,
  basePath,
  preservedParams,
}: {
  options: ReadonlyArray<{ slug: string; name: string }>;
  active: string | null;
  basePath: string;
  preservedParams: Record<string, string>;
}): JSX.Element {
  const router = useRouter();

  /**
   * Navigate to the chosen operator, back to the list's first rows.
   * @param e - The change event.
   */
  function choose(e: ChangeEvent<HTMLSelectElement>): void {
    router.push(
      buildHref(basePath, { ...preservedParams, show: undefined, op: e.target.value || undefined }),
      { scroll: false },
    );
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="at-eyebrow text-at-muted">Operator</span>
      <select value={active ?? ""} onChange={choose} className="at-field">
        <option value="">Any operator</option>
        {options.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
