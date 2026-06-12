import { describe, expect, it } from "vitest";
import { parseModelArtifact, parseTraceArtifact } from "../src/index.js";

describe("artifact parsers", () => {
  it("accepts minimal valid model and trace artifacts", () => {
    expect(parseModelArtifact(JSON.stringify({ schemaVersion: 1, id: "m", vars: [], transitions: [], bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 1 } })).id).toBe("m");
    expect(parseTraceArtifact(JSON.stringify({ steps: [{ transitionId: "t", label: { kind: "click" }, pre: {}, post: {}, diff: {} }] }))).toMatchObject({
      steps: [{ transitionId: "t" }]
    });
  });

  it("rejects newer model schemas and malformed traces", () => {
    expect(() => parseModelArtifact(JSON.stringify({ schemaVersion: 2, id: "m", vars: [], transitions: [], bounds: {} }))).toThrow("unsupported model schemaVersion 2");
    expect(() => parseTraceArtifact(JSON.stringify({ steps: [{ transitionId: "t", pre: {} }] }))).toThrow("trace step 1 is malformed");
  });
});
