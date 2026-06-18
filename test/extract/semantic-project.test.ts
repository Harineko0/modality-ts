import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as ts from "typescript";
import { runExtractionPipeline } from "modality-ts/extract";
import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import { extractReactSourceTransitions } from "../../src/extract/engine/ts/react-source-transitions.js";
import {
  buildComponentRegistry,
  buildCustomHookRegistry,
} from "../../src/extract/engine/ts/components.js";
import { inferDomainSemantic } from "../../src/extract/engine/ts/type-domains.js";
import { useStateSource } from "../../src/extract/sources/use-state/index.js";
import {
  createSemanticProject,
  createSemanticProjectForTest,
  loadSemanticProjectConfig,
  writeSemanticProjectFixture,
} from "../../src/extract/engine/ts/semantic-project.js";
import {
  collectSemanticNamedImports,
  resolveSemanticNamedExport,
} from "../../src/extract/engine/ts/semantic-imports.js";

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

function semanticTypesFor(
  semanticProject: ReturnType<typeof createSemanticProjectForTest>,
  fileName: string,
) {
  const sourceFile = semanticProject.getSourceFile(fileName);
  return {
    program: semanticProject.program,
    checker: semanticProject.checker,
    ...(sourceFile ? { sourceFile } : {}),
    getSourceFile: (name: string) => semanticProject.getSourceFile(name),
    canonicalFileName: (name: string) =>
      semanticProject.canonicalFileName(name),
    resolveModuleName: (specifier: string, containingFile: string) =>
      semanticProject.resolveModuleName(specifier, containingFile),
    symbolAt: (node: ts.Node) => semanticProject.symbolAt(node),
    aliasedSymbolAt: (node: ts.Node) => semanticProject.aliasedSymbolAt(node),
    symbolKey: (symbol: ts.Symbol) => semanticProject.symbolKey(symbol),
    localSymbolKey: (node: ts.Node) => semanticProject.localSymbolKey(node),
  };
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
        expect(
          semanticProject.canonicalFileName(resolved?.fileName ?? ""),
        ).toBe(
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
    expect(resolved?.fileName).toBe(
      semanticProject.canonicalFileName(typesPath),
    );
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
          [
            {
              path: appPath,
              text: `import type { Shared } from "./lib/index.js";
export const value: Shared = "ok";`,
            },
          ],
          config,
        );
        const resolved = semanticProject.resolveModuleName(
          "./lib/index.js",
          appPath,
        );
        expect(
          semanticProject.canonicalFileName(resolved?.fileName ?? ""),
        ).toBe(
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
    expect(
      semanticProject.sourceFiles.get(
        semanticProject.canonicalFileName(appPath),
      ),
    ).toBe(fromMap);
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
        const appNode = appFile ? identifierNode(appFile, "App") : undefined;
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

  it("ties fragment extraction to the project SourceFile when semanticProject is provided", () => {
    const appPath = resolve(projectRoot, "App.tsx");
    const sourceText = `export function App() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}`;
    const semanticProject = createSemanticProjectForTest([
      { path: appPath, text: sourceText },
    ]);
    let observedSourceFile: ts.SourceFile | undefined;
    const plugin: StateSourcePlugin = {
      id: "semantic-source-probe",
      packageNames: ["semantic-source-probe"],
      discover(ctx) {
        observedSourceFile = ctx.types?.sourceFile;
        return [];
      },
      writeChannels: () => [],
      harness: {
        setup: () => ({}),
        observe: () => "unobservable",
      },
    };

    runExtractionPipeline({
      sourceText,
      fileName: appPath,
      route: "/",
      sourcePlugins: [plugin],
      semanticProject,
    });

    expect(observedSourceFile).toBe(semanticProject.getSourceFile(appPath));
  });

  it("infers imported useState domains from the project SourceFile without rematching", () => {
    const typesPath = resolve(projectRoot, "types.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const typesText = `export type Status = "idle" | "loading" | "done";`;
    const appText = `import type { Status } from "./types.js";
export function App() {
  const [status, setStatus] = useState<Status>("idle");
  return <button onClick={() => setStatus("loading")}>{status}</button>;
}`;
    const semanticProject = createSemanticProjectForTest([
      { path: typesPath, text: typesText },
      { path: appPath, text: appText },
    ]);

    const result = runExtractionPipeline({
      sourceText: appText,
      fileName: appPath,
      route: "/",
      sourcePlugins: [useStateSource()],
      semanticProject,
      discoverFragments: [
        { sourceText: typesText, fileName: typesPath },
        { sourceText: appText, fileName: appPath },
      ],
    });

    const statusVar = result.stateVars.find(
      (decl) => decl.id === "local:App.status",
    );
    expect(statusVar?.domain).toEqual({
      kind: "enum",
      values: ["done", "idle", "loading"],
    });
  });

  it("discovers imported components through related project files without supplemental sources", () => {
    const childPath = resolve(projectRoot, "Child.tsx");
    const appPath = resolve(projectRoot, "App.tsx");
    const childText = `export function Child({ onDone }: { onDone: () => void }) {
  return <button onClick={onDone}>done</button>;
}`;
    const appText = `import { Child } from "./Child.js";
export function App() {
  const [done, setDone] = useState(false);
  return <Child onDone={() => setDone(true)} />;
}`;
    const semanticProject = createSemanticProjectForTest([
      { path: childPath, text: childText },
      { path: appPath, text: appText },
    ]);
    const types = semanticTypesFor(semanticProject, appPath);

    const result = extractReactSourceTransitions(appText, {
      fileName: appPath,
      route: "/",
      types,
      relatedFragments: [
        { sourceText: childText, fileName: childPath },
        { sourceText: appText, fileName: appPath },
      ],
    });

    expect(
      result.transitions.some(
        (transition) =>
          transition.id.includes("onClick") || transition.id.includes("onDone"),
      ),
    ).toBe(true);
    expect(result.vars.some((decl) => decl.id === "local:App.done")).toBe(true);
  });

  it("populates component registry entries with symbol keys for imported declarations", () => {
    const childPath = resolve(projectRoot, "Child.tsx");
    const appPath = resolve(projectRoot, "App.tsx");
    const childText = `export function Child() { return null; }`;
    const appText = `import { Child } from "./Child.js";
export function App() { return <Child />; }`;
    const semanticProject = createSemanticProjectForTest([
      { path: childPath, text: childText },
      { path: appPath, text: appText },
    ]);
    const types = semanticTypesFor(semanticProject, appPath);
    const appSource = semanticProject.getSourceFile(appPath)!;
    const registry = buildComponentRegistry(appSource, {
      types,
      primaryFileName: appPath,
      relatedSourceFiles: [semanticProject.getSourceFile(childPath)!],
    });

    expect(registry.bySymbolKey.size).toBeGreaterThanOrEqual(2);
    expect(registry.byDisplayName.has("App")).toBe(true);
    expect(registry.byDisplayName.has("Child")).toBe(false);
    const childTag = identifierNode(appSource, "Child");
    const childKey = childTag ? types.localSymbolKey(childTag) : undefined;
    expect(childKey).toBeTruthy();
    expect(registry.bySymbolKey.get(childKey!)?.displayName).toBe("Child");
  });

  it("discovers re-exported components through a local barrel", () => {
    const childPath = resolve(projectRoot, "Child.tsx");
    const barrelPath = resolve(projectRoot, "components/index.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const childText = `export function Child({ onDone }: { onDone: () => void }) {
  return <button onClick={onDone}>done</button>;
}`;
    const barrelText = `export { Child } from "../Child.js";`;
    const appText = `import { Child } from "./components/index.js";
export function App() {
  const [done, setDone] = useState(false);
  return <Child onDone={() => setDone(true)} />;
}`;
    const semanticProject = createSemanticProjectForTest([
      { path: childPath, text: childText },
      { path: barrelPath, text: barrelText },
      { path: appPath, text: appText },
    ]);
    const types = semanticTypesFor(semanticProject, appPath);

    const result = extractReactSourceTransitions(appText, {
      fileName: appPath,
      route: "/",
      types,
      relatedFragments: [
        { sourceText: childText, fileName: childPath },
        { sourceText: barrelText, fileName: barrelPath },
        { sourceText: appText, fileName: appPath },
      ],
    });

    expect(
      result.transitions.some(
        (transition) =>
          transition.id.includes("onClick") || transition.id.includes("onDone"),
      ),
    ).toBe(true);
  });

  it("inlines imported custom hooks from related project files", () => {
    const hookPath = resolve(projectRoot, "useCounter.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const hookText = `export function useCounter() {
  const [count, setCount] = useState(0);
  return [count, setCount] as const;
}`;
    const appText = `import { useCounter } from "./useCounter.js";
export function App() {
  const [count, setCount] = useCounter();
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}`;
    const semanticProject = createSemanticProjectForTest([
      { path: hookPath, text: hookText },
      { path: appPath, text: appText },
    ]);
    const types = semanticTypesFor(semanticProject, appPath);

    const result = extractReactSourceTransitions(appText, {
      fileName: appPath,
      route: "/",
      types,
      relatedFragments: [
        { sourceText: hookText, fileName: hookPath },
        { sourceText: appText, fileName: appPath },
      ],
    });

    expect(result.vars.some((decl) => decl.id === "local:App.count")).toBe(
      true,
    );
    expect(
      result.transitions.some((transition) =>
        transition.id.includes("onClick"),
      ),
    ).toBe(true);
  });

  it("inlines re-exported custom hooks through a local barrel", () => {
    const hookPath = resolve(projectRoot, "useCounter.ts");
    const barrelPath = resolve(projectRoot, "hooks/index.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const hookText = `export function useCounter() {
  const [count, setCount] = useState(0);
  return [count, setCount] as const;
}`;
    const barrelText = `export { useCounter } from "../useCounter.js";`;
    const appText = `import { useCounter } from "./hooks/index.js";
export function App() {
  const [count, setCount] = useCounter();
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}`;
    const semanticProject = createSemanticProjectForTest([
      { path: hookPath, text: hookText },
      { path: barrelPath, text: barrelText },
      { path: appPath, text: appText },
    ]);
    const types = semanticTypesFor(semanticProject, appPath);

    const result = extractReactSourceTransitions(appText, {
      fileName: appPath,
      route: "/",
      types,
      relatedFragments: [
        { sourceText: hookText, fileName: hookPath },
        { sourceText: barrelText, fileName: barrelPath },
        { sourceText: appText, fileName: appPath },
      ],
    });

    expect(result.vars.some((decl) => decl.id === "local:App.count")).toBe(
      true,
    );
  });

  it("does not cross-bind shadowed component prop handlers", () => {
    const childPath = resolve(projectRoot, "Child.tsx");
    const appPath = resolve(projectRoot, "App.tsx");
    const childText = `export function Child({ onDone }: { onDone: () => void }) {
  return <button onClick={onDone}>done</button>;
}`;
    const appText = `import { Child as ImportedChild } from "./Child.js";
function Child() {
  return <button onClick={() => undefined}>shadow</button>;
}
export function App() {
  const [done, setDone] = useState(false);
  return <ImportedChild onDone={() => setDone(true)} />;
}`;
    const semanticProject = createSemanticProjectForTest([
      { path: childPath, text: childText },
      { path: appPath, text: appText },
    ]);
    const types = semanticTypesFor(semanticProject, appPath);

    const result = extractReactSourceTransitions(appText, {
      fileName: appPath,
      route: "/",
      types,
      relatedFragments: [
        { sourceText: childText, fileName: childPath },
        { sourceText: appText, fileName: appPath },
      ],
    });

    expect(result.vars.some((decl) => decl.id === "local:App.done")).toBe(true);
    expect(
      result.transitions.some(
        (transition) =>
          transition.id.includes("onClick") || transition.id.includes("onDone"),
      ),
    ).toBe(true);
    expect(
      result.transitions.some((transition) => transition.id.includes("shadow")),
    ).toBe(false);
  });

  it("does not cross-bind shadowed custom hook inlining", () => {
    const hookPath = resolve(projectRoot, "useCounter.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const hookText = `export function useCounter() {
  const [count, setCount] = useState(0);
  return [count, setCount] as const;
}`;
    const appText = `import { useCounter } from "./useCounter.js";
export function App() {
  function useCounter() {
    const [shadow, setShadow] = useState(false);
    return [shadow, setShadow] as const;
  }
  const [value, setValue] = useCounter();
  return <button onClick={() => setValue(true)}>{String(value)}</button>;
}`;
    const semanticProject = createSemanticProjectForTest([
      { path: hookPath, text: hookText },
      { path: appPath, text: appText },
    ]);
    const types = semanticTypesFor(semanticProject, appPath);

    const result = extractReactSourceTransitions(appText, {
      fileName: appPath,
      route: "/",
      types,
      relatedFragments: [
        { sourceText: hookText, fileName: hookPath },
        { sourceText: appText, fileName: appPath },
      ],
    });

    expect(result.vars.some((decl) => decl.id === "local:App.shadow")).toBe(
      true,
    );
    expect(result.vars.some((decl) => decl.id === "local:App.count")).toBe(
      false,
    );
  });

  it("populates custom hook registry entries with symbol keys for imported hooks", () => {
    const hookPath = resolve(projectRoot, "useCounter.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const hookText = `export function useCounter() {
  const [count, setCount] = useState(0);
  return [count, setCount] as const;
}`;
    const appText = `import { useCounter } from "./useCounter.js";
export function App() {
  const [count, setCount] = useCounter();
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}`;
    const semanticProject = createSemanticProjectForTest([
      { path: hookPath, text: hookText },
      { path: appPath, text: appText },
    ]);
    const types = semanticTypesFor(semanticProject, appPath);
    const appSource = semanticProject.getSourceFile(appPath)!;
    const registry = buildCustomHookRegistry(appSource, {
      types,
      primaryFileName: appPath,
      relatedSourceFiles: [semanticProject.getSourceFile(hookPath)!],
    });
    const callSite = identifierNode(appSource, "useCounter");
    const symbolKey = callSite ? types.localSymbolKey(callSite) : undefined;

    expect(symbolKey).toBeTruthy();
    expect(registry.bySymbolKey.get(symbolKey!)?.displayName).toBe(
      "useCounter",
    );
  });

  it("discovers components through related project files with transitional supplemental sources", () => {
    const childPath = resolve(projectRoot, "Child.tsx");
    const appPath = resolve(projectRoot, "App.tsx");
    const childText = `export function Child({ onDone }: { onDone: () => void }) {
  return <button onClick={onDone}>done</button>;
}`;
    const appText = `import { Child } from "./Child.js";
export function App() {
  const [done, setDone] = useState(false);
  return <Child onDone={() => setDone(true)} />;
}`;
    const semanticProject = createSemanticProjectForTest([
      { path: childPath, text: childText },
      { path: appPath, text: appText },
    ]);
    const fragmentTypes = {
      program: semanticProject.program,
      checker: semanticProject.checker,
      sourceFile: semanticProject.getSourceFile(appPath),
      getSourceFile: (fileName: string) =>
        semanticProject.getSourceFile(fileName),
      canonicalFileName: (fileName: string) =>
        semanticProject.canonicalFileName(fileName),
      resolveModuleName: (specifier: string, containingFile: string) =>
        semanticProject.resolveModuleName(specifier, containingFile),
      symbolAt: (node: ts.Node) => semanticProject.symbolAt(node),
      aliasedSymbolAt: (node: ts.Node) => semanticProject.aliasedSymbolAt(node),
      symbolKey: (symbol: ts.Symbol) => semanticProject.symbolKey(symbol),
      localSymbolKey: (node: ts.Node) => semanticProject.localSymbolKey(node),
    };

    const result = extractReactSourceTransitions(appText, {
      fileName: appPath,
      route: "/",
      types: fragmentTypes,
      relatedFragments: [
        { sourceText: childText, fileName: childPath },
        { sourceText: appText, fileName: appPath },
      ],
    });

    expect(
      result.transitions.some(
        (transition) =>
          transition.id.includes("onClick") || transition.id.includes("onDone"),
      ),
    ).toBe(true);
  });

  it("keeps syntax-only extractReactSourceTransitions fallback without a semantic program", () => {
    const typesPath = resolve(projectRoot, "types.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const helperText = `export type Mode = "on" | "off";`;
    const appText = `import type { Mode } from "./types.js";
export function App() {
  const [mode, setMode] = useState<Mode>("on");
  return <button onClick={() => setMode("off")}>{mode}</button>;
}`;
    const result = extractReactSourceTransitions(appText, {
      fileName: appPath,
      route: "/",
      relatedFragments: [
        { sourceText: helperText, fileName: typesPath },
        { sourceText: appText, fileName: appPath },
      ],
    });
    expect(result.vars.some((decl) => decl.id === "local:App.mode")).toBe(true);
    expect(
      result.transitions.some((transition) =>
        transition.id.includes("onClick"),
      ),
    ).toBe(true);
  });
});

describe("inferDomainSemantic", () => {
  it("resolves a local type alias through the checker", () => {
    const appPath = resolve(projectRoot, "App.tsx");
    const semanticProject = createSemanticProjectForTest([
      {
        path: appPath,
        text: `import { useState } from "react";
type Mode = "on" | "off";
export function App() {
  const [mode] = useState<Mode>("on");
  return null;
}`,
      },
    ]);
    const sourceFile = semanticProject.getSourceFile(appPath)!;
    let typeArg: ts.TypeNode | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sourceFile) === "useState"
      ) {
        typeArg = node.typeArguments?.[0];
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(typeArg).toBeDefined();
    const result = inferDomainSemantic(typeArg!, {
      checker: semanticProject.checker,
      sourceFile,
    });
    expect(result.domain).toEqual({
      kind: "enum",
      values: ["off", "on"],
    });
  });

  it("resolves expression initializers through the checker", () => {
    const appPath = resolve(projectRoot, "state.ts");
    const semanticProject = createSemanticProjectForTest([
      { path: appPath, text: `export const active = true;` },
    ]);
    const sourceFile = semanticProject.getSourceFile(appPath)!;
    let literal: ts.Node | undefined;
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.TrueKeyword) {
        literal = node;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(literal).toBeDefined();
    const result = inferDomainSemantic(literal as ts.Expression, {
      checker: semanticProject.checker,
      sourceFile,
    });
    expect(result.domain).toEqual({ kind: "bool" });
  });

  it("resolves imported interface fields with optional properties", () => {
    const typesPath = resolve(projectRoot, "types.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const semanticProject = createSemanticProjectForTest([
      {
        path: typesPath,
        text: `export interface Profile {
  name: string;
  nickname?: string;
}`,
      },
      {
        path: appPath,
        text: `import type { Profile } from "./types.js";
import { useState } from "react";
export function App() {
  const [profile] = useState<Profile>({ name: "Ada" });
  return null;
}`,
      },
    ]);
    const sourceFile = semanticProject.getSourceFile(appPath)!;
    let typeArg: ts.TypeNode | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sourceFile) === "useState"
      ) {
        typeArg = node.typeArguments?.[0];
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(typeArg).toBeDefined();
    const result = inferDomainSemantic(typeArg!, {
      checker: semanticProject.checker,
      sourceFile,
    });
    expect(result.domain).toEqual({
      kind: "record",
      fields: {
        name: { kind: "tokens", count: 1 },
        nickname: {
          kind: "option",
          inner: { kind: "tokens", count: 1 },
        },
      },
    });
  });

  it("falls back to syntax alias maps without a checker", () => {
    const sourceFile = ts.createSourceFile(
      "fixture.ts",
      `type Count = 0 | 1 | 2; type T = Count;`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const aliases = new Map<string, ts.TypeNode>();
    const visit = (node: ts.Node): void => {
      if (ts.isTypeAliasDeclaration(node) && ts.isIdentifier(node.name)) {
        aliases.set(node.name.text, node.type);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    const alias = sourceFile.statements.find(
      (statement): statement is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(statement) && statement.name.text === "T",
    );
    expect(alias).toBeDefined();
    const result = inferDomainSemantic(alias!.type, {
      sourceFile,
      typeAliases: aliases,
    });
    expect(result.domain).toEqual({ kind: "boundedInt", min: 0, max: 2 });
  });
});

describe("semantic import recognition", () => {
  it("recognizes direct package imports through checker symbols", () => {
    const statePath = resolve(projectRoot, "state.ts");
    const sourceText = `import { atom } from "jotai";
export const countAtom = atom(0);`;
    const semanticProject = createSemanticProjectForTest([
      { path: statePath, text: sourceText },
    ]);
    const types = semanticTypesFor(semanticProject, statePath);
    const sourceFile = semanticProject.getSourceFile(statePath)!;
    expect(
      collectSemanticNamedImports(
        sourceFile,
        new Set(["jotai"]),
        new Set(["atom"]),
        types,
      ),
    ).toEqual([
      expect.objectContaining({
        localName: "atom",
        exportedName: "atom",
        moduleName: "jotai",
      }),
    ]);
  });

  it("recognizes renamed imports through checker symbols", () => {
    const statePath = resolve(projectRoot, "state.ts");
    const sourceText = `import { atom as makeAtom } from "jotai";
export const countAtom = makeAtom(0);`;
    const semanticProject = createSemanticProjectForTest([
      { path: statePath, text: sourceText },
    ]);
    const types = semanticTypesFor(semanticProject, statePath);
    const sourceFile = semanticProject.getSourceFile(statePath)!;
    const localBinding = identifierNode(sourceFile, "makeAtom");
    expect(localBinding).toBeDefined();
    expect(
      resolveSemanticNamedExport(
        localBinding!,
        new Set(["jotai"]),
        new Set(["atom"]),
        types,
      ),
    ).toMatchObject({
      localName: "makeAtom",
      exportedName: "atom",
      moduleName: "jotai",
    });
  });

  it("recognizes local barrel re-exports through checker symbols", () => {
    const barrelPath = resolve(projectRoot, "jotai.ts");
    const statePath = resolve(projectRoot, "state.ts");
    const barrelText = `export { atom } from "jotai";`;
    const sourceText = `import { atom } from "./jotai.js";
export const countAtom = atom(0);`;
    const semanticProject = createSemanticProjectForTest([
      { path: barrelPath, text: barrelText },
      { path: statePath, text: sourceText },
    ]);
    const types = semanticTypesFor(semanticProject, statePath);
    const sourceFile = semanticProject.getSourceFile(statePath)!;
    const atomBinding = identifierNode(sourceFile, "atom");
    expect(atomBinding).toBeDefined();
    expect(
      collectSemanticNamedImports(
        sourceFile,
        new Set(["jotai"]),
        new Set(["atom"]),
        types,
      ),
    ).toEqual([
      expect.objectContaining({
        localName: "atom",
        exportedName: "atom",
        moduleName: "jotai",
      }),
    ]);
  });

  it("rejects local shadows of allowed library exports", () => {
    const statePath = resolve(projectRoot, "state.ts");
    const sourceText = `import { atom } from "jotai";
function run() {
  const atom = () => 0;
  return atom();
}`;
    const semanticProject = createSemanticProjectForTest([
      { path: statePath, text: sourceText },
    ]);
    const types = semanticTypesFor(semanticProject, statePath);
    const sourceFile = semanticProject.getSourceFile(statePath)!;
    let shadowIdentifier: ts.Identifier | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "atom" &&
        node.parent &&
        ts.isReturnStatement(node.parent)
      ) {
        shadowIdentifier = node.expression;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(shadowIdentifier).toBeDefined();
    expect(
      resolveSemanticNamedExport(
        shadowIdentifier!,
        new Set(["jotai"]),
        new Set(["atom"]),
        types,
      ),
    ).toBeUndefined();
  });
});
