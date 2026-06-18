import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { locationEffect } from "../../../extract/engine/ts/transition/navigation.js";
import { checkModel } from "modality-ts/check";
import {
  andExpr,
  canonicalState,
  eq,
  lit,
  reachable,
  readVar,
  type ExprIR,
  type Model,
  type ModelState,
  type Value,
} from "modality-ts/core";
import {
  generateTlaModule,
  generateTlaStructuredModel,
  runExportTlaCommand,
} from "./index.js";
import { renderHumanExportResult } from "./output.js";

const route = { kind: "enum", values: ["/"] } as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["POST"] },
    continuation: { kind: "enum", values: ["submit#1"] },
    args: { kind: "record", fields: { flag: { kind: "bool" } } },
  },
} as const;

function model(): Model {
  return {
    schemaVersion: 1,
    id: "export-fixture",
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
        domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "pending-queue" },
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

function firstTransition(
  fixture: Model = model(),
): Model["transitions"][number] {
  const transition = fixture.transitions[0];
  if (!transition) throw new Error("export fixture missing transition");
  return transition;
}

function requiredVar(
  id: string,
  fixture: Model = model(),
): Model["vars"][number] {
  const decl = fixture.vars.find((entry) => entry.id === id);
  if (!decl) throw new Error(`export fixture missing var ${id}`);
  return decl;
}

function assuranceModel(): Model {
  return {
    ...model(),
    id: "export-assurance",
    bounds: { maxDepth: 3, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      ...model().vars,
      {
        id: "mode",
        domain: { kind: "enum", values: ["idle", "armed"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "idle",
      },
      {
        id: "seen",
        domain: { kind: "bool" },
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
    ],
    transitions: [
      {
        id: "arm",
        cls: "user",
        label: { kind: "click", text: "Arm" },
        source: [],
        guard: {
          kind: "eq",
          args: [
            { kind: "read", var: "mode" },
            { kind: "lit", value: "idle" },
          ],
        },
        effect: {
          kind: "seq",
          effects: [
            {
              kind: "choose",
              var: "flag",
              among: [
                { kind: "lit", value: true },
                { kind: "lit", value: false },
              ],
            },
            {
              kind: "assign",
              var: "mode",
              expr: { kind: "lit", value: "armed" },
            },
          ],
        },
        reads: ["mode"],
        writes: ["flag", "mode"],
        confidence: "exact",
      },
      {
        id: "submit",
        cls: "user",
        label: { kind: "submit", text: "Submit" },
        source: [],
        guard: {
          kind: "and",
          args: [
            {
              kind: "eq",
              args: [
                { kind: "read", var: "mode" },
                { kind: "lit", value: "armed" },
              ],
            },
            { kind: "read", var: "flag" },
          ],
        },
        effect: {
          kind: "seq",
          effects: [
            {
              kind: "enqueue",
              op: "POST",
              continuation: "submit#1",
              args: { flag: { kind: "read", var: "flag" } },
            },
            { kind: "assign", var: "seen", expr: { kind: "lit", value: true } },
          ],
        },
        reads: ["mode", "flag"],
        writes: ["sys:pending", "seen"],
        confidence: "exact",
      },
      {
        id: "resolve",
        cls: "env",
        label: { kind: "resolve", op: "POST", outcome: "success" },
        source: [],
        guard: {
          kind: "eq",
          args: [
            { kind: "read", var: "sys:pending", path: ["0", "opId"] },
            { kind: "lit", value: "POST" },
          ],
        },
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            {
              kind: "assign",
              var: "mode",
              expr: { kind: "lit", value: "idle" },
            },
          ],
        },
        reads: ["sys:pending"],
        writes: ["sys:pending", "mode"],
        confidence: "exact",
      },
      {
        id: "scramble",
        cls: "env",
        label: { kind: "timer", key: "scramble" },
        source: [],
        guard: {
          kind: "eq",
          args: [
            { kind: "read", var: "mode" },
            { kind: "lit", value: "armed" },
          ],
        },
        effect: { kind: "havoc", var: "seen" },
        reads: ["mode"],
        writes: ["seen"],
        confidence: "over-approx",
      },
    ],
  };
}

function oracleReachableStates(m: Model): Set<string> {
  return new Set(
    oracleReachableStateList(m).map((state) => canonicalState(m, state)),
  );
}

function oracleReachableStateList(m: Model): ModelState[] {
  const initial: ModelState = {
    "sys:route": "/",
    "sys:history": [],
    "sys:pending": [],
    flag: false,
    mode: "idle",
    seen: false,
  };
  const seen = new Map<string, ModelState>([
    [canonicalState(m, initial), initial],
  ]);
  let frontier = [initial];
  for (let depth = 0; depth < m.bounds.maxDepth; depth += 1) {
    const next: ModelState[] = [];
    for (const state of frontier) {
      for (const post of oraclePosts(state)) {
        const canon = canonicalState(m, post);
        if (!seen.has(canon)) {
          seen.set(canon, post);
          next.push(post);
        }
      }
    }
    frontier = next;
  }
  return [...seen.values()];
}

function stateEqualsPredicate(target: ModelState): ExprIR {
  const parts: ExprIR[] = [];
  for (const [key, value] of Object.entries(target)) {
    if (key === "sys:pending") {
      const pending = value as {
        opId: string;
        continuation: string;
        args: { flag: boolean };
      }[];
      parts.push(
        eq(
          { kind: "lenCat", arg: readVar("sys:pending") },
          lit(String(pending.length) as Value),
        ),
      );
      if (pending.length === 1) {
        const op = pending[0];
        if (!op) throw new Error("missing pending op");
        parts.push(eq(readVar("sys:pending", ["0", "opId"]), lit(op.opId)));
        parts.push(
          eq(
            readVar("sys:pending", ["0", "continuation"]),
            lit(op.continuation),
          ),
        );
        parts.push(
          eq(readVar("sys:pending", ["0", "args", "flag"]), lit(op.args.flag)),
        );
      }
      continue;
    }
    if (key === "sys:history") {
      parts.push(eq({ kind: "lenCat", arg: readVar("sys:history") }, lit("0")));
      continue;
    }
    parts.push(eq(readVar(key), lit(value as Value)));
  }
  return andExpr(...parts);
}

function oraclePosts(state: ModelState): ModelState[] {
  const posts: ModelState[] = [];
  const pending = state["sys:pending"] as {
    opId: string;
    continuation: string;
    args: { flag: boolean };
  }[];
  if (state.mode === "idle") {
    posts.push(
      { ...state, flag: true, mode: "armed" },
      { ...state, flag: false, mode: "armed" },
    );
  }
  if (state.mode === "armed" && state.flag === true && pending.length < 1) {
    posts.push({
      ...state,
      "sys:pending": [
        ...pending,
        { opId: "POST", continuation: "submit#1", args: { flag: true } },
      ],
      seen: true,
    });
  }
  if (pending[0]?.opId === "POST") {
    posts.push({ ...state, "sys:pending": pending.slice(1), mode: "idle" });
  }
  if (state.mode === "armed") {
    posts.push({ ...state, seen: false }, { ...state, seen: true });
  }
  return posts;
}

describe("TLA export", () => {
  it("generates a small TLA module for structured assign transitions", () => {
    expect(generateTlaModule(model(), "ExportFixture")).toContain(
      [
        "---- MODULE ExportFixture ----",
        "EXTENDS Naturals, Sequences, TLC",
        "",
        "VARIABLES sys_route, sys_history, sys_pending, flag",
        "",
        "Init ==",
        '  sys_route = "/" /\\',
        "  sys_history = <<>> /\\",
        "  sys_pending = <<>> /\\",
        "  flag = FALSE",
        "",
        "setFlag ==",
        "  ~(flag) /\\",
        "  sys_route' = sys_route /\\",
        "  sys_history' = sys_history /\\",
        "  sys_pending' = sys_pending /\\",
        "  flag' = TRUE",
        "",
        "Next ==",
        "  setFlag",
      ].join("\n"),
    );
  });

  it("writes TLA export artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-export-"));
    const modelPath = join(dir, "model.json");
    const outPath = join(dir, "model.tla");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");

    const result = await runExportTlaCommand({
      modelPath,
      outPath,
      moduleName: "ExportFixture",
    });
    expect(result.lines).toEqual([`export=${outPath}`, "format=tla"]);
    expect(await readFile(outPath, "utf8")).toBe(result.source);
  });

  it("exports push navigation with the bounded history assumption", () => {
    const routes = { kind: "enum", values: ["/a", "/b"] } as const;
    const m: Model = {
      ...model(),
      vars: [
        {
          id: "sys:route",
          domain: routes,
          origin: "system",
          scope: { kind: "global" },
          initial: "/a",
        },
        {
          id: "sys:history",
          domain: { kind: "boundedList", inner: routes, maxLen: 1 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        requiredVar("sys:pending"),
        requiredVar("flag"),
      ],
      transitions: [
        {
          id: "pushB",
          cls: "nav",
          label: { kind: "navigate", mode: "push", to: "/b" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: locationEffect({
            currentVar: "sys:route",
            historyVar: "sys:history",
            mode: "push",
            to: { kind: "lit", value: "/b" },
            routeValues: ["/a", "/b"],
            historyCap: 1,
          }).effect,
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact",
        },
      ],
    };

    const structured = generateTlaStructuredModel(m, "HistoryFixture");
    const push = structured.transitions.find(
      (transition) => transition.id === "pushB",
    );
    expect(push?.branches.length).toBeGreaterThan(0);
    expect(
      push?.branches.some((branch) => branch.next["sys:route"]?.includes("/b")),
    ).toBe(true);
  });

  it("cross-validates structured TLA export against a finite checker oracle", () => {
    const m = assuranceModel();
    const expectedReachable = oracleReachableStates(m);
    const reachableStates = oracleReachableStateList(m);
    const unreachable: ModelState = {
      "sys:route": "/",
      "sys:history": [],
      "sys:pending": [],
      flag: false,
      mode: "idle",
      seen: true,
    };
    const result = checkModel(m, [
      ...reachableStates.map((state, index) =>
        reachable(m, stateEqualsPredicate(state), {
          name: `oracleState${index}`,
        }),
      ),
      reachable(m, stateEqualsPredicate(unreachable), {
        name: "oracleExcludedState",
      }),
    ]);
    expect(result.stats.states).toBe(expectedReachable.size);
    expect(
      result.verdicts
        .slice(0, expectedReachable.size)
        .every((verdict) => verdict.status === "reachable"),
    ).toBe(true);
    expect(result.verdicts.at(-1)).toMatchObject({
      property: "oracleExcludedState",
      status: "vacuous-warning",
    });

    const structured = generateTlaStructuredModel(m, "AssuranceFixture");
    expect(structured.init.map((item) => item.predicate)).toEqual([
      'sys_route = "/"',
      "sys_history = <<>>",
      "sys_pending = <<>>",
      "flag = FALSE",
      'mode = "idle"',
      "seen = FALSE",
    ]);
    expect(
      Object.fromEntries(
        structured.transitions.map((transition) => [
          transition.id,
          transition.branches.length,
        ]),
      ),
    ).toEqual({
      arm: 2,
      submit: 1,
      resolve: 1,
      scramble: 1,
    });

    const armBranches =
      structured.transitions.find((transition) => transition.id === "arm")
        ?.branches ?? [];
    expect(armBranches.map((branch) => branch.next.flag).sort()).toEqual([
      "FALSE",
      "TRUE",
    ]);
    expect(armBranches.every((branch) => branch.next.mode === '"armed"')).toBe(
      true,
    );
    const submit = structured.transitions.find(
      (transition) => transition.id === "submit",
    );
    expect(submit?.guard).toBe('(mode = "armed") /\\ flag');
    expect(submit?.branches[0]?.assumptions).toEqual([
      "(Len(sys_pending) < 1)",
    ]);
    expect(submit?.branches[0]?.next["sys:pending"]).toBe(
      'Append(sys_pending, [opId |-> "POST", continuation |-> "submit#1", args |-> [flag |-> flag]])',
    );
    expect(submit?.branches[0]?.next.seen).toBe("TRUE");
    const resolve = structured.transitions.find(
      (transition) => transition.id === "resolve",
    );
    expect(resolve?.guard).toBe(
      '((IF Len(sys_pending) >= 1 THEN sys_pending[1].opId ELSE "__modality_oob__") = "POST")',
    );
    expect(resolve?.branches[0]?.next["sys:pending"]).toBe(
      "SubSeq(sys_pending, 1, 0) \\o SubSeq(sys_pending, 2, Len(sys_pending))",
    );
  });

  it("exports enqueue and dequeue against a non-sys pending queue role var", () => {
    const base = assuranceModel();
    const customPendingModel: Model = {
      ...base,
      vars: base.vars.map((decl) =>
        decl.id === "sys:pending"
          ? {
              ...decl,
              id: "app:pendingOps",
              role: { kind: "pending-queue" as const },
            }
          : decl,
      ),
      transitions: base.transitions.map((transition) => ({
        ...transition,
        reads: transition.reads.map((id) =>
          id === "sys:pending" ? "app:pendingOps" : id,
        ),
        writes: transition.writes.map((id) =>
          id === "sys:pending" ? "app:pendingOps" : id,
        ),
        guard: JSON.parse(
          JSON.stringify(transition.guard).replaceAll(
            "sys:pending",
            "app:pendingOps",
          ),
        ),
        effect: JSON.parse(
          JSON.stringify(transition.effect).replaceAll(
            "sys:pending",
            "app:pendingOps",
          ),
        ),
      })),
    };
    const structured = generateTlaStructuredModel(customPendingModel, "CustomPending");
    const submit = structured.transitions.find(
      (transition) => transition.id === "submit",
    );
    expect(submit?.branches[0]?.next["app:pendingOps"]).toContain("Append(");
    const resolve = structured.transitions.find(
      (transition) => transition.id === "resolve",
    );
    expect(resolve?.branches[0]?.next["app:pendingOps"]).toContain("SubSeq(");
  });

  it("exports havoc as a finite-domain nondeterministic assignment", () => {
    const overApprox: Model = {
      ...model(),
      transitions: [
        {
          ...firstTransition(),
          effect: { kind: "havoc", var: "flag" },
        },
      ],
    };
    expect(generateTlaModule(overApprox, "HavocFixture")).toContain(
      [
        "setFlag ==",
        "  ~(flag) /\\",
        "  \\E flag_choice_1 \\in {FALSE, TRUE}:",
        "    sys_route' = sys_route /\\",
        "    sys_history' = sys_history /\\",
        "    sys_pending' = sys_pending /\\",
        "    flag' = flag_choice_1",
      ].join("\n"),
    );
  });

  it("preserves havoc choices through later reads in the same structured effect", () => {
    const sequential: Model = {
      ...model(),
      vars: [
        ...model().vars,
        {
          id: "mirror",
          domain: { kind: "bool" },
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          ...firstTransition(),
          effect: {
            kind: "seq",
            effects: [
              { kind: "havoc", var: "flag" },
              {
                kind: "assign",
                var: "mirror",
                expr: { kind: "read", var: "flag" },
              },
            ],
          },
          writes: ["flag", "mirror"],
        },
      ],
    };
    expect(generateTlaModule(sequential, "SequentialHavocFixture")).toContain(
      [
        "\\E flag_choice_1 \\in {FALSE, TRUE}:",
        "    sys_route' = sys_route /\\",
        "    sys_history' = sys_history /\\",
        "    sys_pending' = sys_pending /\\",
        "    flag' = flag_choice_1 /\\",
        "    mirror' = flag_choice_1",
      ].join("\n"),
    );
  });

  it("exports structured async queue transitions and indexed pending reads", () => {
    const asyncModel: Model = {
      ...model(),
      transitions: [
        {
          id: "submit",
          cls: "user",
          label: { kind: "submit", text: "Submit" },
          source: [],
          guard: { kind: "not", args: [{ kind: "read", var: "flag" }] },
          effect: {
            kind: "seq",
            effects: [
              {
                kind: "assign",
                var: "flag",
                expr: { kind: "lit", value: true },
              },
              {
                kind: "enqueue",
                op: "POST",
                continuation: "submit#1",
                args: { flag: { kind: "read", var: "flag" } },
              },
            ],
          },
          reads: ["flag"],
          writes: ["flag", "sys:pending"],
          confidence: "exact",
        },
        {
          id: "resolve",
          cls: "env",
          label: { kind: "resolve", op: "POST", outcome: "success" },
          source: [],
          guard: {
            kind: "eq",
            args: [
              { kind: "read", var: "sys:pending", path: ["0", "opId"] },
              { kind: "lit", value: "POST" },
            ],
          },
          effect: {
            kind: "seq",
            effects: [
              {
                kind: "assign",
                var: "flag",
                expr: {
                  kind: "read",
                  var: "sys:pending",
                  path: ["0", "args", "flag"],
                },
              },
              { kind: "dequeue", index: 0 },
            ],
          },
          reads: ["sys:pending"],
          writes: ["sys:pending", "flag"],
          confidence: "exact",
        },
      ],
    };
    const source = generateTlaModule(asyncModel, "AsyncFixture");
    expect(source).toContain("Len(sys_pending) < 1");
    expect(source).toContain(
      'sys_pending\' = Append(sys_pending, [opId |-> "POST", continuation |-> "submit#1", args |-> [flag |-> TRUE]])',
    );
    expect(source).toContain(
      '((IF Len(sys_pending) >= 1 THEN sys_pending[1].opId ELSE "__modality_oob__") = "POST")',
    );
    expect(source).toContain(
      "SubSeq(sys_pending, 1, 0) \\o SubSeq(sys_pending, 2, Len(sys_pending))",
    );
    expect(source).toContain(
      'flag\' = (IF Len(sys_pending) >= 1 THEN sys_pending[1].args.flag ELSE "__modality_oob__")',
    );
  });

  it("exports empty record values as a stable TLC record marker", () => {
    const emptyArgs: Model = {
      ...model(),
      transitions: [
        {
          id: "submit",
          cls: "user",
          label: { kind: "submit", text: "Submit" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "enqueue",
            op: "POST",
            continuation: "submit#1",
            args: {},
          },
          reads: [],
          writes: ["sys:pending"],
          confidence: "exact",
        },
      ],
    };
    expect(generateTlaModule(emptyArgs, "EmptyArgsFixture")).toContain(
      "args |-> [__empty |-> TRUE]",
    );
  });

  it("exports freshToken assignments as finite fresh choices", () => {
    const tokenModel: Model = {
      ...model(),
      vars: [
        ...model().vars,
        {
          id: "slot",
          domain: { kind: "tokens", count: 2 },
          origin: "system",
          scope: { kind: "global" },
          initial: "tok1",
        },
      ],
      transitions: [
        {
          ...firstTransition(),
          id: "fresh",
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: "slot",
            expr: { kind: "freshToken", domainOf: "slot" },
          },
          reads: ["slot"],
          writes: ["slot"],
        },
      ],
    };
    const source = generateTlaModule(tokenModel, "FreshFixture");
    expect(source).toContain('\\E slot_fresh_1 \\in {"tok1", "tok2"}:');
    expect(source).toContain("(slot # slot_fresh_1)");
    expect(source).toContain("slot' = slot_fresh_1");
  });

  it("exports exhausted freshToken choices as unsatisfiable actions", () => {
    const exhausted: Model = {
      ...model(),
      vars: [
        ...model().vars,
        {
          id: "slot",
          domain: { kind: "tokens", count: 1 },
          origin: "system",
          scope: { kind: "global" },
          initial: "tok1",
        },
      ],
      transitions: [
        {
          ...firstTransition(),
          id: "fresh",
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: "slot",
            expr: { kind: "freshToken", domainOf: "slot" },
          },
          reads: ["slot"],
          writes: ["slot"],
        },
      ],
    };
    const source = generateTlaModule(exhausted, "FreshExhaustedFixture");
    expect(source).toContain('\\E slot_fresh_1 \\in {"tok1"}:');
    expect(source).toContain("(slot # slot_fresh_1)");
  });

  it("exports branched and choice effects under the transition guard", () => {
    const branched: Model = {
      ...model(),
      transitions: [
        {
          ...firstTransition(),
          id: "branch",
          guard: { kind: "read", var: "flag" },
          effect: {
            kind: "if",
            cond: { kind: "read", var: "flag" },
            // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
            then: {
              kind: "choose",
              var: "flag",
              among: [
                { kind: "lit", value: true },
                { kind: "lit", value: false },
              ],
            },
            else: {
              kind: "assign",
              var: "flag",
              expr: { kind: "lit", value: false },
            },
          },
        },
      ],
    };
    const source = generateTlaModule(branched, "BranchFixture");
    expect(source).toContain(
      [
        "branch ==",
        "  flag /\\",
        "  ((flag /\\",
        "  sys_route' = sys_route /\\",
      ].join("\n"),
    );
    expect(source).toContain("\\/\n  (flag /\\");
    expect(source).toContain("\\/\n  (~(flag) /\\");
  });

  it("exports numeric domains and operators", () => {
    const numeric: Model = {
      ...model(),
      vars: [
        ...model().vars.filter((decl) => decl.id !== "flag"),
        {
          id: "count",
          domain: { kind: "boundedInt", min: 0, max: 3, overflow: "forbid" },
          origin: "system",
          scope: { kind: "global" },
          initial: 0,
        },
        {
          id: "sparse",
          domain: { kind: "intSet", values: [0, 2] },
          origin: "system",
          scope: { kind: "global" },
          initial: 0,
        },
      ],
      transitions: [
        {
          id: "inc",
          cls: "user",
          label: { kind: "click", text: "inc" },
          source: [],
          guard: {
            kind: "lt",
            args: [
              { kind: "read", var: "count" },
              { kind: "lit", value: 3 },
            ],
          },
          effect: {
            kind: "assign",
            var: "count",
            expr: {
              kind: "add",
              args: [
                { kind: "read", var: "count" },
                { kind: "lit", value: 1 },
              ],
            },
          },
          reads: ["count"],
          writes: ["count"],
          confidence: "exact",
        },
      ],
    };
    const source = generateTlaModule(numeric, "NumericFixture");
    expect(source).toContain("(count < 3)");
    expect(source).toContain("(count + 1)");
    expect(source).toContain("(count + 1) \\in {0, 1, 2, 3}");
    const havocSparse: Model = {
      ...numeric,
      transitions: [
        {
          id: "havocSparse",
          cls: "user",
          label: { kind: "click", text: "havoc" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: { kind: "havoc", var: "sparse" },
          reads: [],
          writes: ["sparse"],
          confidence: "exact",
        },
      ],
    };
    expect(generateTlaModule(havocSparse, "SparseFixture")).toContain("{0, 2}");
  });

  it("rejects TLA identifier collisions before emitting ambiguous modules", () => {
    const colliding: Model = {
      ...model(),
      vars: [
        ...model().vars,
        {
          id: "a-b",
          domain: { kind: "bool" },
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "a_b",
          domain: { kind: "bool" },
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
    };
    expect(() => generateTlaModule(colliding, "CollisionFixture")).toThrow(
      "TLA export identifier collision",
    );
  });
});

describe("renderHumanExportResult", () => {
  it("prints row-oriented export output", () => {
    const lines = renderHumanExportResult({
      outPath: ".modality/model.tla",
      moduleName: "extracted_model_Model",
      durationMs: 3,
    });
    expect(lines[0]).toMatch(/^ ✓ model\.tla /);
    expect(lines.join("\n")).toContain("format tla");
    expect(lines.join("\n")).toContain("(export) .modality/model.tla");
  });
});
