import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJson, type Model, type Property } from "modality-ts/core";
import { describe, expect, it } from "vitest";
import { runReplayCommand } from "../../replay.js";
import { runCheckCommand } from "./index.js";
import {
  renderHumanCheckResult,
  renderHumanCheckTargets,
  symbolForStatus,
} from "./output.js";

const flagFalseIr = `{ kind: "eq", args: [{ kind: "read", var: "flag" }, { kind: "lit", value: false }] }`;
const flagTrueIr = `{ kind: "eq", args: [{ kind: "read", var: "flag" }, { kind: "lit", value: true }] }`;

const IMPORT_CACHE_DIR = join(process.cwd(), ".modality", "import-cache");
const LONG_PATH_SEGMENT =
  "very-long-path-segment-for-import-cache-filename-regression";

async function cacheEntries(): Promise<Set<string>> {
  try {
    const entries = await readdir(IMPORT_CACHE_DIR);
    return new Set(entries);
  } catch {
    return new Set();
  }
}

function difference(after: string[], before: Set<string>): string[] {
  return after.filter((entry) => !before.has(entry));
}

async function longNestedPath(root: string): Promise<string> {
  let current = root;
  for (let i = 0; i < 4; i++) {
    current = join(current, LONG_PATH_SEGMENT);
  }
  await mkdir(current, { recursive: true });
  return current;
}

function model(): Model {
  return {
    schemaVersion: 1,
    id: "cli-fixture",
    bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
    vars: [
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
        predicate: {
          kind: "eq",
          args: [
            { kind: "read", var: "flag" },
            { kind: "lit", value: false },
          ],
        },
      },
      {
        kind: "reachable",
        name: "flagCanBecomeTrue",
        predicate: {
          kind: "eq",
          args: [
            { kind: "read", var: "flag" },
            { kind: "lit", value: true },
          ],
        },
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

    const propsPath = join(dir, "props.ts");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr}, reads: ["flag"] },
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: ${flagTrueIr}, reads: ["flag"] }
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
        modelSlack: [],
        domains: [
          { varId: "flag", domainKind: "bool", provenance: "system" },
          { varId: "payload", domainKind: "tokens", provenance: "system" },
        ],
        overApproxTransitions: ["setFlag"],
        boundHits: [],
        ignoredVars: [],
        numericReductions: [],
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
      ]),
    );
  });

  it("checks models with role-based location vars", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const locationRoute = { kind: "enum", values: ["/", "/home"] } as const;
    await writeFile(
      modelPath,
      JSON.stringify({
        schemaVersion: 1,
        id: "role-location-fixture",
        bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
        vars: [
          {
            id: "app:location",
            domain: locationRoute,
            origin: "system",
            scope: { kind: "global" },
            role: { kind: "location-current", group: "default" },
            initial: "/",
          },
          {
            id: "app:history",
            domain: {
              kind: "boundedList",
              inner: locationRoute,
              maxLen: 2,
            },
            origin: "system",
            scope: { kind: "global" },
            role: { kind: "location-history", group: "default" },
            initial: [],
          },
          {
            id: "flag",
            domain: { kind: "bool" },
            origin: "system",
            scope: { kind: "global" },
            initial: false,
          },
        ],
        transitions: [],
      }),
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.trustLedger.domains).toEqual(
      expect.arrayContaining([
        { varId: "app:location", domainKind: "enum", provenance: "system" },
        {
          varId: "app:history",
          domainKind: "boundedList",
          provenance: "system",
        },
      ]),
    );
  });

  it("does not emit replay tests for non-replayable reachableFrom counterexamples", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const reportPath = join(dir, "report.json");
    const replayTestsDir = join(dir, "replay-tests");
    const actionReplayTestsDir = join(dir, "action-replay-tests");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "reachableFrom", name: "flagCannotReturnFalse", when: ${flagTrueIr}, goal: ${flagFalseIr}, reads: ["flag"] }
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
    const propsPath = join(dir, "props.ts");
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
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr}, reads: ["flag"] }
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
      kind: "global-taint" as const,
      id: "local:App.status",
      reason: "global-taint:local:App.status",
      severity: "unsound-risk" as const,
    };
    const staleRead = {
      kind: "stale-read" as const,
      id: "App.onClick.api.save:local:App.status",
      reason: "Stale-read risk App.onClick.api.save:local:App.status",
      severity: "info" as const,
    };
    const unhandledRejection = {
      kind: "unhandled-rejection" as const,
      id: "App.onClick.api.save",
      reason: "Unhandled rejection App.onClick.api.save",
      severity: "over-approx" as const,
    };
    const unextractableHandler = {
      kind: "unextractable" as const,
      id: "App.onClick",
      reason: "Unextractable handler App.onClick",
      severity: "over-approx" as const,
    };
    const modelSlack = {
      kind: "model-slack" as const,
      id: "local:App.payload",
      reason: "Wide product domain (257 values) may enlarge search",
      severity: "over-approx" as const,
    };
    await writeFile(
      modelPath,
      JSON.stringify({
        ...model(),
        metadata: {
          extractionCaveats: {
            entries: [
              globalTaint,
              staleRead,
              unhandledRejection,
              unextractableHandler,
              modelSlack,
            ],
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
    expect(result.report.trustLedger.modelSlack).toEqual([modelSlack]);
  });

  it("renders numeric reduction metadata and downgrades heuristic claims", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    await writeFile(
      modelPath,
      JSON.stringify({
        ...model(),
        vars: [
          ...model().vars,
          {
            id: "amount",
            domain: { kind: "enum", values: ["validSmall", "aboveMax"] },
            origin: "system",
            scope: { kind: "global" },
            initial: "validSmall",
          },
        ],
        metadata: {
          numericReductions: {
            entries: [
              {
                varId: "amount",
                kind: "input-class",
                claim: "heuristic",
                reason: "User-entered numeric input modeled as classes",
              },
            ],
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      propsPath,
      `export const properties = [
  {
    kind: "always",
    name: "amountKnown",
    predicate: { kind: "eq", args: [{ kind: "read", var: "amount" }, { kind: "lit", value: "validSmall" }] },
    reads: ["amount"],
  },
];`,
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      propsPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.report.trustLedger.numericReductions).toEqual([
      {
        varId: "amount",
        kind: "input-class",
        claim: "heuristic",
        reason: "User-entered numeric input modeled as classes",
      },
    ]);
    expect(result.report.verdicts[0]).toMatchObject({
      property: "amountKnown",
      status: "vacuous-warning",
    });
  });

  it("applies overlay artifacts before checking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const overlayPath = join(dir, "overlay.json");
    const reportPath = join(dir, "report.json");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [{ kind: "reachable", name: "flagCanBecomeTrue", predicate: ${flagTrueIr}, reads: ["flag"] }];`,
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

  it("embeds slice economics in sliced check report diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    await writeFile(
      modelPath,
      JSON.stringify({
        ...model(),
        vars: [
          ...model().vars,
          {
            id: "noise",
            domain: {
              kind: "enum",
              values: Array.from({ length: 32 }, (_, index) => `n${index}`),
            },
            origin: "system",
            scope: { kind: "global" },
            initial: "n0",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr}, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      propsPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const summary = result.report.diagnostics?.slicing?.sliceSummaries?.[0];
    expect(summary?.retainedBits).toBeGreaterThan(0);
    expect(summary?.prunedBits).toBeGreaterThan(0);
    expect(summary?.topContributors?.length).toBeGreaterThan(0);
    expect(
      summary?.prunedTopContributors?.map((entry) => entry.varId),
    ).toContain("noise");
    expect(summary?.mode).toBeDefined();
  });

  it("includes pruned field paths in slice contributor diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const sessionPredicate = `{ kind: "eq", args: [{ kind: "read", var: "session", path: ["user", "id"] }, { kind: "lit", value: "blocked" }] }`;
    await writeFile(
      modelPath,
      JSON.stringify({
        schemaVersion: 1,
        id: "field-pruning-check",
        bounds: { maxDepth: 4, maxPending: 2, maxInternalSteps: 4 },
        vars: [
          {
            id: "session",
            domain: {
              kind: "record",
              fields: {
                user: {
                  kind: "record",
                  fields: {
                    id: { kind: "tokens", count: 1 },
                    avatarUrl: { kind: "tokens", count: 1 },
                  },
                },
              },
            },
            origin: { file: "fixture.ts", line: 1 },
            scope: { kind: "global" },
            initial: { user: { id: "u1", avatarUrl: "" } },
          },
          {
            id: "noise",
            domain: { kind: "enum", values: ["a", "b"] },
            origin: "system",
            scope: { kind: "global" },
            initial: "a",
          },
        ],
        transitions: [
          {
            id: "noop",
            cls: "internal",
            label: { kind: "internal", text: "noop" },
            source: [{ file: "fixture.ts", line: 2 }],
            guard: { kind: "lit", value: true },
            effect: {
              kind: "assign",
              var: "session",
              expr: {
                kind: "lit",
                value: { user: { id: "u2", avatarUrl: "" } },
              },
            },
            reads: [],
            writes: ["session"],
            confidence: "exact",
          },
        ],
        metadata: {
          fieldPruning: {
            entries: [
              {
                varId: "session",
                keptPaths: [["user", "id"]],
                prunedPaths: [["user", "avatarUrl"]],
                reason: "unread",
                confidence: "exact",
              },
            ],
          },
        },
      } satisfies Model),
      "utf8",
    );
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "idNotBlocked", predicate: ${sessionPredicate}, reads: ["session"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      propsPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const contributor =
      result.report.diagnostics?.slicing?.sliceSummaries?.[0]?.topContributors?.find(
        (entry) => entry.varId === "session",
      );
    expect(contributor?.prunedFieldPaths).toEqual([["user", "avatarUrl"]]);
  });

  it("uses slicing by default when property reads are declared", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr}, reads: ["flag"] }
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

  it("uses slicing by default for serializable properties without explicit reads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr} }
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
    const propsPath = join(dir, "props.ts");
    const reportPath = join(dir, "report.json");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: ${flagTrueIr}, reads: ["flag"] }
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
    const propsPath = join(dir, "props.ts");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr}, reads: ["flag"] }
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
    const propsPath = join(dir, "props.ts");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr}, reads: ["flag"] }
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
    const propsPath = join(dir, "props.ts");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr}, reads: ["flag"] }
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

  it("loads TypeScript properties from long absolute paths with bounded import-cache filenames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-long-ts-"));
    const nested = await longNestedPath(dir);
    const modelPath = resolve(nested, "model.json");
    const propsPath = resolve(nested, "index.props.ts");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: ${flagTrueIr}, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const before = await cacheEntries();
    const result = await runCheckCommand({
      modelPath,
      propsPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const after = await readdir(IMPORT_CACHE_DIR).catch(() => []);
    const newEntries = difference(after, before);

    expect(result.exitCode).toBe(0);
    expect(result.report.verdicts[0]).toMatchObject({
      property: "flagCanBecomeTrue",
      status: "reachable",
    });
    expect(newEntries.length).toBeGreaterThanOrEqual(1);
    for (const entry of newEntries) {
      expect(entry.length).toBeLessThan(120);
      expect(entry).not.toContain(LONG_PATH_SEGMENT);
      expect(entry).toMatch(/^props-[0-9a-f]{64}\.\d+\.\d+\.mjs$/);
    }
  });

  it("copies non-TypeScript properties from long absolute paths with bounded import-cache filenames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-long-mjs-"));
    const nested = await longNestedPath(dir);
    const modelPath = resolve(nested, "model.json");
    const propsPath = resolve(nested, "index.props.mjs");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: ${flagTrueIr}, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const before = await cacheEntries();
    const result = await runCheckCommand({
      modelPath,
      propsPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const after = await readdir(IMPORT_CACHE_DIR).catch(() => []);
    const newEntries = difference(after, before);

    expect(result.exitCode).toBe(0);
    expect(result.report.verdicts[0]).toMatchObject({
      property: "flagCanBecomeTrue",
      status: "reachable",
    });
    expect(newEntries.length).toBeGreaterThanOrEqual(1);
    for (const entry of newEntries) {
      expect(entry.length).toBeLessThan(120);
      expect(entry).not.toContain(LONG_PATH_SEGMENT);
      expect(entry).toMatch(/^props-[0-9a-f]{64}\.\d+\.\d+\.mjs$/);
    }
  });
});

describe("renderHumanCheckTargets", () => {
  it("prints a status row instead of Properties", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr}, reads: ["flag"] },
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: ${flagTrueIr}, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({ modelPath, propsPath });
    const lines = renderHumanCheckTargets(
      [
        {
          modelPath,
          propsPath: "props.ts",
          check: result.check,
          reportPath: "report.json",
          artifacts: [{ kind: "trace", path: "traces/foo.trace.json" }],
          durationMs: 12,
        },
      ],
      {
        startedAt: new Date("2026-06-12T11:36:28.000Z"),
        totalDurationMs: 1270,
        showArtifacts: true,
      },
    );
    expect(lines[0]).toMatch(/^ [×✓⚠] props\.ts /);
    expect(lines.join("\n")).not.toContain("Properties");
    expect(lines.join("\n")).not.toContain("Stats");
    expect(
      lines.some((line) => line === "  × flagStartsFalseOnly violated"),
    ).toBe(true);
    expect(lines.some((line) => line.includes("Test Files"))).toBe(true);
    expect(lines.some((line) => line.includes("Tests"))).toBe(true);
    expect(lines.some((line) => line.includes("Start at"))).toBe(true);
    expect(lines.some((line) => line.includes("Duration"))).toBe(true);
    const artifactsIndex = lines.findIndex((line) =>
      line.trimStart().startsWith("Artifacts"),
    );
    const testFilesIndex = lines.findIndex((line) =>
      line.includes("Test Files"),
    );
    expect(artifactsIndex).toBeGreaterThanOrEqual(0);
    expect(artifactsIndex).toBeGreaterThan(testFilesIndex);
    expect(lines.some((line) => line.includes("(trace)"))).toBe(true);
  });

  it("hides Artifacts by default and shows them when showArtifacts is true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr}, reads: ["flag"] },
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: ${flagTrueIr}, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({ modelPath, propsPath });
    const target = {
      modelPath,
      propsPath: "props.ts",
      check: result.check,
      reportPath: "report.json",
      artifacts: [{ kind: "trace" as const, path: "traces/foo.trace.json" }],
      durationMs: 12,
    };
    const renderOptions = {
      startedAt: new Date("2026-06-12T11:36:28.000Z"),
      totalDurationMs: 1270,
    };

    const hidden = renderHumanCheckTargets([target], renderOptions);
    expect(
      hidden.some((line) => line.trimStart().startsWith("Artifacts")),
    ).toBe(false);
    expect(hidden.some((line) => line.includes("(trace)"))).toBe(false);

    const shown = renderHumanCheckTargets([target], {
      ...renderOptions,
      showArtifacts: true,
    });
    expect(shown.some((line) => line.trimStart().startsWith("Artifacts"))).toBe(
      true,
    );
    expect(shown.some((line) => line.includes("(trace)"))).toBe(true);
  });

  it("prefixes passing property verdicts with a pass symbol", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: ${flagTrueIr}, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({ modelPath, propsPath });
    const lines = renderHumanCheckTargets(
      [
        {
          modelPath,
          propsPath: "props.ts",
          check: result.check,
          artifacts: [],
          durationMs: 5,
        },
      ],
      {
        startedAt: new Date("2026-06-12T11:36:28.000Z"),
        totalDurationMs: 12,
      },
    );
    expect(
      lines.some((line) => line === "  ✓ flagCanBecomeTrue reachable"),
    ).toBe(true);
  });

  it("aggregates multiple targets before the summary block", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: ${flagTrueIr}, reads: ["flag"] }
      ];`,
      "utf8",
    );
    const result = await runCheckCommand({ modelPath, propsPath });
    const lines = renderHumanCheckTargets(
      [
        {
          modelPath,
          propsPath: "a.props.ts",
          check: result.check,
          artifacts: [],
          durationMs: 5,
        },
        {
          modelPath,
          propsPath: "b.props.ts",
          check: result.check,
          artifacts: [],
          durationMs: 7,
        },
      ],
      {
        startedAt: new Date("2026-06-12T11:36:28.000Z"),
        totalDurationMs: 12,
      },
    );
    const testFilesIndex = lines.findIndex((line) =>
      line.includes("Test Files"),
    );
    expect(lines.slice(0, testFilesIndex).join("\n")).toContain("a.props.ts");
    expect(lines.slice(0, testFilesIndex).join("\n")).toContain("b.props.ts");
    expect(lines[testFilesIndex]).toContain("2 passed (2)");
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
    const propsPath = join(dir, "props.ts");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr}, reads: ["flag"] }
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
  it("calls emit with row-oriented output while returning legacy lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const tracesDir = join(dir, "traces");
    const replayTestsDir = join(dir, "replay-tests");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr}, reads: ["flag"] }
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
    expect(emitted.join("\n")).not.toContain("Properties");
    expect(emitted.some((line) => line.match(/^ [×✓⚠] /))).toBe(true);
    expect(emitted.some((line) => line.includes("Test Files"))).toBe(true);
    expect(result.lines.some((line) => line.startsWith("trace="))).toBe(true);
  });

  it("rejects function-valued property predicates with a migration error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const reportPath = join(dir, "report.json");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "legacy", predicate: state => state.flag === false }
      ];`,
      "utf8",
    );

    await expect(
      runCheckCommand({
        modelPath,
        propsPath,
        reportPath,
      }),
    ).rejects.toThrow("serializable IR, not functions");
  });

  it("propagates memory guard limits to the Rust checker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const reportPath = join(dir, "report.json");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: ${flagFalseIr}, reads: ["flag"] }
      ];`,
      "utf8",
    );

    const result = await runCheckCommand({
      modelPath,
      propsPath,
      reportPath,
      searchLimits: { memoryGuardBytes: 1 },
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.check.diagnostics?.limits?.memoryGuardBytes).toBe(1);
    expect(result.check.diagnostics?.limits?.reason).toContain(
      "memoryGuardBytes=1",
    );
    expect(
      result.lines.some((line) => line.startsWith("search-limit=memoryGuard")),
    ).toBe(true);
  });
});
