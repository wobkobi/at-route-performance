import { ChevronRight } from "@/components/icons";
import { cn } from "@/lib/cn";
import Link from "next/link";
import type { JSX, ReactNode } from "react";

/**
 * The "see all" link beside or under a section, pointing at the page that holds
 * its full version. One look everywhere: semibold Shore text and a chevron.
 * @param props - Component props.
 * @param props.href - The fuller page.
 * @param props.className - Extra classes (spacing).
 * @param props.children - The link text.
 * @returns The link.
 */
export function MoreLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Link
      href={href}
      className={cn("at-link inline-flex items-center gap-1 text-sm font-semibold", className)}
    >
      {children}
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0" />
    </Link>
  );
}
