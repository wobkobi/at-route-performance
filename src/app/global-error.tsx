"use client";
// src/app/global-error.tsx
// Last-resort error boundary for a failure inside the root layout itself. It
// replaces the whole document, so it renders its own html and body and uses no
// site component or stylesheet that the layout would normally provide.

import { useEffect, type JSX } from "react";

/**
 * Bare recovery page shown when the root layout throws.
 * @param props - Boundary props from Next.js.
 * @param props.error - The thrown error, with Next's digest when one was assigned.
 * @param props.reset - Re-renders the segment.
 * @returns A complete document.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    console.error("[PAGE] Root layout failed", { error: error.message, digest: error.digest });
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "40rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
        <p style={{ marginBottom: "1rem" }}>
          The site could not render this page. Reload to try again; if it keeps failing, the
          database or the Auckland Transport feeds may be unreachable.
        </p>
        <button type="button" onClick={reset} style={{ padding: "0.5rem 1rem", cursor: "pointer" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
