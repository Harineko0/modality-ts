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
  });
});
