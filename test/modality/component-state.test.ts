import { describe, expect, it } from "vitest";
import type { Model } from "modality-ts/core";
import {
  componentModalsDir,
  emitComponentModalModules,
  varHandleNaming,
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
  it("derives natural export names and paths from variable ids", () => {
    expect(varHandleNaming("local:App.draft")).toEqual({
      exportName: "App",
      path: ["draft"],
    });
    expect(varHandleNaming("atom:selectedAccountAtom")).toEqual({
      exportName: "selectedAccountAtom",
      path: [],
    });
    expect(varHandleNaming("swr:management_summary:data")).toEqual({
      exportName: "management_summary",
      path: ["data"],
    });
    expect(varHandleNaming("tanstack-query:keyId:field")).toEqual({
      exportName: "keyId",
      path: ["field"],
    });
    expect(varHandleNaming("tanstack:/dashboard")).toBeUndefined();
  });

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
    expect(source).toContain("export const App = {");
    expect(source).toContain(
      'export const authAtom: Variable<{ readonly kind: "enum"; readonly values: readonly ["guest", "user"] }, "atom:authAtom"> = variable("atom:authAtom");',
    );
    expect(source).toContain("// state");
    expect(source).toContain("phase: variable(");
    expect(source).toContain('variable("local:App.phase")');
    expect(source).toContain("// transitions");
    expect(source).toContain("onClick: {");
    expect(source).toContain("handleAdvance:");
    expect(source).toContain('"App.onClick.handleAdvance"');
    expect(source).toContain('TransitionRef<"App.onClick.handleAdvance">');
    expect(source).not.toContain('"handleAdvance"');
    expect(source).not.toContain("export const phase");
  });

  it("emits grouped handles for store and cache fields", () => {
    const modules = emitComponentModalModules(
      {
        ...model,
        transitions: [],
        vars: [
          {
            id: "zustand:useManagementStore.summaryStatus",
            domain: { kind: "enum", values: ["idle", "loading", "ready"] },
            origin: { file: "management-store.ts", line: 4 },
            scope: { kind: "global" },
            initial: "idle",
          },
          {
            id: "swr:management_summary:data",
            domain: { kind: "option", inner: { kind: "bool" } },
            origin: { file: "management-store.ts", line: 9 },
            scope: { kind: "global" },
            initial: null,
          },
        ],
      },
      "/tmp/.modality/app.model.ts",
    );

    expect(modules.map((entry) => entry.fileName)).toEqual([
      "management-store.modals.ts",
    ]);
    const source = modules[0]!.source;
    expect(source).toContain("export const management_summary = {");
    expect(source).toContain(
      'data: variable("swr:management_summary:data") as Variable',
    );
    expect(source).toContain("export const useManagementStore = {");
    expect(source).toContain(
      'summaryStatus: variable("zustand:useManagementStore.summaryStatus") as Variable',
    );
  });

  it("anchors cache template vars through their sourced transitions", () => {
    const modules = emitComponentModalModules(
      {
        ...model,
        vars: [
          {
            id: "swr:management_summary:data",
            domain: { kind: "option", inner: { kind: "bool" } },
            origin: "library-template",
            scope: { kind: "global" },
            initial: null,
          },
          {
            id: "swr:management_summary:isValidating",
            domain: { kind: "bool" },
            origin: "library-template",
            scope: { kind: "global" },
            initial: false,
          },
        ],
        transitions: [
          {
            id: "swr:management_summary:fetch",
            cls: "library",
            label: { kind: "timer", key: "management_summary" },
            source: [{ file: "management-queries.ts", line: 7 }],
            guard: { kind: "lit", value: true },
            effect: {
              kind: "assign",
              var: "swr:management_summary:isValidating",
              expr: { kind: "lit", value: true },
            },
            reads: [],
            writes: ["swr:management_summary:isValidating"],
            confidence: "exact",
          },
        ],
      },
      "/tmp/.modality/app.model.ts",
    );

    expect(modules.map((entry) => entry.fileName)).toEqual([
      "management-queries.modals.ts",
    ]);
    const source = modules[0]!.source;
    expect(source).toContain("export const management_summary = {");
    expect(source).toContain(
      'data: variable("swr:management_summary:data") as Variable',
    );
    expect(source).toContain(
      'isValidating: variable("swr:management_summary:isValidating") as Variable',
    );
    expect(source).toContain(
      'fetch: "swr:management_summary:fetch" as TransitionRef<"swr:management_summary:fetch">',
    );
  });

  it("merges SWR state and transitions into one hook-named export", () => {
    const modules = emitComponentModalModules(
      {
        ...model,
        vars: [
          {
            id: "swr:useDashboardSummary:data",
            domain: { kind: "option", inner: { kind: "tokens", count: 1 } },
            origin: "library-template",
            scope: { kind: "global" },
            initial: null,
          },
          {
            id: "swr:useDashboardSummary:error",
            domain: { kind: "bool" },
            origin: "library-template",
            scope: { kind: "global" },
            initial: false,
          },
          {
            id: "swr:useDashboardSummary:isValidating",
            domain: { kind: "bool" },
            origin: "library-template",
            scope: { kind: "global" },
            initial: false,
          },
        ],
        transitions: [
          {
            id: "swr:useDashboardSummary:fetch",
            cls: "library",
            label: { kind: "timer", key: "dashboard:selectedAccount" },
            source: [{ file: "dashboard-queries.ts", line: 4 }],
            guard: { kind: "true" },
            effect: {
              kind: "assign",
              var: "swr:useDashboardSummary:isValidating",
              expr: { kind: "lit", value: true },
            },
            reads: [],
            writes: ["swr:useDashboardSummary:isValidating"],
            confidence: "exact",
          },
          {
            id: "swr:useDashboardSummary:resolve:error",
            cls: "library",
            label: { kind: "timer", key: "dashboard:selectedAccount" },
            source: [{ file: "dashboard-queries.ts", line: 4 }],
            guard: { kind: "true" },
            effect: {
              kind: "assign",
              var: "swr:useDashboardSummary:error",
              expr: { kind: "lit", value: true },
            },
            reads: [],
            writes: ["swr:useDashboardSummary:error"],
            confidence: "exact",
          },
          {
            id: "swr:useDashboardSummary:resolve:success:0",
            cls: "library",
            label: { kind: "timer", key: "dashboard:selectedAccount" },
            source: [{ file: "dashboard-queries.ts", line: 4 }],
            guard: { kind: "true" },
            effect: {
              kind: "assign",
              var: "swr:useDashboardSummary:data",
              expr: { kind: "lit", value: "one" },
            },
            reads: [],
            writes: ["swr:useDashboardSummary:data"],
            confidence: "exact",
          },
        ],
      },
      "/tmp/.modality/app.model.ts",
    );

    const source = modules[0]!.source;
    expect(source).toContain("export const useDashboardSummary = {");
    expect(source).toContain(
      'data: variable("swr:useDashboardSummary:data") as Variable',
    );
    expect(source).toContain(
      'fetch: "swr:useDashboardSummary:fetch" as TransitionRef<"swr:useDashboardSummary:fetch">',
    );
    expect(source).toContain(
      'error: "swr:useDashboardSummary:resolve:error" as TransitionRef<"swr:useDashboardSummary:resolve:error">',
    );
    expect(source).toContain("success: {");
    expect(source).toContain(
      '"0": "swr:useDashboardSummary:resolve:success:0"',
    );
    expect(source).not.toContain("export const swr_useDashboardSummary_fetch");
    expect(source).not.toContain('fetch: {\n    _: "swr:');
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
    expect(source).toContain("export const App = {");
    expect(source).toContain("// state");
    expect(source).toContain("phase: variable(");
  });

  it("emits nothing for a model without source-anchored vars or sourced transitions", () => {
    expect(
      emitComponentModalModules(
        { ...model, vars: [], transitions: [] },
        "/tmp/.modality/app.model.ts",
      ),
    ).toEqual([]);
  });

  it("keeps the legacy synthetic modals directory helper available", () => {
    expect(componentModalsDir("/tmp/.modality/app.model.ts")).toBe(
      "/tmp/.modality/modals",
    );
  });

  it("skips vars without source anchors", () => {
    expect(
      emitComponentModalModules(
        {
          ...model,
          transitions: [],
          vars: [{ ...model.vars[0]!, origin: "system" }],
        },
        "/tmp/.modality/app.model.ts",
      ).map((entry) => entry.path),
    ).toEqual([]);
  });

  it("uses metadata var anchors as source anchors for legacy hand models", () => {
    const modules = emitComponentModalModules(
      {
        ...model,
        metadata: {
          varAnchors: {
            "atom:authAtom": { file: "App.tsx", line: 1 },
          },
        },
        transitions: [],
        vars: [{ ...model.vars[1]!, origin: "system" }],
      },
      "/tmp/.modality/app.model.ts",
    );

    expect(modules).toHaveLength(1);
    expect(modules[0]?.source).toContain("export const authAtom: Variable");
    expect(modules[0]?.source).toContain('variable("atom:authAtom")');
  });

  it("scopes colliding field names by component object", () => {
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

    expect(modules[0]?.source).toContain("export const App = {");
    expect(modules[0]?.source).toContain("export const Child = {");
    expect(modules[0]?.source).toMatch(
      /export const App = \{\n {2}\/\/ state\n {2}phase: variable/,
    );
    expect(modules[0]?.source).toMatch(
      /export const Child = \{\n {2}\/\/ state\n {2}phase: variable/,
    );
    expect(modules[0]?.source).not.toContain("App_phase");
    expect(modules[0]?.source).not.toContain("Child_phase");
  });

  it("emits quoted keys for non-identifier state fields", () => {
    const modules = emitComponentModalModules(
      {
        ...model,
        transitions: [],
        vars: [
          {
            ...model.vars[0]!,
            id: "local:App.active-step",
          },
        ],
      },
      "/tmp/.modality/app.model.ts",
    );

    expect(modules[0]?.source).toContain(
      '"active-step": variable("local:App.active-step")',
    );
  });
});
