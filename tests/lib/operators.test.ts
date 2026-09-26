// tests/lib/operators.test.ts
import { OPERATORS, operatorBySlug, operatorHref, operatorOf } from "@/lib/operators";
import { describe, expect, it } from "vitest";

describe("operators", () => {
  it("gives every operator a unique code and slug", () => {
    expect(new Set(OPERATORS.map((o) => o.code)).size).toBe(OPERATORS.length);
    expect(new Set(OPERATORS.map((o) => o.slug)).size).toBe(OPERATORS.length);
    for (const o of OPERATORS) expect(o.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("names a listed operator from its code", () => {
    expect(operatorOf("NZB")).toEqual({
      code: "NZB",
      name: "New Zealand Bus",
      slug: "new-zealand-bus",
    });
    expect(operatorHref(operatorOf("RTH")!)).toBe("/operator/ritchies-transport");
  });

  it("answers null for a route with no code", () => {
    expect(operatorOf(null)).toBeNull();
    expect(operatorOf("")).toBeNull();
  });

  it("falls back to the code for an operator the table does not list", () => {
    const op = operatorOf("NEWCO");
    expect(op).toEqual({ code: "NEWCO", name: "NEWCO", slug: "newco" });
    expect(operatorBySlug("newco", ["NZB", "NEWCO"])).toEqual(op);
    expect(operatorBySlug("newco")).toBeNull();
  });

  it("resolves a listed slug without being told the codes", () => {
    expect(operatorBySlug("go-bus")?.code).toBe("GBT");
    expect(operatorBySlug("nope")).toBeNull();
  });
});
