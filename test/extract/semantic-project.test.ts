import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { runExtractionPipeline } from "modality-ts/extract";
import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import { useStateSource } from "../../src/extract/sources/use-state/index.js";
import {
  createSemanticProject,
  createSemanticProjectForTest,
  createSemanticProjectFromConfig,
  loadSemanticProjectConfig,
} from "../../src/extract/engine/ts/semantic-project.js";

const projectRoot = resolve("/project");

describe("createSemanticProject", () => {
  it("resolves an imported type alias across two in-memory source files", () => {
    const typesPath = resolve(projectRoot, "types.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const semanticProject = createSemanticProjectForTest([
      {
        path: typesPath,
        text: `export type Status = "idle" | "loading" | "done";`,
      },
      {
        path: appPath,
        text: `import type { Status } from "./types.js";
export function App() {
  const value: Status = "idle";
  return null;
}`,
      },
    ]);

    const appFile = semanticProject.getSourceFile(appPath);
    expect(appFile).toBeDefined();
    if (!appFile) return;
    let statusDeclaration: ts.VariableDeclaration | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "value" &&
        node.type
      ) {
        statusDeclaration = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(appFile);
    expect(statusDeclaration).toBeDefined();
    if (!statusDeclaration) return;
    const type = semanticProject.getTypeAtLocation(statusDeclaration);
    expect(type).toBeDefined();
    if (!type) return;
    expect(type.isUnion()).toBe(true);
    const members = type.types.map((member) =>
      semanticProject.checker.typeToString(member),
    );
    expect(members).toEqual(
      expect.arrayContaining(['"idle"', '"loading"', '"done"']),
    );
  });

  it("respects baseUrl and paths from tsconfig resolution", () => {
    const aliasPath = resolve(projectRoot, "src/shared/status.ts");
    const appPath = resolve(projectRoot, "src/App.tsx");
    const semanticProject = createSemanticProject(
      [
        {
          path: aliasPath,
          text: `export type Status = "open" | "closed";`,
        },
        {
          path: appPath,
          text: `import type { Status } from "@/shared/status.js";
export function App() {
  const value: Status = "open";
  return null;
}`,
        },
      ],
      {
        baseUrl: resolve(projectRoot, "src"),
        paths: [
          {
            prefix: "@/",
            suffix: "",
            targets: [resolve(projectRoot, "src", "*")],
          },
        ],
      },
    );

    const appFile = semanticProject.getSourceFile(appPath);
    expect(appFile).toBeDefined();
    if (!appFile) return;
    let statusDeclaration: ts.VariableDeclaration | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "value" &&
        node.type
      ) {
        statusDeclaration = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(appFile);
    expect(statusDeclaration).toBeDefined();
    if (!statusDeclaration) return;
    const type = semanticProject.getTypeAtLocation(statusDeclaration);
    expect(type?.isUnion()).toBe(true);
    if (!type) return;
    const members = type.types.map((member) =>
      semanticProject.checker.typeToString(member),
    );
    expect(members).toEqual(expect.arrayContaining(['"open"', '"closed"']));
  });

  it("returns the same ts.SourceFile for canonical file paths used by extraction fragments", () => {
    const appPath = resolve(projectRoot, "App.tsx");
    const semanticProject = createSemanticProjectForTest([
      {
        path: appPath,
        text: `export function App() { return null; }`,
      },
    ]);

    const fromMap = semanticProject.getSourceFile(appPath);
    const fromContext = semanticProject.getSourceFile(
      resolve(projectRoot, "./App.tsx"),
    );
    expect(fromMap).toBeDefined();
    expect(fromContext).toBe(fromMap);
    expect(semanticProject.sourceFiles.get(resolve(appPath))).toBe(fromMap);
  });
});

describe("loadSemanticProjectConfig", () => {
  it("parses JSONC comments in tsconfig", async () => {
    const dir = await mkdtemp(join(tmpdir(), "semantic-jsonc-"));
    await writeFile(
      join(dir, "tsconfig.json"),
      `{
        "compilerOptions": {
          /* comment */
          "baseUrl": ".",
          "paths": { "@/*": ["./src/*"] }
        }
      }`,
      "utf8",
    );
    const config = loadSemanticProjectConfig(dir);
    expect(config.configFilePath).toBe(join(dir, "tsconfig.json"));
    expect(config.parsedCommandLine.options.baseUrl).toBe(resolve(dir));
    expect(config.parsedCommandLine.options.paths).toEqual({
      "@/*": ["./src/*"],
    });
  });

  it("inherits compiler options through extends", async () => {
    const dir = await mkdtemp(join(tmpdir(), "semantic-extends-"));
    await writeFile(
      join(dir, "base.json"),
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          jsx: "react-jsx",
        },
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ extends: "./base.json", compilerOptions: { strict: true } }),
      "utf8",
    );
    const config = loadSemanticProjectConfig(dir);
    expect(config.parsedCommandLine.options.module).toBe(ts.ModuleKind.NodeNext);
    expect(config.parsedCommandLine.options.jsx).toBe(ts.JsxEmit.ReactJSX);
    expect(config.parsedCommandLine.options.strict).toBe(true);
  });

  it("resolves path aliases through parsed config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "semantic-paths-"));
    await mkdir(join(dir, "src", "lib"), { recursive: true });
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          paths: { "@lib/*": ["./src/lib/*"] },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "src", "lib", "value.ts"),
      `export const value = 1;`,
      "utf8",
    );
    await writeFile(
      join(dir, "src", "app.ts"),
      `import { value } from "@lib/value.js"; export { value };`,
      "utf8",
    );
    const config = loadSemanticProjectConfig(dir);
    const project = createSemanticProjectFromConfig(config, [
      join(dir, "src", "app.ts"),
    ]);
    const resolved = project.resolveModuleName(
      "@lib/value.js",
      join(dir, "src", "app.ts"),
    );
    expect(resolved?.fileName).toBe(resolve(join(dir, "src", "lib", "value.ts")));
    expect(resolved?.isExternal).toBe(false);
  });

  it("resolves project references exporting consumed types", async () => {
    const dir = await mkdtemp(join(tmpdir(), "semantic-ref-"));
    await mkdir(join(dir, "packages", "shared"), { recursive: true });
    await mkdir(join(dir, "app"), { recursive: true });
    await writeFile(
      join(dir, "packages", "shared", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          composite: true,
          declaration: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          rootDir: ".",
        },
        include: ["index.ts"],
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "packages", "shared", "index.ts"),
      `export type Mode = "on" | "off";`,
      "utf8",
    );
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
        references: [{ path: "./packages/shared" }],
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "app", "main.ts"),
      `import type { Mode } from "../packages/shared/index.js";
export const mode: Mode = "on";`,
      "utf8",
    );
    const config = loadSemanticProjectConfig(dir);
    const project = createSemanticProjectFromConfig(config, [
      join(dir, "app", "main.ts"),
    ]);
    const resolved = project.resolveModuleName(
      "../packages/shared/index.js",
      join(dir, "app", "main.ts"),
    );
    expect(resolved?.fileName).toBe(
      resolve(join(dir, "packages", "shared", "index.ts")),
    );
  });
});

describe("SemanticProject resolver APIs", () => {
  it("resolves extensionless and .js specifiers to .ts sources under NodeNext", () => {
    const root = resolve("/proj");
    const fooPath = resolve(root, "foo.ts");
    const appPath = resolve(root, "app.ts");
    const entries = [
      { path: fooPath, text: `export function foo() { return 1; }` },
      {
        path: appPath,
        text: `import { foo as a } from "./foo.js";
import { foo as b } from "./foo";
export { a, b };`,
      },
    ];
    const project = createSemanticProjectForTest(entries);
    const fromJs = project.resolveModuleName("./foo.js", appPath);
    const fromBare = project.resolveModuleName("./foo", appPath);
    expect(fromJs?.fileName).toBe(fooPath);
    expect(fromBare?.fileName).toBe(fooPath);
  });

  it("resolves re-export aliases to the canonical source file", () => {
    const root = resolve("/proj");
    const implPath = resolve(root, "impl.ts");
    const barrelPath = resolve(root, "barrel.ts");
    const appPath = resolve(root, "app.ts");
    const entries = [
      { path: implPath, text: `export function Widget() { return null; }` },
      {
        path: barrelPath,
        text: `export { Widget } from "./impl.js";`,
      },
      {
        path: appPath,
        text: `import { Widget } from "./barrel.js"; export { Widget };`,
      },
    ];
    const project = createSemanticProjectForTest(entries);
    const resolved = project.resolveModuleName("./barrel.js", appPath);
    expect(resolved?.fileName).toBe(barrelPath);
    const appFile = project.getSourceFile(appPath);
    expect(appFile).toBeDefined();
    if (!appFile) return;
    let importClause: ts.ImportClause | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isImportClause(node.importClause)) {
        importClause = node.importClause;
      }
      ts.forEachChild(node, visit);
    };
    visit(appFile);
    expect(importClause).toBeDefined();
    if (!importClause?.name) return;
    const aliased = project.aliasedSymbolAt(importClause.name);
    const declarations = aliased?.getDeclarations();
    expect(declarations?.[0]?.getSourceFile().fileName).toBe(implPath);
  });

  it("produces stable symbol keys across imported aliases", () => {
    const root = resolve("/proj");
    const libPath = resolve(root, "lib.ts");
    const appPath = resolve(root, "app.tsx");
    const entries = [
      {
        path: libPath,
        text: `export function setCount() {}`,
      },
      {
        path: appPath,
        text: `import { setCount as apply } from "./lib.js";
import { setCount } from "./lib.js";
export function App() { apply(); setCount(); return null; }`,
      },
    ];
    const project = createSemanticProjectForTest(entries);
    const appFile = project.getSourceFile(appPath);
    expect(appFile).toBeDefined();
    if (!appFile) return;
    const identifiers: ts.Identifier[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === "setCount")
        identifiers.push(node);
      if (ts.isIdentifier(node) && node.text === "apply") identifiers.push(node);
      ts.forEachChild(node, visit);
    };
    visit(appFile);
    const keys = identifiers
      .map((id) => project.aliasedSymbolAt(id))
      .filter((symbol): symbol is ts.Symbol => Boolean(symbol))
      .map((symbol) => project.symbolKey(symbol));
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(1);
  });

  it("distinguishes symbol keys for shadowed local identifiers", () => {
    const root = resolve("/proj");
    const appPath = resolve(root, "app.ts");
    const entries = [
      {
        path: appPath,
        text: `export function outer() {
  const value = 1;
  function inner() {
    const value = 2;
    return value;
  }
  return inner();
}`,
      },
    ];
    const project = createSemanticProjectForTest(entries);
    const appFile = project.getSourceFile(appPath);
    expect(appFile).toBeDefined();
    if (!appFile) return;
    const valueDecls: ts.VariableDeclaration[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "value"
      ) {
        valueDecls.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(appFile);
    expect(valueDecls.length).toBe(2);
    const keys = valueDecls.map((decl) => project.localSymbolKey(decl.name));
    expect(keys[0]).toBeDefined();
    expect(keys[1]).toBeDefined();
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("runExtractionPipeline semantic context", () => {
  it("passes checker to plugin discover and writeChannels when semanticProject is provided", () => {
    const fileName = resolve(projectRoot, "App.tsx");
    const sourceText = `export function App() { return null; }`;
    const semanticProject = createSemanticProjectForTest([
      { path: fileName, text: sourceText },
    ]);
    let discoverChecker: ts.TypeChecker | undefined;
    let channelChecker: ts.TypeChecker | undefined;
    const plugin: StateSourcePlugin = {
      id: "semantic-probe",
      packageNames: ["semantic-probe"],
      discover(ctx) {
        discoverChecker = ctx.types?.checker;
        return [];
      },
      writeChannels(ctx) {
        channelChecker = ctx.types?.checker;
        return [];
      },
      harness: {
        setup: () => ({}),
        observe: () => "unobservable",
      },
    };

    runExtractionPipeline({
      sourceText,
      fileName,
      route: "/",
      sourcePlugins: [plugin],
      semanticProject,
    });

    expect(discoverChecker).toBe(semanticProject.checker);
    expect(channelChecker).toBe(semanticProject.checker);
  });

  it("keeps existing behavior when types are omitted", () => {
    const result = runExtractionPipeline({
      sourceText: `export function App() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}`,
      fileName: "App.tsx",
      route: "/",
      sourcePlugins: [useStateSource()],
    });
    expect(
      result.transitions.some((transition) =>
        transition.id.includes("onClick"),
      ),
    ).toBe(true);
    expect(result.stateVars.some((decl) => decl.id.includes("count"))).toBe(
      true,
    );
  });
});
