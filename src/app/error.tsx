"use client";
// src/app/error.tsx
// Error boundary for every page under the root layout. A page that throws
// while rendering (the database unreachable, an AT feed timing out inside a
// query) shows this inside the normal masthead and footer, with a retry, rather
// than Next's blank default. The root layout's own failures fall through to
// global-error.tsx.

import Link from "next/link";
import { useEffect, type JSX } from "react";

/**
 * Recovery page for a failed render, keeping the site frame.
 * @param props - Boundary props from Next.js.
 * @param props.error - The thrown error, with Next's digest when one was assigned.
 * @param props.reset - Re-renders the segment, retrying the page's queries.
 * @returns The recovery markup.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    console.error("[PAGE] Render failed", { error: error.message, digest: error.digest });
  }, [error]);
  return (
    <main className="space-y-4 py-8">
      <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">
        Something went wrong
      </h1>
      <p className="max-w-prose text-at-muted">
        This page could not be loaded. The database or the Auckland Transport feeds may be
        unreachable for a moment; the rest of the site should still work.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={reset} className="at-btn at-btn-cta">
          Try again
        </button>
        <Link href="/" className="at-btn border border-at-border">
          Back to today
        </Link>
      </div>
    </main>
  );
}
