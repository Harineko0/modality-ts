import { canonicalJson, type ModelState, type Trace } from "@modality/kernel";

export interface ReplayTestArtifact {
  fileName: string;
  source: string;
}

export function generateAbstractReplayTest(property: string, trace: Trace, states: readonly ModelState[]): ReplayTestArtifact {
  const safeName = safeFileName(property);
  return {
    fileName: `${safeName}.replay.test.ts`,
    source: [
      `import { describe, expect, it } from "vitest";`,
      `import { replayTrace, StateSequenceDriver } from "@modality/harness";`,
      ``,
      `const trace = ${canonicalJson(trace)};`,
      `const states = ${canonicalJson(states)};`,
      ``,
      `describe(${JSON.stringify(`replay ${property}`)}, () => {`,
      `  it("reproduces the model trace", async () => {`,
      `    const verdict = await replayTrace(trace, new StateSequenceDriver(states));`,
      `    expect(verdict.status).toBe("reproduced");`,
      `  });`,
      `});`,
      ``
    ].join("\n")
  };
}

export function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
