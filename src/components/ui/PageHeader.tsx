import { cn } from "@/lib/cn";
import type { JSX, ReactNode } from "react";

/** Props for {@link PageHeader}. */
export interface PageHeaderProps {
  /** The page title. */
  title: ReactNode;
  /** A small capitals line over the title, naming what kind of thing the page is. */
  eyebrow?: ReactNode;
  /** A mode icon or similar, inside the h1 before the title. */
  icon?: ReactNode;
  /** One muted line under the title, a sentence ending in a full stop. */
  subtitle?: ReactNode;
  /** Controls on the title's right, usually the window tabs and stepper. */
  actions?: ReactNode;
  /** `hero` for the home page's question; `page` everywhere else. */
  size?: "page" | "hero";
  /** `late` for the shame boards' red title. */
  tone?: "ink" | "late";
  /** Layout classes for the header, such as centring. */
  className?: string;
  /** Further lines under the subtitle: operator, fare zone, sibling stations. */
  children?: ReactNode;
}

const SIZE_CLASS = {
  page: "text-2xl sm:text-3xl",
  hero: "text-3xl leading-tight sm:text-5xl",
} as const;

/**
 * Every page's title block: the h1 with its icon, the muted subtitle and any
 * further lines, and the page's controls beside it, wrapping under the title on
 * a phone. One size step and one subtitle style, so no page's title reads as a
 * different kind of heading from the next.
 * @param props - Component props.
 * @param props.title - The page title.
 * @param props.eyebrow - The line over the title.
 * @param props.icon - The icon in the h1.
 * @param props.subtitle - The line under the title.
 * @param props.actions - The controls beside the title.
 * @param props.size - Title size.
 * @param props.tone - Title colour.
 * @param props.className - Header classes.
 * @param props.children - Further lines under the subtitle.
 * @returns The header.
 */
export function PageHeader({
  title,
  eyebrow,
  icon,
  subtitle,
  actions,
  size = "page",
  tone = "ink",
  className,
  children,
}: PageHeaderProps): JSX.Element {
  return (
    <header className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="at-eyebrow text-at-muted">{eyebrow}</p>}
        <h1
          className={cn(
            "font-ultra tracking-zero",
            SIZE_CLASS[size],
            tone === "late" ? "text-at-late" : "text-at-ink",
            icon != null && "flex flex-wrap items-center gap-2.5",
          )}
        >
          {icon}
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-sm text-at-muted">{subtitle}</p>}
        {children}
      </div>
      {actions}
    </header>
  );
}
