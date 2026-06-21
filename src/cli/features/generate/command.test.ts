import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { emitComponentModalModules } from "../../codegen/component-state.js";
import {
  buildExtractionModel,
  createExtractDiagnosticsClock,
} from "../../extraction/build-model.js";
import { runGenerateCommand } from "./command.js";
import {
  renderGenerateSummary,
  renderHumanGenerateTarget,
  renderHumanGenerateTargets,
} from "./output.js";

describe("runGenerateCommand", () => {
  it("writes App.modals.ts from source analysis without loading properties", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-generate-"));
    const sourcePath = join(dir, "App.tsx");
    const propsPath = join(dir, "App.props.ts");
    const modelPath = join(dir, "model.json");
    const appModelPath = join(dir, "app.model.ts");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [flag, setFlag] = useState(false);
        return <button onClick={() => setFlag(true)}>Set</button>;
      }
      `,
      "utf8",
    );
    await writeFile(propsPath, "", "utf8");
    const result = await runGenerateCommand({
      sourcePath,
      modelPath,
      appModelPath,
    });
    const build = await buildExtractionModel(
      { sourcePath, modelPath, appModelPath },
      createExtractDiagnosticsClock(),
    );
    const expectedModules = emitComponentModalModules(
      build.model,
      appModelPath,
    );
    expect(expectedModules).toHaveLength(1);
    const modalsPath = expectedModules[0]?.path;
    expect(modalsPath).toBeDefined();
    await expect(readFile(modalsPath as string, "utf8")).resolves.toBe(
      expectedModules[0]?.source,
    );
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "componentVars", path: modalsPath }),
      ]),
    );
    await expect(readFile(modelPath, "utf8")).rejects.toThrow();
    await expect(
      readFile(join(dir, "App.slices.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("succeeds when a sibling props file is broken", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "modality-generate-broken-props-"),
    );
    const sourcePath = join(dir, "App.tsx");
    const propsPath = join(dir, "App.props.ts");
    const modelPath = join(dir, "model.json");
    const appModelPath = join(dir, "app.model.ts");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [flag, setFlag] = useState(false);
        return <button onClick={() => setFlag(true)}>Set</button>;
      }
      `,
      "utf8",
    );
    await writeFile(
      propsPath,
      `
      import { missingSymbol } from "./does-not-exist";
      missingSymbol();
      `,
      "utf8",
    );
    const result = await runGenerateCommand({
      sourcePath,
      modelPath,
      appModelPath,
    });
    expect(result.moduleCount).toBeGreaterThan(0);
    expect(
      result.artifacts.some((entry) => entry.path.endsWith(".modals.ts")),
    ).toBe(true);
  });

  it("writes handles for source-anchored atoms and store fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-generate-state-"));
    const sourcePath = join(dir, "state.ts");
    const modelPath = join(dir, "model.json");
    const appModelPath = join(dir, "app.model.ts");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: {
          jotai: "^2.0.0",
          react: "^18.0.0",
          zustand: "^4.0.0",
        },
      }),
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
      import { atom } from 'jotai';
      import { create } from 'zustand';
      export const selectedAccountAtom = atom<'none' | 'selected'>('none');
      export const useManagementStore = create(() => ({
        summaryStatus: 'idle' as 'idle' | 'ready',
      }));
      `,
      "utf8",
    );

    const result = await runGenerateCommand({
      sourcePath,
      modelPath,
      appModelPath,
    });

    const modalsPath = join(dir, "state.modals.ts");
    const source = await readFile(modalsPath, "utf8");
    expect(source).toContain("export const selectedAccountAtom: Variable");
    expect(source).toContain('variable("atom:selectedAccountAtom")');
    expect(source).toContain("export const useManagementStore = {");
    expect(source).toContain(
      'summaryStatus: variable("zustand:useManagementStore.summaryStatus") as Variable',
    );
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "componentVars", path: modalsPath }),
      ]),
    );
  });
});

describe("renderHumanGenerateTargets", () => {
  it("prints target rows, duration, and component var artifacts", () => {
    const lines = renderHumanGenerateTargets(
      [
        {
          label: "App.tsx",
          moduleCount: 1,
          varCount: 2,
          transitionCount: 1,
          pluginLabels: ["source:react-use-state@1.0.0"],
          durationMs: 12,
          artifacts: [{ kind: "componentVars", path: "/tmp/App.modals.ts" }],
        },
      ],
      {
        totalDurationMs: 12,
        showArtifacts: true,
        startedAt: new Date("2026-06-12T11:36:28.000Z"),
      },
    );
    expect(lines.join("\n")).toContain("✓");
    expect(lines.join("\n")).toContain("Generate Files");
    expect(lines.join("\n")).toContain("Start at");
    expect(lines.join("\n")).toContain("Duration");
    expect(lines.join("\n")).toContain("(componentVars)");
  });

  it("composes per-target rows and summary into aggregate output", () => {
    const targets = [
      {
        label: "a.tsx",
        moduleCount: 1,
        varCount: 2,
        transitionCount: 1,
        pluginLabels: ["source:react-use-state@1.0.0"],
        durationMs: 5,
        artifacts: [],
      },
      {
        label: "b.tsx",
        moduleCount: 1,
        varCount: 2,
        transitionCount: 1,
        pluginLabels: ["source:react-use-state@1.0.0"],
        durationMs: 7,
        artifacts: [],
      },
    ];
    const options = {
      totalDurationMs: 12,
      showArtifacts: false,
      startedAt: new Date("2026-06-12T11:36:28.000Z"),
    };
    const composed = targets
      .flatMap((target) => renderHumanGenerateTarget(target, options))
      .concat(renderGenerateSummary(targets, options));
    expect(composed).toEqual(renderHumanGenerateTargets(targets, options));
    const summary = composed.slice(-4).join("\n");
    expect(summary).toContain("Generate Files");
    expect(summary).toContain("2 passed (2)");
    expect(summary).toContain("Start at");
    expect(summary).toContain("Duration");
  });
});
