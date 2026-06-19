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
    const handlePath = join(dir, "App.vars.ts");
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
import { phase } from "./App.vars";
eq(phase, "confirm");
`,
      "utf8",
    );

    const { source } = await rewriteImportedSymbols(propsPath, localOnlyModel);
    expect(source).toContain('variable("local:App.phase")');
    expect(source).not.toMatch(/import \{ phase \} from "\.\/App\.vars"/);
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
import { count, phase } from "./App.vars";
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
    expect(source).not.toContain("./App.vars");
  });

  it("throws for stale generated handle imports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-resolve-"));
    const propsPath = join(dir, "app.props.ts");
    await writeFile(
      propsPath,
      `import { eq } from "modality-ts/properties";
import { missing } from "./App.vars";
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
});
