import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { runExtractionPipeline } from "modality-ts/extract";
import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import { useStateSource } from "../../src/extract/sources/use-state/index.js";
import {
  createSemanticProject,
  createSemanticProjectForTest,
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
