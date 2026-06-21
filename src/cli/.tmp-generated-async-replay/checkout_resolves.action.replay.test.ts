/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { createDomReplayActor, ObservableActionReplayDriver, replayTrace } from "modality-ts/cli/harness";
import type { ModalityReplayHarness, ObservationSource } from "modality-ts/cli/harness";
import { observeModalityReplay, renderModalityReplay } from "./modality.replay.harness.js";

const trace = {"steps":[{"diff":{"status":{"after":"submitting","before":"idle"}},"label":{"kind":"submit","locator":{"kind":"testId","value":"checkout"}},"post":{"status":"submitting"},"pre":{"status":"idle"},"transitionId":"submit"},{"diff":{"status":{"after":"done","before":"submitting"}},"label":{"kind":"resolve","op":"api.submitOrder","outcome":"success"},"post":{"status":"done"},"pre":{"status":"submitting"},"transitionId":"submit.resolve"}]};
const observedVars = [...new Set(trace.steps.flatMap((step) => [...Object.keys(step.pre), ...Object.keys(step.post)]))];

describe("replay checkout resolves", () => {
  it("drives the app through the model trace", async () => {
    const replayHarness: ModalityReplayHarness = await renderModalityReplay(trace);
    const observationSources: ObservationSource[] = [observeModalityReplay(replayHarness), ...(replayHarness.sources ?? [])];
    const replayOptions = {
      inputValues: replayHarness.inputValues,
      assertViolation: replayHarness.assertViolation,
      beforeStep: replayHarness.beforeStep,
      afterStep: replayHarness.afterStep
    };
    const actor = createDomReplayActor({
      document: replayHarness.document,
      navigate: replayHarness.navigate,
      resolve: replayHarness.resolve,
      focusRevalidate: replayHarness.focusRevalidate,
      timer: replayHarness.timer,
      stabilize: replayHarness.stabilize
    });
    const verdict = await replayTrace(trace, new ObservableActionReplayDriver(actor, replayHarness.observedVars ?? observedVars, observationSources, replayOptions));
    expect(verdict.status).toBe("reproduced");
  });
});
