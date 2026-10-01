import { Panel } from "@/components/ui/Panel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { cn } from "@/lib/cn";
import type { JSX, ReactNode } from "react";

/** What a trip note reports: a failure, a detour, or a quiet caveat. */
export type TripNoteTone = "late" | "commercial" | "muted";

const RULE_CLASS: Record<TripNoteTone, string> = {
  late: "border-l-at-late",
  commercial: "border-l-at-commercial",
  muted: "border-l-at-muted",
};

/** Props for {@link TripNote}. */
export interface TripNoteProps {
  /** The rule colour; `late` also turns the heading red. */
  tone: TripNoteTone;
  /** The heading. */
  title: ReactNode;
  /** The note's paragraphs. */
  children: ReactNode;
}

/**
 * A note on the trip page explaining something odd about the trip: a panel
 * with a thick coloured rule down its left edge, a heading and muted body text.
 * @param props - Component props.
 * @param props.tone - The rule colour.
 * @param props.title - The heading.
 * @param props.children - The body paragraphs.
 * @returns The note.
 */
export function TripNote({ tone, title, children }: TripNoteProps): JSX.Element {
  return (
    <Panel pad="sm" className={cn("border-l-4", RULE_CLASS[tone])}>
      <SectionHeading className={tone === "late" ? "text-at-late" : undefined}>
        {title}
      </SectionHeading>
      <div className="mt-1 space-y-2 text-sm text-at-muted">{children}</div>
    </Panel>
  );
}
