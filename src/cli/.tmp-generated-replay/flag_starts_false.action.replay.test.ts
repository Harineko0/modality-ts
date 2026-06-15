/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  createDomReplayActor,
  ObservableActionReplayDriver,
  replayTrace,
} from "modality-ts/cli/harness";
import type {
  ModalityReplayHarness,
  ObservationSource,
} from "modality-ts/cli/harness";
import {
  observeModalityReplay,
  renderModalityReplay,
} from "./modality.replay.harness.js";

const trace = {
  steps: [
    {
      diff: { flag: { after: true, before: false } },
      label: { kind: "click", locator: { kind: "testId", value: "set-flag" } },
      post: { flag: true },
      pre: { flag: false },
      transitionId: "setFlag",
    },
  ],
};
const observedVars = [
  ...new Set(
    trace.steps.flatMap((step) => [
      ...Object.keys(step.pre),
      ...Object.keys(step.post),
    ]),
  ),
];

describe("replay flag starts false", () => {
  it("drives the app through the model trace", async () => {
    const replayHarness: ModalityReplayHarness =
      await renderModalityReplay(trace);
    const observationSources: ObservationSource[] = [
      observeModalityReplay(replayHarness),
      ...(replayHarness.sources ?? []),
    ];
    const replayOptions = {
      inputValues: replayHarness.inputValues,
      assertViolation: replayHarness.assertViolation,
      beforeStep: replayHarness.beforeStep,
      afterStep: replayHarness.afterStep,
    };
    const actor = createDomReplayActor({
      document: replayHarness.document,
      navigate: replayHarness.navigate,
      resolve: replayHarness.resolve,
      focusRevalidate: replayHarness.focusRevalidate,
      timer: replayHarness.timer,
      stabilize: replayHarness.stabilize,
    });
    const verdict = await replayTrace(
      trace,
      new ObservableActionReplayDriver(
        actor,
        replayHarness.observedVars ?? observedVars,
        observationSources,
        replayOptions,
      ),
    );
    expect(verdict.status).toBe("reproduced");
  });
});
