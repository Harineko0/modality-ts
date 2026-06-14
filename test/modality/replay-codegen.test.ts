import { describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Trace } from "modality-ts/core";
import {
  generateAbstractReplayTest,
  generateActionReplayTest,
  generateReplayHarness,
} from "../../src/cli/codegen/replay-test.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("generateAbstractReplayTest", () => {
  it("emits a deterministic abstract replay vitest file", () => {
    const trace: Trace = {
      steps: [
        {
          transitionId: "setFlag",
          label: { kind: "click", text: "Set flag" },
          pre: { flag: false },
          post: { flag: true },
          diff: { flag: { before: false, after: true } },
        },
      ],
    };
    const artifact = generateAbstractReplayTest("flag starts false", trace);
    expect(artifact.fileName).toBe("flag_starts_false.replay.test.ts");
    expect(artifact.source).toContain('describe("replay flag starts false"');
    expect(artifact.source).toContain(
      'expect(verdict.status).toBe("reproduced");',
    );
    expect(artifact.source).toContain("statesFromTrace(trace)");
    expect(artifact.source).toContain('"transitionId":"setFlag"');
  });

  it("emits an action replay vitest scaffold for concrete labels", () => {
    const trace: Trace = {
      steps: [
        {
          transitionId: "edit",
          label: {
            kind: "input",
            locator: { kind: "testId", value: "draft" },
            valueClass: "nonEmpty",
          },
          pre: { draft: "empty" },
          post: { draft: "nonEmpty" },
          diff: { draft: { before: "empty", after: "nonEmpty" } },
        },
      ],
    };
    const artifact = generateActionReplayTest("draft can change", trace);
    expect(artifact.fileName).toBe("draft_can_change.action.replay.test.ts");
    expect(artifact.source).toContain("@vitest-environment jsdom");
    expect(artifact.source).toContain("createDomReplayActor");
    expect(artifact.source).toContain("ObservableActionReplayDriver");
    expect(artifact.source).toContain("ModalityReplayHarness");
    expect(artifact.source).toContain('from "./modality.replay.harness.js"');
    expect(artifact.source).toContain("renderModalityReplay(trace)");
    expect(artifact.source).toContain("observeModalityReplay(replayHarness)");
    expect(artifact.source).toContain("...(replayHarness.sources ?? [])");
    expect(artifact.source).toContain(
      "replayHarness.observedVars ?? observedVars",
    );
    expect(artifact.source).toContain("beforeStep: replayHarness.beforeStep");
    expect(artifact.source).toContain(
      '"locator":{"kind":"testId","value":"draft"}',
    );
    expect(artifact.source).toContain('"valueClass":"nonEmpty"');
  });

  it("emits a typed starter app replay harness", () => {
    const artifact = generateReplayHarness();
    expect(artifact.fileName).toBe("modality.replay.harness.ts");
    expect(artifact.source).toContain("renderModalityReplay");
    expect(artifact.source).toContain("observeModalityReplay");
    expect(artifact.source).toContain("ModalityReplayHarness");
    expect(artifact.source).toContain("data-modality-var");
    expect(artifact.source).toContain("dom-projection");
    expect(artifact.source).toContain("__modalityRenderReplayApp");
    expect(artifact.source).toContain(
      "createDeterministicReplayAsyncController",
    );
    expect(artifact.source).toContain("replayAsync");
    expect(artifact.source).toContain("resolve: replayAsync.resolve");
  });

  it("emits generated action replay files that execute under jsdom", async () => {
    const trace: Trace = {
      steps: [
        {
          transitionId: "setFlag",
          label: {
            kind: "click",
            locator: { kind: "testId", value: "set-flag" },
          },
          pre: { flag: false },
          post: { flag: true },
          diff: { flag: { before: false, after: true } },
        },
      ],
    };
    const dir = resolve(repoRoot, "src/cli/.tmp-generated-replay");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const harness = generateReplayHarness();
    const replay = generateActionReplayTest("flag starts false", trace);
    await writeFile(
      resolve(dir, harness.fileName),
      `${generatedAppHook()}\n${harness.source}`,
      "utf8",
    );
    await writeFile(resolve(dir, replay.fileName), replay.source, "utf8");

    try {
      const result = await execFileAsync(
        "pnpm",
        ["vitest", "run", resolve(dir, replay.fileName)],
        {
          cwd: repoRoot,
          env: { ...process.env, FORCE_COLOR: "0" },
          timeout: 30_000,
        },
      );
      expect(result.stdout).toContain("1 passed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("emits generated action replay files that can resolve queued async work", async () => {
    const trace: Trace = {
      steps: [
        {
          transitionId: "submit",
          label: {
            kind: "submit",
            locator: { kind: "testId", value: "checkout" },
          },
          pre: { status: "idle" },
          post: { status: "submitting" },
          diff: { status: { before: "idle", after: "submitting" } },
        },
        {
          transitionId: "submit.resolve",
          label: { kind: "resolve", op: "api.submitOrder", outcome: "success" },
          pre: { status: "submitting" },
          post: { status: "done" },
          diff: { status: { before: "submitting", after: "done" } },
        },
      ],
    };
    const dir = resolve(repoRoot, "src/cli/.tmp-generated-async-replay");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const harness = generateReplayHarness();
    const replay = generateActionReplayTest("checkout resolves", trace);
    await writeFile(
      resolve(dir, harness.fileName),
      `${generatedAsyncAppHook()}\n${harness.source}`,
      "utf8",
    );
    await writeFile(resolve(dir, replay.fileName), replay.source, "utf8");

    try {
      const result = await execFileAsync(
        "pnpm",
        ["vitest", "run", resolve(dir, replay.fileName)],
        {
          cwd: repoRoot,
          env: { ...process.env, FORCE_COLOR: "0" },
          timeout: 30_000,
        },
      );
      expect(result.stdout).toContain("1 passed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function generatedAppHook(): string {
  return [
    `globalThis.__modalityRenderReplayApp = () => {`,
    `  let flag = false;`,
    `  document.body.replaceChildren();`,
    `  const button = document.createElement("button");`,
    `  button.dataset.testid = "set-flag";`,
    `  button.textContent = "Set flag";`,
    `  const output = document.createElement("output");`,
    `  output.setAttribute("data-modality-var", "flag");`,
    `  const paint = () => { output.textContent = JSON.stringify(flag); };`,
    `  button.addEventListener("click", () => { flag = true; paint(); });`,
    `  document.body.append(button, output);`,
    `  paint();`,
    `  return {};`,
    `};`,
  ].join("\n");
}

function generatedAsyncAppHook(): string {
  return [
    `globalThis.__modalityRenderReplayApp = (_trace, replayAsync) => {`,
    `  let status = "idle";`,
    `  document.body.replaceChildren();`,
    `  const form = document.createElement("form");`,
    `  form.dataset.testid = "checkout";`,
    `  const submit = document.createElement("button");`,
    `  submit.type = "submit";`,
    `  submit.textContent = "Submit";`,
    `  const output = document.createElement("output");`,
    `  output.setAttribute("data-modality-var", "status");`,
    `  const paint = () => { output.textContent = JSON.stringify(status); };`,
    `  form.addEventListener("submit", (event) => {`,
    `    event.preventDefault();`,
    `    status = "submitting";`,
    `    replayAsync.registerResponse("api.submitOrder", "success", { status: "done" }, (payload) => { status = payload && typeof payload === "object" && !Array.isArray(payload) && payload.status === "done" ? "done" : "failed"; paint(); });`,
    `    paint();`,
    `  });`,
    `  form.append(submit, output);`,
    `  document.body.append(form);`,
    `  paint();`,
    `  return {};`,
    `};`,
  ].join("\n");
}
