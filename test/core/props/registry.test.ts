import { describe, expect, it } from "vitest";
import {
  enabled,
  eq,
  finalizeProperties,
  group,
  harvest,
  reachable,
  resetRegistry,
  type Model,
} from "modality-ts/core";

const model: Model = {
  schemaVersion: 1,
  id: "registry-fixture",
  bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
  vars: [
    {
      id: "flag",
      domain: { kind: "bool" },
      origin: "system",
      scope: { kind: "global" },
      initial: false,
    },
    {
      id: "mode",
      domain: { kind: "enum", values: ["a", "b"] },
      origin: "system",
      scope: { kind: "global" },
      initial: "a",
    },
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
      confidence: "exact",
    },
  ],
};

describe("property registry", () => {
  it("isolates reset/harvest cycles", () => {
    resetRegistry();
    reachable("one", eq("flag", true));
    expect(harvest()).toHaveLength(1);
    expect(harvest()).toEqual([]);
  });

  it("prefixes grouped property names", () => {
    resetRegistry();
    group("cart", () => {
      reachable("withinCapacity", eq("mode", "a"));
    });
    const [property] = finalizeProperties(model, harvest());
    expect(property?.name).toBe("cart > withinCapacity");
  });

  it("finalizes reads and enabled transitions", () => {
    resetRegistry();
    reachable("toggleEnabled", enabled("toggle"));
    const [property] = finalizeProperties(model, harvest());
    expect(property?.reads).toEqual([]);
    expect(property?.enabledTransitions).toEqual(["toggle"]);
  });
});
