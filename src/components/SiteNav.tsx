"use client";
// src/components/SiteNav.tsx
// Primary site navigation links, highlighting the current section.

import { cn } from "@/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { JSX } from "react";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/routes", label: "Routes" },
  { href: "/rankings", label: "Rankings" },
] as const;

/**
 * Primary site navigation links, highlighting the current section.
 * @returns The nav element.
 */
export function SiteNav(): JSX.Element {
  const pathname = usePathname();
  return (
    <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto sm:gap-1">
      {LINKS.map((l) => {
        // "/" only matches exactly; other links match their section prefix.
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1.5 text-sm font-semibold transition-colors sm:px-3",
              active ? "bg-at-shore text-white" : "text-at-ink hover:bg-at-shore-pale",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
