import { describe, expect, it } from "vitest";
import type { Trace } from "modality-ts/kernel";
import { ActionReplayDriver, createDomReplayActor, dispatchReplayStep, inputWitness, ObservableActionReplayDriver, observationSource, observeModelState, replayTrace, StateSequenceDriver, statesFromTrace, TraceBackedActionReplayDriver, witnessValue } from "modality-ts/harness";
import * as jotaiHarness from "../../src/sources/jotai/harness.js";
import * as routerHarness from "../../src/sources/router/harness.js";
import * as swrHarness from "../../src/sources/swr/harness.js";
import * as useStateHarness from "../../src/sources/use-state/harness.js";

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
  it("derives replay state sequences from trace pre/post states", () => {
    expect(statesFromTrace(trace)).toEqual([{ auth: "guest" }, { auth: "user" }, { auth: "user", pending: 1 }]);
    expect(statesFromTrace({ steps: [] })).toEqual([{}]);
  });

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

  it("can replay actions while using trace states as the observation oracle", async () => {
    const calls: string[] = [];
    const actionTrace: Trace = {
      steps: [
        { ...trace.steps[0]!, label: { kind: "click", locator: { kind: "role", role: "button", name: "Login" } } },
        { ...trace.steps[1]!, label: { kind: "submit", locator: { kind: "testId", value: "checkout" } } }
      ]
    };
    const verdict = await replayTrace(actionTrace, new TraceBackedActionReplayDriver(actionTrace, {
      click: (locator) => calls.push(`click:${locator.kind}`),
      submit: (locator) => calls.push(`submit:${locator.kind}`),
      stabilize: () => calls.push("stabilize")
    }));
    expect(verdict).toEqual({ status: "reproduced", stepsRun: 2 });
    expect(calls).toEqual(["click:role", "stabilize", "submit:testId", "stabilize"]);
  });

  it("combines observable source projections into a model state", () => {
    const observed = observeModelState(["auth", "route", "missing"], [
      observationSource("atoms", (varId) => varId === "auth" ? { value: "user" } : "unobservable"),
      observationSource("router", (varId) => varId === "route" ? { value: "/admin" } : "unobservable")
    ]);

    expect(observed).toEqual({
      state: { auth: "user", route: "/admin" },
      unobservable: ["missing"]
    });
  });

  it("adapts source package harness observations into one model state", () => {
    const atom = {};
    const jotai = jotaiHarness.setup({
      atoms: { "atom:authAtom": atom },
      store: { get: () => "user" }
    });
    const router = routerHarness.setup({ initialState: { "sys:route": "/admin", "sys:history": ["/"] } });
    const swr = swrHarness.setup({ cache: new Map([["api_user", { id: "u1" }]]) });
    const useState = useStateHarness.setup({ probes: { "local:App.status": () => "saving" } });

    expect(observeModelState(["atom:authAtom", "sys:route", "swr:api_user:data", "local:App.status"], [
      observationSource("jotai", (varId) => jotaiHarness.observe(varId, jotai)),
      observationSource("router", (varId) => routerHarness.observe(router, varId)),
      observationSource("swr", (varId) => swrHarness.observe(varId, swr)),
      observationSource("use-state", (varId) => useStateHarness.observe(varId, useState))
    ])).toEqual({
      state: {
        "atom:authAtom": "user",
        "sys:route": "/admin",
        "swr:api_user:data": { id: "u1" },
        "local:App.status": "saving"
      },
      unobservable: []
    });
  });

  it("can replay actions against observable source state", async () => {
    let auth = "guest";
    const actionTrace: Trace = {
      steps: [{
        transitionId: "login",
        label: { kind: "click", locator: { kind: "role", role: "button", name: "Login" } },
        pre: { auth: "guest" },
        post: { auth: "user" },
        diff: { auth: { before: "guest", after: "user" } }
      }]
    };
    const verdict = await replayTrace(actionTrace, new ObservableActionReplayDriver({
      click: () => {
        auth = "user";
      }
    }, ["auth"], [
      observationSource("auth", (varId) => varId === "auth" ? { value: auth } : "unobservable")
    ]));

    expect(verdict).toEqual({ status: "reproduced", stepsRun: 1 });
  });

  it("can replay actions through a DOM actor against observable state", async () => {
    let auth = "guest";
    const login = new FakeElement("button", { textContent: "Login", click: () => { auth = "user"; } });
    const doc = new FakeDocument([login]);
    const actionTrace: Trace = {
      steps: [{
        transitionId: "login",
        label: { kind: "click", locator: { kind: "role", role: "button", name: "Login" } },
        pre: { auth: "guest" },
        post: { auth: "user" },
        diff: { auth: { before: "guest", after: "user" } }
      }]
    };

    const verdict = await replayTrace(actionTrace, new ObservableActionReplayDriver(
      createDomReplayActor({ document: doc as unknown as Document }),
      ["auth"],
      [observationSource("auth", (varId) => varId === "auth" ? { value: auth } : "unobservable")]
    ));

    expect(verdict).toEqual({ status: "reproduced", stepsRun: 1 });
  });

  it("sets DOM input witnesses and rejects disabled DOM targets", async () => {
    const input = new FakeElement("input", { attrs: { "data-testid": "draft" } });
    const disabled = new FakeElement("button", { textContent: "Save", disabled: true });
    const actor = createDomReplayActor({ document: new FakeDocument([input, disabled]) as unknown as Document });

    await dispatchReplayStep({
      transitionId: "edit",
      label: { kind: "input", locator: { kind: "testId", value: "draft" }, valueClass: "nonEmpty" },
      pre: {},
      post: {},
      diff: {}
    }, actor);
    expect(input.value).toBe("modality");
    expect(input.events).toEqual(["input", "change"]);

    await expect(dispatchReplayStep({
      transitionId: "save",
      label: { kind: "click", locator: { kind: "role", role: "button", name: "Save" } },
      pre: {},
      post: {},
      diff: {}
    }, actor)).rejects.toThrow("Element is disabled");
  });

  it("classifies missing observable source state as inconclusive", async () => {
    const actionTrace: Trace = {
      steps: [{
        transitionId: "login",
        label: { kind: "click", locator: { kind: "role", role: "button", name: "Login" } },
        pre: { auth: "guest" },
        post: { auth: "user" },
        diff: { auth: { before: "guest", after: "user" } }
      }]
    };
    const verdict = await replayTrace(actionTrace, new ObservableActionReplayDriver({}, ["auth"], []));

    expect(verdict).toEqual({
      status: "inconclusive",
      stepsRun: 0,
      reason: "Unobservable model vars: auth"
    });
  });

  it("classifies post-step observation loss as inconclusive at the applied step", async () => {
    let auth: string | undefined = "guest";
    const actionTrace: Trace = {
      steps: [{
        transitionId: "login",
        label: { kind: "click", locator: { kind: "role", role: "button", name: "Login" } },
        pre: { auth: "guest" },
        post: { auth: "user" },
        diff: { auth: { before: "guest", after: "user" } }
      }]
    };
    const verdict = await replayTrace(actionTrace, new ObservableActionReplayDriver({
      click: () => {
        auth = undefined;
      }
    }, ["auth"], [
      observationSource("auth", (varId) => varId === "auth" && auth !== undefined ? { value: auth } : "unobservable")
    ]));

    expect(verdict).toEqual({
      status: "inconclusive",
      stepsRun: 1,
      reason: "Unobservable model vars: auth"
    });
  });

  it("uses default input witnesses when no override is supplied", async () => {
    const calls: string[] = [];
    await dispatchReplayStep({
      transitionId: "edit",
      label: { kind: "input", locator: { kind: "testId", value: "draft" }, valueClass: "empty|nonEmpty" },
      pre: {},
      post: {},
      diff: {}
    }, {
      input: (_locator, value, valueClass) => calls.push(`${value}:${valueClass}`)
    });
    expect(calls).toEqual(["modality:empty|nonEmpty"]);
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

  it("creates deterministic concrete witnesses for abstract domains", () => {
    expect(witnessValue({ kind: "lengthCat" }, "many")).toEqual(["item1", "item2", "item3"]);
    expect(witnessValue({ kind: "tokens", count: 2 }, "tok2", { tokenWitnesses: { tok2: { id: 2 } } })).toEqual({ id: 2 });
    expect(witnessValue({
      kind: "record",
      fields: {
        items: { kind: "lengthCat" },
        status: { kind: "enum", values: ["idle", "done"] }
      }
    }, { items: "1", status: "done" })).toEqual({ items: ["item1"], status: "done" });
    expect(witnessValue({
      kind: "tagged",
      tag: "kind",
      variants: {
        guest: { kind: "record", fields: {} },
        user: { kind: "record", fields: { name: { kind: "tokens", count: 1, names: ["u1"] } } }
      }
    }, { kind: "user", name: "u1" }, { tokenWitnesses: { u1: "Ada" } })).toEqual({ kind: "user", name: "Ada" });
  });

  it("provides stable default input witnesses", () => {
    expect(inputWitness("empty")).toBe("");
    expect(inputWitness("nonEmpty")).toBe("modality");
    expect(inputWitness("empty|nonEmpty")).toBe("modality");
  });
});

class FakeDocument {
  defaultView = { Event: FakeEvent };

  constructor(private readonly elements: readonly FakeElement[]) {}

  querySelectorAll(selector: string): FakeElement[] {
    const testId = /\[data-testid="([^"]+)"\]/.exec(selector)?.[1];
    if (testId) return this.elements.filter((element) => element.getAttribute("data-testid") === testId);
    return [...this.elements];
  }
}

class FakeEvent {
  constructor(readonly type: string, readonly init: EventInit) {}
}

class FakeElement {
  value = "";
  events: string[] = [];
  form?: FakeElement;

  constructor(
    readonly tagName: string,
    private readonly options: { attrs?: Record<string, string>; textContent?: string; disabled?: boolean; click?: () => void } = {}
  ) {}

  get textContent(): string {
    return this.options.textContent ?? "";
  }

  get disabled(): boolean {
    return this.options.disabled ?? false;
  }

  getAttribute(name: string): string | null {
    if (name === "type" && this.tagName.toLowerCase() === "input") return this.options.attrs?.[name] ?? "text";
    return this.options.attrs?.[name] ?? null;
  }

  click(): void {
    this.options.click?.();
  }

  dispatchEvent(event: { type: string }): boolean {
    this.events.push(event.type);
    return true;
  }
}
