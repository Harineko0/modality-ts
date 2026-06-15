import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { canonicalJson, type Model, type Property } from "modality-ts/core";
import { runCheckCommand } from "./index.js";
import { renderHumanCheckResult, symbolForStatus } from "./output.js";
import { runReplayCommand } from "../../replay.js";

const route = { kind: "enum", values: ["/"] } as const;

function model(): Model {
  return {
    schemaVersion: 1,
    id: "cli-fixture",
    bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      {
        id: "sys:route",
        domain: route,
        origin: "system",
        scope: { kind: "global" },
        initial: "/",
      },
      {
        id: "sys:history",
        domain: { kind: "boundedList", inner: route, maxLen: 1 },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
      {
        id: "sys:pending",
        domain: {
          kind: "boundedList",
          inner: {
            kind: "record",
            fields: {
              opId: { kind: "enum", values: ["op"] },
              continuation: { kind: "enum", values: ["cont"] },
              args: { kind: "record", fields: {} },
            },
          },
          maxLen: 1,
        },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
      {
        id: "flag",
        domain: { kind: "bool" },
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
      {
        id: "payload",
        domain: { kind: "tokens", count: 1 },
        origin: "system",
        scope: { kind: "global" },
        initial: "tok1",
      },
    ],
    transitions: [
      {
        id: "setFlag",
        cls: "user",
        label: {
          kind: "click",
          locator: { kind: "testId", value: "set-flag" },
          text: "Set flag",
        },
        source: [],
        guard: { kind: "not", args: [{ kind: "read", var: "flag" }] },
        effect: {
          kind: "assign",
          var: "flag",
          expr: { kind: "lit", value: true },
        },
        reads: ["flag"],
        writes: ["flag"],
        confidence: "over-approx",
      },
    ],
  };
}

describe("runCheckCommand", () => {
  it("writes a deterministic schema-versioned check report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "report.json");
    const tracesDir = join(dir, "traces");
    const replayTestsDir = join(dir, "replay-tests");
    const actionReplayTestsDir = join(dir, "action-replay-tests");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    const _properties: Property[] = [
      {
        kind: "always",
        name: "flagStartsFalseOnly",
        predicate: (state) => state.flag === false,
      },
      {
        kind: "reachable",
        name: "flagCanBecomeTrue",
        predicate: (state) => state.flag === true,
      },
    ];

    const first = await runCheckCommand({
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(first.report.verdicts).toEqual([]);
    const second = await runCheckCommand({
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(canonicalJson(second.report)).toBe(canonicalJson(first.report));

    const propsPath = join(dir, "props.mjs");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: state => state.flag === false },
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: state => state.flag === true }
      ];`,
      "utf8",
    );
    const withProps = await runCheckCommand({
      modelPath,
      propsPath,
      reportPath,
      tracesDir,
      replayTestsDir,
      actionReplayTestsDir,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
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
        plugins: [],
        assumptions: [],
        abstractions: ["payload:tokens"],
        globalTaints: [],
        staleReads: [],
        unhandledRejections: [],
        unextractableHandlers: [],
        domains: [
          { varId: "flag", domainKind: "bool", provenance: "system" },
          { varId: "payload", domainKind: "tokens", provenance: "system" },
          {
            varId: "sys:history",
            domainKind: "boundedList",
            provenance: "system",
          },
          {
            varId: "sys:pending",
            domainKind: "boundedList",
            provenance: "system",
          },
          { varId: "sys:route", domainKind: "enum", provenance: "system" },
        ],
        overApproxTransitions: ["setFlag"],
        boundHits: [],
        ignoredVars: [],
      },
    });
    expect(
      report.verdicts.map((verdict: { property: string; status: string }) => [
        verdict.property,
        verdict.status,
      ]),
    ).toEqual([
      ["flagStartsFalseOnly", "violated"],
      ["flagCanBecomeTrue", "reachable"],
    ]);
    const violatedTracePath = join(
      tracesDir,
      "flagStartsFalseOnly.violated.trace.json",
    );
    const reachableTracePath = join(
      tracesDir,
      "flagCanBecomeTrue.reachable.trace.json",
    );
    const violatedTrace = JSON.parse(await readFile(violatedTracePath, "utf8"));
    const reachableTrace = JSON.parse(
      await readFile(reachableTracePath, "utf8"),
    );
    expect(violatedTrace).toMatchObject({ schemaVersion: 1, kind: "trace" });
    expect(reachableTrace).toMatchObject({ schemaVersion: 1, kind: "trace" });
    expect(
      violatedTrace.steps.map(
        (step: { transitionId: string }) => step.transitionId,
      ),
    ).toEqual(["setFlag"]);
    expect(
      reachableTrace.steps.map(
        (step: { transitionId: string }) => step.transitionId,
      ),
    ).toEqual(["setFlag"]);

    const replay = await runReplayCommand({
      tracePath: violatedTracePath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(replay.report.verdict.status).toBe("reproduced");
    const replayTest = await readFile(
      join(replayTestsDir, "flagStartsFalseOnly.replay.test.ts"),
      "utf8",
    );
    expect(replayTest).toContain('describe("replay flagStartsFalseOnly"');
    expect(replayTest).toContain("statesFromTrace(trace)");
    expect(replayTest).toContain('"transitionId":"setFlag"');
    expect(withProps.lines).toContain(
      `actionReplayTest=${join(actionReplayTestsDir, "modality.replay.harness.ts")}`,
    );
    const replayHarness = await readFile(
      join(actionReplayTestsDir, "modality.replay.harness.ts"),
      "utf8",
    );
    expect(replayHarness).toContain("renderModalityReplay");
    expect(replayHarness).toContain("observeModalityReplay");
    expect(replayHarness).toContain("data-modality-var");
    const actionReplayTest = await readFile(
      join(actionReplayTestsDir, "flagStartsFalseOnly.action.replay.test.ts"),
      "utf8",
    );
    expect(actionReplayTest).toContain("@vitest-environment jsdom");
    expect(actionReplayTest).toContain("ObservableActionReplayDriver");
    expect(actionReplayTest).toContain('from "./modality.replay.harness.js"');
    expect(actionReplayTest).toContain("renderModalityReplay(trace)");
    expect(actionReplayTest).toContain("observeModalityReplay(replayHarness)");
    expect(actionReplayTest).toContain(
      'expect(verdict.status).toBe("reproduced")',
    );
    expect(actionReplayTest).toContain('"transitionId":"setFlag"');
  });

  it("renders source hash metadata as trust-ledger assumptions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "report.json");
    const sourcePath = join(dir, "App.tsx");
    await writeFile(
      sourcePath,
      "export function App() { return null; }",
      "utf8",
    );
    await writeFile(
      modelPath,
      JSON.stringify({
        ...model(),
        metadata: { sourceHashes: { [sourcePath]: "abc123" } },
      }),
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.report.trustLedger.assumptions).toEqual([
      `sourceHash:${sourcePath}=abc123`,
    ]);
  });

  it("embeds domain provenance in the trust ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    await writeFile(
      modelPath,
      JSON.stringify({
        ...model(),
        vars: [
          ...model().vars,
          {
            id: "local:App.mode",
            domain: { kind: "enum", values: ["idle", "busy"] },
            origin: { file: "App.tsx", line: 1 },
            scope: { kind: "global" },
            initial: "idle",
          },
          {
            id: "local:App.payload",
            domain: { kind: "tokens", count: 1 },
            origin: { file: "App.tsx", line: 2 },
            scope: { kind: "global" },
            initial: "tok1",
          },
          {
            id: "swr:todos:data",
            domain: { kind: "lengthCat" },
            origin: "library-template",
            scope: { kind: "global" },
            initial: "0",
          },
        ],
      }),
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.report.trustLedger.domains).toEqual(
      expect.arrayContaining([
        {
          varId: "local:App.mode",
          domainKind: "enum",
          provenance: "type-derived",
        },
        {
          varId: "local:App.payload",
          domainKind: "tokens",
          provenance: "default-token",
        },
        {
          varId: "swr:todos:data",
          domainKind: "lengthCat",
          provenance: "template",
        },
        { varId: "sys:route", domainKind: "enum", provenance: "system" },
      ]),
    );
  });

  it("does not emit replay tests for non-replayable reachableFrom counterexamples", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    const reportPath = join(dir, "report.json");
    const replayTestsDir = join(dir, "replay-tests");
    const actionReplayTestsDir = join(dir, "action-replay-tests");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "reachableFrom", name: "flagCannotReturnFalse", when: state => state.flag === true, goal: state => state.flag === false, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      propsPath,
      reportPath,
      replayTestsDir,
      actionReplayTestsDir,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.report.verdicts[0]).toMatchObject({
      property: "flagCannotReturnFalse",
      status: "violated",
      replayable: false,
    });
    expect(result.lines.some((line) => line.startsWith("replayTest="))).toBe(
      false,
    );
    expect(await readdir(replayTestsDir)).toEqual([]);
    expect(await readdir(actionReplayTestsDir)).toEqual([]);
  });

  it("does not emit replay tests for locatorless user-event counterexamples", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    const reportPath = join(dir, "report.json");
    const replayTestsDir = join(dir, "replay-tests");
    const actionReplayTestsDir = join(dir, "action-replay-tests");
    const locatorless = {
      ...model(),
      transitions: model().transitions.map((transition) => ({
        ...transition,
        label: { kind: "click", text: "Set flag" },
      })),
    };
    await writeFile(modelPath, JSON.stringify(locatorless), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: state => state.flag === false, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      propsPath,
      reportPath,
      replayTestsDir,
      actionReplayTestsDir,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.report.verdicts[0]).toMatchObject({
      property: "flagStartsFalseOnly",
      status: "violated",
      replayable: false,
    });
    expect(result.report.verdicts[0]?.replayBlockedReason).toContain(
      "setFlag:click",
    );
    expect(result.lines.some((line) => line.startsWith("replayTest="))).toBe(
      false,
    );
    expect(await readdir(replayTestsDir)).toEqual([]);
    expect(await readdir(actionReplayTestsDir)).toEqual([]);
  });

  it("renders plugin provenance metadata in the trust ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    await writeFile(
      modelPath,
      JSON.stringify({
        ...model(),
        metadata: {
          plugins: [
            {
              id: "swr",
              version: "0.1.0",
              kind: "state-source",
              packageNames: ["swr"],
            },
          ],
        },
      }),
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.report.trustLedger.plugins).toEqual([
      {
        id: "swr",
        version: "0.1.0",
        kind: "state-source",
        packageNames: ["swr"],
      },
    ]);
  });

  it("embeds extraction caveats from model metadata in the trust ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const globalTaint = {
      id: "local:App.status",
      reason: "Global taint local:App.status",
    };
    const staleRead = {
      id: "App.onClick.api.save:local:App.status",
      reason: "Stale-read risk App.onClick.api.save:local:App.status",
    };
    const unhandledRejection = {
      id: "App.onClick.api.save",
      reason: "Unhandled rejection App.onClick.api.save",
    };
    const unextractableHandler = {
      id: "App.onClick",
      reason: "Unextractable handler App.onClick",
    };
    await writeFile(
      modelPath,
      JSON.stringify({
        ...model(),
        metadata: {
          extractionCaveats: {
            globalTaints: [globalTaint],
            staleReads: [staleRead],
            unhandledRejections: [unhandledRejection],
            unextractableHandlers: [unextractableHandler],
          },
        },
      }),
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.report.trustLedger.globalTaints).toEqual([globalTaint]);
    expect(result.report.trustLedger.staleReads).toEqual([staleRead]);
    expect(result.report.trustLedger.unhandledRejections).toEqual([
      unhandledRejection,
    ]);
    expect(result.report.trustLedger.unextractableHandlers).toEqual([
      unextractableHandler,
    ]);
  });

  it("applies overlay artifacts before checking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    const overlayPath = join(dir, "overlay.json");
    const reportPath = join(dir, "report.json");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [{ kind: "reachable", name: "flagCanBecomeTrue", predicate: state => state.flag === true }];`,
      "utf8",
    );
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
            effect: {
              kind: "assign",
              var: "flag",
              expr: { kind: "lit", value: false },
            },
            reads: [],
            writes: ["flag"],
            confidence: "exact",
          },
        ],
        domains: [
          {
            var: "payload",
            domain: { kind: "enum", values: ["empty", "loaded"] },
            initial: "empty",
          },
        ],
      }),
      "utf8",
    );
    const result = await runCheckCommand({
      modelPath,
      propsPath,
      overlayPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.check.verdicts[0]?.status).toBe("vacuous-warning");
    expect(report.trustLedger.manualTransitions).toEqual(["setFlag"]);
    expect(report.trustLedger.domains).toContainEqual({
      varId: "payload",
      domainKind: "enum",
      provenance: "overlay-refined",
    });
    expect(report.trustLedger.ignoredVars).toEqual([]);
  });

  it("uses slicing by default when property reads are declared", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: state => state.flag === false, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      propsPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.check.diagnostics?.slicing?.enabled).toBe(true);
    expect(
      result.lines.some((line) => line.startsWith("slicing=slices:")),
    ).toBe(true);
  });

  it("reports search-limit diagnostics when configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    const reportPath = join(dir, "report.json");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: state => state.flag === true, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      propsPath,
      reportPath,
      searchLimits: { maxStates: 1 },
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(2);
    expect(
      result.check.verdicts.some((verdict) => verdict.status === "error"),
    ).toBe(true);
    const errorVerdict = result.check.verdicts.find(
      (verdict) => verdict.status === "error",
    );
    expect(errorVerdict?.message).toContain("maxStates=1");
    expect(result.check.diagnostics?.limits?.maxStates).toBe(1);
    expect(result.report.diagnostics?.limits?.maxStates).toBe(1);
    expect(
      result.lines.some((line) => line.startsWith("search-limit=maxStates")),
    ).toBe(true);
  });

  it("does not apply search limits when searchLimits is false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: state => state.flag === false, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      propsPath,
      searchLimits: false,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.check.diagnostics?.limits).toBeUndefined();
  });

  it("reports storage diagnostics when available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: state => state.flag === false, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      propsPath,
      searchLimits: false,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.check.diagnostics?.storage?.edgeRecordingMode).toBe("none");
    expect(result.check.diagnostics?.storage?.recordedEdges).toBe(0);
    expect(
      result.lines.some((line) => line.startsWith("storage=mode:none")),
    ).toBe(true);
  });

  it("reports hot-path diagnostics when available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: state => state.flag === false, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      propsPath,
      searchLimits: false,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.check.diagnostics?.hotPath).toMatchObject({
      canonicalCache: true,
      transitionIndex: true,
    });
    expect(
      result.lines.some((line) =>
        line.startsWith("hotPath=canonicalCache:true"),
      ),
    ).toBe(true);
  });

  it("rejects unsupported model artifact versions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    await writeFile(
      modelPath,
      JSON.stringify({
        schemaVersion: 2,
        id: "future",
        vars: [],
        transitions: [],
        bounds: {},
      }),
      "utf8",
    );
    await expect(runCheckCommand({ modelPath })).rejects.toThrow(
      "unsupported model schemaVersion 2",
    );
  });
});

describe("renderHumanCheckResult", () => {
  it("prints Properties before Stats", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: state => state.flag === false },
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: state => state.flag === true }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({ modelPath, propsPath });
    const lines = renderHumanCheckResult(result.check);
    const propertiesIndex = lines.indexOf("Properties");
    const statsIndex = lines.indexOf("Stats");
    expect(propertiesIndex).toBeGreaterThanOrEqual(0);
    expect(statsIndex).toBeGreaterThan(propertiesIndex);
    expect(
      lines.some((line) => line.includes("flagStartsFalseOnly violated")),
    ).toBe(true);
    expect(lines.some((line) => line.includes("states="))).toBe(true);
  });

  it("maps all verdict statuses to expected symbols", () => {
    expect(symbolForStatus("verified-within-bounds")).toBe("✓");
    expect(symbolForStatus("reachable")).toBe("✓");
    expect(symbolForStatus("violated")).toBe("×");
    expect(symbolForStatus("error")).toBe("×");
    expect(symbolForStatus("vacuous-warning")).toBe("⚠");
  });

  it("includes ANSI escapes in color mode and not in plain mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: state => state.flag === false }
      ];`,
      "utf8",
    );
    const result = await runCheckCommand({ modelPath, propsPath });
    const plain = renderHumanCheckResult(result.check, { color: false });
    const colored = renderHumanCheckResult(result.check, { color: true });
    expect(plain.join("\n")).not.toContain("\u001b[");
    expect(colored.join("\n")).toContain("\u001b[");
  });
});

describe("runCheckCommand streaming output", () => {
  it("calls emit before artifact lines while returning legacy lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    const tracesDir = join(dir, "traces");
    const replayTestsDir = join(dir, "replay-tests");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: state => state.flag === false }
      ];`,
      "utf8",
    );

    const emitted: string[] = [];
    const result = await runCheckCommand({
      modelPath,
      propsPath,
      tracesDir,
      replayTestsDir,
      output: {
        human: true,
        emit: (line) => emitted.push(line),
      },
    });

    expect(result.lines).toContain("flagStartsFalseOnly: violated");
    expect(emitted.some((line) => line === "Properties")).toBe(true);
    expect(emitted.some((line) => line === "Stats")).toBe(true);
    const propertiesIndex = emitted.indexOf("Properties");
    const artifactsIndex = emitted.indexOf("Artifacts");
    expect(propertiesIndex).toBeGreaterThanOrEqual(0);
    expect(artifactsIndex).toBeGreaterThan(propertiesIndex);
    expect(result.lines.some((line) => line.startsWith("trace="))).toBe(true);
  });
});
