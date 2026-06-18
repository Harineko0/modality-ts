import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { routeMountScope } from "../../../extract/engine/ts/routes.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkModel } from "modality-ts/check";
import { eq, lit, reachable, readVar, type Model } from "modality-ts/core";
import { runExtractCommand } from "./index.js";

describe("runExtractCommand", () => {
  it("writes model and extraction report artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const appModelPath = join(dir, "app.model.ts");
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
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    const appModel = await readFile(appModelPath, "utf8");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.lines[0]).toBe("extracted vars=1 transitions=1");
    expect(result.lines.some((l) => l.startsWith("state-space≈"))).toBe(true);
    expect(result.lines).toContain(`appModel=${appModelPath}`);
    expect(
      model.vars.find((decl) => decl.id === "local:App.saveStatus"),
    ).toEqual({
      id: "local:App.saveStatus",
      domain: { kind: "enum", values: ["idle", "posting"] },
      origin: { file: sourcePath, line: 4, column: 15 },
      scope: routeMountScope("/"),
      initial: "idle",
    });
    expect(appModel).toContain("export const M = ");
    expect(appModel).toContain('"local:App.saveStatus": "idle"');
    expect(appModel).toContain('"local:App.saveStatus": "idle" | "posting";');
    expect(appModel).toContain("export type VarId = keyof AppState;");
    expect(model.transitions.map((transition) => transition.id)).toEqual([
      "App.onClick.saveStatus",
    ]);
    expect(model.metadata?.sourceHashes?.[sourcePath]).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(
      model.metadata?.plugins?.map((plugin) => [
        plugin.kind,
        plugin.id,
        plugin.version,
      ]),
    ).toEqual([
      ["domain-refinement", "arktype", "0.1.0"],
      ["domain-refinement", "zod", "0.1.0"],
      ["effect-api", "router-effect-api", "0.1.0"],
      ["module-roles", "router-module-roles", "0.1.0"],
      ["navigation", "router", "0.1.0"],
      ["observation", "jotai", "0.1.0"],
      ["observation", "router-observation", "0.1.0"],
      ["observation", "swr", "0.1.0"],
      ["observation", "use-state", "0.1.0"],
      ["observation", "zustand", "0.1.0"],
      ["state-source", "jotai", "0.1.0"],
      ["state-source", "swr", "0.1.0"],
      ["state-source", "use-state", "0.1.0"],
      ["state-source", "zustand", "0.1.0"],
    ]);
    expect(report).toMatchObject({
      schemaVersion: 1,
      kind: "extraction-report",
      generatedAt: "2026-06-12T00:00:00.000Z",
      plugins: model.metadata?.plugins,
      handlers: [
        { id: "App.onClick.saveStatus", classification: "exact", reasons: [] },
      ],
      globalTaints: [],
      staleReads: [],
      unhandledRejections: [],
      modelSlack: [],
      coverage: {
        handlersTotal: 1,
        exactOrOverlay: 1,
        unextractable: 0,
        ignoredVars: 0,
        percentExactOrOverlay: 1,
      },
    });
    expect(report.stateContributors?.topVars[0]?.varId).toBeTruthy();
    expect(typeof report.stateContributors?.topVars[0]?.bits).toBe("number");
    const topBits = report.stateContributors?.topVars.map(
      (v: { bits: number }) => v.bits,
    );
    for (let i = 1; i < (topBits?.length ?? 0); i += 1) {
      const prev = topBits?.[i - 1];
      const curr = topBits?.[i];
      if (prev !== undefined && curr !== undefined) {
        expect(curr).toBeLessThanOrEqual(prev);
      }
    }
    expect(
      report.stateContributors?.bySource.some(
        (entry: { source: string; bits: number }) =>
          entry.source === sourcePath && entry.bits > 0,
      ),
    ).toBe(true);
    expect(model.metadata?.extractionCaveats).toEqual({
      entries: [],
    });

    const check = checkModel(model, [
      reachable(model, eq(readVar("local:App.saveStatus"), lit("posting")), {
        name: "postingReachable",
        reads: ["local:App.saveStatus"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
    expect(report.diagnostics?.phaseTimings?.length).toBeGreaterThan(0);
    for (const timing of report.diagnostics?.phaseTimings ?? []) {
      expect(timing.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(timing.elapsedMs)).toBe(true);
    }
    expect(report.diagnostics?.surface).toMatchObject({
      rawEntries: 1,
      reachableSources: 1,
      includedSources: 1,
      interactionSources: 1,
      reportedSources: 1,
    });
  });

  it("reports surface expansion for imported client components", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-surface-"));
    await mkdir(join(dir, "ui"), { recursive: true });
    const sourcePath = join(dir, "App.tsx");
    const buttonPath = join(dir, "ui", "Button.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    await writeFile(
      buttonPath,
      `
      export function Button(props: { onClick: () => void }) {
        return <button onClick={props.onClick}>Save</button>;
      }
      `,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      import { Button } from './ui/Button';
      export function App() {
        const [status, setStatus] = useState<'idle' | 'saved'>('idle');
        return <Button onClick={() => setStatus('saved')} />;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.report.sourceFiles).toEqual(
      expect.arrayContaining([sourcePath, buttonPath]),
    );
    expect(report.sourceFiles).toEqual(result.report.sourceFiles);
    expect(report.diagnostics?.surface).toMatchObject({
      rawEntries: 1,
      reachableSources: 2,
      includedSources: 2,
      interactionSources: 2,
      reportedSources: 2,
    });
    expect(report.diagnostics?.surface?.expandedSourceFiles).toEqual(
      [buttonPath, sourcePath].sort((left, right) => left.localeCompare(right)),
    );
    expect(report.diagnostics?.pipeline).toMatchObject({
      discoveryFragments: 2,
      relatedFragments: expect.any(Number),
      semanticProjectSourceFiles: expect.any(Number),
    });
    expect(
      report.diagnostics?.phaseTimings?.some(
        (timing: { id: string }) => timing.id === "project-surface",
      ),
    ).toBe(true);
    expect(
      report.diagnostics?.phaseTimings?.some(
        (timing: { id: string }) => timing.id === "extraction-pipeline",
      ),
    ).toBe(true);
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
        const save = () => {
          if (computeStatus()) setSaveStatus('posting');
        };
        return <button onClick={save}>Save</button>;
      }
      `,
      "utf8",
    );
    await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const caveat = model.metadata?.extractionCaveats?.entries.find(
      (entry) => entry.kind === "unextractable",
    );
    expect(caveat?.id).toBe("App.onClick");
    expect(caveat?.reason).toContain("no-extractable-effect");
    expect(caveat?.source?.file).toMatch(/App\.tsx$/);
    expect(
      report.warnings.some((warning: string) =>
        warning.includes("Unextractable handler App.onClick"),
      ),
    ).toBe(true);
    expect(report.handlers).toEqual([
      {
        id: "App.onClick",
        classification: "unextractable",
        reasons: [caveat?.reason],
      },
    ]);
    expect(
      model.metadata?.extractionCaveats?.entries.filter(
        (entry) => entry.kind === "unextractable",
      ),
    ).toEqual([
      {
        kind: "unextractable",
        id: "App.onClick",
        reason: caveat?.reason,
        source: caveat?.source,
        severity: "over-approx",
      },
    ]);
    expect(report.coverage).toEqual({
      handlersTotal: 1,
      exactOrOverlay: 0,
      unextractable: 1,
      ignoredVars: 0,
      percentExactOrOverlay: 0,
    });
  });

  it("reports await-in-loop handlers with a specific category and dedupes caveats", async () => {
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
        const items = ['a'];
        return <button onClick={async () => {
          for (const item of items) {
            await api.save(item);
            setSaveStatus('posting');
          }
        }}>Save</button>;
      }
      `,
      "utf8",
    );
    await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      effectApis: ["api.save"],
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    const caveats =
      model.metadata?.extractionCaveats?.entries.filter(
        (entry) => entry.kind === "unextractable",
      ) ?? [];
    expect(caveats).toHaveLength(1);
    expect(caveats[0]?.id).toBe("App.onClick");
    expect(caveats[0]?.reason).toContain("await-in-loop");
    expect(caveats[0]?.source?.file).toMatch(/App\.tsx$/);
  });

  it("does not classify list-rendered or effect warnings as unextractable handlers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    await writeFile(
      sourcePath,
      `
      import { useEffect, useMemo, useState } from 'react';
      export function App({ external }: { external: string }) {
        const initialRange = useMemo(() => external, [external]);
        const [range, setRange] = useState<string | null>(null);
        useEffect(() => {
          setRange(initialRange);
        }, [initialRange]);
        return range;
      }
      `,
      "utf8",
    );
    await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.warnings).toContain("Unextractable effect App.useEffect");
    expect(
      model.metadata?.extractionCaveats?.entries.filter(
        (entry) =>
          entry.kind === "unextractable" && !entry.id.endsWith(".useEffect"),
      ),
    ).toEqual([]);
  });

  it("reports unsupported useReducer state sources", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    await writeFile(
      sourcePath,
      `
      import { useReducer } from 'react';
      export function App() {
        const [state, dispatch] = useReducer(reducer, { status: 'idle' });
        return <button onClick={() => dispatch({ type: 'save' })}>Save</button>;
      }
      `,
      "utf8",
    );

    await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.warnings).toContain("Unsupported useReducer App.useReducer");
    const unextractable = report.handlers.find(
      (handler: { id: string }) => handler.id === "App.onClick",
    );
    expect(unextractable?.classification).toBe("unextractable");
    expect(unextractable?.reasons[0]).toContain("no-extractable-effect");
    expect(report.coverage).toEqual({
      handlersTotal: 1,
      exactOrOverlay: 0,
      unextractable: 1,
      ignoredVars: 0,
      percentExactOrOverlay: 0,
    });
  });

  it("reports ref-held setters as global taints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    await writeFile(
      sourcePath,
      `
      import { useRef, useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        const setterRef = useRef(setSaveStatus);
        return <button onClick={() => setSaveStatus('posting')}>Save</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const caveat = {
      kind: "global-taint" as const,
      id: "local:App.saveStatus",
      reason: "global-taint:local:App.saveStatus",
      severity: "unsound-risk" as const,
      source: expect.objectContaining({
        file: expect.stringMatching(/App\.tsx$/),
      }),
    };
    expect(report.warnings).toContain("global-taint:local:App.saveStatus");
    expect(report.globalTaints).toEqual([caveat]);
    expect(result.model.metadata?.extractionCaveats?.entries).toEqual([caveat]);
  });

  it("reports wide product domains as typed model slack", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-wide-product-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    const overlayPath = join(dir, "overlay.json");
    const wideEnumValues = Array.from(
      { length: 257 },
      (_, index) => `v${index}`,
    );
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [payload, setPayload] = useState({ tag: 'v0' });
        return <button onClick={() => setPayload({ tag: 'v1' })}>Set</button>;
      }
      `,
      "utf8",
    );
    await writeFile(
      overlayPath,
      JSON.stringify({
        domains: [
          {
            var: "local:App.payload",
            domain: {
              kind: "record",
              fields: {
                tag: { kind: "enum", values: wideEnumValues },
              },
            },
            initial: { tag: "v0" },
          },
        ],
      }),
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      overlayPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const caveat = {
      kind: "model-slack" as const,
      id: "local:App.payload",
      reason: "Wide product domain (257 values) may enlarge search",
      severity: "over-approx" as const,
    };
    expect(report.warnings).toContain(caveat.reason);
    expect(report.modelSlack).toEqual([caveat]);
    expect(result.model.metadata?.extractionCaveats?.entries).toContainEqual(
      caveat,
    );
  });

  it("reports M0 timer callbacks as extracted timer handlers", async () => {
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
        return <button onClick={() => setTimeout(() => setSaveStatus('posting'), 10)}>Save</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.warnings).toEqual([]);
    expect(report.globalTaints).toEqual([]);
    expect(result.model.metadata?.extractionCaveats?.entries).toEqual([]);
    expect(
      result.model.transitions.map((transition) => transition.id),
    ).toContain("App.setTimeout.saveStatus");
    expect(report.handlers).toEqual(
      expect.arrayContaining([
        {
          id: "App.setTimeout.saveStatus",
          classification: "exact",
          reasons: [],
        },
      ]),
    );
    expect(
      report.handlers.some((handler) => handler.id.includes("onClick")),
    ).toBe(true);
  });

  it("omits the routes summary line when no manifest is present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-no-manifest-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [open, setOpen] = useState(false);
        return <button onClick={() => setOpen(true)}>Open</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(result.lines[0]).toBe("extracted vars=1 transitions=1");
    expect(
      result.lines.some((line) => line.startsWith("routes configured=")),
    ).toBe(false);
  });

  it("warns when enabled source plugins run against dependencies below tested versions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const packageJsonPath = join(dir, "package.json");
    const modelPath = join(dir, "model.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({ dependencies: { react: "^17.0.0", swr: "^1.3.0" } }),
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      import useSWR from 'swr';
      export function App() {
        const [status] = useState<'idle' | 'posting'>('idle');
        useSWR('/api/todos');
        return status;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      packageJsonPath,
    });
    expect(result.report.warnings).toEqual([
      "Plugin swr tested against swr>=2, but app uses swr@^1.3.0",
      "Plugin use-state tested against react>=18, but app uses react@^17.0.0",
    ]);
  });

  it("explains over-approximate extracted handlers", async () => {
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
        return <button onClick={() => callExternal(setSaveStatus)}>Save</button>;
      }
      `,
      "utf8",
    );

    await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.handlers).toEqual([
      {
        id: "App.onClick.saveStatus.escaped",
        classification: "over-approx",
        reasons: [
          "domain-wide havoc: havoc write to local:App.saveStatus",
          "setter escaped to unanalyzed call",
        ],
      },
    ]);
  });

  it("reports loop setter writes as over-approximate havoc", async () => {
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
        return <button onClick={() => {
          for (const item of items) {
            setSaveStatus(item.ready ? 'posting' : 'idle');
          }
        }}>Save</button>;
      }
      `,
      "utf8",
    );

    await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.handlers).toEqual([
      {
        id: "App.onClick.saveStatus.loop",
        classification: "over-approx",
        reasons: ["domain-wide havoc: havoc write to local:App.saveStatus"],
      },
    ]);
  });

  it("reports named onOpenChange handlers as exact rather than over-approximate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      function Popover(props: { open: boolean; onOpenChange: (next: boolean) => void; children?: React.ReactNode }) {
        return <button type="button" {...props} />;
      }
      export function App() {
        const [open, setOpen] = useState(false);
        const [pickedDim, setPickedDim] = useState<'browser' | null>(null);
        const [query, setQuery] = useState('');
        function handleOpenChange(next: boolean) {
          setOpen(next);
          if (!next) {
            setPickedDim(null);
            setQuery('');
          }
        }
        return <Popover open={open} onOpenChange={handleOpenChange} />;
      }
      `,
      "utf8",
    );

    await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const openChangeHandlers = report.handlers.filter(
      (handler: { id: string }) => handler.id.includes(".onOpenChange."),
    );
    expect(openChangeHandlers).toHaveLength(2);
    expect(
      openChangeHandlers.every(
        (handler: { classification: string }) =>
          handler.classification === "exact",
      ),
    ).toBe(true);
    expect(
      openChangeHandlers.some(
        (handler: { classification: string }) =>
          handler.classification === "over-approx",
      ),
    ).toBe(false);
  });

  it("reports unhandled async rejection caveats", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'done'>('idle');
        return <button onClick={async () => {
          await api.save();
          setSaveStatus('done');
        }}>Save</button>;
      }
      `,
      "utf8",
    );

    await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      effectApis: ["api.save"],
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const caveat = {
      kind: "unhandled-rejection" as const,
      id: "App.onClick.api.save",
      reason: "Unhandled rejection App.onClick.api.save",
      severity: "over-approx" as const,
      source: expect.objectContaining({
        file: expect.stringMatching(/App\.tsx$/),
      }),
    };
    expect(report.warnings).toContain(
      "Unhandled rejection App.onClick.api.save",
    );
    expect(report.unhandledRejections).toEqual([caveat]);
    expect(
      model.metadata?.extractionCaveats?.entries.filter(
        (entry) => entry.kind === "unhandled-rejection",
      ),
    ).toEqual([caveat]);
  });

  it("surfaces coarse token domains in extraction report and CLI summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "EditLink.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      type Visibility = "private" | "public";
      type Draft = { visibility: Visibility; title: string };
      export default function EditLink() {
        const [draft, setDraft] = useState<Draft>({ visibility: "private", title: "" });
        return <button onClick={() => setDraft({ ...draft, visibility: "public" })} />;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(result.report.coarseDomains).toContainEqual({
      varId: "local:EditLink.draft",
      paths: ["title"],
    });
    expect(
      result.lines.some((line) => line.startsWith("coarse-domains=")),
    ).toBe(true);
  });

  it("records field pruning metadata and model-slack caveats for nested records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "SessionApp.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      type User = { id: string; avatarUrl: string };
      type Session = { user: User };
      export default function SessionApp() {
        const [session, setSession] = useState<Session>({
          user: { id: "u1", avatarUrl: "" },
        });
        const blocked = session.user.id === "blocked";
        return (
          <button
            disabled={blocked}
            onClick={() => setSession({ user: { id: "u2", avatarUrl: "" } })}
          />
        );
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    const session = result.model.vars.find(
      (decl) => decl.id === "local:SessionApp.session",
    );
    expect(session?.domain.kind).toBe("record");
    const entry = result.model.metadata?.fieldPruning?.entries.find(
      (candidate) => candidate.varId === "local:SessionApp.session",
    );
    expect(entry?.keptPaths).toContainEqual(["user", "id"]);
    expect(entry?.prunedPaths).toContainEqual(["user", "avatarUrl"]);
    expect(result.report.fieldPruning?.entries).toContainEqual(entry);
    expect(
      result.model.metadata?.extractionCaveats?.entries.some(
        (caveat) =>
          caveat.kind === "model-slack" &&
          caveat.id === "field:local:SessionApp.session:user.avatarUrl",
      ),
    ).toBe(true);
  });
});
