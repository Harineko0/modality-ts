import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { canonicalJson, type Model, type Property } from "@modality/kernel";
import { runCheckCommand } from "../src/check.js";
import { runReplayCommand } from "../src/replay.js";

const route = { kind: "enum", values: ["/"] } as const;

function model(): Model {
  return {
    schemaVersion: 1,
    id: "cli-fixture",
    bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
      { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
      { id: "sys:pending", domain: { kind: "boundedList", inner: { kind: "record", fields: { opId: { kind: "enum", values: ["op"] }, continuation: { kind: "enum", values: ["cont"] }, args: { kind: "record", fields: {} } } }, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
      { id: "flag", domain: { kind: "bool" }, origin: "system", scope: { kind: "global" }, initial: false },
      { id: "payload", domain: { kind: "tokens", count: 1 }, origin: "system", scope: { kind: "global" }, initial: "tok1" }
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
        confidence: "over-approx"
      }
    ]
  };
}

describe("runCheckCommand", () => {
  it("writes a deterministic schema-versioned check report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "report.json");
    const tracesDir = join(dir, "traces");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    const properties: Property[] = [
      { kind: "always", name: "flagStartsFalseOnly", predicate: (state) => state.flag === false },
      { kind: "reachable", name: "flagCanBecomeTrue", predicate: (state) => state.flag === true }
    ];

    const first = await runCheckCommand({ modelPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(first.report.verdicts).toEqual([]);
    const second = await runCheckCommand({
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z")
    });
    expect(canonicalJson(second.report)).toBe(canonicalJson(first.report));

    const propsPath = join(dir, "props.mjs");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: state => state.flag === false },
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: state => state.flag === true }
      ];`,
      "utf8"
    );
    const withProps = await runCheckCommand({ modelPath, propsPath, reportPath, tracesDir, now: new Date("2026-06-12T00:00:00.000Z") });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(withProps.exitCode).toBe(2);
    expect(withProps.lines).toContain("flagStartsFalseOnly: violated");
    expect(report).toEqual(withProps.report);
    expect(report).toMatchObject({
      schemaVersion: 1,
      kind: "check-report",
      modelId: "cli-fixture",
      generatedAt: "2026-06-12T00:00:00.000Z",
      stats: { states: 2, edges: 1, depth: 2 },
      vacuityWarnings: [],
      trustLedger: {
        bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
        abstractions: ["payload:tokens"],
        overApproxTransitions: ["setFlag"]
      }
    });
    expect(report.verdicts.map((verdict: { property: string; status: string }) => [verdict.property, verdict.status])).toEqual([
      ["flagStartsFalseOnly", "violated"],
      ["flagCanBecomeTrue", "reachable"]
    ]);
    const violatedTracePath = join(tracesDir, "flagStartsFalseOnly.violated.trace.json");
    const reachableTracePath = join(tracesDir, "flagCanBecomeTrue.reachable.trace.json");
    expect(JSON.parse(await readFile(violatedTracePath, "utf8")).steps.map((step: { transitionId: string }) => step.transitionId)).toEqual(["setFlag"]);
    expect(JSON.parse(await readFile(reachableTracePath, "utf8")).steps.map((step: { transitionId: string }) => step.transitionId)).toEqual(["setFlag"]);

    const statesPath = join(dir, "states.json");
    await writeFile(statesPath, JSON.stringify([{ "sys:route": "/", "sys:history": [], "sys:pending": [], flag: false, payload: "tok1" }, { "sys:route": "/", "sys:history": [], "sys:pending": [], flag: true, payload: "tok1" }]), "utf8");
    const replay = await runReplayCommand({ tracePath: violatedTracePath, statesPath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(replay.report.verdict.status).toBe("reproduced");
  });

  it("applies overlay artifacts before checking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    const overlayPath = join(dir, "overlay.json");
    const reportPath = join(dir, "report.json");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(propsPath, `export const properties = [{ kind: "reachable", name: "flagCanBecomeTrue", predicate: state => state.flag === true }];`, "utf8");
    await writeFile(
      overlayPath,
      JSON.stringify({
        transitions: [
          {
            id: "setFlag",
            cls: "user",
            label: { kind: "click", text: "Noop" },
            source: [],
            guard: { kind: "lit", value: true },
            effect: { kind: "assign", var: "flag", expr: { kind: "lit", value: false } },
            reads: [],
            writes: ["flag"],
            confidence: "exact"
          }
        ]
      }),
      "utf8"
    );
    const result = await runCheckCommand({ modelPath, propsPath, overlayPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.check.verdicts[0]?.status).toBe("vacuous-warning");
    expect(report.trustLedger.manualTransitions).toEqual(["setFlag"]);
  });

  it("rejects unsupported model artifact versions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    await writeFile(modelPath, JSON.stringify({ schemaVersion: 2, id: "future", vars: [], transitions: [], bounds: {} }), "utf8");
    await expect(runCheckCommand({ modelPath })).rejects.toThrow("unsupported model schemaVersion 2");
  });
});
