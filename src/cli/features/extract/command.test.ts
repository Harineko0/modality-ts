import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkModel } from "modality-ts/check";
import {
  eq,
  lit,
  reachable,
  readVar,
  validateModel,
  type EffectIR,
  type Model,
} from "modality-ts/core";
import { runExtractCommand } from "./index.js";
import { renderHumanExtractTargets } from "./output.js";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

async function mkSchemaExtractTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await symlink(
    join(repoRoot, "node_modules"),
    join(dir, "node_modules"),
    "dir",
  );
  return dir;
}

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
      ["domain-refinement", "arktype", "0.1.0"],
      ["domain-refinement", "zod", "0.1.0"],
      ["router", "router", "0.1.0"],
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
  });

  it("extracts imported multi-hop component callback interactions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-imported-"));
    const sourcePath = join(dir, "App.tsx");
    const menuItemCardPath = join(dir, "MenuItemCard.tsx");
    const buttonPath = join(dir, "Button.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    await writeFile(
      buttonPath,
      `
      export function Button({ asChild = false, ...props }: { asChild?: boolean; onClick?: () => void }) {
        const Comp = asChild ? 'span' : 'button';
        return <Comp {...props} />;
      }
      `,
      "utf8",
    );
    await writeFile(
      menuItemCardPath,
      `
      import { Button } from './Button';
      export function MenuItemCard(props: { onAdd: () => void }) {
        return <Button onClick={props.onAdd} />;
      }
      `,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      import { MenuItemCard } from './MenuItemCard';
      type CartItem = { id: string; qty: number };
      export function App() {
        const [cart, setCart] = useState<CartItem[]>([]);
        const handleAdd = () => {
          setCart((prev) => [...prev, { id: 'espresso', qty: 1 }]);
        };
        return <MenuItemCard onAdd={handleAdd} />;
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

    expect(model.vars.some((decl) => decl.id === "local:App.cart")).toBe(true);
    expect(
      model.transitions.some((transition) =>
        transition.writes.includes("local:App.cart"),
      ),
    ).toBe(true);
    const cartTransition = model.transitions.find((transition) =>
      transition.writes.includes("local:App.cart"),
    );
    expect(cartTransition).toMatchObject({
      cls: "user",
      label: { kind: "click" },
    });
    expect(
      report.handlers.some(
        (handler: { id: string; classification: string; writes?: string[] }) =>
          handler.id.startsWith("App.onClick") &&
          handler.classification !== "unextractable",
      ),
    ).toBe(true);
    expect(
      (model.metadata?.extractionCaveats?.entries ?? []).some(
        (entry: { id: string; kind: string }) =>
          entry.id === "App.onAdd" && entry.kind === "unextractable",
      ),
    ).toBe(false);
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
      reason: "Global taint local:App.saveStatus",
      severity: "unsound-risk" as const,
      source: expect.objectContaining({
        file: expect.stringMatching(/App\.tsx$/),
      }),
    };
    expect(report.warnings).toContain("Global taint local:App.saveStatus");
    expect(report.globalTaints).toEqual([caveat]);
    expect(result.model.metadata?.extractionCaveats?.entries).toEqual([caveat]);
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
      reachable(result.model, eq(readVar("sys:route"), lit("/checkout")), {
        name: "checkoutReachable",
        reads: ["sys:route"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("discovers UI routes from a manifest in single-file mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-manifest-"));
    await mkdir(join(dir, "app"), { recursive: true });
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      join(dir, "app", "routes.ts"),
      `
      import { index, route } from '@react-router/dev/routes';
      export default [
        index('routes/home.tsx'),
        route('links', 'routes/dashboard.tsx'),
        route('signin', 'routes/signin.tsx'),
        route('api/links', 'routes/api.links.tsx'),
      ];
      `,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
      export function App() {
        return null;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(
      result.model.vars.find((decl) => decl.id === "sys:route")?.domain,
    ).toEqual({
      kind: "enum",
      values: ["/", "/links", "/signin"],
    });
    expect(
      result.report.routeCoverage?.routes.find(
        (entry) => entry.pattern === "/api/links",
      ),
    ).toMatchObject({
      modeled: false,
      classification: "api",
    });
    expect(
      result.lines.some((line) => line.startsWith("routes configured=")),
    ).toBe(true);
  });

  it("synthesizes redirect replace transitions for redirect-only routes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-redirect-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    const sourcePath = dir;
    const modelPath = join(dir, "model.json");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "react-router": "^7.0.0" } }),
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes.ts"),
      `
      import { index, route } from '@react-router/dev/routes';
      export default [
        index('routes/home.tsx'),
        route('links', 'routes/links.tsx'),
        route('legacy', 'routes/legacy.tsx'),
      ];
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "home.tsx"),
      `export default function Home() { return null; }`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "links.tsx"),
      `export default function Links() { return null; }`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "legacy.tsx"),
      `export function loader() { return redirect("/links"); }`,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(
      result.model.transitions.find(
        (transition) => transition.id === "route:/legacy.redirect._links",
      ),
    ).toMatchObject({
      cls: "nav",
      effect: {
        kind: "navigate",
        mode: "replace",
        to: { kind: "lit", value: "/links" },
      },
    });
  });

  it("reduces sys:history within sys:route when pushes are route-bound", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-history-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    const modelPath = join(dir, "model.json");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "react-router": "^7.0.0" } }),
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes.ts"),
      `
      import { index, route } from '@react-router/dev/routes';
      export default [
        index('routes/home.tsx'),
        route('links', 'routes/links.tsx'),
        route('signin', 'routes/signin.tsx'),
      ];
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "home.tsx"),
      `
      import { Link } from 'react-router';
      export default function Home() {
        return <Link to="/signin">Sign in</Link>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "signin.tsx"),
      `export default function Signin() { return null; }`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "links.tsx"),
      `export default function Links() { return null; }`,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath: dir, modelPath });
    const routeValues =
      result.model.vars.find((decl) => decl.id === "sys:route")?.domain.kind ===
      "enum"
        ? result.model.vars.find((decl) => decl.id === "sys:route")?.domain
            .values
        : [];
    const historyDomain = result.model.vars.find(
      (decl) => decl.id === "sys:history",
    )?.domain;
    const historyValues =
      historyDomain?.kind === "boundedList" &&
      historyDomain.inner.kind === "enum"
        ? historyDomain.inner.values
        : [];
    expect(historyValues.every((route) => routeValues?.includes(route))).toBe(
      true,
    );
    expect(historyValues.length).toBeLessThan(routeValues?.length ?? 0);
  });

  it("extracts a route-bound-push app that passes validation and checking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-check-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    const modelPath = join(dir, "model.json");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "react-router": "^7.0.0" } }),
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes.ts"),
      `
      import { index, route } from '@react-router/dev/routes';
      export default [
        index('routes/home.tsx'),
        route('links', 'routes/links.tsx'),
        route('signin', 'routes/signin.tsx'),
      ];
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "home.tsx"),
      `
      import { Link } from 'react-router';
      export default function Home() {
        return <Link to="/signin">Sign in</Link>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "signin.tsx"),
      `export default function Signin() { return null; }`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "links.tsx"),
      `export default function Links() { return null; }`,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath: dir, modelPath });
    expect(validateModel(result.model).ok).toBe(true);

    const check = checkModel(result.model, [
      reachable(result.model, eq(readVar("sys:route"), lit("/signin")), {
        name: "signinReachable",
        reads: ["sys:route"],
      }),
    ]);
    expect(check.verdicts[0]?.status).not.toBe("error");

    const routeValues =
      result.model.vars.find((decl) => decl.id === "sys:route")?.domain.kind ===
      "enum"
        ? result.model.vars.find((decl) => decl.id === "sys:route")?.domain
            .values
        : [];
    for (const transition of result.model.transitions) {
      if (
        transition.effect.kind === "navigate" &&
        transition.effect.to?.kind === "lit"
      ) {
        expect(routeValues).toContain(transition.effect.to.value);
      }
    }
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
      domain: { kind: "enum", values: ["gray", "red"] },
      initial: "gray",
    });
    const check = checkModel(result.model, [
      reachable(result.model, eq(readVar("local:App.color"), lit("gray")), {
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
        navigation: { initialRoute: "/configured" },
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

  it("loads environment.webSockets from modality config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const configPath = join(dir, "modality.config.ts");
    const modelPath = join(dir, "model.json");
    await writeFile(
      configPath,
      `export default {
        environment: {
          webSockets: [
            {
              url: "/ws",
              messages: [
                { type: "snapshot", bind: { orders: "many" } },
              ],
            },
          ],
        },
      };`,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [orders, setOrders] = useState<readonly string[]>([]);
        useEffect(() => {
          const ws = new WebSocket("/ws");
          ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === "snapshot") setOrders(message.orders);
          };
        }, []);
        return <span>{orders.length}</span>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      configPath,
    });
    expect(
      result.report.warnings.map((warning) => warning.message),
    ).not.toContain("Unextractable effect App.useEffect");
    const socketVar = result.model.vars.find((decl) =>
      decl.id.startsWith("sys:websocket:"),
    )?.id;
    expect(socketVar).toBeDefined();
    expect(
      result.model.transitions.some(
        (transition) =>
          transition.cls === "env" &&
          transition.label.kind === "env" &&
          transition.label.key === "App.websocket.onopen" &&
          transition.effect.kind === "assign" &&
          transition.effect.var === socketVar &&
          transition.effect.expr.kind === "lit" &&
          transition.effect.expr.value === "open",
      ),
    ).toBe(true);
    const snapshot = result.model.transitions.find(
      (transition) =>
        transition.cls === "env" &&
        transition.label.kind === "env" &&
        transition.label.key === "App.websocket.onmessage" &&
        transition.label.outcome === "snapshot",
    );
    expect(snapshot).toMatchObject({
      guard: {
        kind: "eq",
        args: [
          { kind: "read", var: socketVar },
          { kind: "lit", value: "open" },
        ],
      },
      effect: {
        kind: "assign",
        var: "local:App.orders",
        expr: { kind: "lit", value: "many" },
      },
      confidence: "exact",
    });
    expect(snapshot?.effect.kind).not.toBe("havoc");
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
      kind: "global-taint" as const,
      id: "jotai:getDefaultStore",
      reason: "Global taint jotai:getDefaultStore",
      severity: "unsound-risk" as const,
      source: expect.objectContaining({
        file: expect.stringMatching(/App\.tsx$/),
      }),
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
    expect(result.model.metadata?.extractionCaveats?.entries).toEqual([caveat]);
  });

  it("extracts Jotai Provider store-qualified writes across components", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const statePath = join(dir, "state.ts");
    const appPath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      statePath,
      `
      import { atom } from 'jotai';
      export const countAtom = atom(0);
      `,
      "utf8",
    );
    await writeFile(
      appPath,
      `
      import { Provider, createStore, useAtom } from 'jotai';
      import { countAtom } from './state';
      const myStore = createStore();
      function Button() {
        const [, setCount] = useAtom(countAtom);
        return <button onClick={() => setCount(1)}>Inc</button>;
      }
      export function App() {
        return <Provider store={myStore}><Button /></Provider>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath: appPath,
      sourcePaths: [statePath],
      modelPath,
    });
    expect(result.model.vars).toContainEqual(
      expect.objectContaining({ id: "atom:countAtom@store:myStore" }),
    );
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        effect: {
          kind: "assign",
          var: "atom:countAtom@store:myStore",
          expr: { kind: "lit", value: 1 },
        },
        writes: ["atom:countAtom@store:myStore"],
      }),
    );
  });

  it("surfaces Jotai utility warnings in extraction caveats", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const reportPath = join(dir, "extraction-report.json");
    await writeFile(
      sourcePath,
      `
      import { atom } from 'jotai';
      import { atomFamily } from 'jotai-family';
      const todoFamily = atomFamily((id: string) => atom(id));
      export function App() {
        const dynamic = todoFamily(routeId);
        return null;
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
    expect(
      report.warnings.some((warning: string) =>
        warning.includes("dynamic atom family param"),
      ),
    ).toBe(true);
    expect(result.lines.join("\n")).toMatch(/jotai|family|warning/i);
  });

  it("extracts Jotai writes inside async handlers and loops through the shared transition extractor", async () => {
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
        return <>
          <button onClick={async () => {
            await api.login();
            setAuth('user');
          }}>Login</button>
          <button onClick={() => {
            for (const item of items) setAuth(item.ok ? 'user' : 'guest');
          }}>Sync</button>
        </>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      effectApis: ["api.login"],
    });
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.api.login.success",
        cls: "env",
        effect: expect.objectContaining({
          kind: "seq",
          effects: expect.arrayContaining([
            {
              kind: "assign",
              var: "atom:authAtom",
              expr: { kind: "lit", value: "user" },
            },
          ]),
        }),
        writes: ["sys:pending", "atom:authAtom"],
      }),
    );
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.authAtom.loop",
        effect: { kind: "havoc", var: "atom:authAtom" },
        writes: ["atom:authAtom"],
        confidence: "over-approx",
      }),
    );
  });

  it("extracts SWR mutate writes inside simple, async, and loop handlers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import useSWR from 'swr';
      export function App() {
        const { mutate } = useSWR<'empty' | 'full'>('/api/todos', fetcher);
        return <>
          <button onClick={() => mutate('full')}>Fill</button>
          <button onClick={async () => {
            await api.refresh();
            mutate('empty');
          }}>Refresh</button>
          <button onClick={() => {
            for (const item of items) mutate(item.done ? 'full' : 'empty');
          }}>Loop</button>
        </>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      effectApis: ["api.refresh"],
    });
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.api_todos",
        effect: {
          kind: "assign",
          var: "swr:api_todos:data",
          expr: { kind: "lit", value: "full" },
        },
        writes: ["swr:api_todos:data"],
      }),
    );
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.api.refresh.success",
        effect: expect.objectContaining({
          kind: "seq",
          effects: expect.arrayContaining([
            {
              kind: "assign",
              var: "swr:api_todos:data",
              expr: { kind: "lit", value: "empty" },
            },
          ]),
        }),
        writes: ["sys:pending", "swr:api_todos:data"],
      }),
    );
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.api_todos.loop",
        effect: { kind: "havoc", var: "swr:api_todos:data" },
        writes: ["swr:api_todos:data"],
        confidence: "over-approx",
      }),
    );
  });

  it("extracts router navigation inside async continuations through the shared transition extractor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useNavigate } from 'react-router';
      export function App() {
        const navigate = useNavigate();
        return <button onClick={async () => {
          await api.save();
          navigate('/done');
        }}>Save</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      effectApis: ["api.save"],
    });
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.api.save.success",
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            {
              kind: "navigate",
              mode: "push",
              to: { kind: "lit", value: "/done" },
            },
          ],
        },
        writes: expect.arrayContaining([
          "sys:pending",
          "sys:route",
          "sys:history",
        ]),
      }),
    );
    expect(
      result.model.vars.find((decl) => decl.id === "sys:route")?.domain,
    ).toEqual({ kind: "enum", values: ["/", "/done"] });
  });

  it("does not duplicate shared handler transitions when useState, Jotai, and SWR are enabled together", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      import { atom, useSetAtom } from 'jotai';
      import useSWR from 'swr';
      export const authAtom = atom<'guest' | 'user'>('guest');
      export function App() {
        const [phase, setPhase] = useState<'idle' | 'done'>('idle');
        const setAuth = useSetAtom(authAtom);
        const { mutate } = useSWR<'empty' | 'full'>('/api/todos', fetcher);
        return <button onClick={() => {
          setPhase('done');
          setAuth('user');
          mutate('full');
        }}>Apply</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    const userTransitionIds = result.model.transitions
      .filter((transition) => transition.cls === "user")
      .map((transition) => transition.id);
    expect(userTransitionIds).toEqual([
      "App.onClick.authAtom_phase_api_todos.seq",
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
    expect(click?.reads).toEqual(["atom:authAtom"]);
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
      "app/routes.ts",
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
              plan: { kind: "enum", values: ["none", "pro", "starter"] },
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

  it("snapshots async continuation reads instead of stale-read warnings", async () => {
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
    const success = model.transitions.find((transition) =>
      transition.id.endsWith(".success"),
    );
    expect(report.staleReads).toEqual([]);
    expect(success?.effect).toMatchObject({
      kind: "seq",
      effects: expect.arrayContaining([
        {
          kind: "assign",
          var: "local:App.saveStatus",
          expr: { kind: "readOpArg", key: "snap:local:App.saveStatus" },
        },
      ]),
    });
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
      // biome-ignore lint/suspicious/noTemplateCurlyInString: extracted template-literal route token
      values: ["/", "/i/:id", "/`/i/${id}`"],
    });
    expect(result.report.routeCoverage).toMatchObject({
      configured: 5,
      modeled: 2,
    });
    expect(
      result.report.routeCoverage?.routes.find(
        (entry) => entry.pattern === "/api/upload",
      ),
    ).toMatchObject({
      modeled: false,
      classification: "api",
    });
    expect(
      result.lines.some((line) => line.startsWith("routes configured=")),
    ).toBe(true);
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

  it("preserves aliased union fields inside useState record domains", async () => {
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
    const draft = result.model.vars.find(
      (decl) => decl.id === "local:EditLink.draft",
    );
    expect(draft?.domain).toEqual({
      kind: "record",
      fields: {
        visibility: { kind: "enum", values: ["private", "public"] },
        title: { kind: "tokens", count: 1 },
      },
    });
    expect((draft?.initial as { visibility: string }).visibility).toBe(
      "private",
    );
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

  it("preserves aliased union fields inside jotai atom record domains", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "state.ts");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { atom } from 'jotai';
      type Status = "open" | "closed";
      export const statusAtom = atom<{ status: Status }>({ status: "open" });
      export function App() {
        return null;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    const statusAtom = result.model.vars.find(
      (decl) => decl.id === "atom:statusAtom",
    );
    expect(statusAtom?.domain).toEqual({
      kind: "record",
      fields: {
        status: { kind: "enum", values: ["open", "closed"] },
      },
    });
  });

  it("loads navigation.initialRoute from modality config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const configPath = join(dir, "modality.config.ts");
    const modelPath = join(dir, "model.json");
    await writeFile(
      configPath,
      `export default { navigation: { initialRoute: "/fallback" } };`,
      "utf8",
    );
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

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      configPath,
    });
    expect(
      result.model.vars.find((decl) => decl.id === "sys:route")?.initial,
    ).toBe("/fallback");
    expect(
      result.model.vars.find((decl) => decl.id === "local:App.flag")?.scope,
    ).toEqual({ kind: "route-local", route: "/fallback" });
  });

  it("loads navigation.routeBySource from modality config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    const routesPath = join(dir, "app", "routes.ts");
    const sourcePath = join(dir, "app", "routes", "analytics.tsx");
    const configPath = join(dir, "modality.config.ts");
    const modelPath = join(dir, "model.json");
    await writeFile(
      routesPath,
      `
      import { index, route } from "@react-router/dev/routes";
      export default [
        index("routes/home.tsx"),
        route("analytics", "routes/analytics.tsx"),
      ];
      `,
      "utf8",
    );
    await writeFile(
      configPath,
      `export default {
        navigation: {
          routeBySource: {
            "app/routes/analytics.tsx": "/custom-analytics",
          },
        },
      };`,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function Analytics() {
        const [viewed, setViewed] = useState(false);
        return <button onClick={() => setViewed(true)}>View</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      configPath,
    });
    expect(
      result.model.vars.find((decl) => decl.id === "sys:route")?.initial,
    ).toBe("/custom-analytics");
    expect(
      result.model.vars.find((decl) => decl.id === "local:Analytics.viewed")
        ?.scope,
    ).toEqual({ kind: "route-local", route: "/custom-analytics" });
  });

  it("scopes route-local state to each route source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-route-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    const routesPath = join(dir, "app", "routes.ts");
    await writeFile(
      routesPath,
      `
      import { index, route } from "@react-router/dev/routes";
      export default [
        index("routes/home.tsx"),
        route("analytics", "routes/analytics.tsx"),
        route("tags", "routes/tags.tsx"),
        route("links/:id", "routes/links.$id.tsx"),
      ];
      `,
      "utf8",
    );
    const cases = [
      {
        file: "home.tsx",
        component: "Home",
        stateVar: "count",
        route: "/",
      },
      {
        file: "analytics.tsx",
        component: "Analytics",
        stateVar: "viewed",
        route: "/analytics",
      },
      {
        file: "tags.tsx",
        component: "Tags",
        stateVar: "query",
        route: "/tags",
      },
      {
        file: "links.$id.tsx",
        component: "LinkDetail",
        stateVar: "copied",
        route: "/links/:id",
      },
    ] as const;
    for (const testCase of cases) {
      const sourcePath = join(dir, "app", "routes", testCase.file);
      const setter =
        testCase.stateVar[0]?.toUpperCase() + testCase.stateVar.slice(1);
      await writeFile(
        sourcePath,
        `
        import { useState } from 'react';
        export function ${testCase.component}() {
          const [${testCase.stateVar}, set${setter}] = useState(false);
          return <button onClick={() => set${setter}(true)}>Set</button>;
        }
        `,
        "utf8",
      );
      const modelPath = join(dir, `${testCase.file}.model.json`);
      const result = await runExtractCommand({ sourcePath, modelPath });
      expect(
        result.model.vars.find((decl) => decl.id === "sys:route")?.initial,
        testCase.file,
      ).toBe(testCase.route);
      expect(
        result.model.vars.find(
          (decl) =>
            decl.id === `local:${testCase.component}.${testCase.stateVar}`,
        )?.scope,
        testCase.file,
      ).toEqual({ kind: "route-local", route: testCase.route });
      expect(result.lines).toContain(`route=${testCase.route}`);
    }
  });

  it("requires navigation.initialRoute for multi-source extraction across routes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-route-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    const routesPath = join(dir, "app", "routes.ts");
    const analyticsPath = join(dir, "app", "routes", "analytics.tsx");
    const tagsPath = join(dir, "app", "routes", "tags.tsx");
    await writeFile(
      routesPath,
      `
      import { route } from "@react-router/dev/routes";
      export default [
        route("analytics", "routes/analytics.tsx"),
        route("tags", "routes/tags.tsx"),
      ];
      `,
      "utf8",
    );
    for (const [file, component] of [
      ["analytics.tsx", "Analytics"],
      ["tags.tsx", "Tags"],
    ] as const) {
      await writeFile(
        join(dir, "app", "routes", file),
        `
        import { useState } from 'react';
        export function ${component}() {
          const [flag, setFlag] = useState(false);
          return <button onClick={() => setFlag(true)}>Set</button>;
        }
        `,
        "utf8",
      );
    }

    await expect(
      runExtractCommand({
        sourcePaths: [analyticsPath, tagsPath],
        modelPath: join(dir, "model.json"),
      }),
    ).rejects.toThrow(/navigation\.initialRoute/);
  });

  it("models React Router route action Form submits with intent args", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-router-form-action-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    await mkdir(join(dir, "app", "components"), { recursive: true });
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
      `import { route } from '@react-router/dev/routes';
export default [route('/drip', 'routes/drip.tsx')];`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "drip.tsx"),
      `
      import { Form } from 'react-router';
      export async function action() {
        return { ok: true };
      }
      export default function DripRoute() {
        return (
          <Form method="post">
            <input type="hidden" name="intent" value="brew-start" />
            <button type="submit">Start</button>
          </Form>
        );
      }
      `,
      "utf8",
    );
    const result = await runExtractCommand({
      sourcePath: join(dir, "app", "routes", "drip.tsx"),
      modelPath,
      reportPath,
    });
    const pendingOps =
      result.model.vars.find((decl) => decl.id === "sys:pending")?.domain
        .kind === "boundedList"
        ? (
            result.model.vars.find((decl) => decl.id === "sys:pending")?.domain
              .inner as {
              fields: {
                opId: { values: string[] };
                args: { fields: Record<string, unknown> };
              };
            }
          ).fields
        : undefined;
    expect(result.report.effectOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ opId: "ACTION /drip", origin: "source" }),
      ]),
    );
    expect(pendingOps?.opId.values).toContain("ACTION /drip");
    const pendingVar = result.model.vars.find(
      (decl) => decl.id === "sys:pending",
    );
    const argsFields =
      pendingVar?.domain.kind === "boundedList"
        ? (
            pendingVar.domain.inner as {
              fields: {
                args: { fields: Record<string, { values?: string[] }> };
              };
            }
          ).fields.args.fields
        : {};
    expect(argsFields.intent?.values).toContain("brew-start");
  });

  it("models customer-like useSubmit and useActionData flows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-router-customer-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    const modelPath = join(dir, "model.json");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18.0.0", "react-router": "^7.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: "." } }),
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes.ts"),
      `import { route } from '@react-router/dev/routes';
export default [route('/customer', 'routes/customer.tsx')];`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "customer.tsx"),
      `
      import { useActionData, useSubmit } from 'react-router';
      import { useEffect, useState } from 'react';
      export async function action() {
        return { ok: true, orderNumber: '42' };
      }
      export default function CustomerHome() {
        const submit = useSubmit();
        const actionData = useActionData();
        const [phase, setPhase] = useState<'confirm' | 'complete'>('confirm');
        useEffect(() => {
          if (actionData) setPhase('complete');
        }, [actionData]);
        const handlePrintSubmit = (e) => {
          e.preventDefault();
          submit(e.currentTarget);
        };
        return <form method="post" onSubmit={handlePrintSubmit} />;
      }
      `,
      "utf8",
    );
    const result = await runExtractCommand({
      sourcePath: join(dir, "app", "routes", "customer.tsx"),
      modelPath,
    });
    const ids = result.model.transitions.map((transition) => transition.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /CustomerHome\.onSubmit\.ACTION \/customer\.start/,
        ),
        expect.stringMatching(
          /CustomerHome\.onSubmit\.ACTION \/customer\.success/,
        ),
        expect.stringMatching(
          /CustomerHome\.onSubmit\.ACTION \/customer\.error/,
        ),
      ]),
    );
    const actionDataVar = result.model.vars.find((decl) =>
      decl.id.startsWith("router:actionData:"),
    );
    expect(actionDataVar?.initial).toBe("none");
    const success = result.model.transitions.find((transition) =>
      transition.id.includes("ACTION /customer.success"),
    );
    expect(success?.writes).toContain(actionDataVar?.id);
    expect(
      result.model.transitions.some(
        (transition) =>
          transition.cls === "internal" &&
          transition.writes.includes("local:CustomerHome.phase"),
      ),
    ).toBe(true);
  });

  it("models useSubmit route action on the matched route in multi-route apps", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "modality-router-multi-customer-"),
    );
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    const modelPath = join(dir, "model.json");
    const configPath = join(dir, "modality.config.ts");
    const homePath = join(dir, "app", "routes", "home.tsx");
    const customerPath = join(dir, "app", "routes", "customer.tsx");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18.0.0", "react-router": "^7.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: "." } }),
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes.ts"),
      `import { index, route } from '@react-router/dev/routes';
export default [
  index('routes/home.tsx'),
  route('/customer', 'routes/customer.tsx'),
];`,
      "utf8",
    );
    await writeFile(
      configPath,
      `export default { navigation: { initialRoute: "/" } };`,
      "utf8",
    );
    await writeFile(
      homePath,
      `
      export default function Home() {
        return <div>Home</div>;
      }
      `,
      "utf8",
    );
    await writeFile(
      customerPath,
      `
      import { useSubmit } from 'react-router';
      export async function action() {
        return { ok: true };
      }
      export default function Customer() {
        const submit = useSubmit();
        const onSubmit = (e) => {
          e.preventDefault();
          submit(e.currentTarget);
        };
        return <form onSubmit={onSubmit} />;
      }
      `,
      "utf8",
    );
    const result = await runExtractCommand({
      sourcePaths: [homePath, customerPath],
      modelPath,
      configPath,
    });
    const pendingVar = result.model.vars.find(
      (decl) => decl.id === "sys:pending",
    );
    const pendingOps =
      pendingVar?.domain.kind === "boundedList"
        ? (
            pendingVar.domain.inner as {
              fields: { opId: { values: string[] } };
            }
          ).fields.opId.values
        : [];
    expect(pendingOps).toContain("ACTION /customer");
    const customerActionIds = result.model.transitions
      .map((transition) => transition.id)
      .filter(
        (id) =>
          id.startsWith("Customer.onSubmit.ACTION") && id.includes("/customer"),
      );
    expect(customerActionIds).toEqual(
      expect.arrayContaining([
        "Customer.onSubmit.ACTION /customer.start",
        "Customer.onSubmit.ACTION /customer.success",
        "Customer.onSubmit.ACTION /customer.error",
      ]),
    );
    expect(
      result.model.transitions.some(
        (transition) =>
          transition.id.startsWith("Customer.onSubmit.ACTION /.") ||
          transition.id === "Customer.onSubmit.ACTION /.start" ||
          transition.id === "Customer.onSubmit.ACTION /.success" ||
          transition.id === "Customer.onSubmit.ACTION /.error",
      ),
    ).toBe(false);
  });

  it("keeps server helper fetches out of client pending ops for route actions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-router-action-helper-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    await mkdir(join(dir, "app", "lib"), { recursive: true });
    const modelPath = join(dir, "model.json");
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
      `import { route } from '@react-router/dev/routes';
export default [route('/items', 'routes/items.tsx')];`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "lib", "server-action.ts"),
      `
      export async function serverHelper() {
        await fetch('https://example.com/server');
      }
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "items.tsx"),
      `
      import { Form } from 'react-router';
      import { serverHelper } from '~/lib/server-action';
      export async function action() {
        await serverHelper();
        return { ok: true };
      }
      export default function ItemsRoute() {
        return (
          <Form method="post">
            <button type="submit">Save</button>
          </Form>
        );
      }
      `,
      "utf8",
    );
    const result = await runExtractCommand({
      sourcePath: join(dir, "app", "routes", "items.tsx"),
      modelPath,
    });
    const pendingOps =
      result.model.vars.find((decl) => decl.id === "sys:pending")?.domain
        .kind === "boundedList"
        ? (
            result.model.vars.find((decl) => decl.id === "sys:pending")?.domain
              .inner as { fields: { opId: { values: string[] } } }
          ).fields.opId.values
        : [];
    expect(pendingOps).toContain("ACTION /items");
    expect(pendingOps).not.toContain("GET https://example.com/server");
    expect(pendingOps).not.toContain("POST https://example.com/server");
  });

  it("extracts enum domains from imported useState type aliases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-semantic-"));
    const typesPath = join(dir, "types.ts");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: {
          react: "^18.0.0",
          jotai: "^2.0.0",
          zustand: "^4.0.0",
          swr: "^2.0.0",
        },
      }),
      "utf8",
    );
    await writeFile(
      typesPath,
      `export type Status = "idle" | "posting" | "failed";
export type User = { id: string; role: "admin" | "user" };
export type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; user: User };
`,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { useState } from "react";
import type { Status, LoadState } from "./types.js";
export function App() {
  const [saveStatus, setSaveStatus] = useState<Status>("idle");
  const [loadState] = useState<LoadState>({ kind: "idle" });
  return (
    <button onClick={() => setSaveStatus("posting")}>Save</button>
  );
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "local:App.saveStatus")?.domain,
    ).toEqual({
      kind: "enum",
      values: ["failed", "idle", "posting"],
    });
    expect(
      model.vars.find((decl) => decl.id === "local:App.loadState")?.domain,
    ).toMatchObject({
      kind: "tagged",
      tag: "kind",
    });
  });

  it("keeps broad imported string and number as token domains", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-semantic-"));
    const typesPath = join(dir, "types.ts");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({ dependencies: { react: "^18.0.0" } }),
      "utf8",
    );
    await writeFile(
      typesPath,
      `export type Label = string;
export type Count = number;
`,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { useState } from "react";
import type { Label, Count } from "./types.js";
export function App() {
  const [label] = useState<Label>("idle");
  const [count] = useState<Count>(0);
  return null;
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "local:App.label")?.domain,
    ).toEqual({ kind: "tokens", count: 1 });
    expect(
      model.vars.find((decl) => decl.id === "local:App.count")?.domain,
    ).toEqual({ kind: "tokens", count: 1 });
  });

  it("preserves imported enum domains in multi-file extraction regardless of file order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-multifile-"));
    const typesPath = join(dir, "types.ts");
    const alphaPath = join(dir, "Alpha.tsx");
    const betaPath = join(dir, "Beta.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({ dependencies: { react: "^18.0.0" } }),
      "utf8",
    );
    await writeFile(
      typesPath,
      `export type Status = "idle" | "done";\n`,
      "utf8",
    );
    await writeFile(
      alphaPath,
      `import { useState } from "react";
export function Alpha() {
  const [flag] = useState(false);
  return null;
}
`,
      "utf8",
    );
    await writeFile(
      betaPath,
      `import { useState } from "react";
import type { Status } from "./types.js";
export function Beta() {
  const [status] = useState<Status>("idle");
  return null;
}
`,
      "utf8",
    );

    await runExtractCommand({
      sourcePaths: [alphaPath, betaPath],
      modelPath,
      packageJsonPath,
    });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "local:Beta.status")?.domain,
    ).toEqual({
      kind: "enum",
      values: ["done", "idle"],
    });
    expect(
      model.vars.find((decl) => decl.id === "local:Alpha.flag")?.domain,
    ).toEqual({ kind: "bool" });
  });

  it("extracts Jotai atom domains from imported type aliases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-semantic-"));
    const typesPath = join(dir, "types.ts");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: { react: "^18.0.0", jotai: "^2.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      typesPath,
      `export type Status = "idle" | "posting" | "failed";`,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { atom, useAtom } from "jotai";
import type { Status } from "./types.js";
export const statusAtom = atom<Status>("idle");
export function App() {
  const [status, setStatus] = useAtom(statusAtom);
  return <button onClick={() => setStatus("posting")}>Save</button>;
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "atom:statusAtom")?.domain,
    ).toEqual({
      kind: "enum",
      values: ["failed", "idle", "posting"],
    });
  });

  it("extracts Zustand store field domains from imported interfaces", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-semantic-"));
    const typesPath = join(dir, "types.ts");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: { react: "^18.0.0", zustand: "^4.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      typesPath,
      `export interface User {
  role: "admin" | "user";
  active: boolean;
}`,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { create } from "zustand";
import type { User } from "./types.js";
type StoreState = { user: User };
export const useStore = create<{ user: User }>(() => ({
  user: { role: "admin", active: true },
}));
export function App() {
  const user = useStore((state) => state.user);
  return <span>{user.role}</span>;
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "zustand:useStore.user")?.domain,
    ).toEqual({
      kind: "record",
      fields: {
        role: { kind: "enum", values: ["admin", "user"] },
        active: { kind: "bool" },
      },
    });
  });

  it("extracts SWR payload domains from imported type aliases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-semantic-"));
    const typesPath = join(dir, "types.ts");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: { react: "^18.0.0", swr: "^2.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      typesPath,
      `export type User = { id: string; role: "admin" | "user" };`,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import useSWR from "swr";
import type { User } from "./types.js";
export function App() {
  const { data } = useSWR<User>("/api/user");
  return <span>{data?.role}</span>;
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "swr:api_user:data")?.domain,
    ).toMatchObject({
      inner: {
        kind: "record",
        fields: {
          id: { kind: "tokens", count: 1 },
          role: { kind: "enum", values: ["admin", "user"] },
        },
      },
    });
  });

  it("extracts Zod inferred non-numerical domains from imported types", async () => {
    const dir = await mkSchemaExtractTemp("modality-extract-zod-");
    const schemaPath = join(dir, "schema.ts");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: { react: "^18.0.0", zod: "^4.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      schemaPath,
      `import { z } from "zod";
export const StateSchema = z.object({
  status: z.enum(["idle", "posting", "failed"]),
  flag: z.boolean(),
  label: z.string().optional(),
});
export type State = z.infer<typeof StateSchema>;
`,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { useState } from "react";
import type { State } from "./schema.js";
export function App() {
  const [state, setState] = useState<State>({
    status: "idle",
    flag: false,
  });
  return (
    <button onClick={() => setState({ status: "posting", flag: false })}>
      Post
    </button>
  );
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "local:App.state")?.domain,
    ).toEqual({
      kind: "record",
      fields: {
        status: { kind: "enum", values: ["failed", "idle", "posting"] },
        flag: { kind: "bool" },
        label: { kind: "option", inner: { kind: "tokens", count: 1 } },
      },
    });
  });

  it("extracts ArkType inferred non-numerical domains from imported types", async () => {
    const dir = await mkSchemaExtractTemp("modality-extract-arktype-");
    const schemaPath = join(dir, "schema.ts");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: { react: "^18.0.0", arktype: "^2.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      schemaPath,
      `import { type } from "arktype";
export const StateSchema = type({
  status: "'idle'|'posting'|'failed'",
  flag: "boolean",
  "label?": "string",
});
export type State = typeof StateSchema.infer;
`,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { useState } from "react";
import type { State } from "./schema.js";
export function App() {
  const [state, setState] = useState<State>({
    status: "idle",
    flag: false,
  });
  return (
    <button onClick={() => setState({ status: "posting", flag: false })}>
      Post
    </button>
  );
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "local:App.state")?.domain,
    ).toEqual({
      kind: "record",
      fields: {
        status: { kind: "enum", values: ["failed", "idle", "posting"] },
        flag: { kind: "bool" },
        label: { kind: "option", inner: { kind: "tokens", count: 1 } },
      },
    });
  });

  it("keeps Zod inferred broad string as token domains", async () => {
    const dir = await mkSchemaExtractTemp("modality-extract-zod-broad-");
    const schemaPath = join(dir, "schema.ts");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: { react: "^18.0.0", zod: "^4.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      schemaPath,
      `import { z } from "zod";
export const LabelSchema = z.string();
export type Label = z.infer<typeof LabelSchema>;
`,
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { useState } from "react";
import type { Label } from "./schema.js";
export function App() {
  const [label] = useState<Label>("idle");
  return null;
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "local:App.label")?.domain,
    ).toEqual({ kind: "tokens", count: 1 });
  });

  it("refines Zod numeric schema initializers through registry providers", async () => {
    const dir = await mkSchemaExtractTemp("modality-extract-zod-numeric-");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: { react: "^18.0.0", zod: "^4.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { useState } from "react";
import { z } from "zod";
export function App() {
  const [n] = useState(z.number().int().min(0).max(3));
  return null;
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "local:App.n")?.domain,
    ).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
    expect(model.metadata?.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "zod", kind: "domain-refinement" }),
      ]),
    );
  });

  it("refines Zod exclusive-bound alias chains through registry providers", async () => {
    const dir = await mkSchemaExtractTemp("modality-extract-zod-gt-lte-");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: { react: "^18.0.0", zod: "^4.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { useState } from "react";
import { z } from "zod";
export function App() {
  const [n] = useState(z.number().int().gt(0).lte(3));
  return null;
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "local:App.n")?.domain,
    ).toEqual({
      kind: "boundedInt",
      min: 1,
      max: 3,
      overflow: "forbid",
    });
    expect(model.metadata?.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "zod", kind: "domain-refinement" }),
      ]),
    );
  });

  it("refines ArkType numeric schema initializers through registry providers", async () => {
    const dir = await mkSchemaExtractTemp("modality-extract-arktype-numeric-");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: { react: "^18.0.0", arktype: "^2.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { useState } from "react";
import { type } from "arktype";
export function App() {
  const [n] = useState(type("0 <= number.integer <= 3"));
  return null;
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "local:App.n")?.domain,
    ).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
  });

  it("refines ArkType string literal unions through registry providers", async () => {
    const dir = await mkSchemaExtractTemp("modality-extract-arktype-literals-");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: { react: "^18.0.0", arktype: "^2.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { useState } from "react";
import { type } from "arktype";
export function App() {
  const [label] = useState(type("'idle' | 'posting'"));
  return null;
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "local:App.label")?.domain,
    ).toEqual({
      kind: "enum",
      values: ["idle", "posting"],
    });
  });

  it("refines ArkType bounded divisor schemas through registry providers", async () => {
    const dir = await mkSchemaExtractTemp("modality-extract-arktype-divisor-");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: { react: "^18.0.0", arktype: "^2.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { useState } from "react";
import { type } from "arktype";
export function App() {
  const [n] = useState(type("-5 <= (number.integer % 2) <= 5"));
  return null;
}
`,
      "utf8",
    );

    await runExtractCommand({ sourcePath, modelPath, packageJsonPath });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "local:App.n")?.domain,
    ).toEqual({
      kind: "intSet",
      values: [-4, -2, 0, 2, 4],
      overflow: "forbid",
    });
  });

  it("disabling zod removes initializer-chain refinement while typed extraction still works", async () => {
    const dir = await mkSchemaExtractTemp("modality-extract-zod-disabled-");
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    const configPath = join(dir, "modality.config.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        dependencies: { react: "^18.0.0", zod: "^4.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      configPath,
      JSON.stringify({ disabledPlugins: ["zod"] }),
      "utf8",
    );
    await writeFile(
      sourcePath,
      `import { useState } from "react";
export function App() {
  const [typed] = useState<0 | 1 | 2 | 3>(0);
  const [untyped] = useState(z.number().int().min(0).max(3));
  return null;
}
`,
      "utf8",
    );

    await runExtractCommand({
      sourcePath,
      modelPath,
      packageJsonPath,
      configPath,
    });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.find((decl) => decl.id === "local:App.untyped")?.domain,
    ).toEqual({ kind: "tokens", count: 1 });
    expect(
      model.vars.find((decl) => decl.id === "local:App.typed")?.domain,
    ).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
    });
    expect(model.metadata?.plugins).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "zod", kind: "domain-refinement" }),
      ]),
    );
  });
});

describe("renderHumanExtractTargets", () => {
  it("prints aggregated extract rows before duration and artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
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
    const lines = renderHumanExtractTargets(
      [
        {
          label: "App.tsx",
          durationMs: 12,
          varCount: result.varCount,
          transitionCount: result.transitionCount,
          report: result.report,
          pluginLabels: result.pluginLabels,
          artifacts: result.artifacts,
        },
      ],
      { totalDurationMs: 12 },
    );
    expect(lines[0]).toMatch(/^ ✓ App\.tsx /);
    expect(lines.join("\n")).not.toContain("extracted vars=");
    expect(lines.join("\n")).toContain("Duration");
    expect(lines.join("\n")).toContain("(model)");
  });

  it("excludes React Router server-only imports from client pending ops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-router-server-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    await mkdir(join(dir, "app", "services"), { recursive: true });
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
        compilerOptions: {
          baseUrl: ".",
          paths: { "~/*": ["./app/*"] },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes.ts"),
      `import { route } from '@react-router/dev/routes';
export default [route('/ingest/:sessionId', 'routes/ingest.$sessionId.tsx')];`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "services", "ingest.server.ts"),
      `
      export async function fetchGoogleToken() {
        const res = await fetch('https://oauth.googleapis.com/token', { method: 'POST' });
        return res.json();
      }
      export async function fetchJinaEmbedding() {
        return fetch('https://api.jina.ai/v1/embeddings', { method: 'POST' });
      }
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "ingest.$sessionId.tsx"),
      `
      import { fetchGoogleToken, fetchJinaEmbedding } from '~/services/ingest.server';
      export async function loader() {
        await fetchGoogleToken();
        await fetchJinaEmbedding();
        return null;
      }
      export default function IngestSession() {
        const submit = async () => {
          await fetch('/api/ingest/client', { method: 'POST' });
        };
        return <button onClick={submit}>Submit</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath: join(dir, "app", "routes", "ingest.$sessionId.tsx"),
      modelPath,
      reportPath,
    });
    const pendingOps =
      result.model.vars.find((decl) => decl.id === "sys:pending")?.domain
        .kind === "boundedList"
        ? (
            result.model.vars.find((decl) => decl.id === "sys:pending")?.domain
              .inner as { fields: { opId: { values: string[] } } }
          ).fields.opId.values
        : [];
    expect(pendingOps).toContain("POST /api/ingest/client");
    expect(pendingOps).not.toContain("POST https://oauth.googleapis.com/token");
    expect(pendingOps).not.toContain("POST https://api.jina.ai/v1/embeddings");
    expect(
      result.report.sourceFiles.some((file) =>
        file.includes("ingest.server.ts"),
      ),
    ).toBe(false);
    expect(result.report.effectOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          opId: "POST /api/ingest/client",
          origin: "source",
        }),
      ]),
    );
  });

  it("models only client-reachable code from mixed server/client helper modules", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-mixed-helper-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    await mkdir(join(dir, "app", "lib"), { recursive: true });
    const modelPath = join(dir, "model.json");
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
        compilerOptions: {
          baseUrl: ".",
          paths: { "~/*": ["./app/*"] },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes.ts"),
      `import { route } from '@react-router/dev/routes';
export default [route('/items', 'routes/items.tsx')];`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "lib", "helpers.ts"),
      `
      export function ClientButton(props: { onClick: () => void }) {
        return <button onClick={props.onClick}>Go</button>;
      }
      export async function serverSubmit() {
        await fetch('https://example.com/server-submit', { method: 'POST' });
      }
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "items.tsx"),
      `
      import { useState } from 'react';
      import { ClientButton, serverSubmit } from '~/lib/helpers';
      export async function action() {
        await serverSubmit();
        return null;
      }
      export default function ItemsRoute() {
        const [busy, setBusy] = useState(false);
        const onClick = async () => {
          setBusy(true);
          try {
            await fetch('/api/items', { method: 'POST' });
          } finally {
            setBusy(false);
          }
        };
        return <ClientButton onClick={onClick} disabled={busy} />;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath: join(dir, "app", "routes", "items.tsx"),
      modelPath,
    });
    const pendingOps =
      result.model.vars.find((decl) => decl.id === "sys:pending")?.domain
        .kind === "boundedList"
        ? (
            result.model.vars.find((decl) => decl.id === "sys:pending")?.domain
              .inner as { fields: { opId: { values: string[] } } }
          ).fields.opId.values
        : [];
    expect(pendingOps).toContain("POST /api/items");
    expect(pendingOps).not.toContain("POST https://example.com/server-submit");
    expect(
      result.model.transitions.some((transition) =>
        transition.id.includes("onClick"),
      ),
    ).toBe(true);
  });

  it("keeps type-only imports for domain inference without server fetch ops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-type-only-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    await mkdir(join(dir, "app", "lib"), { recursive: true });
    const modelPath = join(dir, "model.json");
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
        compilerOptions: {
          baseUrl: ".",
          paths: { "~/*": ["./app/*"] },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes.ts"),
      `import { route } from '@react-router/dev/routes';
export default [route('/phase', 'routes/phase.tsx')];`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "lib", "phase.ts"),
      `
      export type Phase = 'alpha' | 'beta';
      export async function serverHelper() {
        await fetch('https://example.com/server');
      }
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "phase.tsx"),
      `
      import { useState } from 'react';
      import type { Phase } from '~/lib/phase';
      export default function PhaseRoute() {
        const [phase, setPhase] = useState<Phase>('alpha');
        return <button onClick={() => setPhase('beta')}>Next</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath: join(dir, "app", "routes", "phase.tsx"),
      modelPath,
    });
    expect(
      result.model.vars.find((decl) => decl.id === "local:PhaseRoute.phase")
        ?.domain,
    ).toEqual({ kind: "enum", values: ["alpha", "beta"] });
    const pendingOps =
      result.model.vars.find((decl) => decl.id === "sys:pending")?.domain
        .kind === "boundedList"
        ? (
            result.model.vars.find((decl) => decl.id === "sys:pending")?.domain
              .inner as { fields: { opId: { values: string[] } } }
          ).fields.opId.values
        : [];
    expect(pendingOps).not.toContain("GET https://example.com/server");
  });

  it("extracts anonymous default route components", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-anon-default-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    const modelPath = join(dir, "model.json");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18.0.0", "react-router": "^7.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes.ts"),
      `import { route } from '@react-router/dev/routes';
export default [route('/open', 'routes/open.tsx')];`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "open.tsx"),
      `
      import { useState } from 'react';
      export default function() {
        const [open, setOpen] = useState(false);
        return <button onClick={() => setOpen(true)}>Open</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath: join(dir, "app", "routes", "open.tsx"),
      modelPath,
    });
    expect(
      result.model.vars.find((decl) => decl.id === "local:Anonymous.open"),
    ).toBeTruthy();
    expect(result.model.transitions.map((transition) => transition.id)).toEqual(
      expect.arrayContaining(["Anonymous.onClick.open"]),
    );
    expect(result.report.warnings).not.toContain(
      "No render surface found for requested extraction entries",
    );
  });

  it("follows barrel re-exports to client components", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-barrel-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    await mkdir(join(dir, "app", "components"), { recursive: true });
    const modelPath = join(dir, "model.json");
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
        compilerOptions: {
          baseUrl: ".",
          paths: { "~/*": ["./app/*"] },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes.ts"),
      `import { route } from '@react-router/dev/routes';
export default [route('/', 'routes/home.tsx')];`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "components", "Child.tsx"),
      `
      import { useState } from 'react';
      export function Child() {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(1)}>Count</button>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "components", "index.ts"),
      `export { Child } from "./Child";`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "home.tsx"),
      `
      import { Child } from '~/components';
      export default function Home() {
        return <Child />;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath: join(dir, "app", "routes", "home.tsx"),
      modelPath,
    });
    expect(result.model.transitions.map((transition) => transition.id)).toEqual(
      expect.arrayContaining(["Child.onClick.count"]),
    );
  });

  it("preserves source anchor line numbers in pruned interaction text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-anchors-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';

      export function Login() {
        const [busy, setBusy] = useState(false);
        return <button onClick={() => setBusy(true)}>Login</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(
      result.model.vars.find((decl) => decl.id === "local:Login.busy")?.origin,
    ).toEqual({
      file: sourcePath,
      line: 5,
      column: 15,
    });
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
