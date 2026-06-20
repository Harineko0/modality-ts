import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Model } from "modality-ts/core";
import { rewriteImportedSymbols } from "../../../src/cli/properties/resolve-symbols.js";

const model: Model = {
  schemaVersion: 1,
  id: "resolve-fixture",
  bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
  metadata: {
    varAnchors: {
      "atom:authAtom": {
        file: join(process.cwd(), "examples/demo-app/App.tsx"),
        line: 5,
      },
    },
  },
  vars: [
    {
      id: "atom:authAtom",
      domain: { kind: "enum", values: ["guest", "user"] },
      origin: {
        file: join(process.cwd(), "examples/demo-app/App.tsx"),
        line: 5,
      },
      scope: { kind: "global" },
      initial: "guest",
    },
  ],
  transitions: [],
};

const localOnlyModel: Model = {
  schemaVersion: 1,
  id: "resolve-local-fixture",
  bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
  vars: [
    {
      id: "local:App.phase",
      domain: { kind: "enum", values: ["plan", "confirm"] },
      origin: { file: join(process.cwd(), "App.tsx"), line: 3 },
      scope: { kind: "global" },
      initial: "plan",
    },
    {
      id: "local:App.count",
      domain: { kind: "boundedInt", min: 0, max: 2 },
      origin: { file: join(process.cwd(), "App.tsx"), line: 4 },
      scope: { kind: "global" },
      initial: 0,
    },
  ],
  transitions: [],
};

describe("rewriteImportedSymbols", () => {
  it("rewrites imported module-scoped symbols to var calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-resolve-"));
    const propsPath = join(dir, "app.props.ts");
    const appPath = join(dir, "App.tsx");
    await writeFile(
      appPath,
      `export const authAtom = "guest" as const;\n`,
      "utf8",
    );
    await writeFile(
      propsPath,
      `import { eq } from "modality-ts/properties";
import { authAtom } from "./App";
eq(authAtom, "guest");
`,
      "utf8",
    );

    const anchoredModel: Model = {
      ...model,
      metadata: {
        varAnchors: {
          "atom:authAtom": { file: appPath, line: 1 },
        },
      },
    };
    const { source } = await rewriteImportedSymbols(propsPath, anchoredModel);
    expect(source).toContain('variable("atom:authAtom")');
    expect(source).not.toMatch(/\beq\(authAtom,/);
  });

  it("leaves unknown symbols untouched when they are not imported state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-resolve-"));
    const propsPath = join(dir, "app.props.ts");
    await writeFile(
      propsPath,
      `import { eq } from "modality-ts/properties";
const local = "guest";
eq(local, "guest");
`,
      "utf8",
    );
    const { source } = await rewriteImportedSymbols(propsPath, localOnlyModel);
    expect(source).toContain('eq(local, "guest")');
  });

  it("rewrites imports from generated handle modules via the embedded id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-resolve-"));
    const propsPath = join(dir, "app.props.ts");
    const handlePath = join(dir, "App.modals.ts");
    await writeFile(
      handlePath,
      `import { variable, type Variable } from "modality-ts/core";
export const phase: Variable<{ readonly kind: "enum" }, "local:App.phase"> = variable("local:App.phase") as Variable<{ readonly kind: "enum" }, "local:App.phase">;
`,
      "utf8",
    );
    await writeFile(
      propsPath,
      `import { eq } from "modality-ts/properties";
import { phase } from "./App.modals";
eq(phase, "confirm");
`,
      "utf8",
    );

    const { source } = await rewriteImportedSymbols(propsPath, localOnlyModel);
    expect(source).toContain('variable("local:App.phase")');
    expect(source).not.toMatch(/import \{ phase \} from "\.\/App\.modals"/);
  });

  it("rewrites sibling generated handle imports from virtual declarations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-resolve-"));
    const propsPath = join(dir, "app.props.ts");
    const modelWithOrigins: Model = {
      ...localOnlyModel,
      vars: localOnlyModel.vars.map((decl, index) => ({
        ...decl,
        origin: { file: join(dir, "App.tsx"), line: index + 3 },
      })),
    };
    await writeFile(
      propsPath,
      `import { always, and, eq } from "modality-ts/properties";
import { count, phase } from "./App.modals";
always("ok", and(eq(phase, "confirm"), eq(count, 1)));
`,
      "utf8",
    );

    const { source } = await rewriteImportedSymbols(
      propsPath,
      modelWithOrigins,
    );
    expect(source).toContain('variable("local:App.phase")');
    expect(source).toContain('variable("local:App.count")');
    expect(source).not.toContain("./App.modals");
  });

  it("throws for stale generated handle imports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-resolve-"));
    const propsPath = join(dir, "app.props.ts");
    await writeFile(
      propsPath,
      `import { eq } from "modality-ts/properties";
import { missing } from "./App.modals";
eq(missing, "confirm");
`,
      "utf8",
    );

    const modelWithOrigin: Model = {
      ...localOnlyModel,
      vars: localOnlyModel.vars.map((decl) => ({
        ...decl,
        origin: { file: join(dir, "App.tsx"), line: 3 },
      })),
    };
    await expect(
      rewriteImportedSymbols(propsPath, modelWithOrigin),
    ).rejects.toThrow(/Could not resolve imported symbol "missing"/);
  });

  it("never rewrites or flags modality-ts/* package imports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-resolve-"));
    const propsPath = join(dir, "app.props.ts");
    await writeFile(
      propsPath,
      `import { eq } from "modality-ts/properties";
import { pending } from "modality-ts/vars";
eq(pending, "api.placeOrder");
`,
      "utf8",
    );
    const { source, diagnostics } = await rewriteImportedSymbols(
      propsPath,
      model,
    );
    expect(diagnostics).toEqual([]);
    expect(source).toMatch(/import \{ pending \} from "modality-ts\/vars"/);
    expect(source).toContain("eq(pending,");
  });

  it("rewrites nested transition member access and strips the root import", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-resolve-transition-"));
    const propsPath = join(dir, "app.props.ts");
    const transitionId = "App.onClick.handleAdvance";
    const modelWithTransition: Model = {
      ...localOnlyModel,
      transitions: [
        {
          id: transitionId,
          cls: "user",
          label: {
            kind: "click",
            locator: { kind: "testId", value: "advance" },
          },
          source: [{ file: join(dir, "App.tsx"), line: 10 }],
          guard: { kind: "true" },
          effect: {
            kind: "assign",
            target: "local:App.phase",
            value: "confirm",
          },
          reads: [],
          writes: ["local:App.phase"],
          confidence: "exact",
        },
      ],
      vars: localOnlyModel.vars.map((decl, index) => ({
        ...decl,
        origin: { file: join(dir, "App.tsx"), line: index + 3 },
      })),
    };
    await writeFile(
      propsPath,
      `import { alwaysStep, enabled, stepTransitionId } from "modality-ts/properties";
import { App } from "./App.modals";
alwaysStep("clicked", { step: stepTransitionId(App.onClick.handleAdvance), pre: enabled(App.onClick.handleAdvance) });
`,
      "utf8",
    );

    const { source } = await rewriteImportedSymbols(
      propsPath,
      modelWithTransition,
    );
    expect(source).toContain(
      `stepTransitionId(${JSON.stringify(transitionId)})`,
    );
    expect(source).toContain(`enabled(${JSON.stringify(transitionId)})`);
    expect(source).not.toContain("./App.modals");
    expect(source).not.toMatch(/import \{ App \}/);
  });

  it("rewrites dotted property and quoted element access for nested handles", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "modality-resolve-transition-nested-"),
    );
    const propsPath = join(dir, "app.props.ts");
    const historyId = "CustomerHome.onClick.isHistoryOpen";
    const submitId = "CustomerHome.onSubmit.ACTION /order.start";
    const modelWithTransition: Model = {
      ...localOnlyModel,
      vars: [],
      transitions: [
        {
          id: historyId,
          cls: "user",
          label: { kind: "click", text: "History" },
          source: [{ file: join(dir, "Home.tsx"), line: 10 }],
          guard: { kind: "true" },
          effect: {
            kind: "assign",
            target: "local:CustomerHome.isHistoryOpen",
            value: true,
          },
          reads: [],
          writes: ["local:CustomerHome.isHistoryOpen"],
          confidence: "exact",
        },
        {
          id: submitId,
          cls: "user",
          label: { kind: "submit", text: "Start" },
          source: [{ file: join(dir, "Home.tsx"), line: 11 }],
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
    };
    await writeFile(
      propsPath,
      `import { enabled, stepTransitionId } from "modality-ts/properties";
import { CustomerHome } from "./Home.modals";
enabled(CustomerHome.onClick.isHistoryOpen);
stepTransitionId(CustomerHome.onSubmit["ACTION /order"].start);
`,
      "utf8",
    );

    const { source } = await rewriteImportedSymbols(
      propsPath,
      modelWithTransition,
    );
    expect(source).toContain(`enabled(${JSON.stringify(historyId)})`);
    expect(source).toContain(`stepTransitionId(${JSON.stringify(submitId)})`);
    expect(source).not.toContain("./Home.modals");
    expect(source).not.toMatch(/import \{ CustomerHome \}/);
  });

  it("rewrites imported flat transition handles to string literals and strips the import", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-resolve-transition-"));
    const propsPath = join(dir, "app.props.ts");
    const handlePath = join(dir, "App.modals.ts");
    const transitionId = "App.onClick.handleAdvance";
    await writeFile(
      handlePath,
      `import type { TransitionRef } from "modality-ts/properties";
export const app_advance: TransitionRef<"${transitionId}"> = ${JSON.stringify(transitionId)} as TransitionRef<"${transitionId}">;
`,
      "utf8",
    );
    await writeFile(
      propsPath,
      `import { alwaysStep, enabled, stepTransitionId } from "modality-ts/properties";
import { app_advance } from "./App.modals";
alwaysStep("clicked", { step: stepTransitionId(app_advance), pre: enabled(app_advance) });
`,
      "utf8",
    );

    const { source } = await rewriteImportedSymbols(propsPath, localOnlyModel);
    expect(source).toContain(
      `stepTransitionId(${JSON.stringify(transitionId)})`,
    );
    expect(source).toContain(`enabled(${JSON.stringify(transitionId)})`);
    expect(source).not.toContain("./App.modals");
    expect(source).not.toContain("app_advance");
  });

  it("throws for stale generated transition handle imports", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "modality-resolve-transition-stale-"),
    );
    const propsPath = join(dir, "app.props.ts");
    const modelWithTransition: Model = {
      ...localOnlyModel,
      transitions: [
        {
          id: "App.onClick.handleAdvance",
          cls: "user",
          label: { kind: "click", text: "Go" },
          source: [{ file: join(dir, "App.tsx"), line: 10 }],
          guard: { kind: "true" },
          effect: {
            kind: "assign",
            target: "local:App.phase",
            value: "confirm",
          },
          reads: [],
          writes: ["local:App.phase"],
          confidence: "exact",
        },
      ],
      vars: localOnlyModel.vars.map((decl) => ({
        ...decl,
        origin: { file: join(dir, "App.tsx"), line: 3 },
      })),
    };
    await writeFile(
      propsPath,
      `import { enabled } from "modality-ts/properties";
import { missingTransition } from "./App.modals";
enabled(missingTransition);
`,
      "utf8",
    );

    await expect(
      rewriteImportedSymbols(propsPath, modelWithTransition),
    ).rejects.toThrow(/Could not resolve imported symbol "missingTransition"/);
  });
});
