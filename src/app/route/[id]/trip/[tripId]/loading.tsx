import type { JSX } from "react";

/**
 * Pulse-placeholder skeleton element.
 * @param root0 - Props.
 * @param root0.className - Tailwind size and shape classes.
 * @returns The bone element.
 */
function Bone({ className }: { className: string }): JSX.Element {
  return <div className={`animate-pulse rounded bg-at-border ${className}`} />;
}

/**
 * Trip page loading skeleton.
 * @returns Skeleton layout matching the trip detail page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      {/* Back link */}
      <Bone className="h-4 w-24" />

      {/* Header: mode icon + route number + trip details */}
      <header>
        <div className="flex items-center gap-3">
          <Bone className="h-7 w-7 shrink-0 rounded-full" />
          <Bone className="h-9 w-20" />
        </div>
        <Bone className="mt-1 h-4 w-52" />
      </header>

      {/* Map */}
      <section className="border border-at-border bg-at-surface p-4">
        <Bone className="mb-3 h-6 w-24" />
        <Bone className="h-100" />
      </section>

      {/* Stop timeline */}
      <section className="border border-at-border bg-at-surface p-4">
        <Bone className="mb-4 h-6 w-32" />
        <ol>
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="flex items-start gap-3 py-3">
              <div className="flex shrink-0 flex-col items-center">
                <div className={`w-px flex-1 bg-at-border${i === 0 ? "opacity-0" : ""}`} />
                <Bone className="h-3 w-3 rounded-full" />
                <div className={`w-px flex-1 bg-at-border${i === 7 ? "opacity-0" : ""}`} />
              </div>
              <div className="flex-1 space-y-1">
                <Bone className="h-4 w-40" />
                <Bone className="h-3 w-28" />
              </div>
              <Bone className="mt-0.5 h-4 w-16 shrink-0" />
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
