import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkModel } from "@modality/checker";
import { reachable, type Model } from "@modality/kernel";
import { runExtractCommand } from "../src/extract.js";

describe("runExtractCommand", () => {
  it("writes model and extraction report artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => setSaveStatus('posting')}>Save</button>;
      }
      `,
      "utf8"
    );

    const result = await runExtractCommand({ sourcePath, modelPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.lines[0]).toBe("extracted vars=1 transitions=1");
    expect(model.transitions.map((transition) => transition.id)).toEqual(["App.onClick.saveStatus"]);
    expect(report).toMatchObject({
      schemaVersion: 1,
      kind: "extraction-report",
      generatedAt: "2026-06-12T00:00:00.000Z",
      handlers: [{ id: "App.onClick.saveStatus", classification: "exact", reasons: [] }]
    });

    const check = checkModel(model, [
      reachable(model, (state) => state["local:App.saveStatus"] === "posting", { name: "postingReachable", reads: ["local:App.saveStatus"] })
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("surfaces unextractable handlers in the extraction report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        const save = () => setSaveStatus(computeStatus());
        return <button onClick={save}>Save</button>;
      }
      `,
      "utf8"
    );
    await runExtractCommand({ sourcePath, modelPath, reportPath, now: new Date("2026-06-12T00:00:00.000Z") });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.warnings).toContain("Unextractable handler App.onClick");
    expect(report.handlers).toEqual([
      { id: "App.onClick", classification: "unextractable", reasons: ["Unextractable handler App.onClick"] }
    ]);
  });

  it("applies overlay artifacts during extraction", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    const overlayPath = join(dir, "overlay.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => setSaveStatus('posting')}>Save</button>;
      }
      `,
      "utf8"
    );
    await writeFile(
      overlayPath,
      JSON.stringify({
        transitions: [
          {
            id: "App.onClick.saveStatus",
            cls: "user",
            label: { kind: "click", text: "Overlay save" },
            source: [],
            guard: { kind: "lit", value: true },
            effect: { kind: "assign", var: "local:App.saveStatus", expr: { kind: "lit", value: "idle" } },
            reads: [],
            writes: ["local:App.saveStatus"],
            confidence: "exact"
          }
        ]
      }),
      "utf8"
    );
    await runExtractCommand({ sourcePath, modelPath, reportPath, overlayPath, now: new Date("2026-06-12T00:00:00.000Z") });
    const model = JSON.parse(await readFile(modelPath, "utf8"));
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(model.transitions[0]).toMatchObject({ id: "App.onClick.saveStatus", confidence: "manual" });
    expect(report.warnings).toContain("Overlay overrides exact transition App.onClick.saveStatus");
    expect(report.handlers).toEqual([{ id: "App.onClick.saveStatus", classification: "overlay", reasons: [] }]);
  });

  it("compares extracted output against a golden model snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const goldenPath = join(dir, "golden-model.json");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [draft, setDraft] = useState<'empty' | 'nonEmpty'>('empty');
        return <input data-testid="draft" onChange={e => setDraft(e.target.value)} />;
      }
      `,
      "utf8"
    );
    await runExtractCommand({ sourcePath, modelPath: goldenPath, now: new Date("2026-06-12T00:00:00.000Z") });
    const result = await runExtractCommand({ sourcePath, modelPath, expectModelPath: goldenPath, now: new Date("2026-06-12T00:00:00.000Z") });
    expect(result.lines).toContain(`expectedModel=${goldenPath}`);
  });

  it("fails when extracted output differs from the golden model snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const goldenPath = join(dir, "golden-model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => setSaveStatus('posting')}>Save</button>;
      }
      `,
      "utf8"
    );
    await writeFile(
      goldenPath,
      JSON.stringify({ schemaVersion: 1, id: "wrong", bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 1 }, vars: [], transitions: [] }),
      "utf8"
    );
    await expect(runExtractCommand({ sourcePath, modelPath, expectModelPath: goldenPath })).rejects.toThrow("Extracted model differs from expected snapshot");
  });

  it("fails extraction on orphan overlay entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const overlayPath = join(dir, "overlay.json");
    await writeFile(sourcePath, "export function App() { return null; }", "utf8");
    await writeFile(overlayPath, JSON.stringify({ transitions: [{ id: "missing", cls: "user", label: { kind: "click" }, source: [], guard: { kind: "lit", value: true }, effect: { kind: "seq", effects: [] }, reads: [], writes: [], confidence: "exact" }] }), "utf8");
    await expect(runExtractCommand({ sourcePath, modelPath, overlayPath })).rejects.toThrow("Overlay transition missing does not match an extracted transition");
  });
});
