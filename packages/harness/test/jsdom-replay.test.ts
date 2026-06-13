/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Trace } from "modality-ts/kernel";
import { createDomReplayActor, ObservableActionReplayDriver, observationSource, replayTrace } from "../src/index.js";

describe("jsdom replay", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("reproduces a concrete DOM trace through observable state", async () => {
    const state = renderCheckoutFixture();
    const trace = checkoutTrace({
      afterSubmit: "submitting",
      afterResolve: "done"
    });

    const verdict = await replayTrace(trace, new ObservableActionReplayDriver(
      createDomReplayActor({
        resolve: async (op, outcome) => {
          expect(`${op}:${outcome}`).toBe("api.submitOrder:success");
          state.status = "done";
          state.paint();
        },
        stabilize: async () => Promise.resolve()
      }),
      ["local:Checkout.status"],
      [observationSource("checkout-dom", (varId) => varId === "local:Checkout.status" ? { value: state.status } : "unobservable")]
    ));

    expect(verdict).toEqual({ status: "reproduced", stepsRun: 2 });
    expect(document.querySelector("[data-testid=\"status\"]")?.textContent).toBe("done");
  });

  it("reports the exact divergence step for a wrong model post-state", async () => {
    const state = renderCheckoutFixture();
    const wrongTrace = checkoutTrace({
      afterSubmit: "done",
      afterResolve: "done"
    });

    const verdict = await replayTrace(wrongTrace, new ObservableActionReplayDriver(
      createDomReplayActor({
        resolve: () => {
          state.status = "done";
          state.paint();
        }
      }),
      ["local:Checkout.status"],
      [observationSource("checkout-dom", (varId) => varId === "local:Checkout.status" ? { value: state.status } : "unobservable")]
    ));

    expect(verdict).toEqual({
      status: "not-reproduced",
      stepsRun: 1,
      divergenceStep: 1,
      reason: 'postcondition mismatch: local:Checkout.status: expected "done", got "submitting"'
    });
  });
});

function renderCheckoutFixture(): { status: string; paint: () => void } {
  const state = {
    status: "idle",
    paint: () => {
      status.textContent = state.status;
      submit.disabled = state.status === "submitting";
    }
  };
  const form = document.createElement("form");
  form.dataset.testid = "checkout";
  const status = document.createElement("output");
  status.dataset.testid = "status";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Submit";
  form.append(status, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    state.status = "submitting";
    state.paint();
  });
  document.body.append(form);
  state.paint();
  return state;
}

function checkoutTrace(states: { afterSubmit: string; afterResolve: string }): Trace {
  return {
    steps: [
      {
        transitionId: "Checkout.onSubmit.api.submitOrder.start",
        label: { kind: "submit", locator: { kind: "testId", value: "checkout" } },
        pre: { "local:Checkout.status": "idle" },
        post: { "local:Checkout.status": states.afterSubmit },
        diff: { "local:Checkout.status": { before: "idle", after: states.afterSubmit } }
      },
      {
        transitionId: "Checkout.onSubmit.api.submitOrder.cont.success",
        label: { kind: "resolve", op: "api.submitOrder", outcome: "success" },
        pre: { "local:Checkout.status": states.afterSubmit },
        post: { "local:Checkout.status": states.afterResolve },
        diff: { "local:Checkout.status": { before: states.afterSubmit, after: states.afterResolve } }
      }
    ]
  };
}
