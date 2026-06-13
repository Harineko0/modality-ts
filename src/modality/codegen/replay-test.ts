import { canonicalJson, type Trace } from "modality-ts/kernel";

export interface ReplayTestArtifact {
  fileName: string;
  source: string;
}

export function generateAbstractReplayTest(property: string, trace: Trace): ReplayTestArtifact {
  const safeName = safeFileName(property);
  return {
    fileName: `${safeName}.replay.test.ts`,
    source: [
      `import { describe, expect, it } from "vitest";`,
      `import { replayTrace, StateSequenceDriver, statesFromTrace } from "modality-ts/harness";`,
      ``,
      `const trace = ${canonicalJson(trace)};`,
      ``,
      `describe(${JSON.stringify(`replay ${property}`)}, () => {`,
      `  it("reproduces the model trace", async () => {`,
      `    const verdict = await replayTrace(trace, new StateSequenceDriver(statesFromTrace(trace)));`,
      `    expect(verdict.status).toBe("reproduced");`,
      `  });`,
      `});`,
      ``
    ].join("\n")
  };
}

export function generateActionReplayTest(property: string, trace: Trace): ReplayTestArtifact {
  const safeName = safeFileName(property);
  return {
    fileName: `${safeName}.action.replay.test.ts`,
    source: [
      `/**`,
      ` * @vitest-environment jsdom`,
      ` */`,
      `import { describe, expect, it } from "vitest";`,
      `import { createDomReplayActor, ObservableActionReplayDriver, replayTrace } from "modality-ts/harness";`,
      `import type { ModalityReplayHarness, ObservationSource } from "modality-ts/harness";`,
      `import { observeModalityReplay, renderModalityReplay } from "./modality.replay.harness.js";`,
      ``,
      `const trace = ${canonicalJson(trace)};`,
      `const observedVars = [...new Set(trace.steps.flatMap((step) => [...Object.keys(step.pre), ...Object.keys(step.post)]))];`,
      ``,
      `describe(${JSON.stringify(`replay ${property}`)}, () => {`,
      `  it("drives the app through the model trace", async () => {`,
      `    const replayHarness: ModalityReplayHarness = await renderModalityReplay(trace);`,
      `    const observationSources: ObservationSource[] = [observeModalityReplay(replayHarness), ...(replayHarness.sources ?? [])];`,
      `    const replayOptions = {`,
      `      inputValues: replayHarness.inputValues,`,
      `      assertViolation: replayHarness.assertViolation,`,
      `      beforeStep: replayHarness.beforeStep,`,
      `      afterStep: replayHarness.afterStep`,
      `    };`,
      `    const actor = createDomReplayActor({`,
      `      document: replayHarness.document,`,
      `      navigate: replayHarness.navigate,`,
      `      resolve: replayHarness.resolve,`,
      `      focusRevalidate: replayHarness.focusRevalidate,`,
      `      timer: replayHarness.timer,`,
      `      stabilize: replayHarness.stabilize`,
      `    });`,
      `    const verdict = await replayTrace(trace, new ObservableActionReplayDriver(actor, replayHarness.observedVars ?? observedVars, observationSources, replayOptions));`,
      `    expect(verdict.status).toBe("reproduced");`,
      `  });`,
      `});`,
      ``
    ].join("\n")
  };
}

export function generateReplayHarness(): ReplayTestArtifact {
  return {
    fileName: "modality.replay.harness.ts",
    source: [
      `import { createDeterministicReplayAsyncController, observationSource, type DeterministicReplayAsyncController, type ModalityReplayHarness, type ObservationSource } from "modality-ts/harness";`,
      `import type { Trace } from "modality-ts/kernel";`,
      ``,
      `declare global {`,
      `  var __modalityRenderReplayApp: ((trace: Trace, replayAsync: DeterministicReplayAsyncController) => Partial<ModalityReplayHarness> | Promise<Partial<ModalityReplayHarness>>) | undefined;`,
      `}`,
      ``,
      `export async function renderModalityReplay(trace: Trace): Promise<ModalityReplayHarness> {`,
      `  const replayAsync = createDeterministicReplayAsyncController();`,
      `  const appHarness = await globalThis.__modalityRenderReplayApp?.(trace, replayAsync);`,
      `  return {`,
      `    document: globalThis.document,`,
      `    resolve: replayAsync.resolve,`,
      `    stabilize: async () => Promise.resolve(),`,
      `    ...(appHarness ?? {})`,
      `  };`,
      `}`,
      ``,
      `export function observeModalityReplay(_harness: ModalityReplayHarness): ObservationSource {`,
      `  return observationSource("dom-projection", (varId) => {`,
      `    const element = globalThis.document?.querySelector(\`[data-modality-var="\${cssString(varId)}"]\`);`,
      `    if (!element) return "unobservable";`,
      `    return { value: parseObservedValue(element.textContent ?? "") };`,
      `  });`,
      `}`,
      ``,
      `function parseObservedValue(text: string): unknown {`,
      `  try {`,
      `    return JSON.parse(text);`,
      `  } catch {`,
      `    return text;`,
      `  }`,
      `}`,
      ``,
      `function cssString(value: string): string {`,
      `  return value.replace(/["\\\\]/g, "\\\\$&");`,
      `}`,
      ``
    ].join("\n")
  };
}

export function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
