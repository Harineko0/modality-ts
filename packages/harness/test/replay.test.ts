import { describe, expect, it } from "vitest";
import type { Trace } from "@modality/kernel";
import { ActionReplayDriver, dispatchReplayStep, replayTrace, StateSequenceDriver } from "../src/index.js";

const trace: Trace = {
  steps: [
    {
      transitionId: "login",
      label: { kind: "click", text: "Login" },
      pre: { auth: "guest" },
      post: { auth: "user" },
      diff: { auth: { before: "guest", after: "user" } }
    },
    {
      transitionId: "submit",
      label: { kind: "submit", text: "Submit" },
      pre: { auth: "user" },
      post: { auth: "user", pending: 1 },
      diff: { pending: { before: undefined, after: 1 } }
    }
  ]
};

describe("replayTrace", () => {
  it("classifies reproduced traces when every step matches", async () => {
    const verdict = await replayTrace(trace, new StateSequenceDriver([{ auth: "guest" }, { auth: "user" }, { auth: "user", pending: 1 }]));
    expect(verdict).toEqual({ status: "reproduced", stepsRun: 2 });
  });

  it("reports the first postcondition divergence step", async () => {
    const verdict = await replayTrace(trace, new StateSequenceDriver([{ auth: "guest" }, { auth: "user" }, { auth: "user", pending: 0 }]));
    expect(verdict).toEqual({
      status: "not-reproduced",
      stepsRun: 2,
      divergenceStep: 2,
      reason: "postcondition mismatch: pending: expected 1, got 0"
    });
  });

  it("reports precondition divergence before applying a step", async () => {
    const verdict = await replayTrace(trace, new StateSequenceDriver([{ auth: "user" }]));
    expect(verdict).toEqual({
      status: "not-reproduced",
      stepsRun: 0,
      divergenceStep: 1,
      reason: 'precondition mismatch: auth: expected "guest", got "user"'
    });
  });

  it("classifies driver failures as inconclusive", async () => {
    const verdict = await replayTrace(trace, new StateSequenceDriver([{ auth: "guest" }, { auth: "user" }], 1));
    expect(verdict).toEqual({ status: "inconclusive", stepsRun: 0, reason: "driver failed at step 1" });
  });

  it("dispatches event labels to a concrete replay actor", async () => {
    const calls: string[] = [];
    await dispatchReplayStep({
      transitionId: "edit",
      label: { kind: "input", locator: { kind: "testId", value: "draft" }, valueClass: "nonEmpty" },
      pre: {},
      post: {},
      diff: {}
    }, {
      input: (locator, value, valueClass) => calls.push(`input:${locator.kind}:${value}:${valueClass}`),
      stabilize: () => calls.push("stabilize")
    }, { inputValues: { nonEmpty: "Buy milk" } });
    expect(calls).toEqual(["input:testId:Buy milk:nonEmpty", "stabilize"]);
  });

  it("classifies missing concrete locators as inconclusive", async () => {
    const actionTrace: Trace = {
      steps: [{
        transitionId: "save",
        label: { kind: "click" },
        pre: { draft: "nonEmpty" },
        post: { draft: "nonEmpty", status: "posting" },
        diff: { status: { before: undefined, after: "posting" } }
      }]
    };
    let state = { draft: "nonEmpty" };
    const verdict = await replayTrace(actionTrace, new ActionReplayDriver({}, () => state));
    expect(verdict).toEqual({ status: "inconclusive", stepsRun: 0, reason: "Missing locator for click step save" });
  });
});
