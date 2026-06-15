import { describe, expect, it } from "vitest";
import {
  applyInputClassAbstraction,
  applyIntervalAbstraction,
  applyPredicateAbstraction,
  applySaturationCounter,
  attachNumericReductions,
  downgradeVerdictForReductions,
  exactFirstReduction,
  mergeNumericReductions,
  numericCoiDroppedReductions,
  worstNumericClaim,
} from "modality-ts/extract/engine";
import type { Model } from "modality-ts/core";

describe("numeric abstraction", () => {
  it("keeps sparse intSet exact-first", () => {
    const reduction = exactFirstReduction("phase", {
      kind: "intSet",
      values: [0, 2],
    });
    expect(reduction).toEqual({
      varId: "phase",
      kind: "exact",
      claim: "exact",
      reason: "Sparse numeric set preserved exactly (2 values)",
    });
  });

  it("records lazy-range for wide boundedInt", () => {
    const reduction = exactFirstReduction("count", {
      kind: "boundedInt",
      min: 0,
      max: 65535,
      overflow: "wrap",
    });
    expect(reduction?.kind).toBe("lazy-range");
    expect(reduction?.claim).toBe("property-preserving");
  });

  it("builds saturation counter metadata and domain", () => {
    const result = applySaturationCounter(
      "len",
      { kind: "boundedInt", min: 0, max: 255, overflow: "saturate" },
      { ceiling: 3 },
    );
    expect(result.domain).toEqual({
      kind: "intSet",
      values: [0, 1, 2, 3, 4],
      overflow: "saturate",
    });
    expect(result.reduction).toMatchObject({
      kind: "saturation",
      claim: "property-preserving",
    });
  });

  it("derives interval categories from cut points", () => {
    const result = applyIntervalAbstraction(
      "score",
      { kind: "boundedInt", min: 0, max: 10 },
      { cutPoints: [1, 10] },
      [
        {
          kind: "lte",
          args: [
            { kind: "read", var: "score" },
            { kind: "lit", value: 10 },
          ],
        },
      ],
    );
    expect(result?.domain).toEqual({
      kind: "enum",
      values: ["0", "1+"],
    });
    expect(result?.reduction.kind).toBe("interval");
  });

  it("marks predicate abstraction heuristic when observations are uncovered", () => {
    const result = applyPredicateAbstraction(
      "count",
      { kind: "boundedInt", min: 0, max: 10 },
      {
        categories: [
          {
            name: "zero",
            predicate: {
              kind: "eq",
              args: [
                { kind: "read", var: "count" },
                { kind: "lit", value: 0 },
              ],
            },
          },
        ],
      },
      [
        {
          kind: "gt",
          args: [
            { kind: "read", var: "count" },
            { kind: "lit", value: 5 },
          ],
        },
      ],
    );
    expect(result.reduction.claim).toBe("heuristic");
    expect(result.domain).toEqual({ kind: "enum", values: ["zero"] });
  });

  it("models wide numeric input as classes", () => {
    const result = applyInputClassAbstraction("amount", {
      kind: "boundedInt",
      min: 0,
      max: 65535,
    });
    expect(result.domain.kind).toBe("enum");
    expect(result.reduction.kind).toBe("input-class");
    expect(result.reduction.claim).toBe("heuristic");
  });

  it("downgrades verified verdict only for heuristic reductions", () => {
    expect(
      downgradeVerdictForReductions("verified-within-bounds", [
        {
          varId: "count",
          kind: "exact",
          claim: "exact",
          reason: "exact",
        },
      ]),
    ).toEqual({ status: "verified-within-bounds" });
    expect(
      downgradeVerdictForReductions("verified-within-bounds", [
        {
          varId: "count",
          kind: "input-class",
          claim: "heuristic",
          reason: "heuristic",
        },
      ]).status,
    ).toBe("vacuous-warning");
  });

  it("merges reductions keeping the worst claim per var/kind", () => {
    const merged = mergeNumericReductions(
      [
        {
          varId: "count",
          kind: "lazy-range",
          claim: "property-preserving",
          reason: "lazy",
        },
      ],
      [
        {
          varId: "count",
          kind: "lazy-range",
          claim: "heuristic",
          reason: "heuristic",
        },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.claim).toBe("heuristic");
    expect(worstNumericClaim(merged)).toBe("heuristic");
  });

  it("records numeric COI drops", () => {
    const original: Model = {
      schemaVersion: 1,
      id: "coi",
      bounds: { maxDepth: 4, maxPending: 0, maxInternalSteps: 2 },
      vars: [
        {
          id: "needed",
          domain: { kind: "bool" },
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "ignored",
          domain: { kind: "boundedInt", min: 0, max: 100 },
          origin: "system",
          scope: { kind: "global" },
          initial: 0,
        },
      ],
      transitions: [],
    };
    const sliced = { ...original, vars: [original.vars[0]!] };
    expect(numericCoiDroppedReductions(original, sliced, ["needed"])).toEqual([
      {
        varId: "ignored",
        kind: "dropped",
        claim: "property-preserving",
        reason:
          "Numeric variable ignored dropped from property slice (cone-of-influence)",
      },
    ]);
  });

  it("attaches numeric reductions to model metadata", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "meta",
      bounds: { maxDepth: 4, maxPending: 0, maxInternalSteps: 2 },
      vars: [
        {
          id: "phase",
          domain: { kind: "intSet", values: [0, 2] },
          origin: "system",
          scope: { kind: "global" },
          initial: 0,
        },
      ],
      transitions: [],
    };
    const annotated = attachNumericReductions(model);
    expect(annotated.metadata?.numericReductions?.entries).toEqual([
      {
        varId: "phase",
        kind: "exact",
        claim: "exact",
        reason: "Sparse numeric set preserved exactly (2 values)",
      },
    ]);
  });
});
