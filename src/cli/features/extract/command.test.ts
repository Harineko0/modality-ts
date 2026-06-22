import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderHumanExtractTargets, runExtractCommand } from "./index.js";

describe("runExtractCommand", () => {
  it("extracts a minimal component", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-smoke-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
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
    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(result.varCount).toBeGreaterThan(0);
    expect(result.transitionCount).toBeGreaterThan(0);
  });

  it("hides Artifacts by default and shows them when showArtifacts is true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-smoke-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
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
    const result = await runExtractCommand({ sourcePath, modelPath });
    const target = {
      label: result.targetLabel,
      durationMs: 12,
      varCount: result.varCount,
      transitionCount: result.transitionCount,
      report: result.report,
      pluginLabels: result.pluginLabels,
      artifacts: result.artifacts,
    };
    const renderOptions = {
      totalDurationMs: 1270,
    };

    const hidden = renderHumanExtractTargets([target], renderOptions);
    expect(
      hidden.some((line) => line.trimStart().startsWith("Artifacts")),
    ).toBe(false);
    expect(hidden.some((line) => line.includes("(model)"))).toBe(false);

    const shown = renderHumanExtractTargets([target], {
      ...renderOptions,
      showArtifacts: true,
    });
    expect(shown.some((line) => line.trimStart().startsWith("Artifacts"))).toBe(
      true,
    );
    expect(shown.some((line) => line.includes("(model)"))).toBe(true);
  });
});
