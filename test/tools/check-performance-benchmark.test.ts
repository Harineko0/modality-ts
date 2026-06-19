import { describe, expect, it } from "vitest";
import { runCheckPerformanceBenchmark } from "../../tools/check-performance-benchmark.js";
import { COFFEE_SHAPED_DENSITY_ONE_PROPERTY } from "../../tools/perf/coffee-shaped-fixture.js";

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
});
