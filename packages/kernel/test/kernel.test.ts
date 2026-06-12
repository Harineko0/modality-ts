import { describe, expect, it } from "vitest";
import { canonicalJson, canonicalState, enumerateDomain, validateModel, validateValue, type AbstractDomain, type Model } from "../src/index.js";

const bool = { kind: "bool" } as const;
const route = { kind: "enum", values: ["/"] } as const;

function baseModel(): Model {
  return {
    schemaVersion: 1,
    id: "kernel-fixture",
    bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
      { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
      {
        id: "sys:pending",
        domain: { kind: "boundedList", inner: { kind: "record", fields: { opId: { kind: "enum", values: ["op"] }, continuation: { kind: "enum", values: ["cont"] }, args: { kind: "record", fields: {} } } }, maxLen: 1 },
        origin: "system",
        scope: { kind: "global" },
        initial: []
      },
      { id: "flag", domain: bool, origin: "system", scope: { kind: "global" }, initial: false },
      { id: "mode", domain: { kind: "enum", values: ["a", "b"] }, origin: "system", scope: { kind: "global" }, initial: "a" }
    ],
    transitions: [
      {
        id: "toggle",
        cls: "user",
        label: { kind: "click", text: "Toggle" },
        source: [],
        guard: { kind: "not", args: [{ kind: "read", var: "flag" }] },
        effect: { kind: "assign", var: "flag", expr: { kind: "lit", value: true } },
        reads: ["flag"],
        writes: ["flag"],
        confidence: "exact"
      }
    ]
  };
}

describe("domains", () => {
  it("enumerates only values accepted by validation", () => {
    const domains: AbstractDomain[] = [
      bool,
      { kind: "enum", values: ["idle", "done"] },
      { kind: "boundedInt", min: 1, max: 3 },
      { kind: "option", inner: { kind: "enum", values: ["x"] } },
      { kind: "record", fields: { a: bool, b: { kind: "enum", values: ["x", "y"] } } },
      { kind: "tagged", tag: "kind", variants: { guest: { kind: "record", fields: {} }, user: { kind: "record", fields: { id: { kind: "tokens", count: 2 } } } } },
      { kind: "tokens", count: 2 },
      { kind: "lengthCat" },
      { kind: "boundedList", inner: bool, maxLen: 2 }
    ];
    for (const domain of domains) {
      const values = enumerateDomain(domain);
      expect(values.length).toBeGreaterThan(0);
      expect(values.every((value) => validateValue(domain, value))).toBe(true);
    }
  });

  it("canonicalizes JSON and token names deterministically", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    const model = baseModel();
    const left = { "sys:route": "/", "sys:history": [], "sys:pending": [], flag: false, mode: "tok2" };
    const right = { "sys:route": "/", "sys:history": [], "sys:pending": [], flag: false, mode: "tok1" };
    expect(canonicalState(model, left)).toBe(canonicalState(model, right));
  });
});

describe("validator", () => {
  it("accepts a well-formed model", () => {
    expect(validateModel(baseModel())).toEqual({ ok: true, errors: [] });
  });

  it("rejects duplicate ids and invalid initials", () => {
    const model = baseModel();
    const broken: Model = {
      ...model,
      vars: [...model.vars, { ...model.vars[3]!, id: "flag", initial: "not-bool" }]
    };
    const result = validateModel(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("Duplicate state var id flag");
    expect(result.errors.join("\n")).toContain("invalid initial");
  });

  it("rejects undeclared guard and effect reads", () => {
    const model = baseModel();
    const broken: Model = {
      ...model,
      transitions: [
        {
          ...model.transitions[0]!,
          reads: [],
          effect: { kind: "assign", var: "flag", expr: { kind: "read", var: "mode" } }
        }
      ]
    };
    const errors = validateModel(broken).errors.join("\n");
    expect(errors).toContain("guard reads flag");
    expect(errors).toContain("effect reads mode");
  });

  it("rejects undeclared writes and unknown vars", () => {
    const model = baseModel();
    const broken: Model = {
      ...model,
      transitions: [{ ...model.transitions[0]!, writes: ["missing"] }]
    };
    const errors = validateModel(broken).errors.join("\n");
    expect(errors).toContain("unknown var missing");
    expect(errors).toContain("effect writes flag");
  });

  it("rejects invalid structured write values and targets", () => {
    const model = baseModel();
    const badLiteral: Model = {
      ...model,
      transitions: [
        {
          ...model.transitions[0]!,
          effect: { kind: "assign", var: "flag", expr: { kind: "lit", value: "yes" } }
        }
      ]
    };
    expect(validateModel(badLiteral).errors.join("\n")).toContain("invalid assignment to flag");

    const badHavoc: Model = {
      ...model,
      transitions: [
        {
          ...model.transitions[0]!,
          effect: { kind: "havoc", var: "missing" },
          writes: ["flag"]
        }
      ]
    };
    expect(validateModel(badHavoc).errors.join("\n")).toContain("havoc targets unknown var missing");
  });

  it("rejects malformed tagged domains", () => {
    const model = baseModel();
    const broken: Model = {
      ...model,
      vars: [
        ...model.vars,
        { id: "badTagged", domain: { kind: "tagged", tag: "kind", variants: { x: bool } }, origin: "system", scope: { kind: "global" }, initial: { kind: "x" } }
      ]
    };
    const result = validateModel(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("domain cannot enumerate");
  });
});
