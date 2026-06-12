import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Trace } from "@modality/kernel";
import { runReplayCommand } from "../src/replay.js";

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
  it("writes reproduced replay reports from trace and state artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-replay-"));
    const tracePath = join(dir, "trace.json");
    const statesPath = join(dir, "states.json");
    const reportPath = join(dir, "replay-report.json");
    await writeFile(tracePath, JSON.stringify(trace), "utf8");
    await writeFile(statesPath, JSON.stringify([{ auth: "guest" }, { auth: "user" }]), "utf8");

    const result = await runReplayCommand({ tracePath, statesPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["replay: reproduced", "stepsRun=1"]);
    expect(report).toEqual({
      schemaVersion: 1,
      kind: "replay-report",
      generatedAt: "2026-06-12T00:00:00.000Z",
      verdict: { status: "reproduced", stepsRun: 1 }
    });
  });

  it("returns a not-reproduced report with divergence details", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-replay-"));
    const tracePath = join(dir, "trace.json");
    const statesPath = join(dir, "states.json");
    await writeFile(tracePath, JSON.stringify(trace), "utf8");
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

  it("rejects malformed trace artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-replay-"));
    const tracePath = join(dir, "trace.json");
    const statesPath = join(dir, "states.json");
    await writeFile(tracePath, JSON.stringify({ steps: [{ transitionId: "bad", pre: {} }] }), "utf8");
    await writeFile(statesPath, JSON.stringify([{ auth: "guest" }]), "utf8");
    await expect(runReplayCommand({ tracePath, statesPath })).rejects.toThrow("trace step 1 is malformed");
  });
});
