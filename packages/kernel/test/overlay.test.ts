import { describe, expect, it } from "vitest";
import { applyOverlay, type Model } from "../src/index.js";

const model: Model = {
  schemaVersion: 1,
  id: "overlay-fixture",
  bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
  vars: [
    { id: "flag", domain: { kind: "bool" }, origin: "system", scope: { kind: "global" }, initial: false },
    { id: "debug", domain: { kind: "bool" }, origin: "system", scope: { kind: "global" }, initial: false }
  ],
  transitions: [
    {
      id: "toggle",
      cls: "user",
      label: { kind: "click", text: "Toggle" },
      source: [],
      guard: { kind: "lit", value: true },
      effect: { kind: "assign", var: "flag", expr: { kind: "lit", value: true } },
      reads: [],
      writes: ["flag"],
      confidence: "exact"
    },
    {
      id: "debugToggle",
      cls: "user",
      label: { kind: "click", text: "Debug" },
      source: [],
      guard: { kind: "lit", value: true },
      effect: { kind: "assign", var: "debug", expr: { kind: "lit", value: true } },
      reads: [],
      writes: ["debug"],
      confidence: "exact"
    }
  ]
};

describe("applyOverlay", () => {
  it("overrides matching transitions as manual and warns on exact overrides", () => {
    const replacement = { ...model.transitions[0]!, effect: { kind: "assign" as const, var: "flag", expr: { kind: "lit" as const, value: false } } };
    const result = applyOverlay(model, { transitions: [replacement] });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(["Overlay overrides exact transition toggle"]);
    expect(result.model.transitions[0]).toMatchObject({ id: "toggle", confidence: "manual", effect: replacement.effect });
  });

  it("removes ignored vars and dependent transitions", () => {
    const result = applyOverlay(model, { ignoreVars: ["debug"] });
    expect(result.errors).toEqual([]);
    expect(result.model.vars.map((decl) => decl.id)).toEqual(["flag"]);
    expect(result.model.transitions.map((transition) => transition.id)).toEqual(["toggle"]);
  });

  it("applies domain refinements and marks their provenance", () => {
    const result = applyOverlay(model, {
      domains: [{ var: "debug", domain: { kind: "enum", values: ["off", "on"] }, initial: "off" }]
    });
    expect(result.errors).toEqual([]);
    expect(result.model.vars.find((decl) => decl.id === "debug")).toMatchObject({
      domain: { kind: "enum", values: ["off", "on"] },
      initial: "off"
    });
    expect(result.model.metadata?.domainProvenance).toEqual({ debug: "overlay-refined" });
  });

  it("reports orphan overlay entries as errors", () => {
    const result = applyOverlay(model, {
      transitions: [{ ...model.transitions[0]!, id: "missing" }],
      ignoreVars: ["alsoMissing"],
      domains: [{ var: "domainMissing", domain: { kind: "bool" } }]
    });
    expect(result.errors).toEqual([
      "Overlay transition missing does not match an extracted transition",
      "Overlay domain domainMissing does not match a state variable",
      "Overlay ignoreVar alsoMissing does not match a state variable"
    ]);
    expect(result.model).toBe(model);
  });
});
