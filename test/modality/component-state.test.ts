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
  it("emits one module per component with id-embedded handle types", () => {
    const modules = emitComponentVarModules(model);
    expect(modules.map((entry) => entry.fileName)).toEqual(["App.d.ts"]);
    const source = modules[0]!.source;
    expect(source).toContain(
      'import type { VarHandle } from "modality-ts/core";',
    );
    expect(source).toContain("export declare const phase: VarHandle<");
    expect(source).toContain('"local:App.phase"');
    // atoms are not component-local — they resolve via real source imports
    expect(source).not.toContain("authAtom");
  });

  it("emits nothing for a model without local vars", () => {
    expect(emitComponentVarModules({ ...model, vars: [] })).toEqual([]);
  });

  it("places modules in a vars/ dir beside the app model", () => {
    expect(componentVarsDir("/tmp/.modality/app.model.ts")).toBe(
      "/tmp/.modality/vars",
    );
  });
});
