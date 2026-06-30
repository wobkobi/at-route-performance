// src/app/not-found.tsx
/**
 * @description Global 404 page with a page directory and the full route list.
 */
import { ModeIcon } from "@/components/ModeIcon";
import { prisma } from "@/lib/db";
import { routeSlug } from "@/lib/route-slug";
import { isSchoolBus } from "@/lib/school-bus";
import Link from "next/link";
import type { JSX } from "react";
import { FaChartBar, FaExclamationTriangle, FaHome, FaMapMarkerAlt, FaRoute } from "react-icons/fa";

const PAGES = [
  { href: "/", icon: FaHome, label: "Today" },
  { href: "/rankings", icon: FaChartBar, label: "Rankings" },
  { href: "/shame", icon: FaExclamationTriangle, label: "Shame of the day" },
  { href: "/shame/route", icon: FaRoute, label: "Worst routes" },
  { href: "/shame/stop", icon: FaMapMarkerAlt, label: "Worst stops" },
] as const;

/**
 * Global 404 page - rendered by Next.js when `notFound()` is called from any
 * route or stop page, or when a path matches no route segment. Loads the route
 * directory from Prisma; silently skips it when `DATABASE_URL` is unset (CI).
 * @returns 404 markup.
 */
export default async function NotFound(): Promise<JSX.Element> {
  let rawRoutes: {
    id: string;
    shortName: string | null;
    longName: string | null;
    mode: string;
    colour: string | null;
  }[] = [];

  try {
    rawRoutes = await prisma.route.findMany({
      select: { id: true, shortName: true, longName: true, mode: true, colour: true },
      orderBy: { shortName: "asc" },
    });
  } catch {
    // DATABASE_URL not configured (CI builds, static export) - show page without route list.
  }

  // Deduplicate by slug (same route across feed versions), keep first encountered.
  const bySlug = new Map<
    string,
    {
      id: string;
      shortName: string | null;
      longName: string | null;
      mode: string;
      colour: string | null;
    }
  >();
  for (const r of rawRoutes) {
    const slug = routeSlug(r.id);
    if (!bySlug.has(slug)) bySlug.set(slug, r);
  }

  const all = [...bySlug.values()];
  // Sort numerically then alphabetically: "1" < "2" < "10" < "27T" < "195" < "NX1".
  all.sort((a, b) => {
    const numA = parseInt(a.shortName ?? "", 10);
    const numB = parseInt(b.shortName ?? "", 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    if (!isNaN(numA)) return -1;
    if (!isNaN(numB)) return 1;
    return (a.shortName ?? "").localeCompare(b.shortName ?? "");
  });

  const regular = all.filter((r) => !isSchoolBus(r.shortName, r.longName ?? ""));
  const school = all.filter((r) => isSchoolBus(r.shortName, r.longName ?? ""));

  return (
    <main className="space-y-10 py-8">
      {/* 404 block */}
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-6xl font-ultra tracking-zero text-at-muted">404</p>
        <h1 className="text-2xl font-ultra tracking-zero text-at-ink">Page not found</h1>
        <p className="text-sm text-at-muted">That route or stop doesn&apos;t exist.</p>
      </div>

      {/* Page directory */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {PAGES.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 border border-at-border bg-at-surface p-4 transition-colors hover:bg-at-shore-pale"
          >
            <Icon className="h-5 w-5 shrink-0 text-at-shore" aria-hidden="true" />
            <p className="font-semibold text-at-ink">{label}</p>
          </Link>
        ))}
      </div>

      {/* Route directory */}
      {all.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-ultra tracking-zero text-at-ink">All routes</h2>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(3.5rem, 1fr))" }}
          >
            {regular.map((r) => (
              <Link
                key={routeSlug(r.id)}
                href={`/route/${encodeURIComponent(routeSlug(r.id))}`}
                className="flex aspect-square flex-col items-center justify-center gap-1 border border-at-border bg-at-surface p-2 text-center transition-colors hover:bg-at-shore-pale"
              >
                <ModeIcon
                  mode={r.mode}
                  shortName={r.shortName}
                  longName={r.longName}
                  colour={r.colour}
                  className="h-4 w-4 shrink-0"
                />
                <span className="text-xs leading-none font-semibold text-at-ink">
                  {r.shortName ?? r.id}
                </span>
              </Link>
            ))}
          </div>
          {school.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-semibold text-at-muted">
                School buses ({school.length})
              </summary>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {school.map((r) => (
                  <Link
                    key={routeSlug(r.id)}
                    href={`/route/${encodeURIComponent(routeSlug(r.id))}`}
                    className="flex items-center gap-2 border border-at-border bg-at-surface px-3 py-2 transition-colors hover:bg-at-shore-pale"
                  >
                    <ModeIcon
                      mode={r.mode}
                      shortName={r.shortName}
                      longName={r.longName}
                      colour={r.colour}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="truncate text-sm font-medium text-at-ink">
                      {r.longName ?? r.shortName ?? r.id}
                    </span>
                  </Link>
                ))}
              </div>
            </details>
          )}
        </section>
      )}
    </main>
  );
}
