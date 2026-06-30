// src/components/SchoolBusToggle.tsx
/**
 * @description Toggle linking between including and excluding school bus services.
 */
import { cn } from "@/lib/cn";
import { buildHref } from "@/lib/utils";
import type { JSX } from "react";

/** Props for {@link SchoolBusToggle}. */
export interface SchoolBusToggleProps {
  /** Whether school buses are currently included. */
  active: boolean;
  /** Page path the toggle links to. */
  basePath: string;
  /** Query params to preserve (the `school` param is set here). */
  preservedParams: Record<string, string>;
}

/**
 * A chip that toggles whether school-service routes (`S###`) are shown.
 * Off by default; clicking adds `?school=1`, clicking again removes it.
 * @param props - Component props.
 * @param props.active - Whether school buses are currently shown.
 * @param props.basePath - Page path the chip links to.
 * @param props.preservedParams - Query params to keep when toggling.
 * @returns The toggle chip element.
 */
export function SchoolBusToggle({
  active,
  basePath,
  preservedParams,
}: SchoolBusToggleProps): JSX.Element {
  const href = buildHref(basePath, { ...preservedParams, school: active ? undefined : "1" });
  return (
    <a href={href} className={cn("chip", active ? "chip-on" : "chip-off")}>
      School buses
    </a>
  );
}
