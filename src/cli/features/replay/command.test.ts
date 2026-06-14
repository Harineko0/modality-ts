import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { traceArtifact, type Trace } from "modality-ts/core";
import { runReplayCommand } from "../replay/index.js";

const trace: Trace = {
  steps: [
    {
      transitionId: "login",
      label: { kind: "click", text: "Login" },
      pre: { auth: "guest" },
      post: { auth: "user" },
      diff: { auth: { before: "guest", after: "user" } }
    }
  ]
};

describe("runReplayCommand", () => {
  it("writes reproduced replay reports directly from trace artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-replay-"));
    const tracePath = join(dir, "trace.json");
    const reportPath = join(dir, "replay-report.json");
    await writeFile(tracePath, JSON.stringify(traceArtifact(trace)), "utf8");

    const result = await runReplayCommand({ tracePath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["replay: reproduced", "mode=abstract", "stepsRun=1"]);
    expect(report).toEqual({
      schemaVersion: 1,
      kind: "replay-report",
      generatedAt: "2026-06-12T00:00:00.000Z",
      mode: "abstract",
      verdict: { status: "reproduced", stepsRun: 1 }
    });
  });

  it("allows explicit state artifacts to override trace-derived states for divergence checks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-replay-"));
    const tracePath = join(dir, "trace.json");
    const statesPath = join(dir, "states.json");
    await writeFile(tracePath, JSON.stringify(traceArtifact(trace)), "utf8");
    await writeFile(statesPath, JSON.stringify([{ auth: "guest" }, { auth: "guest" }]), "utf8");

    const result = await runReplayCommand({ tracePath, statesPath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(result.exitCode).toBe(2);
    expect(result.report.verdict).toEqual({
      status: "not-reproduced",
      stepsRun: 1,
      divergenceStep: 1,
      reason: 'postcondition mismatch: auth: expected "user", got "guest"'
    });
  });

  it("runs action replay through a harness module", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-replay-action-"));
    const tracePath = join(dir, "trace.json");
    const harnessPath = join(dir, "harness.mjs");
    await writeFile(tracePath, JSON.stringify(traceArtifact({
      steps: [{
        ...trace.steps[0]!,
        label: { kind: "click", locator: { kind: "testId", value: "login" } }
      }]
    })), "utf8");
    await writeFile(harnessPath, [
      "export async function renderModalityReplay() {",
      "  document.body.innerHTML = '<button data-testid=\"login\">Login</button><span data-modality-var=\"auth\">\"guest\"</span>';",
      "  document.querySelector('[data-testid=\"login\"]').addEventListener('click', () => {",
      "    document.querySelector('[data-modality-var=\"auth\"]').textContent = '\"user\"';",
      "  });",
      "  return { document };",
      "}"
    ].join("\n"), "utf8");

    const result = await runReplayCommand({ tracePath, harnessPath, mode: "action", now: new Date("2026-06-12T00:00:00.000Z") });
    expect(result.exitCode).toBe(0);
    expect(result.report.mode).toBe("action");
    expect(result.report.harnessPath).toBe(harnessPath);
    expect(result.report.verdict).toEqual({ status: "reproduced", stepsRun: 1 });
  });

  it("passes app-specific action replay hooks from the harness module", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-replay-action-hooks-"));
    const tracePath = join(dir, "trace.json");
    const harnessPath = join(dir, "harness.mjs");
    await writeFile(tracePath, JSON.stringify(traceArtifact({
      steps: [{
        transitionId: "edit",
        label: { kind: "input", locator: { kind: "testId", value: "draft" }, valueClass: "valid" },
        pre: { draft: "empty" },
        post: { draft: "custom" },
        diff: { draft: { before: "empty", after: "custom" } }
      }]
    } satisfies Trace)), "utf8");
    await writeFile(harnessPath, [
      "export async function renderModalityReplay() {",
      "  const calls = [];",
      "  document.body.innerHTML = '<input data-testid=\"draft\"><span data-modality-var=\"draft\">\"empty\"</span>';",
      "  document.querySelector('[data-testid=\"draft\"]').addEventListener('input', (event) => {",
      "    document.querySelector('[data-modality-var=\"draft\"]').textContent = JSON.stringify(event.target.value);",
      "  });",
      "  return {",
      "    document,",
      "    inputValues: { valid: 'custom' },",
      "    beforeStep: ({ stepIndex }) => calls.push(`before:${stepIndex}`),",
      "    afterStep: ({ stepIndex }) => calls.push(`after:${stepIndex}`),",
      "    assertViolation: () => calls.join(',') === 'before:0,after:0'",
      "  };",
      "}"
    ].join("\n"), "utf8");

    const result = await runReplayCommand({ tracePath, harnessPath, mode: "action", now: new Date("2026-06-12T00:00:00.000Z") });
    expect(result.exitCode).toBe(0);
    expect(result.report.verdict).toEqual({ status: "reproduced", stepsRun: 1 });
  });

  it("allows observed state artifacts to compare only observable variables", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-replay-"));
    const tracePath = join(dir, "trace.json");
    const observedPath = join(dir, "observed.json");
    await writeFile(tracePath, JSON.stringify(traceArtifact({
      steps: [{
        transitionId: "login",
        label: { kind: "click", text: "Login" },
        pre: { auth: "guest", hidden: "before" },
        post: { auth: "user", hidden: "after" },
        diff: { auth: { before: "guest", after: "user" }, hidden: { before: "before", after: "after" } }
      }]
    } satisfies Trace)), "utf8");
    await writeFile(observedPath, JSON.stringify([{ auth: "guest" }, { auth: "user" }]), "utf8");

    const result = await runReplayCommand({ tracePath, observedPath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(result.exitCode).toBe(0);
    expect(result.report.verdict).toEqual({ status: "reproduced", stepsRun: 1 });
  });

  it("reports divergence when observed variables disagree with the trace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-replay-"));
    const tracePath = join(dir, "trace.json");
    const observedPath = join(dir, "observed.json");
    await writeFile(tracePath, JSON.stringify(traceArtifact(trace)), "utf8");
    await writeFile(observedPath, JSON.stringify([{ auth: "guest" }, { auth: "guest" }]), "utf8");

    const result = await runReplayCommand({ tracePath, observedPath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(result.exitCode).toBe(2);
    expect(result.report.verdict).toEqual({
      status: "not-reproduced",
      stepsRun: 1,
      divergenceStep: 1,
      reason: 'postcondition mismatch: auth: expected "user", got "guest"'
    });
  });

  it("classifies a deliberately wrong model trace as not reproduced at the divergence step", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-replay-"));
    const tracePath = join(dir, "trace.json");
    const observedPath = join(dir, "observed.json");
    await writeFile(tracePath, JSON.stringify(traceArtifact({
      steps: [{
        ...trace.steps[0]!,
        post: { auth: "admin" },
        diff: { auth: { before: "guest", after: "admin" } }
      }]
    })), "utf8");
    await writeFile(observedPath, JSON.stringify([{ auth: "guest" }, { auth: "user" }]), "utf8");

    const result = await runReplayCommand({ tracePath, observedPath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(result.exitCode).toBe(2);
    expect(result.report.verdict).toEqual({
      status: "not-reproduced",
      stepsRun: 1,
      divergenceStep: 1,
      reason: 'postcondition mismatch: auth: expected "admin", got "user"'
    });
  });

  it("rejects malformed trace artifacts without requiring state artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-replay-"));
    const tracePath = join(dir, "trace.json");
    await writeFile(tracePath, JSON.stringify({ schemaVersion: 1, kind: "trace", steps: [{ transitionId: "bad", pre: {} }] }), "utf8");
    await expect(runReplayCommand({ tracePath })).rejects.toThrow("trace step 1 is malformed");
  });
});
