// tests/lib/operators.test.ts
import { type Operator, operatorBySlug, operatorHref, operatorOf } from "@/lib/operators";
import { describe, expect, it } from "vitest";

const LIST: Operator[] = [
  { code: "GBT", name: "Go Bus", slug: "go-bus", current: true },
  { code: "NZB", name: "New Zealand Bus", slug: "new-zealand-bus", current: true },
  { code: "RTH", name: "Ritchies Transport", slug: "ritchies-transport", current: false },
];

describe("operators", () => {
  it("names a listed operator from its code, current or not", () => {
    expect(operatorOf("NZB", LIST)).toEqual(LIST[1]);
    expect(operatorHref(operatorOf("RTH", LIST)!)).toBe("/operator/ritchies-transport");
  });

  it("answers null for a route with no code", () => {
    expect(operatorOf(null, LIST)).toBeNull();
    expect(operatorOf("", LIST)).toBeNull();
  });

  it("falls back to the code for an operator the list does not hold", () => {
    const op = operatorOf("NEWCO", LIST);
    expect(op).toEqual({ code: "NEWCO", name: "NEWCO", slug: "newco", current: true });
    expect(operatorBySlug("newco", LIST, ["NZB", "NEWCO"])).toEqual(op);
    expect(operatorBySlug("newco", LIST)).toBeNull();
  });

  it("resolves a listed slug without being told the codes", () => {
    expect(operatorBySlug("go-bus", LIST)?.code).toBe("GBT");
    expect(operatorBySlug("nope", LIST)).toBeNull();
  });
});
