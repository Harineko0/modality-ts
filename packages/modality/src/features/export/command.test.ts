import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Model } from "@modality/kernel";
import { generateTlaModule, runExportTlaCommand } from "./index.js";

const route = { kind: "enum", values: ["/"] } as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["POST"] },
    continuation: { kind: "enum", values: ["submit#1"] },
    args: { kind: "record", fields: { flag: { kind: "bool" } } }
  }
} as const;

function model(): Model {
  return {
    schemaVersion: 1,
    id: "export-fixture",
    bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
      { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
      { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
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

describe("TLA export", () => {
  it("generates a small TLA module for structured assign transitions", () => {
    expect(generateTlaModule(model(), "ExportFixture")).toContain([
      "---- MODULE ExportFixture ----",
      "EXTENDS Naturals, Sequences, TLC",
      "",
      "VARIABLES sys_route, sys_history, sys_pending, flag",
      "",
      "Init ==",
      "  sys_route = \"/\" /\\",
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
      "  setFlag"
    ].join("\n"));
  });

  it("writes TLA export artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-export-"));
    const modelPath = join(dir, "model.json");
    const outPath = join(dir, "model.tla");
    await writeFile(modelPath, JSON.stringify(model()), "utf8");

    const result = await runExportTlaCommand({ modelPath, outPath, moduleName: "ExportFixture" });
    expect(result.lines).toEqual([`export=${outPath}`, "format=tla"]);
    expect(await readFile(outPath, "utf8")).toBe(result.source);
  });

  it("exports havoc as a finite-domain nondeterministic assignment", () => {
    const overApprox: Model = {
      ...model(),
      transitions: [
        {
          ...model().transitions[0]!,
          effect: { kind: "havoc", var: "flag" }
        }
      ]
    };
    expect(generateTlaModule(overApprox, "HavocFixture")).toContain([
      "setFlag ==",
      "  ~(flag) /\\",
      "  \\E flag_choice_1 \\in {FALSE, TRUE}:",
      "    sys_route' = sys_route /\\",
      "    sys_history' = sys_history /\\",
      "    sys_pending' = sys_pending /\\",
      "    flag' = flag_choice_1"
    ].join("\n"));
  });

  it("preserves havoc choices through later reads in the same structured effect", () => {
    const sequential: Model = {
      ...model(),
      vars: [
        ...model().vars,
        { id: "mirror", domain: { kind: "bool" }, origin: "system", scope: { kind: "global" }, initial: false }
      ],
      transitions: [
        {
          ...model().transitions[0]!,
          effect: {
            kind: "seq",
            effects: [
              { kind: "havoc", var: "flag" },
              { kind: "assign", var: "mirror", expr: { kind: "read", var: "flag" } }
            ]
          },
          writes: ["flag", "mirror"]
        }
      ]
    };
    expect(generateTlaModule(sequential, "SequentialHavocFixture")).toContain([
      "\\E flag_choice_1 \\in {FALSE, TRUE}:",
      "    sys_route' = sys_route /\\",
      "    sys_history' = sys_history /\\",
      "    sys_pending' = sys_pending /\\",
      "    flag' = flag_choice_1 /\\",
      "    mirror' = flag_choice_1"
    ].join("\n"));
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
              { kind: "assign", var: "flag", expr: { kind: "lit", value: true } },
              { kind: "enqueue", op: "POST", continuation: "submit#1", args: { flag: { kind: "read", var: "flag" } } }
            ]
          },
          reads: ["flag"],
          writes: ["flag", "sys:pending"],
          confidence: "exact"
        },
        {
          id: "resolve",
          cls: "env",
          label: { kind: "resolve", op: "POST", outcome: "success" },
          source: [],
          guard: { kind: "eq", args: [{ kind: "read", var: "sys:pending", path: ["0", "opId"] }, { kind: "lit", value: "POST" }] },
          effect: {
            kind: "seq",
            effects: [
              { kind: "assign", var: "flag", expr: { kind: "read", var: "sys:pending", path: ["0", "args", "flag"] } },
              { kind: "dequeue", index: 0 }
            ]
          },
          reads: ["sys:pending"],
          writes: ["sys:pending", "flag"],
          confidence: "exact"
        }
      ]
    };
    const source = generateTlaModule(asyncModel, "AsyncFixture");
    expect(source).toContain("Len(sys_pending) < 1");
    expect(source).toContain("sys_pending' = Append(sys_pending, [opId |-> \"POST\", continuation |-> \"submit#1\", args |-> [flag |-> TRUE]])");
    expect(source).toContain("(sys_pending[1].opId = \"POST\")");
    expect(source).toContain("SubSeq(sys_pending, 1, 0) \\o SubSeq(sys_pending, 2, Len(sys_pending))");
    expect(source).toContain("flag' = sys_pending[1].args.flag");
  });

  it("exports branched and choice effects under the transition guard", () => {
    const branched: Model = {
      ...model(),
      transitions: [
        {
          ...model().transitions[0]!,
          id: "branch",
          guard: { kind: "read", var: "flag" },
          effect: {
            kind: "if",
            cond: { kind: "read", var: "flag" },
            then: { kind: "choose", var: "flag", among: [{ kind: "lit", value: true }, { kind: "lit", value: false }] },
            else: { kind: "assign", var: "flag", expr: { kind: "lit", value: false } }
          }
        }
      ]
    };
    const source = generateTlaModule(branched, "BranchFixture");
    expect(source).toContain([
      "branch ==",
      "  flag /\\",
      "  ((flag /\\",
      "  sys_route' = sys_route /\\"
    ].join("\n"));
    expect(source).toContain("\\/\n  (flag /\\");
    expect(source).toContain("\\/\n  (~(flag) /\\");
  });

  it("rejects TLA identifier collisions before emitting ambiguous modules", () => {
    const colliding: Model = {
      ...model(),
      vars: [
        ...model().vars,
        { id: "a-b", domain: { kind: "bool" }, origin: "system", scope: { kind: "global" }, initial: false },
        { id: "a_b", domain: { kind: "bool" }, origin: "system", scope: { kind: "global" }, initial: false }
      ]
    };
    expect(() => generateTlaModule(colliding, "CollisionFixture")).toThrow("TLA export identifier collision");
  });
});
