import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Model } from "@modality/kernel";
import { generateTlaModule, runExportTlaCommand } from "../src/export-tla.js";

const route = { kind: "enum", values: ["/"] } as const;

function model(): Model {
  return {
    schemaVersion: 1,
    id: "export-fixture",
    bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
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
      "VARIABLES sys_route, flag",
      "",
      "Init ==",
      "  sys_route = \"/\" /\\",
      "  flag = FALSE",
      "",
      "setFlag ==",
      "  ~(flag) /\\",
      "  flag' = TRUE /\\",
      "  UNCHANGED <<sys_route>>",
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
      "  flag' \\in {FALSE, TRUE} /\\",
      "  UNCHANGED <<sys_route>>"
    ].join("\n"));
  });
});
