import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runExtractCommand } from "./index.js";
import { renderHumanExtractTargets } from "./output.js";

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

  it("renders slice artifacts and compact slice stats when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-slice-output-"));
    const sourcePath = join(dir, "App.tsx");
    const propsPath = join(dir, "App.props.ts");
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
    await writeFile(
      propsPath,
      `
      export const properties = [
        {
          kind: 'always',
          name: 'flagFalse',
          predicate: {
            kind: 'eq',
            args: [
              { kind: 'read', var: 'local:App.flag' },
              { kind: 'lit', value: false },
            ],
          },
        },
      ];
      `,
      "utf8",
    );
    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      propsPaths: [propsPath],
    });
    const lines = renderHumanExtractTargets(
      [
        {
          label: "App.tsx",
          durationMs: 12,
          varCount: result.varCount,
          transitionCount: result.transitionCount,
          report: result.report,
          pluginLabels: result.pluginLabels,
          sliceStatsLine: result.sliceStatsLine,
          artifacts: result.artifacts,
        },
      ],
      { totalDurationMs: 12 },
    );
    expect(lines.join("\n")).toContain("(sliceManifest)");
    expect(lines.join("\n")).toContain("(sliceModel)");
    expect(lines.join("\n")).toContain("slices=properties:");
  });

  it("omits compact slice stats when no slices are produced", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "modality-extract-no-slice-output-"),
    );
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
          sliceStatsLine: result.sliceStatsLine,
          artifacts: result.artifacts,
        },
      ],
      { totalDurationMs: 12 },
    );
    expect(lines.join("\n")).not.toContain("slices=properties:");
  });
});
