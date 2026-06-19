import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkModel } from "modality-ts/check";
import { reachable } from "../../../../test/helpers/property-builders.js";
import {
  eq,
  lit,
  parseModelArtifact,
  parsePropertySliceManifestArtifact,
  readVar,
  validateModel,
  type Model,
} from "modality-ts/core";
import { runExtractCommand } from "./index.js";
import {
  sliceManifestPathForModel,
  sliceModelPathForProperty,
} from "../../defaults.js";
import { createBuiltinModalityRegistry } from "../../registry/index.js";

describe("runExtractCommand", () => {
  it("wires module-role and effect API providers from registry adapters", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { next: "^15.0.0" },
    });
    expect(
      registry.adapters.moduleRoles.map((adapter) => adapter.kind),
    ).toEqual(["module-roles"]);
    expect(
      registry.adapters.effectApis.map((provider) => provider.kind),
    ).toEqual(["effect-api"]);
    expect(
      registry.adapters.cacheStorage.map((provider) => provider.kind),
    ).toEqual(["cache-storage"]);
  });

  it("merges Next cache/storage provider fragments into extracted model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-cache-"));
    const sourcePath = join(dir, "actions.ts");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({ dependencies: { next: "^15.0.0" } }),
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
        "use server";
        import { updateTag } from "next/cache";
        export async function save() {
          updateTag("posts");
        }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      packageJsonPath,
    });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.some((decl) => decl.id === "sys:next:cache:tag:posts"),
    ).toBe(true);
    expect(
      model.transitions.some((transition) =>
        transition.id.includes("updateTag"),
      ),
    ).toBe(true);
    expect(
      model.metadata?.plugins?.some(
        (plugin) =>
          plugin.kind === "cache-storage" && plugin.id === "next-cache-storage",
      ),
    ).toBe(true);
    expect(
      result.pluginLabels.some((label) => label.includes("cache-storage")),
    ).toBe(true);
  });

  it("omits cache vars when Next cache/storage provider is not registered", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-cache-"));
    const sourcePath = join(dir, "actions.ts");
    const modelPath = join(dir, "model.json");
    const packageJsonPath = join(dir, "package.json");
    await writeFile(
      packageJsonPath,
      JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      "utf8",
    );
    await writeFile(
      sourcePath,
      `
        "use server";
        import { updateTag } from "next/cache";
        export async function save() {
          updateTag("posts");
        }
      `,
      "utf8",
    );

    await runExtractCommand({
      sourcePath,
      modelPath,
      packageJsonPath,
    });
    const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
    expect(
      model.vars.some((decl) => decl.id.startsWith("sys:next:cache:")),
    ).toBe(false);
  });

  it("reads commented tsconfig.json files when resolving paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-tsconfig-jsonc-"));
    await mkdir(join(dir, "src", "ui"), { recursive: true });
    const sourcePath = join(dir, "src", "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      join(dir, "tsconfig.json"),
      `{
          "compilerOptions": {
            /* Path aliases are common in Next-generated TSConfig files. */
            "baseUrl": ".",
            "paths": {
              "~/*": ["./src/*"]
            }
          }
        }`,
      "utf8",
    );
    await writeFile(
      join(dir, "src", "ui", "Button.tsx"),
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
        import { Button } from '~/ui/Button';

        export function App() {
          const [status, setStatus] = useState<'idle' | 'saved'>('idle');
          return <Button onClick={() => setStatus('saved')} />;
        }
        `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });

    expect(result.model.transitions.map((transition) => transition.id)).toEqual(
      ["App.onClick.status"],
    );
    expect(result.report.diagnostics?.pipeline?.discoveryFragments).toBe(2);
    expect(result.report.diagnostics?.surface?.rawEntries).toBe(1);
    expect(result.report.diagnostics?.surface?.interactionSources).toBe(2);
  }, 15_000);

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
      effect: expect.objectContaining({ kind: "if" }),
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
        kind: "assign",
        var: "sys:route",
        expr: { kind: "lit", value: "/links" },
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
      if (transition.cls !== "nav") continue;
      const assignsRoute = (
        effect: typeof transition.effect,
      ): string | undefined => {
        if (effect.kind === "assign" && effect.var === "sys:route") {
          return effect.expr.kind === "lit" &&
            typeof effect.expr.value === "string"
            ? effect.expr.value
            : undefined;
        }
        if (effect.kind === "seq") {
          for (const child of effect.effects) {
            const route = assignsRoute(child);
            if (route) return route;
          }
        }
        if (effect.kind === "if") {
          return assignsRoute(effect.then) ?? assignsRoute(effect.else);
        }
        return undefined;
      };
      const pushedTo = assignsRoute(transition.effect);
      if (pushedTo) {
        expect(routeValues).toContain(pushedTo);
      }
    }
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
    expect(reactOnly.lines).toContain(
      "plugins=observation:use-state@0.1.0,state-source:use-state@0.1.0",
    );
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
      "plugins=observation:jotai@0.1.0,observation:use-state@0.1.0,state-source:jotai@0.1.0,state-source:use-state@0.1.0",
    );
    expect(withJotai.report.warnings).toEqual([]);
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
    expect(result.lines).toContain(
      "plugins=observation:use-state@0.1.0,state-source:use-state@0.1.0",
    );
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
    expect(result.report.assumptions).toContain("bound:maxPending=2");
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
      "plugins=effect-api:router-effect-api@0.1.0,module-roles:router-module-roles@0.1.0,navigation:router@0.1.0,observation:router-observation@0.1.0,observation:use-state@0.1.0,state-source:use-state@0.1.0",
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

  it("blocks empty-label form submit through required input guards", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [label, setLabel] = useState('');
        return (
          <form onSubmit={() => setLabel('saved')}>
            <input required value={label} onChange={(e) => setLabel(e.target.value)} />
            <button type="submit">Save</button>
          </form>
        );
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(result.model.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onSubmit.label",
        guard: {
          kind: "neq",
          args: [
            { kind: "readPre", var: "local:App.label" },
            { kind: "lit", value: "" },
          ],
        },
        reads: ["local:App.label"],
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
      reason: "global-taint:jotai:getDefaultStore",
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
    expect(report.warnings).toContain("global-taint:jotai:getDefaultStore");
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

  it("emits property slice artifacts when props paths are supplied", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-slices-"));
    const sourcePath = join(dir, "App.tsx");
    const propsPath = join(dir, "App.props.ts");
    const modelPath = join(dir, "App.model.json");
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
      import { always, eq } from "modality-ts/properties";
      import { flag } from "./vars/App";
      always("flagFalse", eq(flag, false));
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      propsPaths: [propsPath],
    });
    const manifestPath = sliceManifestPathForModel(modelPath);
    const manifest = parsePropertySliceManifestArtifact(
      await readFile(manifestPath, "utf8"),
    );
    expect(manifest.kind).toBe("property-slice-manifest");
    expect(
      manifest.properties.some((entry) => entry.status === "emitted"),
    ).toBe(true);
    const emitted = manifest.properties.find(
      (entry) => entry.status === "emitted",
    );
    expect(emitted?.status).toBe("emitted");
    if (emitted?.status === "emitted") {
      const slicePath = sliceModelPathForProperty(
        modelPath,
        emitted.property,
        emitted.propertyIndex,
        manifest.properties.map((entry) => ({
          name: entry.property,
          index: entry.propertyIndex,
        })),
      );
      expect(emitted.path).toBe(slicePath);
      parseModelArtifact(await readFile(slicePath, "utf8"));
    }
    expect(
      result.artifacts.some((entry) => entry.kind === "sliceManifest"),
    ).toBe(true);
    expect(result.artifacts).toContainEqual({
      kind: "componentVars",
      path: join(dir, "vars", "App.d.ts"),
    });
    expect(await readFile(join(dir, "vars", "App.d.ts"), "utf8")).toContain(
      '"local:App.flag"',
    );
    expect(result.artifacts.some((entry) => entry.kind === "sliceModel")).toBe(
      true,
    );
    expect(result.sliceStatsLine).toMatch(/^slices=properties:/);
    const propertySlices = result.report.diagnostics?.propertySlices;
    expect(propertySlices).toBeDefined();
    const emittedDiagnostic = propertySlices?.entries?.find(
      (entry) => entry.status === "emitted",
    );
    expect(emittedDiagnostic).toEqual(
      expect.objectContaining({
        fullVars: expect.any(Number),
        fullTransitions: expect.any(Number),
        topRetainedContributors: expect.any(Array),
        topPrunedContributors: expect.any(Array),
        elapsedMs: expect.any(Number),
      }),
    );
    expect(emittedDiagnostic?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(emittedDiagnostic?.elapsedMs)).toBe(true);
    expect(propertySlices?.totalElapsedMs).toBeGreaterThanOrEqual(0);
    const manifestText = await readFile(manifestPath, "utf8");
    expect(manifestText).not.toContain("elapsedMs");
    if (emitted?.status === "emitted") {
      expect(emitted.fullVars).toBe(result.model.vars.length);
      expect(emitted.fullTransitions).toBe(result.model.transitions.length);
      expect(emitted.topRetainedContributors).toEqual(expect.any(Array));
      expect(emitted.topPrunedContributors).toEqual(expect.any(Array));
    }
    expect(result.sliceEconomicsLine).toMatch(/^slice-economics=largest:/);
  });

  it("does not emit slice artifacts without props paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-no-slices-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "App.model.json");
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
    expect(result.artifacts.map((entry) => entry.kind)).toEqual([
      "model",
      "appModel",
      "componentVars",
    ]);
    expect(result.sliceStatsLine).toBeUndefined();
    expect(result.sliceEconomicsLine).toBeUndefined();
  });
});
