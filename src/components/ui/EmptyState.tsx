import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import type { JSX, ReactNode } from "react";

/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
  /**
   * Inside a panel that already has its heading: drop the box and keep only the
   * text, so a board keeps its frame and says why it is empty.
   */
  inset?: boolean;
  /** Extra classes. */
  className?: string;
  /** What is missing, as "No {thing} recorded {window}." */
  children: ReactNode;
}

/**
 * The line shown in place of a board, table or list with nothing to show.
 * @param props - Component props.
 * @param props.inset - Render the text alone, inside an existing panel.
 * @param props.className - Extra classes.
 * @param props.children - The message.
 * @returns The message, boxed unless inset.
 */
export function EmptyState({ inset = false, className, children }: EmptyStateProps): JSX.Element {
  if (inset) return <p className={cn("text-sm text-at-muted", className)}>{children}</p>;
  return (
    <Panel as="p" pad="lg" className={cn("text-sm text-at-muted", className)}>
      {children}
    </Panel>
  );
}
