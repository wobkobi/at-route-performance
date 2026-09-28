// tests/lib/at-static.test.ts
// Guards the AT error contract: a caller reads the status off the error, never out of its message.

import { AtHttpError } from "@/lib/at-static";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every TypeScript source file beneath a directory.
 * @param dir - Directory to walk, relative to the repo root.
 * @returns Paths of every `.ts` and `.tsx` file under it.
 */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("AtHttpError", () => {
  it("carries the status and keeps the URL in the message for the log", () => {
    const err = new AtHttpError(503, "https://api.at.govt.nz/gtfs/v3/stops/7143/trips");
    expect(err.status).toBe(503);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("7143");
    expect(err.message).toContain("503");
  });

  it("separates a 404 from a 500 at a stop whose own id contains 404", () => {
    // The trap this class closes. Both messages contain "404" - one because AT answered 404, the
    // other because the stop is called 1404 - so a message test read the failure as an empty
    // schedule and the board showed no departures instead of an error.
    const url = "https://api.at.govt.nz/gtfs/v3/stops/1404/trips?filter%5Bdate%5D=2026-09-24";
    expect(new AtHttpError(404, url).status).toBe(404);
    expect(new AtHttpError(500, url).status).toBe(500);
    expect(new AtHttpError(500, url).message).toContain("404");
  });
});

describe("status handling across the source", () => {
  it("never decides an HTTP status by matching an error message", () => {
    // A message carries the request URL, and a URL holds ids that read as status codes.
    const byMessage =
      /message\s*\.\s*(?:includes|startsWith|endsWith|indexOf|match)\s*\(\s*["'`][^"'`]*[45]\d\d/;
    const offenders = tsFiles("src").filter((file) => byMessage.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
