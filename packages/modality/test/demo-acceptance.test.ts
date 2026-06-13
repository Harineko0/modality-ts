import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { createDomReplayActor, ObservableActionReplayDriver, observationSource, replayTrace } from "modality-ts/harness";
import type { ModelState, Trace } from "modality-ts/kernel";
import { runCheckCommand } from "../src/check.js";
import { runCiCommand } from "../src/ci.js";
import { runExtractCommand } from "../src/extract.js";
import { runReplayCommand } from "../src/replay.js";
import { checkoutHandModel } from "./fixtures/checkout-hand-model.js";
import { demoHandModel } from "./fixtures/demo-hand-model.js";
import { todoHandModel } from "./fixtures/todo-hand-model.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const checkoutDir = join(repoRoot, "examples", "checkout-app");
const demoDir = join(repoRoot, "examples", "demo-app");
const todoDir = join(repoRoot, "examples", "todo-app");

describe("demo app acceptance fixture", () => {
  it("extracts and checks the three seeded MVP bugs", async () => {
    const startedAt = Date.now();
    const artifactDir = await mkdtemp(join(tmpdir(), "modality-demo-"));
    const sourcePath = join(demoDir, "App.tsx");
    const propsPath = join(demoDir, "app.props.mjs");
    const modelPath = join(artifactDir, "model.json");
    const reportPath = join(artifactDir, "report.json");
    const handModelPath = join(artifactDir, "hand-model.json");
    const handReportPath = join(artifactDir, "hand-report.json");
    const tracesDir = join(artifactDir, "traces");
    const replayTestsDir = join(artifactDir, "replay-tests");
    const ciArtifactDir = join(artifactDir, ".modality");
    const overlayLines = await countOverlayLines(demoDir);

    const extracted = await runExtractCommand({
      sourcePath,
      modelPath,
      effectApis: ["api.placeOrder"],
      now: new Date("2026-06-12T00:00:00.000Z")
    });
    expect(extracted.model.vars.map((decl) => decl.id)).toEqual(expect.arrayContaining([
      "atom:authAtom",
      "local:App.orderStatus",
      "swr:api_user:data",
      "sys:pending",
      "sys:route"
    ]));
    const transitionIds = extracted.model.transitions.map((transition) => transition.id);
    expect(transitionIds.some((id) => /^App\.onClick\.authAtom\.[a-z0-9]{6}$/.test(id))).toBe(true);
    expect(transitionIds).toEqual(expect.arrayContaining([
      "App.onClick.navigate._admin",
      "App.onClick.api.placeOrder.start",
      "swr:api_user:resolve:success:0"
    ]));
    expect(extracted.report.coverage).toEqual({
      handlersTotal: 8,
      exactOrOverlay: 8,
      unextractable: 0,
      ignoredVars: 0,
      percentExactOrOverlay: 1
    });
    expect(extracted.report.handlers.every((handler) => handler.classification === "exact" || handler.classification === "overlay")).toBe(true);
    expect(extracted.report.globalTaints).toEqual([]);
    expect(extracted.report.staleReads).toEqual([]);
    expect(extracted.report.unhandledRejections).toEqual([
      { id: "App.onClick.api.placeOrder", reason: "Unhandled rejection App.onClick.api.placeOrder" }
    ]);
    expect(extracted.report.warnings).toEqual(["Unhandled rejection App.onClick.api.placeOrder"]);

    const checked = await runCheckCommand({ modelPath, propsPath, reportPath, tracesDir, replayTestsDir, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(checked.exitCode).toBe(2);
    expect(checked.check.stats).toEqual({ states: 1417, edges: 6047, depth: 12 });
    expect(checked.check.verdicts.map((verdict) => [verdict.property, verdict.status])).toEqual([
      ["noDoubleSubmit", "violated"],
      ["guestCannotReachAdmin", "violated"],
      ["guestDoesNotSeeUserCache", "violated"]
    ]);
    const traces = checked.check.verdicts.map((verdict) => verdict.status === "violated" ? verdict.trace.steps.map((step) => step.transitionId) : []);
    expect(traces).toEqual([
      ["App.onClick.api.placeOrder.start", "App.onClick.api.placeOrder.start"],
      ["App.onClick.navigate._admin"],
      ["swr:api_user:fetch", "swr:api_user:resolve:success:0"]
    ]);
    await writeFile(handModelPath, JSON.stringify(demoHandModel()), "utf8");
    const handChecked = await runCheckCommand({ modelPath: handModelPath, propsPath, reportPath: handReportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(handChecked.check.stats).toEqual(checked.check.stats);
    expect(verdictSummary(handChecked.check.verdicts)).toEqual(verdictSummary(checked.check.verdicts));
    const replayStatuses = await replayStatusesForViolations(tracesDir);
    expect(replayStatuses.filter((status) => status === "reproduced")).toHaveLength(3);
    expect(replayStatuses.filter((status) => status === "reproduced").length).toBeGreaterThanOrEqual(2);
    expect(await readdir(replayTestsDir)).toHaveLength(3);
    expect(overlayLines).toBeLessThanOrEqual(100);

    const ci = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir: ciArtifactDir,
      sourcePath,
      now: new Date("2026-06-12T00:00:00.000Z")
    });
    expect(ci.exitCode).toBe(2);
    expect(ci.lines).toContain("violations=3 errors=0");
    expect(ci.lines).toContain("determinism=passed");
    expect(ci.lines).toContain("source-freshness=passed");
    const ciReport = JSON.parse(await readFile(join(ciArtifactDir, "report.json"), "utf8"));
    expect(ciReport.verdicts.map((verdict: { property: string; status: string }) => [verdict.property, verdict.status])).toEqual([
      ["noDoubleSubmit", "violated"],
      ["guestCannotReachAdmin", "violated"],
      ["guestDoesNotSeeUserCache", "violated"]
    ]);
    const noDoubleSubmitTrace = JSON.parse(await readFile(join(ciArtifactDir, "traces", "noDoubleSubmit.violated.trace.json"), "utf8"));
    expect(noDoubleSubmitTrace).toMatchObject({ schemaVersion: 1, kind: "trace" });
    expect(noDoubleSubmitTrace.steps.map((step: { transitionId: string }) => step.transitionId)).toEqual([
      "App.onClick.api.placeOrder.start",
      "App.onClick.api.placeOrder.start"
    ]);
    expect(Date.now() - startedAt).toBeLessThan(60_000);
  });

  it("keeps the concrete ToDo fixture equivalent to its hand model", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "modality-todo-"));
    const sourcePath = join(todoDir, "App.tsx");
    const propsPath = join(todoDir, "app.props.mjs");
    const modelPath = join(artifactDir, "model.json");
    const reportPath = join(artifactDir, "report.json");
    const handModelPath = join(artifactDir, "hand-model.json");
    const handReportPath = join(artifactDir, "hand-report.json");

    const extracted = await runExtractCommand({
      sourcePath,
      modelPath,
      effectApis: ["api.createTodo"],
      now: new Date("2026-06-12T00:00:00.000Z")
    });
    expect(extracted.report.coverage).toEqual({
      handlersTotal: 9,
      exactOrOverlay: 9,
      unextractable: 0,
      ignoredVars: 0,
      percentExactOrOverlay: 1
    });
    expect(extracted.report.globalTaints).toEqual([]);
    expect(extracted.report.staleReads).toEqual([]);
    expect(extracted.report.unhandledRejections).toEqual([
      { id: "App.onClick.api.createTodo", reason: "Unhandled rejection App.onClick.api.createTodo" }
    ]);

    const checked = await runCheckCommand({ modelPath, propsPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(checked.check.stats).toEqual({ states: 560, edges: 3459, depth: 12 });
    expect(verdictSummary(checked.check.verdicts)).toEqual([
      ["naiveNoDoubleSubmitInvariant", "violated", [
        "App.onClick.api.createTodo.start",
        "App.onClick.authAtom_draft_saveStatus.seq",
        "App.onClick.api.createTodo.start"
      ]],
      ["guestCannotSubmit", "violated", ["App.onClick.api.createTodo.start"]],
      ["emptyDraftCannotSubmit", "violated", ["App.onClick.api.createTodo.start"]],
      ["staleCompletionIsInert", "violated", [
        "App.onClick.api.createTodo.start",
        "App.onClick.authAtom_draft_saveStatus.seq",
        "App.onChange.draft.nonEmpty",
        "App.onClick.api.createTodo.success"
      ]]
    ]);

    await writeFile(handModelPath, JSON.stringify(todoHandModel()), "utf8");
    const handChecked = await runCheckCommand({ modelPath: handModelPath, propsPath, reportPath: handReportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(handChecked.check.stats).toEqual(checked.check.stats);
    expect(verdictSummary(handChecked.check.verdicts)).toEqual(verdictSummary(checked.check.verdicts));
  });

  it("reproduces the ToDo stale-completion counterexample through jsdom action replay", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "modality-todo-replay-"));
    const sourcePath = join(todoDir, "App.tsx");
    const propsPath = join(todoDir, "app.props.mjs");
    const modelPath = join(artifactDir, "model.json");
    const reportPath = join(artifactDir, "report.json");

    await runExtractCommand({
      sourcePath,
      modelPath,
      effectApis: ["api.createTodo"],
      now: new Date("2026-06-12T00:00:00.000Z")
    });
    const checked = await runCheckCommand({ modelPath, propsPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    const staleCompletion = checked.check.verdicts.find((verdict) => verdict.property === "staleCompletionIsInert");
    if (staleCompletion?.status !== "violated") throw new Error("expected staleCompletionIsInert violation");
    expect(staleCompletion.trace.steps.map((step) => step.transitionId)).toEqual([
      "App.onClick.api.createTodo.start",
      "App.onClick.authAtom_draft_saveStatus.seq",
      "App.onChange.draft.nonEmpty",
      "App.onClick.api.createTodo.success"
    ]);

    const replay = createTodoStaleCompletionReplay(staleCompletion.trace);
    const observedVars = Object.keys(staleCompletion.trace.steps[0]?.pre ?? {});
    const verdict = await replayTrace(staleCompletion.trace, new ObservableActionReplayDriver(
      createDomReplayActor({
        document: replay.document,
        resolve: (op, outcome) => replay.resolve(op, outcome)
      }),
      observedVars,
      [observationSource("todo-jsdom", (varId) => varId in replay.state ? { value: replay.state[varId] } : "unobservable")]
    ));

    expect(verdict).toEqual({ status: "reproduced", stepsRun: 4 });
    expect(replay.document.querySelector("[data-testid=\"draft-state\"]")?.textContent).toBe("empty");
  });

  it("reproduces the demo double-submit counterexample through jsdom action replay", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "modality-demo-replay-"));
    const sourcePath = join(demoDir, "App.tsx");
    const propsPath = join(demoDir, "app.props.mjs");
    const modelPath = join(artifactDir, "model.json");
    const reportPath = join(artifactDir, "report.json");

    await runExtractCommand({
      sourcePath,
      modelPath,
      effectApis: ["api.placeOrder"],
      now: new Date("2026-06-12T00:00:00.000Z")
    });
    const checked = await runCheckCommand({ modelPath, propsPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    const noDoubleSubmit = checked.check.verdicts.find((verdict) => verdict.property === "noDoubleSubmit");
    if (noDoubleSubmit?.status !== "violated") throw new Error("expected noDoubleSubmit violation");
    expect(noDoubleSubmit.trace.steps.map((step) => step.transitionId)).toEqual([
      "App.onClick.api.placeOrder.start",
      "App.onClick.api.placeOrder.start"
    ]);

    const replay = createDemoDoubleSubmitReplay(noDoubleSubmit.trace);
    const observedVars = Object.keys(noDoubleSubmit.trace.steps[0]?.pre ?? {});
    const verdict = await replayTrace(noDoubleSubmit.trace, new ObservableActionReplayDriver(
      createDomReplayActor({ document: replay.document }),
      observedVars,
      [observationSource("demo-jsdom", (varId) => varId in replay.state ? { value: replay.state[varId] } : "unobservable")]
    ));

    expect(verdict).toEqual({ status: "reproduced", stepsRun: 2 });
    expect(replay.document.querySelector("[data-testid=\"orderStatus\"]")?.textContent).toBe("submitting");
  });

  it("keeps the concrete checkout fixture equivalent to its hand model", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "modality-checkout-"));
    const sourcePath = join(checkoutDir, "App.tsx");
    const propsPath = join(checkoutDir, "app.props.mjs");
    const modelPath = join(artifactDir, "model.json");
    const reportPath = join(artifactDir, "report.json");
    const handModelPath = join(artifactDir, "hand-model.json");
    const handReportPath = join(artifactDir, "hand-report.json");

    const extracted = await runExtractCommand({
      sourcePath,
      modelPath,
      route: "/checkout",
      effectApis: ["api.fetchQuote", "api.submitOrder"],
      bounds: { maxDepth: 16, maxPending: 2 },
      now: new Date("2026-06-12T00:00:00.000Z")
    });
    expect(extracted.report.coverage).toEqual({
      handlersTotal: 12,
      exactOrOverlay: 12,
      unextractable: 0,
      ignoredVars: 0,
      percentExactOrOverlay: 1
    });
    expect(extracted.report.globalTaints).toEqual([]);
    expect(extracted.report.staleReads).toEqual([]);
    expect(extracted.report.unhandledRejections).toEqual([
      { id: "App.onClick.api.fetchQuote", reason: "Unhandled rejection App.onClick.api.fetchQuote" }
    ]);

    const checked = await runCheckCommand({ modelPath, propsPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(checked.check.stats).toEqual({ states: 277, edges: 1600, depth: 16 });
    expect(verdictSummary(checked.check.verdicts)).toEqual([
      ["guestCannotReachSuccess", "violated", [
        "App.onClick.auth_userId.seq",
        "App.onClick.plan_quoteStatus.seq",
        "App.onClick.step.my8cwv",
        "App.onClick.paymentMethod",
        "App.onClick.step.ny1ruq",
        "App.onClick.api.submitOrder.start",
        "App.onClick.auth_paymentMethod_plan_quoteStatus_step_submitStatus_userId.seq",
        "App.onClick.api.submitOrder.success"
      ]],
      ["orderSuccessMatchesUser", "violated", [
        "App.onClick.auth_userId.seq",
        "App.onClick.plan_quoteStatus.seq",
        "App.onClick.step.my8cwv",
        "App.onClick.paymentMethod",
        "App.onClick.step.ny1ruq",
        "App.onClick.api.submitOrder.start",
        "App.onClick.auth_paymentMethod_plan_quoteStatus_step_submitStatus_userId.seq",
        "App.onClick.api.submitOrder.success"
      ]],
      ["orderSuccessMatchesCart", "violated", [
        "App.onClick.auth_userId.seq",
        "App.onClick.plan_quoteStatus.seq",
        "App.onClick.step.my8cwv",
        "App.onClick.paymentMethod",
        "App.onClick.step.ny1ruq",
        "App.onClick.api.submitOrder.start",
        "App.onClick.api.fetchQuote.start",
        "App.onClick.api.submitOrder.success"
      ]],
      ["staleFailureDoesNotMutateGuestStatus", "violated", [
        "App.onClick.auth_userId.seq",
        "App.onClick.plan_quoteStatus.seq",
        "App.onClick.step.my8cwv",
        "App.onClick.paymentMethod",
        "App.onClick.step.ny1ruq",
        "App.onClick.api.submitOrder.start",
        "App.onClick.auth_paymentMethod_plan_quoteStatus_step_submitStatus_userId.seq",
        "App.onClick.api.submitOrder.error"
      ]],
      ["invalidQuoteCannotEnterBilling", "violated", [
        "App.onClick.auth_userId.seq",
        "App.onClick.api.fetchQuote.start",
        "App.onClick.api.fetchQuote.success",
        "App.onClick.step.my8cwv"
      ]],
      ["reviewCanReachSuccess", "verified-within-bounds", []]
    ]);

    await writeFile(handModelPath, JSON.stringify(checkoutHandModel()), "utf8");
    const handChecked = await runCheckCommand({ modelPath: handModelPath, propsPath, reportPath: handReportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(handChecked.check.stats).toEqual(checked.check.stats);
    expect(verdictSummary(handChecked.check.verdicts)).toEqual(verdictSummary(checked.check.verdicts));
  });

  it("reproduces the checkout counterexamples through jsdom action replay", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "modality-checkout-replay-"));
    const sourcePath = join(checkoutDir, "App.tsx");
    const propsPath = join(checkoutDir, "app.props.mjs");
    const modelPath = join(artifactDir, "model.json");
    const reportPath = join(artifactDir, "report.json");

    await runExtractCommand({
      sourcePath,
      modelPath,
      route: "/checkout",
      effectApis: ["api.fetchQuote", "api.submitOrder"],
      bounds: { maxDepth: 16, maxPending: 2 },
      now: new Date("2026-06-12T00:00:00.000Z")
    });
    const checked = await runCheckCommand({ modelPath, propsPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    const expectedTraces: Record<string, string[]> = {
      guestCannotReachSuccess: [
        "App.onClick.auth_userId.seq",
        "App.onClick.plan_quoteStatus.seq",
        "App.onClick.step.my8cwv",
        "App.onClick.paymentMethod",
        "App.onClick.step.ny1ruq",
        "App.onClick.api.submitOrder.start",
        "App.onClick.auth_paymentMethod_plan_quoteStatus_step_submitStatus_userId.seq",
        "App.onClick.api.submitOrder.success"
      ],
      orderSuccessMatchesUser: [
        "App.onClick.auth_userId.seq",
        "App.onClick.plan_quoteStatus.seq",
        "App.onClick.step.my8cwv",
        "App.onClick.paymentMethod",
        "App.onClick.step.ny1ruq",
        "App.onClick.api.submitOrder.start",
        "App.onClick.auth_paymentMethod_plan_quoteStatus_step_submitStatus_userId.seq",
        "App.onClick.api.submitOrder.success"
      ],
      orderSuccessMatchesCart: [
        "App.onClick.auth_userId.seq",
        "App.onClick.plan_quoteStatus.seq",
        "App.onClick.step.my8cwv",
        "App.onClick.paymentMethod",
        "App.onClick.step.ny1ruq",
        "App.onClick.api.submitOrder.start",
        "App.onClick.api.fetchQuote.start",
        "App.onClick.api.submitOrder.success"
      ],
      staleFailureDoesNotMutateGuestStatus: [
        "App.onClick.auth_userId.seq",
        "App.onClick.plan_quoteStatus.seq",
        "App.onClick.step.my8cwv",
        "App.onClick.paymentMethod",
        "App.onClick.step.ny1ruq",
        "App.onClick.api.submitOrder.start",
        "App.onClick.auth_paymentMethod_plan_quoteStatus_step_submitStatus_userId.seq",
        "App.onClick.api.submitOrder.error"
      ],
      invalidQuoteCannotEnterBilling: [
        "App.onClick.auth_userId.seq",
        "App.onClick.api.fetchQuote.start",
        "App.onClick.api.fetchQuote.success",
        "App.onClick.step.my8cwv"
      ]
    };

    for (const [property, expectedSteps] of Object.entries(expectedTraces)) {
      const replayableVerdict = checked.check.verdicts.find((verdict) => verdict.property === property);
      if (replayableVerdict?.status !== "violated") throw new Error(`expected ${property} violation`);
      expect(replayableVerdict.trace.steps.map((step) => step.transitionId)).toEqual(expectedSteps);

      const replay = createCheckoutReplay(replayableVerdict.trace);
      const observedVars = Object.keys(replayableVerdict.trace.steps[0]?.pre ?? {});
      const verdict = await replayTrace(replayableVerdict.trace, new ObservableActionReplayDriver(
        createDomReplayActor({
          document: replay.document,
          resolve: (op, outcome) => replay.resolve(op, outcome)
        }),
        observedVars,
        [observationSource("checkout-jsdom", (varId) => varId in replay.state ? { value: replay.state[varId] } : "unobservable")]
      ));

      expect(verdict).toEqual({ status: "reproduced", stepsRun: expectedSteps.length });
      if (property !== "staleFailureDoesNotMutateGuestStatus" && property !== "invalidQuoteCannotEnterBilling") {
        expect(replay.document.querySelector("[data-testid=\"step\"]")?.textContent).toBe("success");
      }
    }
  });
});

function createDemoDoubleSubmitReplay(trace: Trace): { document: Document; state: ModelState } {
  const dom = new JSDOM("<main></main>");
  const document = dom.window.document;
  const state: ModelState = { ...(trace.steps[0]?.pre ?? {}) };
  const firstPending = trace.steps[0]?.post["sys:pending"];
  const pendingTemplate = Array.isArray(firstPending) && firstPending[0] && typeof firstPending[0] === "object"
    ? firstPending[0] as Record<string, unknown>
    : { opId: "api.placeOrder", continuation: "App.onClick.api.placeOrder.cont", args: {} };
  const button = document.createElement("button");
  button.textContent = "Place order";
  const status = document.createElement("output");
  status.dataset.testid = "orderStatus";
  const paint = () => {
    status.textContent = String(state["local:App.orderStatus"]);
  };
  button.addEventListener("click", () => {
    state["local:App.orderStatus"] = "submitting";
    state["sys:pending"] = [...((state["sys:pending"] as unknown[] | undefined) ?? []), { ...pendingTemplate }];
    paint();
  });
  document.querySelector("main")?.append(button, status);
  paint();
  return { document: document as unknown as Document, state };
}

function createTodoStaleCompletionReplay(trace: Trace): { document: Document; state: ModelState; resolve: (op: string, outcome: string) => void } {
  const dom = new JSDOM("<main></main>");
  const document = dom.window.document;
  const state: ModelState = { ...(trace.steps[0]?.pre ?? {}) };
  const firstPending = trace.steps[0]?.post["sys:pending"];
  const pendingTemplate = Array.isArray(firstPending) && firstPending[0] && typeof firstPending[0] === "object"
    ? firstPending[0] as Record<string, unknown>
    : { opId: "api.createTodo", continuation: "App.onClick.api.createTodo.cont", args: {} };
  const main = document.querySelector("main")!;
  const add = button("Add", () => {
    state["local:App.saveStatus"] = "posting";
    state["sys:pending"] = [...((state["sys:pending"] as unknown[] | undefined) ?? []), { ...pendingTemplate }];
    paint();
  });
  const logout = button("Logout", () => {
    state["atom:authAtom"] = "guest";
    state["local:App.draft"] = "empty";
    state["local:App.saveStatus"] = "idle";
    paint();
  });
  const draft = document.createElement("input");
  draft.dataset.testid = "draft";
  draft.addEventListener("input", () => {
    state["local:App.draft"] = draft.value.length > 0 ? "nonEmpty" : "empty";
    paint();
  });
  draft.addEventListener("change", () => {
    state["local:App.draft"] = draft.value.length > 0 ? "nonEmpty" : "empty";
    paint();
  });
  const draftState = document.createElement("output");
  draftState.dataset.testid = "draft-state";
  main.append(add, logout, draft, draftState);
  paint();
  return {
    document: document as unknown as Document,
    state,
    resolve: (op, outcome) => {
      expect(`${op}:${outcome}`).toBe("api.createTodo:success");
      state["sys:pending"] = [];
      state["local:App.draft"] = "empty";
      state["local:App.saveStatus"] = "idle";
      paint();
    }
  };

  function button(text: string, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.textContent = text;
    element.addEventListener("click", onClick);
    return element;
  }

  function paint(): void {
    add.disabled = state["local:App.saveStatus"] === "posting";
    draftState.textContent = String(state["local:App.draft"]);
  }
}

function createCheckoutReplay(trace: Trace): { document: Document; state: ModelState; resolve: (op: string, outcome: string) => void } {
  const dom = new JSDOM("<main></main>");
  const document = dom.window.document;
  const state: ModelState = { ...(trace.steps[0]?.pre ?? {}) };
  const submitPost = trace.steps.find((step) => step.transitionId === "App.onClick.api.submitOrder.start")?.post;
  const quotePost = trace.steps.find((step) => step.transitionId === "App.onClick.api.fetchQuote.start")?.post;
  const pendingTemplate = Array.isArray(submitPost?.["sys:pending"]) && submitPost["sys:pending"][0] && typeof submitPost["sys:pending"][0] === "object"
    ? submitPost["sys:pending"][0] as Record<string, unknown>
    : { opId: "api.submitOrder", continuation: "App.onClick.api.submitOrder.cont", args: { userId: "u1", plan: "pro" } };
  const quotePending = Array.isArray(quotePost?.["sys:pending"]) && quotePost["sys:pending"].at(-1) && typeof quotePost["sys:pending"].at(-1) === "object"
    ? quotePost["sys:pending"].at(-1) as Record<string, unknown>
    : { opId: "api.fetchQuote", continuation: "App.onClick.api.fetchQuote.cont", args: { plan: "pro" } };
  const main = document.querySelector("main")!;
  const stepOutput = document.createElement("output");
  stepOutput.dataset.testid = "step";
  const buttons = {
    login: button("Login", () => {
      state["local:App.auth"] = "user";
      state["local:App.userId"] = "u1";
      paint();
    }),
    logout: button("Logout", () => {
      state["local:App.auth"] = "guest";
      state["local:App.userId"] = "none";
      state["local:App.step"] = "plan";
      state["local:App.plan"] = "none";
      state["local:App.quoteStatus"] = "missing";
      state["local:App.paymentMethod"] = "none";
      state["local:App.submitStatus"] = "idle";
      paint();
    }),
    pro: button("Pro", () => {
      state["local:App.plan"] = "pro";
      state["local:App.quoteStatus"] = "loading";
      state["sys:pending"] = [...((state["sys:pending"] as unknown[] | undefined) ?? []), { ...quotePending }];
      paint();
    }),
    starter: button("Starter", () => {
      state["local:App.plan"] = "starter";
      state["local:App.quoteStatus"] = "valid";
      paint();
    }),
    billing: button("Billing", () => {
      state["local:App.step"] = "billing";
      paint();
    }),
    card: button("Use card", () => {
      state["local:App.paymentMethod"] = "valid";
      paint();
    }),
    review: button("Review order", () => {
      state["local:App.step"] = "review";
      paint();
    }),
    submit: button("Submit order", () => {
      state["local:App.submitStatus"] = "submitting";
      state["sys:pending"] = [...((state["sys:pending"] as unknown[] | undefined) ?? []), { ...pendingTemplate }];
      paint();
    })
  };
  main.append(buttons.login, buttons.logout, buttons.pro, buttons.starter, buttons.billing, buttons.card, buttons.review, buttons.submit, stepOutput);
  paint();
  return {
    document: document as unknown as Document,
    state,
    resolve: (op, outcome) => {
      state["sys:pending"] = ((state["sys:pending"] as unknown[] | undefined) ?? []).slice(1);
      if (`${op}:${outcome}` === "api.fetchQuote:success") {
        state["local:App.quoteStatus"] = "invalid";
      } else if (`${op}:${outcome}` === "api.submitOrder:success") {
        state["local:App.submitStatus"] = "idle";
        state["local:App.step"] = "success";
      } else {
        expect(`${op}:${outcome}`).toBe("api.submitOrder:error");
        state["local:App.submitStatus"] = "failed";
      }
      paint();
    }
  };

  function button(text: string, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.textContent = text;
    element.addEventListener("click", onClick);
    return element;
  }

  function paint(): void {
    buttons.login.disabled = state["local:App.auth"] !== "guest";
    buttons.pro.disabled = state["local:App.auth"] !== "user";
    buttons.starter.disabled = state["local:App.auth"] !== "user";
    buttons.billing.disabled = state["local:App.auth"] !== "user" || state["local:App.plan"] === "none";
    buttons.card.disabled = state["local:App.auth"] !== "user" || state["local:App.step"] !== "billing";
    buttons.review.disabled = state["local:App.auth"] !== "user" || state["local:App.step"] !== "billing" || state["local:App.paymentMethod"] === "none";
    buttons.submit.disabled = state["local:App.auth"] !== "user" || state["local:App.step"] !== "review" || state["local:App.submitStatus"] === "submitting" || state["local:App.plan"] === "none";
    stepOutput.textContent = String(state["local:App.step"]);
  }
}

function verdictSummary(verdicts: readonly { property: string; status: string; trace?: { steps: readonly { transitionId: string }[] } }[]) {
  return verdicts.map((verdict) => [
    verdict.property,
    verdict.status,
    verdict.trace?.steps.map((step) => step.transitionId) ?? []
  ]);
}

async function replayStatusesForViolations(tracesDir: string): Promise<string[]> {
  const traceNames = (await readdir(tracesDir)).filter((name) => name.endsWith(".violated.trace.json")).sort();
  const statuses: string[] = [];
  for (const traceName of traceNames) {
    const replay = await runReplayCommand({ tracePath: join(tracesDir, traceName), now: new Date("2026-06-12T00:00:00.000Z") });
    statuses.push(replay.report.verdict.status);
  }
  return statuses;
}

async function countOverlayLines(root: string): Promise<number> {
  const names = await readdir(root, { recursive: true });
  let lines = 0;
  for (const name of names) {
    const relative = String(name);
    if (!isOverlayFile(relative)) continue;
    const text = await readFile(join(root, relative), "utf8");
    lines += text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  }
  return lines;
}

function isOverlayFile(path: string): boolean {
  return /(^|\/)(modality\.)?overlay\.(json|mjs|js|ts)$/.test(path) || path.endsWith(".overlay.ts");
}
