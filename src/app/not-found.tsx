import Link from "next/link";
import type { JSX } from "react";

/**
 * Global 404 page - rendered by Next.js when `notFound()` is called from any
 * route or stop page, or when a path matches no route segment.
 * @returns 404 markup.
 */
export default function NotFound(): JSX.Element {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-6xl font-ultra tracking-zero text-at-muted">404</p>
      <h1 className="text-2xl font-ultra tracking-zero text-at-ink">Page not found</h1>
      <p className="text-sm text-at-muted">That route or stop doesn&apos;t exist.</p>
      <Link href="/" className="mt-2 text-sm font-semibold text-at-shore hover:underline">
        Back to today&apos;s rankings
      </Link>
    </main>
  );
}
