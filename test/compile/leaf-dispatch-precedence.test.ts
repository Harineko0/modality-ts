import {
  LEAF_PRECEDENCE,
  mergeLeafEffects,
  type LeafEffect,
  type RankedLeafEffect,
} from "modality-ts/extract/engine/spi";
import { describe, expect, it } from "vitest";

describe("leaf dispatch precedence", () => {
  const frameworkEffect: LeafEffect = {
    effect: { kind: "assign", var: "local:C.X", expr: { kind: "lit", value: 1 } },
  };
  const stateEffect: LeafEffect = {
    effect: { kind: "assign", var: "local:C.X", expr: { kind: "lit", value: 2 } },
  };

  it("picks declared precedence regardless of registration order", () => {
    const claimsA: RankedLeafEffect[] = [
      { precedence: "state-write", pluginId: "zustand", leaf: stateEffect },
      { precedence: "framework-hook", pluginId: "react", leaf: frameworkEffect },
    ];
    const claimsB: RankedLeafEffect[] = [...claimsA].reverse();
    expect(mergeLeafEffects(claimsA)?.effect).toEqual(frameworkEffect.effect);
    expect(mergeLeafEffects(claimsB)?.effect).toEqual(frameworkEffect.effect);
  });

  it("surfaces conflicting IR as a caveat instead of silently picking", () => {
    const merged = mergeLeafEffects([
      { precedence: "framework-hook", pluginId: "react", leaf: frameworkEffect },
      {
        precedence: "framework-hook",
        pluginId: "alt-react",
        leaf: stateEffect,
      },
    ]);
    expect(merged?.effect).toEqual(stateEffect.effect);
    expect(merged?.caveats?.[0]?.kind).toBe("model-slack");
    expect(merged?.caveats?.[0]?.reason).toContain("Conflicting leaf interpretations");
  });

  it("declares a total precedence order", () => {
    expect(LEAF_PRECEDENCE).toEqual([
      "framework-hook",
      "state-write",
      "navigation",
      "effect-model",
      "default",
    ]);
  });
});
