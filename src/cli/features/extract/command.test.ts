import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkModel } from "modality-ts/check";
import { reachable, type EffectIR, type Model } from "modality-ts/core";
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
    expect(result.lines).toContain(`appModel=${appModelPath}`);
    expect(
      model.vars.find((decl) => decl.id === "local:App.saveStatus"),
    ).toEqual({
      id: "local:App.saveStatus",
      domain: { kind: "enum", values: ["idle", "posting"] },
      origin: { file: sourcePath, line: 4, column: 15 },
      scope: { kind: "route-local", route: "/" },
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
      ["router", "router", "0.1.0"],
      ["state-source", "jotai", "0.1.0"],
      ["state-source", "swr", "0.1.0"],
      ["state-source", "use-state", "0.1.0"],
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
      coverage: {
        handlersTotal: 1,
        exactOrOverlay: 1,
        unextractable: 0,
        ignoredVars: 0,
        percentExactOrOverlay: 1,
      },
    });
    expect(model.metadata?.extractionCaveats).toEqual({
      globalTaints: [],
      staleReads: [],
      unhandledRejections: [],
      unextractableHandlers: [],
    });

    const check = checkModel(model, [
      reachable(model, (state) => state["local:App.saveStatus"] === "posting", {
        name: "postingReachable",
        reads: ["local:App.saveStatus"],
      }),
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
    const caveat = {
      id: "App.onClick",
      reason: "Unextractable handler App.onClick",
    };
    expect(report.warnings).toContain("Unextractable handler App.onClick");
    expect(report.handlers).toEqual([
      {
        id: "App.onClick",
        classification: "unextractable",
        reasons: ["Unextractable handler App.onClick"],
      },
    ]);
    expect(model.metadata?.extractionCaveats?.unextractableHandlers).toEqual([
      caveat,
    ]);
    expect(report.coverage).toEqual({
      handlersTotal: 1,
      exactOrOverlay: 0,
      unextractable: 1,
      ignoredVars: 0,
      percentExactOrOverlay: 0,
    });
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
    expect(report.handlers).toEqual([
      {
        id: "App.onClick",
        classification: "unextractable",
        reasons: ["Unextractable handler App.onClick"],
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
      id: "local:App.saveStatus",
      reason: "Global taint local:App.saveStatus",
    };
    expect(report.warnings).toContain("Global taint local:App.saveStatus");
    expect(report.globalTaints).toEqual([caveat]);
    expect(result.model.metadata?.extractionCaveats?.globalTaints).toEqual([
      caveat,
    ]);
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
    expect(result.model.metadata?.extractionCaveats?.globalTaints).toEqual([]);
    expect(
      result.model.transitions.map((transition) => transition.id),
    ).toContain("App.setTimeout.saveStatus");
    expect(report.handlers).toEqual([
      { id: "App.setTimeout.saveStatus", classification: "exact", reasons: [] },
    ]);
  });

  it("includes extracted navigation targets in the route domain", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      export function App() {
        return <button onClick={() => navigate('/checkout')}>Checkout</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(
      result.model.vars.find((decl) => decl.id === "sys:route")?.domain,
    ).toEqual({ kind: "enum", values: ["/", "/checkout"] });
    expect(result.model.transitions[0]).toMatchObject({
      id: "App.onClick.navigate._checkout",
      effect: {
        kind: "navigate",
        mode: "push",
        to: { kind: "lit", value: "/checkout" },
      },
    });

    const check = checkModel(result.model, [
      reachable(result.model, (state) => state["sys:route"] === "/checkout", {
        name: "checkoutReachable",
        reads: ["sys:route"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("normalizes unresolved typed useState literal initials to token representatives", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      const COLORS = ['red', 'gray'] as const;
      type Color = typeof COLORS[number];
      export function App() {
        const [color] = useState<Color>('gray');
        return color;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    const color = result.model.vars.find(
      (decl) => decl.id === "local:App.color",
    );
    expect(color).toMatchObject({
      domain: { kind: "tokens", count: 1 },
      initial: "tok1",
    });
    const check = checkModel(result.model, [
      reachable(result.model, (state) => state["local:App.color"] === "tok1", {
        name: "tokenInitialReachable",
        reads: ["local:App.color"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("includes Jotai atom declarations through the source plugin SPI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { atom } from 'jotai';
      export const authAtom = atom<'guest' | 'user'>('guest');
      export function App() {
        return null;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(result.lines[0]).toBe("extracted vars=1 transitions=0");
    expect(
      result.model.vars.find((decl) => decl.id === "atom:authAtom"),
    ).toEqual({
      id: "atom:authAtom",
      domain: { kind: "enum", values: ["guest", "user"] },
      origin: { file: sourcePath, line: 3, column: 20 },
      scope: { kind: "global" },
      initial: "guest",
    });
  });

  it("auto-registers source plugins from package dependencies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const packageJsonPath = join(dir, "package.json");
    const modelPath = join(dir, "model.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({ dependencies: { react: "^18.0.0" } }),
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
      import { atom } from 'jotai';
      export const authAtom = atom<'guest' | 'user'>('guest');
      export function App() {
        return null;
      }
      `,
      "utf8",
    );

    const reactOnly = await runExtractCommand({
      sourcePath,
      modelPath,
      packageJsonPath,
    });
    expect(
      reactOnly.model.vars.some((decl) => decl.id === "atom:authAtom"),
    ).toBe(false);
    expect(reactOnly.lines).toContain("plugins=state-source:use-state@0.1.0");
    expect(reactOnly.report.warnings).toEqual([]);

    await writeFile(
      packageJsonPath,
      JSON.stringify({ dependencies: { react: "^18.0.0", jotai: "^2.0.0" } }),
      "utf8",
    );
    const withJotai = await runExtractCommand({
      sourcePath,
      modelPath,
      packageJsonPath,
    });
    expect(
      withJotai.model.vars.some((decl) => decl.id === "atom:authAtom"),
    ).toBe(true);
    expect(withJotai.lines).toContain(
      "plugins=state-source:jotai@0.1.0,state-source:use-state@0.1.0",
    );
    expect(withJotai.report.warnings).toEqual([]);
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

  it("can disable auto-registered source plugins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const packageJsonPath = join(dir, "package.json");
    const modelPath = join(dir, "model.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({ dependencies: { react: "^18.0.0", jotai: "^2.0.0" } }),
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
      import { atom } from 'jotai';
      export const authAtom = atom<'guest' | 'user'>('guest');
      export function App() {
        return null;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      packageJsonPath,
      disabledPlugins: ["jotai"],
    });
    expect(result.model.vars.some((decl) => decl.id === "atom:authAtom")).toBe(
      false,
    );
    expect(result.lines).toContain("plugins=state-source:use-state@0.1.0");
  });

  it("loads modality config for route, bounds, effect APIs, package manifest, and plugin controls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const packageJsonPath = join(dir, "package.json");
    const configPath = join(dir, "modality.config.ts");
    const modelPath = join(dir, "model.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: {
          jotai: "^2.0.0",
          react: "^18.0.0",
          "react-router-dom": "^6.0.0",
        },
      }),
      "utf8",
    );
    await writeFile(
      configPath,
      `export default {
        route: "/configured",
        effectApis: ["api.save"],
        bounds: { maxDepth: 5, maxPending: 2 },
        packageJsonPath: ${JSON.stringify(packageJsonPath)},
        disabledPlugins: ["jotai"]
      };`,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
      import { atom } from 'jotai';
      import { useState } from 'react';
      export const authAtom = atom<'guest' | 'user'>('guest');
      export function App() {
        const [status, setStatus] = useState<'idle' | 'saving'>('idle');
        return <button onClick={() => setStatus('saving')}>Save {status}</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      configPath,
    });
    expect(result.model.bounds).toEqual({
      maxDepth: 5,
      maxPending: 2,
      maxInternalSteps: 16,
    });
    expect(
      result.model.vars.find((decl) => decl.id === "sys:route")?.initial,
    ).toBe("/configured");
    expect(result.model.vars.some((decl) => decl.id === "atom:authAtom")).toBe(
      false,
    );
    expect(
      result.model.vars.find((decl) => decl.id === "sys:pending")?.domain,
    ).toMatchObject({
      inner: { fields: { opId: { values: ["api.save"] } } },
      maxLen: 2,
    });
    expect(result.model.transitions.map((transition) => transition.id)).toEqual(
      expect.arrayContaining(["App.onClick.status"]),
    );
    expect(result.lines).toContain(`config=${configPath}`);
    expect(result.lines).toContain(
      "plugins=router:router@0.1.0,state-source:use-state@0.1.0",
    );
  });

  it("extracts Jotai useSetAtom writes through source write channels", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { atom, useSetAtom } from 'jotai';
      export const authAtom = atom<'guest' | 'user'>('guest');
      export function App() {
        const setAuth = useSetAtom(authAtom);
        return <button onClick={() => setAuth('user')}>Login</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(
      result.model.vars.find((decl) => decl.id === "atom:authAtom"),
    ).toMatchObject({
      id: "atom:authAtom",
      domain: { kind: "enum", values: ["guest", "user"] },
      scope: { kind: "global" },
      initial: "guest",
    });
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.authAtom",
        cls: "user",
        effect: {
          kind: "assign",
          var: "atom:authAtom",
          expr: { kind: "lit", value: "user" },
        },
        writes: ["atom:authAtom"],
        confidence: "exact",
      }),
    );
  });

  it("extracts Jotai useAtom setter writes through source write channels", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { atom, useAtom } from 'jotai';
      export const modalAtom = atom(false);
      export function App() {
        const [, setModal] = useAtom(modalAtom);
        return <button onClick={() => setModal(true)}>Open</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.modalAtom",
        effect: {
          kind: "assign",
          var: "atom:modalAtom",
          expr: { kind: "lit", value: true },
        },
        writes: ["atom:modalAtom"],
        confidence: "exact",
      }),
    );
  });

  it("extracts supported disabled guard conjuncts through component boolean aliases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      type SubmissionPhase = 'idle' | 'submitting';
      export function App() {
        const [phase, setPhase] = useState<SubmissionPhase>('idle');
        const isUser = session.status === 'user';
        const isApplied = snapshot?.application?.applied ?? false;
        const isBusy = phase === 'submitting';
        const canSubmit = isUser && !isApplied && !isBusy;
        return <button disabled={!canSubmit} onClick={() => setPhase('submitting')}>Submit</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
    });
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.phase",
        guard: {
          kind: "not",
          args: [
            {
              kind: "not",
              args: [
                {
                  kind: "not",
                  args: [
                    {
                      kind: "eq",
                      args: [
                        { kind: "read", var: "local:App.phase" },
                        { kind: "lit", value: "submitting" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        reads: ["local:App.phase"],
        effect: {
          kind: "assign",
          var: "local:App.phase",
          expr: { kind: "lit", value: "submitting" },
        },
      }),
    );
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.warnings).not.toContain(
      "Unsupported disabled guard App.onClick",
    );
  });

  it("uses submit button disabled guards for form submit transitions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [phase, setPhase] = useState<'idle' | 'submitting'>('idle');
        const isBusy = phase === 'submitting';
        const canSubmit = !isBusy;
        return (
          <form onSubmit={() => setPhase('submitting')}>
            <button type="submit" disabled={!canSubmit}>Submit</button>
          </form>
        );
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onSubmit.phase",
        reads: ["local:App.phase"],
      }),
    );
  });

  it("extracts Jotai default-store writes through source write channels", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    await writeFile(
      sourcePath,
      `
      import { atom, getDefaultStore } from 'jotai';
      export const authAtom = atom<'guest' | 'user'>('guest');
      const store = getDefaultStore();
      export function App() {
        return <button onClick={() => store.set(authAtom, 'user')}>Login</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const caveat = {
      id: "jotai:getDefaultStore",
      reason: "Global taint jotai:getDefaultStore",
    };
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.authAtom",
        effect: {
          kind: "assign",
          var: "atom:authAtom",
          expr: { kind: "lit", value: "user" },
        },
        writes: ["atom:authAtom"],
        confidence: "exact",
      }),
    );
    expect(report.warnings).toContain("Global taint jotai:getDefaultStore");
    expect(report.globalTaints).toEqual([caveat]);
    expect(result.model.metadata?.extractionCaveats?.globalTaints).toEqual([
      caveat,
    ]);
  });

  it("writes app.model.ts to an explicit path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, ".modality", "model.json");
    const appModelPath = join(dir, "src", "app.model.ts");
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

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      appModelPath,
    });
    const appModel = await readFile(appModelPath, "utf8");
    expect(result.lines).toContain(`appModel=${appModelPath}`);
    expect(appModel).toContain('"local:App.open": boolean;');
    expect(appModel).toContain('"local:App.open":false');
  });

  it("instantiates SWR template vars and transitions from useSWR call sites", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import useSWR from 'swr';
      type Todo = { id: string };
      export function App() {
        const { data } = useSWR<Todo[]>('/api/todos', fetchTodos, { revalidateOnFocus: true });
        return data?.length;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(result.lines[0]).toBe("extracted vars=3 transitions=6");
    expect(result.model.vars.map((decl) => decl.id)).toContain(
      "swr:api_todos:data",
    );
    expect(
      result.model.vars.find((decl) => decl.id === "swr:api_todos:data")
        ?.domain,
    ).toEqual({ kind: "option", inner: { kind: "lengthCat" } });
    expect(result.model.transitions.map((transition) => transition.id)).toEqual(
      [
        "swr:api_todos:fetch",
        "swr:api_todos:focus-revalidate",
        "swr:api_todos:resolve:success:0",
        "swr:api_todos:resolve:success:1",
        "swr:api_todos:resolve:success:2",
        "swr:api_todos:resolve:error",
      ],
    );
    expect(
      result.model.vars.find((decl) => decl.id === "sys:pending")?.domain,
    ).toMatchObject({
      kind: "boundedList",
      inner: {
        kind: "record",
        fields: {
          opId: { kind: "enum", values: ["GET /api/todos"] },
          continuation: { kind: "enum", values: ["swr:api_todos:resolve"] },
        },
      },
    });
  });

  it("loads local imports for Jotai atoms and SWR payload domains", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    await mkdir(join(dir, "state"));
    await mkdir(join(dir, "api"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      join(dir, "state", "auth.ts"),
      `
      import { atom } from 'jotai';
      export type AuthState = { status: 'guest'; userId: null } | { status: 'user'; userId: string };
      export const authAtom = atom<AuthState>({ status: 'guest', userId: null });
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "api", "eventApi.ts"),
      `
      export type ApplicationStatus = { applied: boolean };
      export type EventSnapshot = { application: ApplicationStatus | null };
      `,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
      import { useAtom } from 'jotai';
      import useSWR from 'swr';
      import { authAtom } from './state/auth';
      import type { EventSnapshot } from './api/eventApi';
      export function App() {
        const [auth, setAuth] = useAtom(authAtom);
        const userId = auth.userId;
        const { data: snapshot } = useSWR<EventSnapshot>(['event-snapshot', userId], fetcher);
        const isUser = auth.status === 'user';
        const application = snapshot?.application;
        const isApplied = application?.applied ?? false;
        const canCancel = isUser && isApplied;
        return <button disabled={!canCancel} onClick={() => setAuth({ status: 'guest', userId: null })}>Logout</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(
      result.model.vars.find((decl) => decl.id === "atom:authAtom")?.domain,
    ).toMatchObject({
      kind: "tagged",
      tag: "status",
    });
    expect(
      result.model.vars.find(
        (decl) => decl.id === "swr:event_snapshot_userId:data",
      )?.domain,
    ).toMatchObject({
      inner: {
        fields: {
          application: {
            inner: {
              fields: {
                applied: { kind: "bool" },
              },
            },
          },
        },
      },
    });
    const click = result.model.transitions.find((transition) =>
      transition.id.startsWith("App.onClick.authAtom"),
    );
    expect(click?.reads).toEqual([
      "atom:authAtom",
      "swr:event_snapshot_userId:data",
    ]);
  });

  it("extracts a React Router v7 app directory with tsconfig imports, fetch flows, Button wrappers, and theme context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-router-app-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    await mkdir(join(dir, "app", "components"), { recursive: true });
    await mkdir(join(dir, "app", "lib"), { recursive: true });
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "report.json");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18.0.0", "react-router": "^7.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "~/*": ["./app/*"] } },
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes.ts"),
      `
      import { index, route } from '@react-router/dev/routes';
      export default [
        index('routes/home.tsx'),
        route('i/:id', 'routes/image.tsx')
      ];
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "root.tsx"),
      `
      import { createContext, useContext, useState } from 'react';
      import { Link } from 'react-router';
      import { Button } from '~/components/Button';
      type Theme = 'light' | 'dark' | 'system';
      const ThemeContext = createContext(null);
      export function ThemeProvider({ children }) {
        const [theme, setTheme] = useState<Theme>('system');
        const resolvedTheme = theme === 'system' ? 'light' : theme;
        return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
      }
      export function useTheme() {
        return useContext(ThemeContext);
      }
      export function TopBar() {
        const { theme, setTheme } = useTheme();
        return <header>
          <Link to="/">Gallery</Link>
          <Button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>Theme</Button>
        </header>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "components", "Button.tsx"),
      `
      export function Button(props) {
        return <button {...props} />;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "components", "UploadForm.tsx"),
      `
      import { useState } from 'react';
      import { useNavigate } from 'react-router';
      import { Button } from './Button';
      export function UploadForm() {
        const navigate = useNavigate();
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState<string | null>(null);
        return <form onSubmit={async () => {
          setBusy(true);
          try {
            const res = await fetch('/api/upload', { method: 'POST' });
            setError(null);
            navigate('/i/abc');
          } catch (err) {
            setError('upload');
          } finally {
            setBusy(false);
          }
        }}>
          <Button type="submit" disabled={busy}>Upload</Button>
        </form>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "home.tsx"),
      `
      import { Link } from 'react-router';
      import { TopBar } from '../root';
      import { UploadForm } from '~/components/UploadForm';
      export default function Home() {
        return <main><TopBar /><UploadForm /><Link to="/i/example">Example</Link></main>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "image.tsx"),
      `
      import { useState } from 'react';
      import { useNavigate } from 'react-router';
      import { Button } from '~/components/Button';
      export default function ImageDetail() {
        const navigate = useNavigate();
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const id = 'abc';
        return <section>
          <Button onClick={async () => {
            setBusy(true);
            try {
              const res = await fetch(\`/api/replace/\${id}\`, { method: 'POST' });
              setError(null);
            } catch (err) {
              setError('replace');
            } finally {
              setBusy(false);
            }
          }}>Replace</Button>
          <Button onClick={async () => {
            try {
              const res = await fetch(\`/api/delete/\${id}\`, { method: 'POST' });
              navigate('/');
            } catch (err) {
              setError('delete');
            }
          }}>Delete</Button>
        </section>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath: dir,
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const ids = result.model.transitions.map((transition) => transition.id);
    expect(
      result.report.sourceFiles
        .map((file) => file.replace(`${dir}/`, ""))
        .sort(),
    ).toEqual([
      "app/components/Button.tsx",
      "app/components/UploadForm.tsx",
      "app/root.tsx",
      "app/routes/home.tsx",
      "app/routes/image.tsx",
    ]);
    expect(
      result.model.vars.find((decl) => decl.id === "sys:route")?.domain,
    ).toEqual({ kind: "enum", values: ["/", "/i/:id"] });
    expect(
      result.model.vars.find((decl) => decl.id === "local:UploadForm.busy"),
    ).toBeTruthy();
    expect(
      result.model.vars.find((decl) => decl.id === "local:ThemeProvider.theme"),
    ).toMatchObject({
      domain: { kind: "enum", values: ["light", "dark", "system"] },
      scope: { kind: "global" },
    });
    expect(ids).toEqual(
      expect.arrayContaining([
        "UploadForm.onSubmit.POST /api/upload.start",
        "UploadForm.onSubmit.POST /api/upload.success",
        "UploadForm.onSubmit.POST /api/upload.error",
        "ImageDetail.onClick.POST /api/replace/:id.start",
        "ImageDetail.onClick.POST /api/replace/:id.success",
        "ImageDetail.onClick.POST /api/replace/:id.error",
        "ImageDetail.onClick.POST /api/delete/:id.start",
        "ImageDetail.onClick.POST /api/delete/:id.success",
        "TopBar.onClick.theme",
        "TopBar.Link.navigate._",
        "Home.Link.navigate._i_id",
      ]),
    );
    expect(
      result.model.transitions.find(
        (transition) =>
          transition.id === "UploadForm.onSubmit.POST /api/upload.success",
      )?.writes,
    ).toEqual(
      expect.arrayContaining([
        "local:UploadForm.busy",
        "local:UploadForm.error",
        "sys:route",
      ]),
    );
    expect(
      result.model.transitions.find(
        (transition) =>
          transition.id === "ImageDetail.onClick.POST /api/delete/:id.success",
      )?.effect,
    ).toMatchObject({
      kind: "seq",
      effects: expect.arrayContaining([
        { kind: "navigate", mode: "push", to: { kind: "lit", value: "/" } },
      ]),
    });
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
          "havoc write to local:App.saveStatus",
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
        reasons: ["havoc write to local:App.saveStatus"],
      },
    ]);
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
      id: "App.onClick.api.save",
      reason: "Unhandled rejection App.onClick.api.save",
    };
    expect(report.warnings).toContain(
      "Unhandled rejection App.onClick.api.save",
    );
    expect(report.unhandledRejections).toEqual([caveat]);
    expect(model.metadata?.extractionCaveats?.unhandledRejections).toEqual([
      caveat,
    ]);
  });

  it("types pending op args from extracted effect API snapshots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [userId, setUserId] = useState<'none' | 'u1'>('none');
        const [plan, setPlan] = useState<'none' | 'starter' | 'pro'>('none');
        const [status, setStatus] = useState<'idle' | 'submitting' | 'done'>('idle');
        return <button onClick={async () => {
          setStatus('submitting');
          await api.submitOrder({ userId, plan });
          setStatus('done');
        }}>Submit</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      effectApis: ["api.submitOrder"],
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(
      result.model.vars.find((decl) => decl.id === "sys:pending")?.domain,
    ).toMatchObject({
      inner: {
        fields: {
          args: {
            fields: {
              userId: { kind: "enum", values: ["none", "u1"] },
              plan: { kind: "enum", values: ["none", "starter", "pro"] },
            },
          },
        },
      },
    });
    expect(
      result.model.transitions.find(
        (transition) => transition.id === "App.onClick.api.submitOrder.start",
      ),
    ).toMatchObject({
      reads: ["local:App.plan", "local:App.userId"],
      effect: {
        kind: "seq",
        effects: expect.arrayContaining([
          {
            kind: "enqueue",
            op: "api.submitOrder",
            continuation: "App.onClick.api.submitOrder.cont",
            args: {
              userId: { kind: "read", var: "local:App.userId" },
              plan: { kind: "read", var: "local:App.plan" },
            },
          },
        ]),
      },
    });
  });

  it("reports stale-read caveats for async continuations", async () => {
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
          setSaveStatus(saveStatus);
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
      id: "App.onClick.api.save:local:App.saveStatus",
      reason: "Stale-read risk App.onClick.api.save:local:App.saveStatus",
    };
    expect(report.warnings).toContain(
      "Stale-read risk App.onClick.api.save:local:App.saveStatus",
    );
    expect(report.staleReads).toEqual([caveat]);
    expect(model.metadata?.extractionCaveats?.staleReads).toEqual([caveat]);
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
        const [debug, setDebug] = useState<'off' | 'on'>('off');
        return <>
          <button onClick={() => setSaveStatus('posting')}>Save</button>
          <button onClick={() => setDebug('on')}>Debug</button>
        </>;
      }
      `,
      "utf8",
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
            effect: {
              kind: "assign",
              var: "local:App.saveStatus",
              expr: { kind: "lit", value: "idle" },
            },
            reads: [],
            writes: ["local:App.saveStatus"],
            confidence: "exact",
          },
        ],
        domains: [
          {
            var: "local:App.saveStatus",
            domain: { kind: "enum", values: ["idle"] },
            initial: "idle",
          },
        ],
        ignoreVars: ["local:App.debug"],
      }),
      "utf8",
    );
    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      reportPath,
      overlayPath,
      explainDrift: true,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const model = JSON.parse(await readFile(modelPath, "utf8"));
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(result.lines).toContain("overlay-drift=none");
    expect(model.transitions[0]).toMatchObject({
      id: "App.onClick.saveStatus",
      confidence: "manual",
    });
    expect(model.vars.map((decl: { id: string }) => decl.id)).not.toContain(
      "local:App.debug",
    );
    expect(report.warnings).toContain(
      "Overlay overrides exact transition App.onClick.saveStatus",
    );
    expect(report.handlers).toEqual([
      { id: "App.onClick.saveStatus", classification: "overlay", reasons: [] },
    ]);
    expect(report.domains).toContainEqual({
      varId: "local:App.saveStatus",
      domainKind: "enum",
      provenance: "overlay-refined",
    });
    expect(report.coverage.ignoredVars).toBe(1);
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
      "utf8",
    );
    await runExtractCommand({
      sourcePath,
      modelPath: goldenPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      expectModelPath: goldenPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
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
      "utf8",
    );
    await writeFile(
      goldenPath,
      JSON.stringify({
        schemaVersion: 1,
        id: "wrong",
        bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 1 },
        vars: [],
        transitions: [],
      }),
      "utf8",
    );
    await expect(
      runExtractCommand({ sourcePath, modelPath, expectModelPath: goldenPath }),
    ).rejects.toThrow("Extracted model differs from expected snapshot");
  });

  it("fails extraction on orphan overlay entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const overlayPath = join(dir, "overlay.json");
    await writeFile(
      sourcePath,
      "export function App() { return null; }",
      "utf8",
    );
    await writeFile(
      overlayPath,
      JSON.stringify({
        transitions: [
          {
            id: "missing",
            cls: "user",
            label: { kind: "click" },
            source: [],
            guard: { kind: "lit", value: true },
            effect: { kind: "seq", effects: [] },
            reads: [],
            writes: [],
            confidence: "exact",
          },
        ],
      }),
      "utf8",
    );
    await expect(
      runExtractCommand({ sourcePath, modelPath, overlayPath }),
    ).rejects.toThrow(
      "Overlay transition missing does not match an extracted transition",
    );
  });

  it("explains orphan overlay drift against current extraction candidates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
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
      "utf8",
    );
    await writeFile(
      overlayPath,
      JSON.stringify({
        transitions: [
          {
            id: "App.onClick.status",
            cls: "user",
            label: { kind: "click" },
            source: [],
            guard: { kind: "lit", value: true },
            effect: { kind: "seq", effects: [] },
            reads: [],
            writes: [],
            confidence: "exact",
          },
        ],
        domains: [
          {
            var: "local:App.status",
            domain: { kind: "enum", values: ["idle"] },
          },
        ],
        ignoreVars: ["local:App.debug"],
      }),
      "utf8",
    );

    await expect(
      runExtractCommand({
        sourcePath,
        modelPath,
        overlayPath,
        explainDrift: true,
      }),
    ).rejects.toThrow(
      /overlay-drift: transition App\.onClick\.status has no match; nearest=App\.onClick\.saveStatus\(\d+\)/,
    );
    await expect(
      runExtractCommand({
        sourcePath,
        modelPath,
        overlayPath,
        explainDrift: true,
      }),
    ).rejects.toThrow(
      /overlay-drift: domain local:App\.status has no match; nearest=local:App\.saveStatus\(\d+\)/,
    );
    await expect(
      runExtractCommand({
        sourcePath,
        modelPath,
        overlayPath,
        explainDrift: true,
      }),
    ).rejects.toThrow(
      /overlay-drift: ignoreVar local:App\.debug has no match; nearest=local:App\.saveStatus\(\d+\)/,
    );
  });

  it("extracts a React Router v7 app directory with aliases, fetch flows, links, and context setters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-rr7-"));
    const appDir = join(dir, "app");
    await mkdir(join(appDir, "routes"), { recursive: true });
    await mkdir(join(appDir, "components", "ui"), { recursive: true });
    await mkdir(join(appDir, "lib"), { recursive: true });
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "report.json");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^19.0.0", "react-router": "^7.1.1" },
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "~/*": ["./app/*"] } },
      }),
      "utf8",
    );
    await writeFile(
      join(appDir, "routes.ts"),
      `
      import { index, route } from "@react-router/dev/routes";
      export default [
        index("routes/home.tsx"),
        route("i/:id", "routes/i.$id.tsx"),
        route("api/upload", "routes/api.upload.ts"),
        route("api/replace/:id", "routes/api.replace.$id.ts"),
        route("api/delete/:id", "routes/api.delete.$id.ts"),
      ];
      `,
      "utf8",
    );
    await writeFile(
      join(appDir, "root.tsx"),
      `
      import { Outlet } from "react-router";
      import { ThemeProvider } from "~/lib/theme";
      export default function App() {
        return <ThemeProvider><Outlet /></ThemeProvider>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(appDir, "lib", "theme.tsx"),
      `
      import { createContext, useContext, useState } from "react";
      export type Theme = "light" | "dark" | "system";
      const ThemeContext = createContext<{ theme: Theme; setTheme: (next: Theme) => void } | null>(null);
      export function ThemeProvider({ children }: { children: React.ReactNode }) {
        const [theme, setTheme] = useState<Theme>("system");
        return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
      }
      export function useTheme() {
        const ctx = useContext(ThemeContext);
        if (!ctx) throw new Error("missing provider");
        return ctx;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(appDir, "components", "ui", "button.tsx"),
      `
      export function Button(props: React.ComponentProps<"button">) {
        return <button {...props} />;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(appDir, "components", "top-bar.tsx"),
      `
      import { Link } from "react-router";
      import { Button } from "~/components/ui/button";
      import { useTheme, type Theme } from "~/lib/theme";
      export function TopBar() {
        return <><Link to="/">Home</Link><ThemeToggle /></>;
      }
      function ThemeToggle() {
        const { theme, setTheme } = useTheme();
        const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
        return <Button onClick={() => setTheme(next)}>Theme</Button>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(appDir, "components", "upload-form.tsx"),
      `
      import { useRef, useState } from "react";
      import { useNavigate } from "react-router";
      import { Button } from "~/components/ui/button";
      export function UploadForm() {
        const navigate = useNavigate();
        const inputRef = useRef<HTMLInputElement>(null);
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState<string | null>(null);
        async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/upload", { method: "POST", body: new FormData() });
            if (!res.ok) throw new Error(await res.text());
            const { id } = await res.json() as { id: string };
            navigate(\`/i/\${id}\`);
          } catch (err) {
            setError(String(err));
          } finally {
            setBusy(false);
          }
        }
        return <><input ref={inputRef} onChange={onChange} /><Button onClick={() => inputRef.current?.click()}>Upload</Button></>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(appDir, "routes", "home.tsx"),
      `
      import { Link } from "react-router";
      import { TopBar } from "~/components/top-bar";
      import { UploadForm } from "~/components/upload-form";
      export default function Home() {
        return <><TopBar /><UploadForm /><Link to={\`/i/\${"abc"}\`}>Image</Link></>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(appDir, "routes", "i.$id.tsx"),
      `
      import { useState } from "react";
      import { useNavigate } from "react-router";
      import { Button } from "~/components/ui/button";
      export default function ImageDetail() {
        const navigate = useNavigate();
        const image = { id: "abc" };
        const [busy, setBusy] = useState(false);
        const [err, setErr] = useState<string | null>(null);
        async function onDelete() {
          setBusy(true);
          setErr(null);
          try {
            const res = await fetch(\`/api/delete/\${image.id}\`, { method: "POST" });
            if (!res.ok) throw new Error(await res.text());
            navigate("/");
          } catch (e) {
            setErr(String(e));
            setBusy(false);
          }
        }
        return <Button disabled={busy} onClick={onDelete}>Delete</Button>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(appDir, "routes", "api.upload.ts"),
      "export async function action() {}",
      "utf8",
    );
    await writeFile(
      join(appDir, "routes", "api.replace.$id.ts"),
      "export async function action() {}",
      "utf8",
    );
    await writeFile(
      join(appDir, "routes", "api.delete.$id.ts"),
      "export async function action() {}",
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath: dir,
      modelPath,
      reportPath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });

    expect(
      result.model.vars.find((decl) => decl.id === "sys:route")?.domain,
    ).toEqual({
      kind: "enum",
      values: [
        "/",
        "/api/delete/:id",
        "/api/replace/:id",
        "/api/upload",
        "/i/:id",
      ],
    });
    expect(result.model.vars.map((decl) => decl.id)).toEqual(
      expect.arrayContaining([
        "local:UploadForm.busy",
        "local:UploadForm.error",
        "local:ImageDetail.busy",
        "local:ImageDetail.err",
        "local:ThemeProvider.theme",
      ]),
    );
    expect(result.model.transitions.map((transition) => transition.id)).toEqual(
      expect.arrayContaining([
        "UploadForm.onChange.POST /api/upload.start",
        "UploadForm.onChange.POST /api/upload.success",
        "UploadForm.onChange.POST /api/upload.error",
        "ImageDetail.onClick.POST /api/delete/:id.start",
        "ImageDetail.onClick.POST /api/delete/:id.success",
        "ThemeToggle.onClick.theme",
      ]),
    );
    expect(
      result.model.transitions.find(
        (transition) =>
          transition.id === "ImageDetail.onClick.POST /api/delete/:id.start",
      )?.writes,
    ).toEqual(
      expect.arrayContaining([
        "local:ImageDetail.busy",
        "local:ImageDetail.err",
      ]),
    );
    expect(
      result.model.transitions.find(
        (transition) =>
          transition.id === "ImageDetail.onClick.POST /api/delete/:id.start",
      )?.writes,
    ).not.toContain("local:UploadForm.busy");
    expect(
      result.model.transitions.find(
        (transition) =>
          transition.id === "ImageDetail.onClick.POST /api/delete/:id.error",
      )?.writes,
    ).toEqual(
      expect.arrayContaining([
        "local:ImageDetail.busy",
        "local:ImageDetail.err",
      ]),
    );
    expect(
      result.model.transitions.find(
        (transition) =>
          transition.id === "ImageDetail.onClick.POST /api/delete/:id.error",
      )?.writes,
    ).not.toContain("local:UploadForm.busy");
    expect(
      result.model.transitions.some((transition) =>
        navigatesTo(transition.effect, "/i/:id"),
      ),
    ).toBe(true);
    expect(result.report.sourceFiles).toEqual(
      expect.arrayContaining([
        join(appDir, "root.tsx"),
        join(appDir, "routes", "home.tsx"),
        join(appDir, "components", "upload-form.tsx"),
      ]),
    );
    expect(result.report.coverage.exactOrOverlay).toBeGreaterThan(0);
  });
});

function navigatesTo(effect: EffectIR, route: string): boolean {
  if (effect.kind === "navigate")
    return effect.to?.kind === "lit" && effect.to.value === route;
  if (effect.kind === "seq")
    return effect.effects.some((child) => navigatesTo(child, route));
  if (effect.kind === "if")
    return navigatesTo(effect.then, route) || navigatesTo(effect.else, route);
  return false;
}
