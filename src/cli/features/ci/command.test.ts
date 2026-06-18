import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Model } from "modality-ts/core";
import { runCiCommand } from "./index.js";
import { renderHumanCiResult } from "./output.js";

const flagAlwaysFalseProps = `export const properties = [{ kind: "always", name: "flagAlwaysFalse", predicate: { kind: "eq", args: [{ kind: "read", var: "flag" }, { kind: "lit", value: false }] }, reads: ["flag"] }];`;
const flagTrueProps = `export const properties = [{ kind: "reachable", name: "flagCanBecomeTrue", predicate: { kind: "eq", args: [{ kind: "read", var: "flag" }, { kind: "lit", value: true }] }, reads: ["flag"] }];`;
const flagFalseReachableProps = `export const properties = [{ kind: "reachable", name: "flagAlreadyFalse", predicate: { kind: "eq", args: [{ kind: "read", var: "flag" }, { kind: "lit", value: false }] }, reads: ["flag"] }];`;

function model(): Model {
  return {
    schemaVersion: 1,
    id: "ci-fixture",
    bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      {
        id: "flag",
        domain: { kind: "bool" },
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
    ],
    transitions: [
      {
        id: "setFlag",
        cls: "user",
        label: { kind: "click", text: "Set flag" },
        source: [],
        guard: { kind: "not", args: [{ kind: "read", var: "flag" }] },
        effect: {
          kind: "assign",
          var: "flag",
          expr: { kind: "lit", value: true },
        },
        reads: ["flag"],
        writes: ["flag"],
        confidence: "exact",
      },
    ],
  };
}

function baselineDomains() {
  return [{ varId: "flag", domainKind: "bool", provenance: "system" }];
}

function baselineTrustLedger() {
  return {
    bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
    plugins: [],
    assumptions: [],
    abstractions: [],
    globalTaints: [],
    staleReads: [],
    unhandledRejections: [],
    unextractableHandlers: [],
    domains: baselineDomains(),
    manualTransitions: [],
    overApproxTransitions: [],
    boundHits: [],
    ignoredVars: [],
    numericReductions: [],
  };
}

describe("runCiCommand", () => {
  it("writes report and traces and fails on violations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const artifactDir = join(dir, ".modality");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(propsPath, flagAlwaysFalseProps, "utf8");

    const result = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.lines).toEqual([
      "ci: failed",
      "violations=1 errors=0",
      "determinism=passed",
      `report=${join(artifactDir, "report.json")}`,
      `traces=${join(artifactDir, "traces")}`,
    ]);
    const report = JSON.parse(
      await readFile(join(artifactDir, "report.json"), "utf8"),
    );
    expect(report.verdicts[0]).toMatchObject({
      property: "flagAlwaysFalse",
      status: "violated",
    });
    const trace = JSON.parse(
      await readFile(
        join(artifactDir, "traces", "flagAlwaysFalse.violated.trace.json"),
        "utf8",
      ),
    );
    expect(trace).toMatchObject({ schemaVersion: 1, kind: "trace" });
    expect(
      trace.steps.map((step: { transitionId: string }) => step.transitionId),
    ).toEqual(["setFlag"]);
  });

  it("passes when all properties hold", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const artifactDir = join(dir, ".modality");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(propsPath, flagTrueProps, "utf8");

    const result = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toBe("ci: passed");
    expect(result.lines).toContain("determinism=passed");
  });

  it("fails when trust ledger regresses against a baseline report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const baselinePath = join(dir, "baseline-report.json");
    const artifactDir = join(dir, ".modality");
    const current = model();
    const firstTransition = current.transitions[0];
    if (!firstTransition) throw new Error("fixture missing transition");
    current.transitions = [{ ...firstTransition, confidence: "manual" }];
    await writeFile(modelPath, JSON.stringify(current), "utf8");
    await writeFile(propsPath, flagTrueProps, "utf8");
    await writeFile(
      baselinePath,
      JSON.stringify({
        schemaVersion: 1,
        kind: "check-report",
        modelId: "ci-fixture",
        generatedAt: "2026-06-11T00:00:00.000Z",
        verdicts: [],
        stats: { states: 0, edges: 0, depth: 0 },
        vacuityWarnings: [],
        trustLedger: baselineTrustLedger(),
      }),
      "utf8",
    );

    const result = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir,
      baselinePath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(3);
    expect(result.lines).toContain("determinism=passed");
    expect(result.lines).toContain("trust-regressions=1");
    expect(result.lines).toContain(
      "trust-regression: manualTransitions 0->1 new=setFlag",
    );
  });

  it("fails when plugin provenance changes against a baseline report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const baselinePath = join(dir, "baseline-report.json");
    const artifactDir = join(dir, ".modality");
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
    await writeFile(propsPath, flagFalseReachableProps, "utf8");
    await writeFile(
      baselinePath,
      JSON.stringify({
        schemaVersion: 1,
        kind: "check-report",
        modelId: "ci-fixture",
        generatedAt: "2026-06-11T00:00:00.000Z",
        verdicts: [],
        stats: { states: 0, edges: 0, depth: 0 },
        vacuityWarnings: [],
        trustLedger: baselineTrustLedger(),
      }),
      "utf8",
    );

    const result = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir,
      baselinePath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(3);
    expect(result.lines).toContain(
      "trust-regression: plugins 0->1 new=state-source:swr@0.1.0[swr]",
    );
  });

  it("fails when the trust-ledger domain table grows against a baseline report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const baselinePath = join(dir, "baseline-report.json");
    const artifactDir = join(dir, ".modality");
    await writeFile(
      modelPath,
      JSON.stringify({
        ...model(),
        vars: [
          ...model().vars,
          {
            id: "local:App.payload",
            domain: { kind: "tokens", count: 1 },
            origin: { file: "App.tsx", line: 1 },
            scope: { kind: "global" },
            initial: "tok1",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(propsPath, flagFalseReachableProps, "utf8");
    await writeFile(
      baselinePath,
      JSON.stringify({
        schemaVersion: 1,
        kind: "check-report",
        modelId: "ci-fixture",
        generatedAt: "2026-06-11T00:00:00.000Z",
        verdicts: [],
        stats: { states: 0, edges: 0, depth: 0 },
        vacuityWarnings: [],
        trustLedger: baselineTrustLedger(),
      }),
      "utf8",
    );

    const result = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir,
      baselinePath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(3);
    expect(result.lines).toContain(
      "trust-regression: domains 1->2 new=local:App.payload:tokens:default-token",
    );
  });

  it("fails when ignored vars grow against a baseline report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const overlayPath = join(dir, "overlay.json");
    const baselinePath = join(dir, "baseline-report.json");
    const artifactDir = join(dir, ".modality");
    await writeFile(
      modelPath,
      JSON.stringify({
        ...model(),
        vars: [
          ...model().vars,
          {
            id: "debug",
            domain: { kind: "bool" },
            origin: "system",
            scope: { kind: "global" },
            initial: false,
          },
        ],
        transitions: [
          ...model().transitions,
          {
            id: "setDebug",
            cls: "user",
            label: { kind: "click", text: "Debug" },
            source: [],
            guard: { kind: "lit", value: true },
            effect: {
              kind: "assign",
              var: "debug",
              expr: { kind: "lit", value: true },
            },
            reads: [],
            writes: ["debug"],
            confidence: "exact",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      overlayPath,
      JSON.stringify({ ignoreVars: ["debug"] }),
      "utf8",
    );
    await writeFile(propsPath, flagFalseReachableProps, "utf8");
    await writeFile(
      baselinePath,
      JSON.stringify({
        schemaVersion: 1,
        kind: "check-report",
        modelId: "ci-fixture",
        generatedAt: "2026-06-11T00:00:00.000Z",
        verdicts: [],
        stats: { states: 0, edges: 0, depth: 0 },
        vacuityWarnings: [],
        trustLedger: baselineTrustLedger(),
      }),
      "utf8",
    );

    const result = await runCiCommand({
      modelPath,
      propsPath,
      overlayPath,
      artifactDir,
      baselinePath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(3);
    expect(result.lines).toContain(
      "trust-regression: ignoredVars 0->1 new=debug",
    );
  });

  it("fails when extraction caveats grow against a baseline report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const baselinePath = join(dir, "baseline-report.json");
    const artifactDir = join(dir, ".modality");
    await writeFile(
      modelPath,
      JSON.stringify({
        ...model(),
        metadata: {
          extractionCaveats: {
            entries: [
              {
                kind: "unhandled-rejection",
                id: "App.onClick.api.save",
                reason: "Unhandled rejection App.onClick.api.save",
                severity: "over-approx",
              },
            ],
          },
        },
      }),
      "utf8",
    );
    await writeFile(propsPath, flagFalseReachableProps, "utf8");
    await writeFile(
      baselinePath,
      JSON.stringify({
        schemaVersion: 1,
        kind: "check-report",
        modelId: "ci-fixture",
        generatedAt: "2026-06-11T00:00:00.000Z",
        verdicts: [],
        stats: { states: 0, edges: 0, depth: 0 },
        vacuityWarnings: [],
        trustLedger: baselineTrustLedger(),
      }),
      "utf8",
    );

    const result = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir,
      baselinePath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(3);
    expect(result.lines).toContain(
      "trust-regression: unhandledRejections 0->1 new=App.onClick.api.save:Unhandled rejection App.onClick.api.save",
    );
  });

  it("rejects unsupported baseline check report artifact versions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const baselinePath = join(dir, "baseline-report.json");
    const artifactDir = join(dir, ".modality");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(propsPath, flagTrueProps, "utf8");
    await writeFile(
      baselinePath,
      JSON.stringify({
        schemaVersion: 2,
        kind: "check-report",
        modelId: "ci-fixture",
        generatedAt: "2026-06-11T00:00:00.000Z",
        verdicts: [],
        stats: { states: 0, edges: 0, depth: 0 },
        vacuityWarnings: [],
        trustLedger: baselineTrustLedger(),
      }),
      "utf8",
    );

    await expect(
      runCiCommand({
        modelPath,
        propsPath,
        artifactDir,
        baselinePath,
        now: new Date("2026-06-12T00:00:00.000Z"),
      }),
    ).rejects.toThrow("unsupported check report schemaVersion 2");
  });

  it("runs generated conformance walks as part of CI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const artifactDir = join(dir, ".modality");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(propsPath, flagTrueProps, "utf8");

    const result = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir,
      conformCount: 2,
      conformDepth: 2,
      conformSeed: 7,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.lines).toContain("conform-pass-rate=1");
    expect(result.lines).toContain(
      "conform: total=2 reproduced=2 notReproduced=0 inconclusive=0",
    );
  });

  it("passes CI source freshness when model source hash matches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const sourcePath = join(dir, "App.tsx");
    const artifactDir = join(dir, ".modality");
    const source = "export function App() { return null; }";
    await writeFile(sourcePath, source, "utf8");
    await writeFile(
      modelPath,
      JSON.stringify({
        ...model(),
        metadata: { sourceHashes: { [sourcePath]: sha256(source) } },
      }),
      "utf8",
    );
    await writeFile(propsPath, flagTrueProps, "utf8");

    const result = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir,
      sourcePath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.lines).toContain("source-freshness=passed");
  });

  it("fails CI source freshness when model source hash is stale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const sourcePath = join(dir, "App.tsx");
    const artifactDir = join(dir, ".modality");
    await writeFile(
      sourcePath,
      "export function App() { return null; }",
      "utf8",
    );
    await writeFile(
      modelPath,
      JSON.stringify({
        ...model(),
        metadata: { sourceHashes: { [sourcePath]: "0".repeat(64) } },
      }),
      "utf8",
    );
    await writeFile(propsPath, flagTrueProps, "utf8");

    const result = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir,
      sourcePath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(6);
    expect(result.lines).toContain("source-freshness=failed");
    expect(
      result.lines.some((line) =>
        line.startsWith(`source-stale: ${sourcePath} expected=`),
      ),
    ).toBe(true);
  });

  it("fails CI when conformance pass rate is below the configured threshold", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const walksPath = join(dir, "walks.json");
    const artifactDir = join(dir, ".modality");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(propsPath, flagTrueProps, "utf8");
    await writeFile(
      walksPath,
      JSON.stringify(
        conformWalks([
          {
            id: "diverged",
            trace: {
              steps: [
                {
                  transitionId: "setFlag",
                  label: { kind: "click", text: "Set flag" },
                  pre: {
                    flag: false,
                  },
                  post: {
                    flag: true,
                  },
                  diff: { flag: { before: false, after: true } },
                },
              ],
            },
            states: [
              {
                flag: false,
              },
              {
                flag: false,
              },
            ],
          },
        ]),
      ),
      "utf8",
    );

    const result = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir,
      conformWalksPath: walksPath,
      minConformPassRate: 1,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(5);
    expect(result.lines).toContain("conform-pass-rate=0");
    expect(result.lines).toContain("conform-min-pass-rate=1");
    expect(result.lines).toContain(
      "conform-transition-failure: setFlag passRate=0 walks=1",
    );
  });

  it("fails CI when a transition conformance pass rate is below the configured threshold", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-ci-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const walksPath = join(dir, "walks.json");
    const artifactDir = join(dir, ".modality");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");
    await writeFile(propsPath, flagTrueProps, "utf8");
    await writeFile(
      walksPath,
      JSON.stringify(
        conformWalks([
          {
            id: "ok",
            trace: {
              steps: [
                {
                  transitionId: "setFlag",
                  label: { kind: "click", text: "Set flag" },
                  pre: {
                    flag: false,
                  },
                  post: {
                    flag: true,
                  },
                  diff: { flag: { before: false, after: true } },
                },
              ],
            },
            states: [
              {
                flag: false,
              },
              {
                flag: true,
              },
            ],
          },
          {
            id: "bad-other-transition",
            trace: {
              steps: [
                {
                  transitionId: "other",
                  label: { kind: "internal", text: "Other" },
                  pre: {
                    flag: true,
                  },
                  post: {
                    flag: false,
                  },
                  diff: { flag: { before: true, after: false } },
                },
              ],
            },
            states: [
              {
                flag: true,
              },
              {
                flag: true,
              },
            ],
          },
        ]),
      ),
      "utf8",
    );

    const result = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir,
      conformWalksPath: walksPath,
      minConformPassRate: 0.5,
      minTransitionConformPassRate: 1,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(5);
    expect(result.lines).toContain("conform-pass-rate=0.5");
    expect(result.lines).toContain("conform-transition-min-pass-rate=1");
    expect(result.lines).toContain(
      "conform-transition-failure: other passRate=0 walks=1",
    );
    expect(result.lines).not.toContain(
      "conform-transition-failure: setFlag passRate=1 walks=1",
    );
  });
});

describe("renderHumanCiResult", () => {
  it("prints row-oriented ci output", () => {
    const lines = renderHumanCiResult({
      exitCode: 0,
      violationCount: 0,
      errorCount: 0,
      determinismPassed: true,
      determinismFailures: [],
      trustRegressions: [],
      sourceFreshnessPassed: true,
      sourceStaleFailures: [],
      conformPassRate: 1,
      conformMinPassRate: 1,
      transitionConformFailures: [],
      reportPath: ".modality/report.json",
      tracesDir: ".modality/traces",
      durationMs: 43,
    });
    expect(lines[0]).toMatch(/^ ✓ ci /);
    expect(lines.join("\n")).toContain("check 0 violations, 0 errors");
    expect(lines.join("\n")).toContain("(report) .modality/report.json");
    expect(lines.join("\n")).toContain("(traces) .modality/traces");
  });
});

function conformWalks(walks: readonly unknown[]) {
  return { schemaVersion: 1, kind: "conform-walks", walks };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
