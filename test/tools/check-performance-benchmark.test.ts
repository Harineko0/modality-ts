import { sliceModelForCheckProperty } from "modality-ts/check";
import { describe, expect, it } from "vitest";
import { compareModelEconomics } from "../../src/check/slicing/contributors.js";
import { runCheckPerformanceBenchmark } from "../../tools/check-performance-benchmark.js";
import {
  COFFEE_SHAPED_DENSITY_ONE_PROPERTY,
  coffeeShapedDensityOnePropertyInferred,
  coffeeShapedPerformanceModel,
} from "../../tools/perf/coffee-shaped-fixture.js";

describe("check-performance-benchmark", () => {
  it("emits stable structural fields for the coffee-shaped fixture", () => {
    const result = runCheckPerformanceBenchmark("coffee-shaped");
    expect(result.fixture).toBe("coffee-shaped");
    expect(result.properties).toContain(COFFEE_SHAPED_DENSITY_ONE_PROPERTY);
    expect(result.fullVars).toBeGreaterThan(0);
    expect(result.fullTransitions).toBeGreaterThan(0);
    expect(result.fullStateSpaceBits).toBeGreaterThan(0);
    expect(result.propertySlices.length).toBe(result.properties.length);
    const motivating = result.propertySlices.find(
      (entry) => entry.property === COFFEE_SHAPED_DENSITY_ONE_PROPERTY,
    );
    expect(motivating?.status).toBe("emitted");
    expect(motivating?.fullVars).toBe(result.fullVars);
    expect(motivating?.fullTransitions).toBe(result.fullTransitions);
    expect(motivating?.vars).toBeGreaterThan(0);
    expect(motivating?.retainedBits).toBeGreaterThanOrEqual(0);
    expect(motivating?.prunedBits).toBeGreaterThanOrEqual(0);
    expect(motivating?.topRetainedContributors?.length).toBeGreaterThan(0);
    expect(result.motivatingProperty).toBe(COFFEE_SHAPED_DENSITY_ONE_PROPERTY);
    expect(result.motivatingPropertySlice?.property).toBe(
      COFFEE_SHAPED_DENSITY_ONE_PROPERTY,
    );
    expect(result.unsliced.states).toBeGreaterThan(0);
    expect(result.sliced.states).toBeGreaterThan(0);
    expect(result.unsliced.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.sliced.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.slicePlanningTotalElapsedMs).toBeGreaterThanOrEqual(0);
    if (result.speedup !== undefined) {
      expect(result.speedup).toBeGreaterThan(0);
    }
  });

  it("infers narrow enabled reads and slice economics for densityOne", () => {
    const model = coffeeShapedPerformanceModel();
    const property = coffeeShapedDensityOnePropertyInferred(model);
    expect(property.reads).toEqual(["printerStatus", "sys:route"]);
    expect(property.enabledTransitions).toEqual(["setDensity1"]);

    const { model: sliced } = sliceModelForCheckProperty(model, property);
    expect(sliced.vars.map((decl) => decl.id).sort()).toEqual([
      "printerStatus",
      "sys:route",
    ]);
    expect(sliced.transitions.map((transition) => transition.id)).toEqual([
      "setDensity1",
    ]);
    expect(sliced.vars.length).toBe(2);
    expect(sliced.transitions.length).toBe(1);

    const economics = compareModelEconomics(model, sliced);
    const prunedVarIds = economics.prunedTopContributors.map(
      (entry) => entry.varId,
    );
    expect(prunedVarIds).toEqual(
      expect.arrayContaining(["orderHistoryPayload", "printerStatusData"]),
    );
  });
});
