import { describe, expect, it } from "vitest";
import type { AbstractDomain } from "./types.js";
import { domainCardinality, enumerateDomain } from "./domains.js";

describe("domainCardinality", () => {
  const cases: Array<{ label: string; domain: AbstractDomain }> = [
    { label: "bool", domain: { kind: "bool" } },
    {
      label: "enum",
      domain: { kind: "enum", values: ["a", "b", "c"] },
    },
    { label: "boundedInt", domain: { kind: "boundedInt", min: 2, max: 5 } },
    { label: "option", domain: { kind: "option", inner: { kind: "bool" } } },
    {
      label: "record",
      domain: {
        kind: "record",
        fields: { x: { kind: "bool" }, y: { kind: "bool" } },
      },
    },
    {
      label: "tagged",
      domain: {
        kind: "tagged",
        tag: "kind",
        variants: {
          a: { kind: "record", fields: { x: { kind: "bool" } } },
          b: { kind: "record", fields: { y: { kind: "bool" } } },
        },
      },
    },
    { label: "tokens count", domain: { kind: "tokens", count: 3 } },
    {
      label: "tokens names",
      domain: { kind: "tokens", count: 0, names: ["a", "b"] },
    },
    { label: "lengthCat", domain: { kind: "lengthCat" } },
    {
      label: "boundedList",
      domain: {
        kind: "boundedList",
        inner: { kind: "bool" },
        maxLen: 2,
      },
    },
  ];

  it.each(cases)("matches enumerateDomain length for $label", ({ domain }) => {
    expect(domainCardinality(domain)).toBe(enumerateDomain(domain).length);
  });

  it("boundedList bool maxLen 2 has cardinality 7", () => {
    const domain: AbstractDomain = {
      kind: "boundedList",
      inner: { kind: "bool" },
      maxLen: 2,
    };
    expect(domainCardinality(domain)).toBe(7);
  });

  it("saturates large boundedList without Infinity or NaN", () => {
    const domain: AbstractDomain = {
      kind: "boundedList",
      inner: {
        kind: "record",
        fields: {
          a: { kind: "bool" },
          b: { kind: "bool" },
          c: { kind: "bool" },
          d: { kind: "bool" },
          e: { kind: "bool" },
        },
      },
      maxLen: 8,
    };
    const card = domainCardinality(domain);
    expect(Number.isFinite(card)).toBe(true);
    expect(card).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });
});
