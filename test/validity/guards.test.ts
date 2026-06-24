import { describe, expect, it } from "vitest";
import {
  hasNoConformanceSignal,
  hasNoMetamorphicSignal,
  hasNoMutationSignal,
} from "../../tools/validity/guards.js";

describe("validity no-signal guards", () => {
  it("detects conformance runs with walks but no reproduced or not-reproduced outcomes", () => {
    expect(
      hasNoConformanceSignal({
        total: 3,
        reproduced: 0,
        notReproduced: 0,
      }),
    ).toBe(true);
    expect(
      hasNoConformanceSignal({
        total: 3,
        reproduced: 1,
        notReproduced: 0,
      }),
    ).toBe(false);
    expect(
      hasNoConformanceSignal({
        total: 0,
        reproduced: 0,
        notReproduced: 0,
      }),
    ).toBe(false);
  });

  it("detects mutation runs with mutants but no killed or preserved outcomes", () => {
    expect(
      hasNoMutationSignal({
        mutantsTotal: 4,
        killed: 0,
        preserved: 0,
      }),
    ).toBe(true);
    expect(
      hasNoMutationSignal({
        mutantsTotal: 4,
        killed: 0,
        preserved: 1,
      }),
    ).toBe(false);
    expect(
      hasNoMutationSignal({
        mutantsTotal: 0,
        killed: 0,
        preserved: 0,
      }),
    ).toBe(false);
  });

  it("detects metamorphic runs with variants but no stable or divergent outcomes", () => {
    expect(
      hasNoMetamorphicSignal({
        variantsTotal: 2,
        stable: 0,
        divergent: 0,
      }),
    ).toBe(true);
    expect(
      hasNoMetamorphicSignal({
        variantsTotal: 2,
        stable: 0,
        divergent: 1,
      }),
    ).toBe(false);
    expect(
      hasNoMetamorphicSignal({
        variantsTotal: 0,
        stable: 0,
        divergent: 0,
      }),
    ).toBe(false);
  });
});
