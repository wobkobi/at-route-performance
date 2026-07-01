"use client";
// src/components/SiteNav.tsx
/**
 * @description Primary site navigation links, highlighting the current section.
 */

import { cn } from "@/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { JSX } from "react";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/rankings", label: "Rankings" },
] as const;

/**
 * Primary site navigation links, highlighting the current section.
 * @returns The nav element.
 */
export function SiteNav(): JSX.Element {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((l) => {
        // "/" only matches exactly; other links match their section prefix.
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
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
