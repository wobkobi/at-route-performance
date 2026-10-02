// src/components/map/MapGlyphs.tsx
// Every route glyph rendered once, hidden, for the maps to copy into their
// vehicle markers (see readGlyphs), so a marker draws the icon the page does.

import { ALL_GLYPHS } from "@/components/ModeIcon";
import type { JSX, Ref } from "react";

/**
 * The hidden glyph copies, each tagged with its label.
 * @param props - Component props.
 * @param props.ref - Receives the container the maps read.
 * @returns The hidden container.
 */
export function MapGlyphs({ ref }: { ref: Ref<HTMLDivElement> }): JSX.Element {
  return (
    <div ref={ref} hidden>
      {ALL_GLYPHS.map(({ Icon, label }) => (
        <Icon key={label} data-glyph={label} />
      ))}
    </div>
  );
}
