import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "modality-ts/core";
import { describe, expect, it } from "vitest";
import { routeMountScope } from "../../../extract/lang/ts/driver/routes.js";
import { runExtractCommand } from "./index.js";
import { navigatesTo } from "./test-helpers.js";

describe("runExtractCommand", () => {
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
        id: "App.onClick.Fill",
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
        id: "App.onClick.Loop.loop",
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
            expect.objectContaining({ kind: "if" }),
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
    expect(userTransitionIds).toEqual(["App.onClick.Apply"]);
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
      transition.writes.includes("atom:authAtom"),
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
        "TopBar.onClick.Theme",
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
        expect.objectContaining({ kind: "if" }),
      ]),
    });
  });

  it("narrows pending continuations to concrete enqueues when they exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [status, setStatus] = useState<'idle' | 'done'>('idle');
        return <button onClick={async () => {
          setStatus('done');
          await api.save();
        }}>Save</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      effectApis: ["api.save"],
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const pendingVar = result.model.vars.find(
      (decl) => decl.id === "sys:pending",
    );
    expect(pendingVar?.domain).toMatchObject({
      kind: "boundedList",
      inner: {
        kind: "record",
        fields: {
          opId: { kind: "enum", values: ["api.save"] },
          continuation: {
            kind: "enum",
            values: ["App.onClick.api.save.cont"],
          },
        },
      },
    });
    const continuationValues =
      pendingVar?.domain.kind === "boundedList"
        ? (
            pendingVar.domain.inner as {
              fields: { continuation: { values: string[] } };
            }
          ).fields.continuation.values
        : [];
    for (const synthetic of [
      "App.onSubmit.api.save.cont",
      "App.onChange.api.save.cont",
    ]) {
      expect(continuationValues).not.toContain(synthetic);
    }
  });

  it("falls back to configured effect API pending domains when no enqueues exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [status, setStatus] = useState<'idle' | 'saving'>('idle');
        return <button onClick={() => setStatus('saving')}>Save</button>;
      }
      `,
      "utf8",
    );

    const result = await runExtractCommand({
      sourcePath,
      modelPath,
      effectApis: ["api.save"],
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const pendingVar = result.model.vars.find(
      (decl) => decl.id === "sys:pending",
    );
    expect(pendingVar?.domain).toMatchObject({
      kind: "boundedList",
      inner: {
        kind: "record",
        fields: {
          opId: { kind: "enum", values: ["api.save"] },
          continuation: {
            kind: "enum",
            values: expect.arrayContaining([
              "App.onClick.api.save.cont",
              "App.onSubmit.api.save.cont",
              "App.onChange.api.save.cont",
            ]),
          },
        },
      },
    });
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
            id: "App.onClick.Save",
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
      id: "App.onClick.Save",
      confidence: "manual",
    });
    expect(model.vars.map((decl: { id: string }) => decl.id)).not.toContain(
      "local:App.debug",
    );
    expect(report.warnings).toContain(
      "Overlay overrides exact transition App.onClick.Save",
    );
    expect(report.handlers).toEqual([
      { id: "App.onClick.Save", classification: "overlay", reasons: [] },
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
      /overlay-drift: transition App\.onClick\.status has no match; nearest=App\.onClick\.Save\(\d+\)/,
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
        "ThemeToggle.onClick.Theme",
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
        status: { kind: "enum", values: ["closed", "open"] },
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
    ).toEqual(routeMountScope("/fallback"));
  });
});
