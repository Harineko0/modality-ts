import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Model, Trace } from "@modality/kernel";
import { generateConformWalks, runConformCommand } from "../src/conform.js";

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

const route = { kind: "enum", values: ["/"] } as const;

function model(): Model {
  return {
    schemaVersion: 1,
    id: "conform-model",
    bounds: { maxDepth: 3, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
      { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
      { id: "sys:pending", domain: { kind: "boundedList", inner: { kind: "record", fields: { opId: { kind: "enum", values: ["noop"] }, continuation: { kind: "enum", values: ["noop"] }, args: { kind: "record", fields: {} } } }, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
      { id: "flag", domain: { kind: "bool" }, origin: "system", scope: { kind: "global" }, initial: false }
    ],
    transitions: [
      {
        id: "setFlag",
        cls: "user",
        label: { kind: "click", text: "Set flag" },
        source: [],
        guard: { kind: "not", args: [{ kind: "read", var: "flag" }] },
        effect: { kind: "assign", var: "flag", expr: { kind: "lit", value: true } },
        reads: ["flag"],
        writes: ["flag"],
        confidence: "exact"
      }
    ]
  };
}

describe("runConformCommand", () => {
  it("classifies multiple replay walks and writes metrics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conform-"));
    const walksPath = join(dir, "walks.json");
    const reportPath = join(dir, "conform-report.json");
    await writeFile(
      walksPath,
      JSON.stringify([
        { id: "ok", trace, states: [{ auth: "guest" }, { auth: "user" }] },
        { id: "diverged", trace, states: [{ auth: "guest" }, { auth: "guest" }] }
      ]),
      "utf8"
    );

    const result = await runConformCommand({ walksPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.exitCode).toBe(2);
    expect(result.lines).toEqual(["conform: total=2 reproduced=1 notReproduced=1 inconclusive=0", "passRate=0.5"]);
    expect(report).toMatchObject({
      schemaVersion: 1,
      kind: "conform-report",
      generatedAt: "2026-06-12T00:00:00.000Z",
      metrics: { total: 2, reproduced: 1, notReproduced: 1, inconclusive: 0, passRate: 0.5 }
    });
    expect(report.walks.map((walk: { id: string; status: string }) => [walk.id, walk.status])).toEqual([
      ["ok", "reproduced"],
      ["diverged", "not-reproduced"]
    ]);
  });

  it("generates deterministic bounded walks from a model", () => {
    const left = generateConformWalks(model(), { count: 2, depth: 2, seed: 7 });
    const right = generateConformWalks(model(), { count: 2, depth: 2, seed: 7 });
    expect(left).toEqual(right);
    expect(left.map((walk) => walk.trace.steps.map((step) => step.transitionId))).toEqual([["setFlag"], ["setFlag"]]);
    expect(left[0]?.states.map((state) => state.flag)).toEqual([false, true]);
  });

  it("runs conform directly from a model by generating abstract walks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conform-"));
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "conform-report.json");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");

    const result = await runConformCommand({ modelPath, reportPath, walkCount: 2, depth: 2, seed: 7, now: new Date("2026-06-12T00:00:00.000Z") });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["conform: total=2 reproduced=2 notReproduced=0 inconclusive=0", "passRate=1"]);
    expect(report.walks.map((walk: { id: string; status: string; stepsRun: number }) => [walk.id, walk.status, walk.stepsRun])).toEqual([
      ["walk-1", "reproduced", 1],
      ["walk-2", "reproduced", 1]
    ]);
  });
});
