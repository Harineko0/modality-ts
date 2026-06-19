import { describe, expect, it } from "vitest";
import type { Model } from "modality-ts/core";
import {
  componentVarsDir,
  emitComponentVarModules,
} from "../../src/cli/codegen/component-state.js";

const model: Model = {
  schemaVersion: 1,
  id: "component-state-fixture",
  bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
  vars: [
    {
      id: "local:App.phase",
      domain: { kind: "enum", values: ["plan", "confirm"] },
      origin: { file: "App.tsx", line: 3 },
      scope: { kind: "global" },
      initial: "plan",
    },
    {
      id: "atom:authAtom",
      domain: { kind: "enum", values: ["guest", "user"] },
      origin: { file: "App.tsx", line: 1 },
      scope: { kind: "global" },
      initial: "guest",
    },
  ],
  transitions: [],
};

describe("emitComponentVarModules", () => {
  it("emits one sibling module per source file with id-embedded handles", () => {
    const modules = emitComponentVarModules(
      model,
      "/tmp/.modality/app.model.ts",
    );
    expect(modules.map((entry) => entry.fileName)).toEqual(["App.vars.ts"]);
    expect(modules.map((entry) => entry.path)).toEqual(["App.vars.ts"]);
    const source = modules[0]!.source;
    expect(source).toContain(
      'import { var as modalityVar, type VarHandle } from "modality-ts/core";',
    );
    expect(source).toContain("export const phase: VarHandle<");
    expect(source).toContain('modalityVar("local:App.phase")');
    expect(source).toContain('"local:App.phase"');
    // atoms are not component-local — they resolve via real source imports
    expect(source).not.toContain("authAtom");
  });

  it("emits nothing for a model without local vars", () => {
    expect(
      emitComponentVarModules(
        { ...model, vars: [] },
        "/tmp/.modality/app.model.ts",
      ),
    ).toEqual([]);
  });

  it("falls back to a vars/ dir beside the app model for synthetic local vars", () => {
    expect(componentVarsDir("/tmp/.modality/app.model.ts")).toBe(
      "/tmp/.modality/vars",
    );
    expect(
      emitComponentVarModules(
        {
          ...model,
          vars: [{ ...model.vars[0]!, origin: "system" }],
        },
        "/tmp/.modality/app.model.ts",
      ).map((entry) => entry.path),
    ).toEqual(["/tmp/.modality/vars/App.vars.ts"]);
  });

  it("qualifies colliding field exports within a source file", () => {
    const modules = emitComponentVarModules(
      {
        ...model,
        vars: [
          model.vars[0]!,
          {
            ...model.vars[0]!,
            id: "local:Child.phase",
            origin: { file: "App.tsx", line: 8 },
          },
        ],
      },
      "/tmp/.modality/app.model.ts",
    );

    expect(modules[0]?.source).toContain("export const App_phase:");
    expect(modules[0]?.source).toContain("export const Child_phase:");
    expect(modules[0]?.source).not.toContain("export const phase:");
  });
});
