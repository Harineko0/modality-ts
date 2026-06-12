import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { canonicalJson, type Model, type Property } from "@modality/kernel";
import { runCheckCommand } from "../src/check.js";

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
    const withProps = await runCheckCommand({ modelPath, propsPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
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
  });
});
