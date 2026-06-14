import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Model, Trace } from "modality-ts/core";
import { generateConformWalks, runConformCommand } from "./index.js";

const trace: Trace = {
  steps: [
    {
      transitionId: "login",
      label: { kind: "click", text: "Login" },
      pre: { auth: "guest" },
      post: { auth: "user" },
      diff: { auth: { before: "guest", after: "user" } },
    },
  ],
};

const repeatedTrace: Trace = {
  steps: [
    ...trace.steps,
    {
      transitionId: "login",
      label: { kind: "click", text: "Login again" },
      pre: { auth: "user" },
      post: { auth: "user" },
      diff: {},
    },
    {
      transitionId: "submit",
      label: { kind: "submit", text: "Submit" },
      pre: { auth: "user" },
      post: { auth: "user", pending: 1 },
      diff: { pending: { before: undefined, after: 1 } },
    },
  ],
};

const route = { kind: "enum", values: ["/"] } as const;

function model(): Model {
  return {
    schemaVersion: 1,
    id: "conform-model",
    bounds: { maxDepth: 3, maxPending: 1, maxInternalSteps: 4 },
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
              opId: { kind: "enum", values: ["noop"] },
              continuation: { kind: "enum", values: ["noop"] },
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

describe("runConformCommand", () => {
  it("classifies multiple replay walks and writes metrics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conform-"));
    const walksPath = join(dir, "walks.json");
    const reportPath = join(dir, "conform-report.json");
    await writeFile(
      walksPath,
      JSON.stringify(
        conformWalks([
          { id: "ok", trace },
          {
            id: "diverged",
            trace,
            states: [{ auth: "guest" }, { auth: "guest" }],
          },
        ]),
      ),
      "utf8",
    );

    const result = await runConformCommand({
      walksPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.exitCode).toBe(2);
    expect(result.lines).toEqual([
      "conform: total=2 reproduced=1 notReproduced=1 inconclusive=0",
      "mode=abstract",
      "passRate=0.5",
    ]);
    expect(report).toMatchObject({
      schemaVersion: 1,
      kind: "conform-report",
      generatedAt: "2026-06-12T00:00:00.000Z",
      mode: "abstract",
      metrics: {
        total: 2,
        reproduced: 1,
        notReproduced: 1,
        inconclusive: 0,
        passRate: 0.5,
      },
    });
    expect(
      report.walks.map((walk: { id: string; status: string }) => [
        walk.id,
        walk.status,
      ]),
    ).toEqual([
      ["ok", "reproduced"],
      ["diverged", "not-reproduced"],
    ]);
    expect(report.transitionMetrics).toEqual([
      {
        transitionId: "login",
        walks: 2,
        reproduced: 1,
        notReproduced: 1,
        inconclusive: 0,
        passRate: 0.5,
      },
    ]);
  });

  it("aggregates per-transition pass rates from walks that touch each transition", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conform-"));
    const walksPath = join(dir, "walks.json");
    await writeFile(
      walksPath,
      JSON.stringify(
        conformWalks([
          { id: "ok", trace: repeatedTrace },
          {
            id: "login-diverged",
            trace,
            states: [{ auth: "guest" }, { auth: "guest" }],
          },
        ]),
      ),
      "utf8",
    );

    const result = await runConformCommand({
      walksPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.report.transitionMetrics).toEqual([
      {
        transitionId: "login",
        walks: 2,
        reproduced: 1,
        notReproduced: 1,
        inconclusive: 0,
        passRate: 0.5,
      },
      {
        transitionId: "submit",
        walks: 1,
        reproduced: 1,
        notReproduced: 0,
        inconclusive: 0,
        passRate: 1,
      },
    ]);
  });

  it("derives replay states from compact walk traces when states are omitted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conform-"));
    const walksPath = join(dir, "walks.json");
    await writeFile(
      walksPath,
      JSON.stringify(conformWalks([{ id: "compact", trace: repeatedTrace }])),
      "utf8",
    );

    const result = await runConformCommand({
      walksPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.walks).toEqual([
      { id: "compact", status: "reproduced", stepsRun: 3 },
    ]);
    expect(result.report.transitionMetrics).toEqual([
      {
        transitionId: "login",
        walks: 1,
        reproduced: 1,
        notReproduced: 0,
        inconclusive: 0,
        passRate: 1,
      },
      {
        transitionId: "submit",
        walks: 1,
        reproduced: 1,
        notReproduced: 0,
        inconclusive: 0,
        passRate: 1,
      },
    ]);
  });

  it("runs action conformance walks through a harness module", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conform-action-"));
    const walksPath = join(dir, "walks.json");
    const harnessPath = join(dir, "harness.mjs");
    await writeFile(
      walksPath,
      JSON.stringify(
        conformWalks([
          {
            id: "action",
            trace: {
              steps: [
                {
                  ...trace.steps[0]!,
                  label: {
                    kind: "click",
                    locator: { kind: "testId", value: "login" },
                  },
                },
              ],
            },
          },
        ]),
      ),
      "utf8",
    );
    await writeFile(
      harnessPath,
      [
        "export async function renderModalityReplay() {",
        '  document.body.innerHTML = \'<button data-testid="login">Login</button><span data-modality-var="auth">"guest"</span>\';',
        "  document.querySelector('[data-testid=\"login\"]').addEventListener('click', () => {",
        "    document.querySelector('[data-modality-var=\"auth\"]').textContent = '\"user\"';",
        "  });",
        "  return { document };",
        "}",
      ].join("\n"),
      "utf8",
    );

    const result = await runConformCommand({
      walksPath,
      mode: "action",
      harnessPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.mode).toBe("action");
    expect(result.report.harnessPath).toBe(harnessPath);
    expect(result.report.metrics).toMatchObject({
      total: 1,
      reproduced: 1,
      notReproduced: 0,
      inconclusive: 0,
      passRate: 1,
    });
  });

  it("compares only observed variables when walk artifacts provide observed states", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conform-"));
    const walksPath = join(dir, "walks.json");
    const hiddenTrace: Trace = {
      steps: [
        {
          transitionId: "login",
          label: { kind: "click", text: "Login" },
          pre: { auth: "guest", hidden: "before" },
          post: { auth: "user", hidden: "after" },
          diff: {
            auth: { before: "guest", after: "user" },
            hidden: { before: "before", after: "after" },
          },
        },
      ],
    };
    await writeFile(
      walksPath,
      JSON.stringify(
        conformWalks([
          {
            id: "observed",
            trace: hiddenTrace,
            observedStates: [{ auth: "guest" }, { auth: "user" }],
          },
        ]),
      ),
      "utf8",
    );

    const result = await runConformCommand({
      walksPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.walks).toEqual([
      { id: "observed", status: "reproduced", stepsRun: 1 },
    ]);
    expect(result.report.transitionMetrics).toEqual([
      {
        transitionId: "login",
        walks: 1,
        reproduced: 1,
        notReproduced: 0,
        inconclusive: 0,
        passRate: 1,
      },
    ]);
  });

  it("reports observed-state conformance divergence per transition", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conform-"));
    const walksPath = join(dir, "walks.json");
    await writeFile(
      walksPath,
      JSON.stringify(
        conformWalks([
          {
            id: "observed-diverged",
            trace,
            observedStates: [{ auth: "guest" }, { auth: "guest" }],
          },
        ]),
      ),
      "utf8",
    );

    const result = await runConformCommand({
      walksPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.report.walks).toEqual([
      {
        id: "observed-diverged",
        status: "not-reproduced",
        stepsRun: 1,
        divergenceStep: 1,
        reason: 'postcondition mismatch: auth: expected "user", got "guest"',
      },
    ]);
    expect(result.report.transitionMetrics).toEqual([
      {
        transitionId: "login",
        walks: 1,
        reproduced: 0,
        notReproduced: 1,
        inconclusive: 0,
        passRate: 0,
      },
    ]);
  });

  it("reports a deliberately wrong hand-model edit at the exact divergence step", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conform-"));
    const walksPath = join(dir, "walks.json");
    const wrongTrace: Trace = {
      steps: [
        {
          ...trace.steps[0]!,
          post: { auth: "admin" },
          diff: { auth: { before: "guest", after: "admin" } },
        },
      ],
    };
    await writeFile(
      walksPath,
      JSON.stringify(
        conformWalks([
          {
            id: "wrong-hand-model",
            trace: wrongTrace,
            observedStates: [{ auth: "guest" }, { auth: "user" }],
          },
        ]),
      ),
      "utf8",
    );

    const result = await runConformCommand({
      walksPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.report.walks).toEqual([
      {
        id: "wrong-hand-model",
        status: "not-reproduced",
        stepsRun: 1,
        divergenceStep: 1,
        reason: 'postcondition mismatch: auth: expected "admin", got "user"',
      },
    ]);
    expect(result.report.transitionMetrics).toEqual([
      {
        transitionId: "login",
        walks: 1,
        reproduced: 0,
        notReproduced: 1,
        inconclusive: 0,
        passRate: 0,
      },
    ]);
  });

  it("generates deterministic bounded walks from a model", () => {
    const left = generateConformWalks(model(), { count: 2, depth: 2, seed: 7 });
    const right = generateConformWalks(model(), {
      count: 2,
      depth: 2,
      seed: 7,
    });
    expect(left).toEqual(right);
    expect(
      left.map((walk) => walk.trace.steps.map((step) => step.transitionId)),
    ).toEqual([["setFlag"], ["setFlag"]]);
    expect(left[0]?.states.map((state) => state.flag)).toEqual([false, true]);
  });

  it("rejects unsupported conform walk artifact versions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conform-"));
    const walksPath = join(dir, "walks.json");
    await writeFile(
      walksPath,
      JSON.stringify({
        schemaVersion: 2,
        kind: "conform-walks",
        walks: [{ id: "ok", trace }],
      }),
      "utf8",
    );

    await expect(
      runConformCommand({
        walksPath,
        now: new Date("2026-06-12T00:00:00.000Z"),
      }),
    ).rejects.toThrow("unsupported conform walks schemaVersion 2");
  });

  it("runs conform directly from a model by generating abstract walks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conform-"));
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "conform-report.json");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");

    const result = await runConformCommand({
      modelPath,
      reportPath,
      walkCount: 2,
      depth: 2,
      seed: 7,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([
      "conform: total=2 reproduced=2 notReproduced=0 inconclusive=0",
      "mode=abstract",
      "passRate=1",
    ]);
    expect(
      report.walks.map(
        (walk: { id: string; status: string; stepsRun: number }) => [
          walk.id,
          walk.status,
          walk.stepsRun,
        ],
      ),
    ).toEqual([
      ["walk-1", "reproduced", 1],
      ["walk-2", "reproduced", 1],
    ]);
    expect(report.transitionMetrics).toEqual([
      {
        transitionId: "setFlag",
        walks: 2,
        reproduced: 2,
        notReproduced: 0,
        inconclusive: 0,
        passRate: 1,
      },
    ]);
  });
});

function conformWalks(walks: readonly unknown[]) {
  return { schemaVersion: 1, kind: "conform-walks", walks };
}
