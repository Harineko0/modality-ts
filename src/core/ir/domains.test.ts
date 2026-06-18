import { describe, expect, it } from "vitest";
import type { AbstractDomain } from "./types.js";
import {
  collectRecordDomainFieldPaths,
  collectTokenDomainPaths,
  domainCardinality,
  domainFingerprint,
  enumerateDomain,
  exceedsWideNumericThreshold,
  validateValue,
  WIDE_NUMERIC_DOMAIN_THRESHOLD,
} from "./domains.js";

describe("domainCardinality", () => {
  const cases: Array<{ label: string; domain: AbstractDomain }> = [
    { label: "bool", domain: { kind: "bool" } },
    {
      label: "enum",
      domain: { kind: "enum", values: ["a", "b", "c"] },
    },
    { label: "boundedInt", domain: { kind: "boundedInt", min: 2, max: 5 } },
    {
      label: "intSet",
      domain: { kind: "intSet", values: [0, 2], overflow: "wrap" },
    },
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

describe("intSet domain", () => {
  const sparse: AbstractDomain = { kind: "intSet", values: [0, 2] };
  const dense: AbstractDomain = { kind: "boundedInt", min: 0, max: 2 };

  it("enumerates exact sparse values", () => {
    expect(enumerateDomain(sparse)).toEqual([0, 2]);
    expect(domainCardinality(sparse)).toBe(2);
  });

  it("validates integer membership only", () => {
    expect(validateValue(sparse, 0)).toBe(true);
    expect(validateValue(sparse, 2)).toBe(true);
    expect(validateValue(sparse, 1)).toBe(false);
    expect(validateValue(sparse, 0.5)).toBe(false);
  });

  it("distinguishes sparse set from dense range in fingerprint", () => {
    expect(domainFingerprint(sparse)).toBe("intSet(0,2)");
    expect(domainFingerprint(dense)).toBe("int(0,2)");
    expect(domainFingerprint(sparse)).not.toBe(domainFingerprint(dense));
  });

  it("ignores overflow metadata for cardinality and enumeration", () => {
    const wrapped: AbstractDomain = {
      kind: "intSet",
      values: [0, 2],
      overflow: "wrap",
    };
    expect(domainCardinality(wrapped)).toBe(domainCardinality(sparse));
    expect(enumerateDomain(wrapped)).toEqual(enumerateDomain(sparse));
  });
});

describe("wide numeric threshold", () => {
  it("flags domains above the threshold", () => {
    expect(WIDE_NUMERIC_DOMAIN_THRESHOLD).toBe(256);
    expect(
      exceedsWideNumericThreshold({
        kind: "boundedInt",
        min: 0,
        max: WIDE_NUMERIC_DOMAIN_THRESHOLD - 1,
      }),
    ).toBe(false);
    expect(
      exceedsWideNumericThreshold({
        kind: "boundedInt",
        min: 0,
        max: WIDE_NUMERIC_DOMAIN_THRESHOLD,
      }),
    ).toBe(true);
  });
});

describe("collectTokenDomainPaths", () => {
  it("collects token paths across domain shapes", () => {
    expect(collectTokenDomainPaths({ kind: "tokens", count: 1 })).toEqual([""]);
    expect(collectTokenDomainPaths({ kind: "bool" })).toEqual([]);
    expect(collectTokenDomainPaths({ kind: "enum", values: ["a"] })).toEqual(
      [],
    );
    expect(
      collectTokenDomainPaths({ kind: "boundedInt", min: 0, max: 1 }),
    ).toEqual([]);
    expect(collectTokenDomainPaths({ kind: "lengthCat" })).toEqual([]);

    expect(
      collectTokenDomainPaths({
        kind: "record",
        fields: {
          a: { kind: "tokens", count: 1 },
          b: { kind: "bool" },
          c: { kind: "enum", values: ["x"] },
        },
      }),
    ).toEqual(["a"]);

    expect(
      collectTokenDomainPaths({
        kind: "record",
        fields: {
          outer: {
            kind: "record",
            fields: { inner: { kind: "tokens", count: 1 } },
          },
        },
      }),
    ).toEqual(["outer.inner"]);

    expect(
      collectTokenDomainPaths({
        kind: "option",
        inner: {
          kind: "record",
          fields: { title: { kind: "tokens", count: 1 } },
        },
      }),
    ).toEqual(["title"]);

    expect(
      collectTokenDomainPaths({
        kind: "tagged",
        tag: "kind",
        variants: {
          a: {
            kind: "record",
            fields: { field: { kind: "tokens", count: 1 } },
          },
        },
      }),
    ).toEqual(["#a.field"]);

    expect(
      collectTokenDomainPaths({
        kind: "boundedList",
        inner: {
          kind: "record",
          fields: { field: { kind: "tokens", count: 1 } },
        },
        maxLen: 2,
      }),
    ).toEqual(["[].field"]);

    expect(
      collectTokenDomainPaths({
        kind: "record",
        fields: {
          z: { kind: "tokens", count: 1 },
          a: { kind: "tokens", count: 1 },
          b: { kind: "tokens", count: 1 },
        },
      }),
    ).toEqual(["a", "b", "z"]);
  });
});

describe("collectRecordDomainFieldPaths", () => {
  it("collects nested record leaf paths", () => {
    expect(
      collectRecordDomainFieldPaths({
        kind: "record",
        fields: {
          user: {
            kind: "record",
            fields: {
              id: { kind: "tokens", count: 1 },
              avatarUrl: { kind: "tokens", count: 1 },
            },
          },
        },
      }),
    ).toEqual([
      ["user", "avatarUrl"],
      ["user", "id"],
    ]);
  });
});
