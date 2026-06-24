import { cn } from "@/lib/cn";
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
  const params = new URLSearchParams({
    ...preservedParams,
    ...(active ? {} : { school: "1" }),
  });
  const href = params.toString() ? `${basePath}?${params.toString()}` : basePath;
  return (
    <a href={href} className={cn("chip", active ? "chip-on" : "chip-off")}>
      School buses
    </a>
  );
}
