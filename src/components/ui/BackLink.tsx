import { ChevronLeft } from "@/components/icons";
import Link from "next/link";
import type { JSX, ReactNode } from "react";

/**
 * The "Back to …" link above a page title, to the list or page the reader came
 * from.
 * @param props - Component props.
 * @param props.href - Where it goes.
 * @param props.to - The place, as it finishes "Back to …".
 * @returns The link.
 */
export function BackLink({ href, to }: { href: string; to: ReactNode }): JSX.Element {
  return (
    <Link href={href} className="at-link inline-flex items-center gap-1 text-sm">
      <ChevronLeft className="h-3.5 w-3.5" />
      Back to {to}
    </Link>
  );
}
