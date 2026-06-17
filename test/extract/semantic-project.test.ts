import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as ts from "typescript";
import { runExtractionPipeline } from "modality-ts/extract";
import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import { useStateSource } from "../../src/extract/sources/use-state/index.js";
import {
  createSemanticProject,
  createSemanticProjectForTest,
  loadSemanticProjectConfig,
  writeSemanticProjectFixture,
} from "../../src/extract/engine/ts/semantic-project.js";

const projectRoot = resolve("/project");
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function withFixture(
  files: Record<string, string>,
  run: (rootDir: string) => void | Promise<void>,
): Promise<void> {
  const rootDir = await mkdtemp(join(tmpdir(), "modality-semantic-project-"));
  tempDirs.push(rootDir);
  writeSemanticProjectFixture(rootDir, files);
  await run(rootDir);
}

function identifierNode(
  sourceFile: ts.SourceFile,
  name: string,
): ts.Identifier | undefined {
  let found: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe("loadSemanticProjectConfig", () => {
  it("parses JSONC comments in tsconfig.json", async () => {
    await withFixture(
      {
        "tsconfig.json": `{
          "compilerOptions": {
            /* Path aliases are common in generated TSConfig files. */
            "baseUrl": ".",
            "paths": {
              "@/*": ["./src/*"]
            }
          }
        }`,
        "src/App.tsx": "export function App() { return null; }",
      },
      (rootDir) => {
        const config = loadSemanticProjectConfig(rootDir);
        expect(config.configFilePath).toBe(join(rootDir, "tsconfig.json"));
        expect(config.parsedCommandLine.options.baseUrl).toBe(config.configDir);
        expect(config.parsedCommandLine.options.paths).toEqual({
          "@/*": ["./src/*"],
        });
      },
    );
  });

  it("inherits compiler options through extends", async () => {
    await withFixture(
      {
        "base.json": `{
          "compilerOptions": {
            "jsx": "react-jsx",
            "allowJs": true
          }
        }`,
        "tsconfig.json": `{
          "extends": "./base.json",
          "compilerOptions": {
            "baseUrl": "./src"
          }
        }`,
        "src/App.tsx": "export function App() { return null; }",
      },
      (rootDir) => {
        const config = loadSemanticProjectConfig(rootDir);
        expect(config.parsedCommandLine.options.jsx).toBe(ts.JsxEmit.ReactJSX);
        expect(config.parsedCommandLine.options.allowJs).toBe(true);
        expect(config.parsedCommandLine.options.baseUrl).toBe(
          join(rootDir, "src"),
        );
      },
    );
  });

  it("loads project references from parsed command line", async () => {
    await withFixture(
      {
        "tsconfig.json": `{
          "files": ["./app.ts"],
          "references": [{ "path": "./lib" }]
        }`,
        "app.ts": "export {}",
        "lib/tsconfig.json": `{
          "compilerOptions": {
            "composite": true,
            "declaration": true
          },
          "include": ["./index.ts"]
        }`,
        "lib/index.ts": "export type Shared = 'ok';",
      },
      (rootDir) => {
        const config = loadSemanticProjectConfig(rootDir);
        expect(config.projectReferences).toHaveLength(1);
        expect(config.projectReferences[0]?.path).toBe(join(rootDir, "lib"));
      },
    );
  });
});

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

  it("resolves path aliases from parsed semantic project config", async () => {
    await withFixture(
      {
        "tsconfig.json": `{
          "compilerOptions": {
            "module": "NodeNext",
            "moduleResolution": "NodeNext",
            "jsx": "react-jsx",
            "baseUrl": "./src",
            "paths": {
              "@/*": ["./*"]
            }
          }
        }`,
        "src/shared/status.ts": `export type Status = "open" | "closed";`,
        "src/App.tsx": `import type { Status } from "@/shared/status.js";
export function App() {
  const value: Status = "open";
  return null;
}`,
      },
      (rootDir) => {
        const config = loadSemanticProjectConfig(rootDir);
        const appPath = join(rootDir, "src/App.tsx");
        const semanticProject = createSemanticProject(
          [
            {
              path: join(rootDir, "src/shared/status.ts"),
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
          config,
        );
        const resolved = semanticProject.resolveModuleName(
          "@/shared/status.js",
          appPath,
        );
        expect(resolved?.fileName).toBe(
          semanticProject.canonicalFileName(
            join(rootDir, "src/shared/status.ts"),
          ),
        );
        expect(resolved?.sourceFile).toBeDefined();
      },
    );
  });

  it("resolves NodeNext .js imports to .ts source files", () => {
    const typesPath = resolve(projectRoot, "types.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const semanticProject = createSemanticProjectForTest([
      {
        path: typesPath,
        text: `export type Status = "idle";`,
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

    const resolved = semanticProject.resolveModuleName("./types.js", appPath);
    expect(resolved?.fileName).toBe(semanticProject.canonicalFileName(typesPath));
    expect(resolved?.sourceFile).toBe(semanticProject.getSourceFile(typesPath));
  });

  it("resolves bare relative imports without the .js suffix", () => {
    const helperPath = resolve(projectRoot, "helper.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const semanticProject = createSemanticProjectForTest([
      {
        path: helperPath,
        text: `export const value = 1;`,
      },
      {
        path: appPath,
        text: `import { value } from "./helper";
export function App() { return value; }`,
      },
    ]);

    const resolved = semanticProject.resolveModuleName("./helper", appPath);
    expect(resolved?.fileName).toBe(
      semanticProject.canonicalFileName(helperPath),
    );
  });

  it("consumes a type exported through a project reference", async () => {
    await withFixture(
      {
        "tsconfig.json": `{
          "compilerOptions": {
            "module": "NodeNext",
            "moduleResolution": "NodeNext",
            "jsx": "react-jsx"
          },
          "files": ["./app.ts"],
          "references": [{ "path": "./lib" }]
        }`,
        "app.ts": `import type { Shared } from "./lib/index.js";
export const value: Shared = "ok";`,
        "lib/tsconfig.json": `{
          "compilerOptions": {
            "composite": true,
            "declaration": true,
            "module": "NodeNext",
            "moduleResolution": "NodeNext"
          },
          "include": ["./index.ts"]
        }`,
        "lib/index.ts": `export type Shared = "ok";`,
      },
      (rootDir) => {
        const config = loadSemanticProjectConfig(rootDir);
        const appPath = join(rootDir, "app.ts");
        const semanticProject = createSemanticProject(
          [{ path: appPath, text: `import type { Shared } from "./lib/index.js";
export const value: Shared = "ok";` }],
          config,
        );
        const resolved = semanticProject.resolveModuleName(
          "./lib/index.js",
          appPath,
        );
        expect(resolved?.fileName).toBe(
          semanticProject.canonicalFileName(join(rootDir, "lib/index.ts")),
        );
        const appFile = semanticProject.getSourceFile(appPath);
        expect(appFile).toBeDefined();
        if (!appFile) return;
        const sharedRef = identifierNode(appFile, "Shared");
        expect(sharedRef).toBeDefined();
        if (!sharedRef) return;
        const type = semanticProject.getTypeAtLocation(sharedRef);
        expect(semanticProject.checker.typeToString(type!)).toBe('"ok"');
      },
    );
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
    expect(semanticProject.sourceFiles.get(semanticProject.canonicalFileName(appPath))).toBe(
      fromMap,
    );
    expect(semanticProject.canonicalFileName(appPath)).toBe(
      semanticProject.canonicalFileName(resolve(projectRoot, "./App.tsx")),
    );
  });

  it("keeps symbol keys stable across imported aliases and re-exports", () => {
    const typesPath = resolve(projectRoot, "types.ts");
    const bridgePath = resolve(projectRoot, "bridge.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const semanticProject = createSemanticProjectForTest([
      {
        path: typesPath,
        text: `export type Status = "idle" | "done";`,
      },
      {
        path: bridgePath,
        text: `export type { Status } from "./types.js";`,
      },
      {
        path: appPath,
        text: `import type { Status } from "./bridge.js";
import type { Status as DirectStatus } from "./types.js";
export function App() {
  const value: Status = "idle";
  const other: DirectStatus = "done";
  return null;
}`,
      },
    ]);

    const appFile = semanticProject.getSourceFile(appPath);
    expect(appFile).toBeDefined();
    if (!appFile) return;
    let statusTypeRef: ts.TypeReferenceNode | undefined;
    let directTypeRef: ts.TypeReferenceNode | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        node.typeName.text === "Status" &&
        !statusTypeRef
      ) {
        statusTypeRef = node;
      }
      if (
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        node.typeName.text === "DirectStatus"
      ) {
        directTypeRef = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(appFile);
    expect(statusTypeRef).toBeDefined();
    expect(directTypeRef).toBeDefined();
    if (!statusTypeRef || !directTypeRef) return;
    expect(semanticProject.localSymbolKey(statusTypeRef.typeName)).toBe(
      semanticProject.localSymbolKey(directTypeRef.typeName),
    );
  });

  it("distinguishes symbol keys for shadowed local identifiers", () => {
    const appPath = resolve(projectRoot, "App.tsx");
    const semanticProject = createSemanticProjectForTest([
      {
        path: appPath,
        text: `function outer(value: number) {
  function inner(value: string) {
    return value;
  }
  return inner(String(value));
}
export { outer };`,
      },
    ]);

    const appFile = semanticProject.getSourceFile(appPath);
    expect(appFile).toBeDefined();
    if (!appFile) return;
    const identifiers = new Map<string, ts.Identifier[]>();
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === "value") {
        const existing = identifiers.get(node.text) ?? [];
        existing.push(node);
        identifiers.set(node.text, existing);
      }
      ts.forEachChild(node, visit);
    };
    visit(appFile);
    const valueIds = identifiers.get("value") ?? [];
    expect(valueIds.length).toBeGreaterThanOrEqual(2);
    const keys = valueIds.map((node) => semanticProject.localSymbolKey(node));
    expect(new Set(keys).size).toBeGreaterThan(1);
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
    let discoverSymbolKey: string | undefined;
    const plugin: StateSourcePlugin = {
      id: "semantic-probe",
      packageNames: ["semantic-probe"],
      discover(ctx) {
        discoverChecker = ctx.types?.checker;
        const appFile = ctx.types?.getSourceFile(fileName);
        const appNode = appFile
          ? identifierNode(appFile, "App")
          : undefined;
        discoverSymbolKey = appNode
          ? ctx.types?.localSymbolKey?.(appNode)
          : undefined;
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
    expect(discoverSymbolKey).toBeDefined();
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
