import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Model } from "@modality/kernel";
import { runCiCommand } from "../src/ci.js";

const route = { kind: "enum", values: ["/"] } as const;

function model(): Model {
  return {
    schemaVersion: 1,
    id: "ci-fixture",
    bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
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

describe("runCiCommand", () => {
  it("writes report and traces and fails on violations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    const artifactDir = join(dir, ".modality");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(propsPath, `export const properties = [{ kind: "always", name: "flagAlwaysFalse", predicate: state => state.flag === false }];`, "utf8");

    const result = await runCiCommand({ modelPath, propsPath, artifactDir, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(result.exitCode).toBe(2);
    expect(result.lines).toEqual([
      "ci: failed",
      "violations=1 errors=0",
      "determinism=passed",
      `report=${join(artifactDir, "report.json")}`,
      `traces=${join(artifactDir, "traces")}`
    ]);
    const report = JSON.parse(await readFile(join(artifactDir, "report.json"), "utf8"));
    expect(report.verdicts[0]).toMatchObject({ property: "flagAlwaysFalse", status: "violated" });
    const trace = JSON.parse(await readFile(join(artifactDir, "traces", "flagAlwaysFalse.violated.trace.json"), "utf8"));
    expect(trace.steps.map((step: { transitionId: string }) => step.transitionId)).toEqual(["setFlag"]);
  });

  it("passes when all properties hold", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    const artifactDir = join(dir, ".modality");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(propsPath, `export const properties = [{ kind: "reachable", name: "flagCanBecomeTrue", predicate: state => state.flag === true }];`, "utf8");

    const result = await runCiCommand({ modelPath, propsPath, artifactDir, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toBe("ci: passed");
    expect(result.lines).toContain("determinism=passed");
  });

  it("fails when trust ledger regresses against a baseline report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    const baselinePath = join(dir, "baseline-report.json");
    const artifactDir = join(dir, ".modality");
    const current = model();
    current.transitions = [{ ...current.transitions[0]!, confidence: "manual" }];
    await writeFile(modelPath, JSON.stringify(current), "utf8");
    await writeFile(propsPath, `export const properties = [{ kind: "reachable", name: "flagCanBecomeTrue", predicate: state => state.flag === true }];`, "utf8");
    await writeFile(baselinePath, JSON.stringify({
      schemaVersion: 1,
      kind: "check-report",
      modelId: "ci-fixture",
      generatedAt: "2026-06-11T00:00:00.000Z",
      verdicts: [],
      stats: { states: 0, edges: 0, depth: 0 },
      vacuityWarnings: [],
      trustLedger: {
        bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
        assumptions: [],
        abstractions: [],
        manualTransitions: [],
        overApproxTransitions: [],
        boundHits: []
      }
    }), "utf8");

    const result = await runCiCommand({ modelPath, propsPath, artifactDir, baselinePath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(result.exitCode).toBe(3);
    expect(result.lines).toContain("determinism=passed");
    expect(result.lines).toContain("trust-regressions=1");
    expect(result.lines).toContain("trust-regression: manualTransitions 0->1 new=setFlag");
  });
});
