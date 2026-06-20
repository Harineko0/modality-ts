import { describe, expect, it } from "vitest";
import type { Model } from "modality-ts/core";
import {
  componentModalsDir,
  emitComponentModalModules,
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
  transitions: [
    {
      id: "App.onClick.handleAdvance",
      cls: "user",
      label: {
        kind: "click",
        locator: { kind: "testId", value: "advance" },
      },
      source: [{ file: "App.tsx", line: 10 }],
      guard: { kind: "true" },
      effect: { kind: "assign", target: "local:App.phase", value: "confirm" },
      reads: [],
      writes: ["local:App.phase"],
      confidence: "exact",
    },
  ],
};

describe("emitComponentModalModules", () => {
  it("emits one sibling module per source file with state and transition sections", () => {
    const modules = emitComponentModalModules(
      model,
      "/tmp/.modality/app.model.ts",
    );
    expect(modules.map((entry) => entry.fileName)).toEqual(["App.modals.ts"]);
    expect(modules.map((entry) => entry.path)).toEqual(["App.modals.ts"]);
    const source = modules[0]!.source;
    expect(source).toContain(
      'import { variable, type Variable } from "modality-ts/core";',
    );
    expect(source).toContain(
      'import type { TransitionRef } from "modality-ts/properties";',
    );
    expect(source).toContain("// state");
    expect(source).toContain("export const phase: Variable<");
    expect(source).toContain('variable("local:App.phase")');
    expect(source).toContain("// transitions");
    expect(source).toContain("export const App = {");
    expect(source).toContain("onClick: {");
    expect(source).toContain("handleAdvance:");
    expect(source).toContain('"App.onClick.handleAdvance"');
    expect(source).toContain('TransitionRef<"App.onClick.handleAdvance">');
    expect(source).not.toContain('"handleAdvance"');
    expect(source).not.toContain("authAtom");
  });

  it("nests multi-segment transition remainders under each period", () => {
    const modules = emitComponentModalModules(
      {
        ...model,
        vars: [],
        transitions: [
          {
            id: "PrinterSettingsDialog.onClick.optimisticDensity.seq.1",
            cls: "user",
            label: { kind: "click", text: "Apply" },
            source: [{ file: "PrinterSettingsDialog.tsx", line: 10 }],
            guard: { kind: "true" },
            effect: {
              kind: "assign",
              target: "local:PrinterSettingsDialog.optimisticDensity",
              value: 1,
            },
            reads: [],
            writes: ["local:PrinterSettingsDialog.optimisticDensity"],
            confidence: "exact",
          },
        ],
      },
      "/tmp/.modality/app.model.ts",
    );
    const source = modules[0]!.source;
    expect(source).toContain("optimisticDensity: {");
    expect(source).toContain("seq: {");
    expect(source).toContain(
      '"1": "PrinterSettingsDialog.onClick.optimisticDensity.seq.1"',
    );
    expect(source).not.toContain('"optimisticDensity.seq.1"');
  });

  it("uses _ when a period segment is both a leaf and a branch prefix", () => {
    const modules = emitComponentModalModules(
      {
        ...model,
        vars: [],
        transitions: [
          {
            id: "App.onClick.api_todos",
            cls: "user",
            label: { kind: "click", text: "Fill" },
            source: [{ file: "App.tsx", line: 10 }],
            guard: { kind: "true" },
            effect: {
              kind: "assign",
              target: "swr:api_todos:data",
              value: "full",
            },
            reads: [],
            writes: ["swr:api_todos:data"],
            confidence: "exact",
          },
          {
            id: "App.onClick.api_todos.loop",
            cls: "user",
            label: { kind: "click", text: "Loop" },
            source: [{ file: "App.tsx", line: 12 }],
            guard: { kind: "true" },
            effect: { kind: "havoc", target: "swr:api_todos:data" },
            reads: [],
            writes: ["swr:api_todos:data"],
            confidence: "over-approx",
          },
        ],
      },
      "/tmp/.modality/app.model.ts",
    );
    const source = modules[0]!.source;
    expect(source).toContain("api_todos: {");
    expect(source).toContain('_: "App.onClick.api_todos"');
    expect(source).toContain('loop: "App.onClick.api_todos.loop"');
  });

  it("emits quoted keys for non-identifier transition remainders", () => {
    const modules = emitComponentModalModules(
      {
        ...model,
        vars: [],
        transitions: [
          {
            id: "CustomerHome.onClick.注文を確認する",
            cls: "user",
            label: { kind: "click", text: "注文を確認する" },
            source: [{ file: "Home.tsx", line: 8 }],
            guard: { kind: "true" },
            effect: {
              kind: "assign",
              target: "local:CustomerHome.step",
              value: "confirm",
            },
            reads: [],
            writes: ["local:CustomerHome.step"],
            confidence: "exact",
          },
          {
            id: "CustomerHome.onSubmit.ACTION /order.start",
            cls: "user",
            label: { kind: "submit", text: "Start" },
            source: [{ file: "Home.tsx", line: 10 }],
            guard: { kind: "true" },
            effect: {
              kind: "assign",
              target: "local:CustomerHome.step",
              value: "start",
            },
            reads: [],
            writes: ["local:CustomerHome.step"],
            confidence: "exact",
          },
        ],
      },
      "/tmp/.modality/app.model.ts",
    );
    const source = modules[0]!.source;
    expect(source).toContain("export const CustomerHome = {");
    expect(source).toContain(
      '"注文を確認する": "CustomerHome.onClick.注文を確認する"',
    );
    expect(source).toContain('"ACTION /order": {');
    expect(source).toContain(
      'start: "CustomerHome.onSubmit.ACTION /order.start"',
    );
  });

  it("emits transition-only modules without the state import", () => {
    const modules = emitComponentModalModules(
      {
        ...model,
        vars: [],
      },
      "/tmp/.modality/app.model.ts",
    );
    expect(modules).toHaveLength(1);
    const source = modules[0]!.source;
    expect(source).toContain(
      'import type { TransitionRef } from "modality-ts/properties";',
    );
    expect(source).not.toContain("modality-ts/core");
    expect(source).not.toContain("// state");
    expect(source).toContain("// transitions");
  });

  it("emits state-only modules without the TransitionRef import", () => {
    const modules = emitComponentModalModules(
      {
        ...model,
        transitions: [],
      },
      "/tmp/.modality/app.model.ts",
    );
    expect(modules).toHaveLength(1);
    const source = modules[0]!.source;
    expect(source).toContain(
      'import { variable, type Variable } from "modality-ts/core";',
    );
    expect(source).not.toContain("TransitionRef");
    expect(source).not.toContain("// transitions");
    expect(source).toContain("// state");
  });

  it("emits nothing for a model without local vars or sourced transitions", () => {
    expect(
      emitComponentModalModules(
        { ...model, vars: [], transitions: [] },
        "/tmp/.modality/app.model.ts",
      ),
    ).toEqual([]);
  });

  it("falls back to a modals/ dir beside the app model for synthetic local vars", () => {
    expect(componentModalsDir("/tmp/.modality/app.model.ts")).toBe(
      "/tmp/.modality/modals",
    );
    expect(
      emitComponentModalModules(
        {
          ...model,
          transitions: [],
          vars: [{ ...model.vars[0]!, origin: "system" }],
        },
        "/tmp/.modality/app.model.ts",
      ).map((entry) => entry.path),
    ).toEqual(["/tmp/.modality/modals/App.modals.ts"]);
  });

  it("qualifies colliding field exports within a source file", () => {
    const modules = emitComponentModalModules(
      {
        ...model,
        transitions: [],
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
