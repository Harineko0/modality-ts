import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkModel } from "modality-ts/check";
import { always, lit, neq, readVar, UNMOUNTED } from "modality-ts/core";
import { createBuiltinModalityRegistry } from "../../registry/index.js";
import { runExtractCommand } from "./index.js";

async function writeNextProject(
  root: string,
  files: Record<string, string>,
): Promise<{ packageJsonPath: string; paths: string[] }> {
  const packageJsonPath = join(root, "package.json");
  await writeFile(
    packageJsonPath,
    JSON.stringify({
      dependencies: { next: "^15.0.0", react: "^19.0.0" },
    }),
    "utf8",
  );
  const paths: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    paths.push(abs);
  }
  return { packageJsonPath, paths };
}

describe("runExtractCommand next.js", () => {
  it("discovers App Router routes, route-tree vars, and Link navigation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-next-app-"));
    const modelPath = join(dir, "model.json");
    const { packageJsonPath, paths } = await writeNextProject(dir, {
      "app/page.tsx": `
        'use client';
        import Link from 'next/link';
        export default function Home() {
          return <Link href="/dashboard">Dashboard</Link>;
        }
      `,
      "app/dashboard/page.tsx": `
        'use client';
        export default function Dashboard() {
          return <p>Dashboard</p>;
        }
      `,
    });

    const result = await runExtractCommand({
      sourcePaths: paths,
      modelPath,
      packageJsonPath,
      route: "/",
    });

    expect(result.model.metadata?.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "navigation", id: "next" }),
      ]),
    );
    expect(
      result.model.vars.find((decl) => decl.id === "sys:route")?.domain,
    ).toEqual({
      kind: "enum",
      values: ["/", "/dashboard"],
    });
    expect(
      result.model.vars.some((decl) => decl.id.startsWith("sys:next:slot:")),
    ).toBe(true);
    const nav = result.model.transitions.find(
      (transition) => transition.cls === "nav",
    );
    expect(nav?.effect.kind).toBe("seq");
    expect(nav?.writes).toEqual(
      expect.arrayContaining(["sys:route", "sys:history"]),
    );
  });

  it("mounts dashboard client state after navigation and on initial route", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-next-dashboard-"));
    const modelPath = join(dir, "model.json");
    const { packageJsonPath, paths } = await writeNextProject(dir, {
      "app/page.tsx": `
        'use client';
        import Link from 'next/link';
        export default function Home() {
          return <Link href="/dashboard">Dashboard</Link>;
        }
      `,
      "app/dashboard/page.tsx": `
        'use client';
        import { useState } from 'react';
        export default function Dashboard() {
          const [count, setCount] = useState(0);
          return <button onClick={() => setCount(count + 1)}>{count}</button>;
        }
      `,
    });

    const result = await runExtractCommand({
      sourcePaths: paths,
      modelPath,
      packageJsonPath,
      route: "/",
    });

    const countVar = result.model.vars.find((decl) =>
      decl.id.endsWith(".count"),
    );
    expect(countVar?.scope).toMatchObject({ kind: "mount-local" });

    const nav = result.model.transitions.find(
      (transition) => transition.cls === "nav",
    );
    expect(nav).toBeDefined();

    const check = checkModel(result.model, [
      always(result.model, neq(readVar(countVar!.id), lit(UNMOUNTED)), {
        name: "dashboardCountMountedAfterNav",
        reads: [countVar!.id],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("verified-within-bounds");

    const initialDashboard = await runExtractCommand({
      sourcePaths: paths,
      modelPath: join(dir, "model-dashboard.json"),
      packageJsonPath,
      route: "/dashboard",
    });
    const childrenSlot = initialDashboard.model.vars.find(
      (decl) => decl.id === "sys:next:slot:children",
    );
    expect(childrenSlot?.initial).not.toBe("__none");
    expect(
      initialDashboard.model.vars.find((decl) => decl.id.endsWith(".count"))
        ?.scope,
    ).toMatchObject({ kind: "mount-local" });
    const initialCountVar = initialDashboard.model.vars.find((decl) =>
      decl.id.endsWith(".count"),
    );
    const initialCheck = checkModel(initialDashboard.model, [
      always(
        initialDashboard.model,
        neq(readVar(initialCountVar!.id), lit(UNMOUNTED)),
        {
          name: "dashboardCountMountedInitially",
          reads: [initialCountVar!.id],
        },
      ),
    ]);
    expect(initialCheck.verdicts[0]?.status).toBe("verified-within-bounds");
  });

  it("synthesizes parallel slot vars for @modal routes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-next-modal-"));
    const modelPath = join(dir, "model.json");
    const { packageJsonPath, paths } = await writeNextProject(dir, {
      "app/dashboard/page.tsx": `'use client';\nexport default function Dashboard() { return null; }`,
      "app/dashboard/@modal/default.tsx": `export default function ModalDefault() { return null; }`,
      "app/dashboard/@modal/(.)photo/[id]/page.tsx": `'use client';\nexport default function PhotoModal() { return null; }`,
    });

    const result = await runExtractCommand({
      sourcePaths: paths,
      modelPath,
      packageJsonPath,
      route: "/dashboard",
    });

    const slotVars = result.model.vars
      .map((decl) => decl.id)
      .filter((id) => id.startsWith("sys:next:slot:"));
    expect(slotVars.length).toBeGreaterThanOrEqual(1);
    expect(slotVars).toEqual(
      expect.arrayContaining(["sys:next:slot:children"]),
    );
  });

  it("discovers server action effect APIs from action modules", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-next-server-"));
    const modelPath = join(dir, "model.json");
    const { packageJsonPath, paths } = await writeNextProject(dir, {
      "app/page.tsx": `
        'use client';
        import { save } from './actions';
        export default function Home() {
          return (
            <form action={save}>
              <button type="submit">Save</button>
            </form>
          );
        }
      `,
      "app/actions.ts": `
        'use server';
        export async function save() {}
      `,
    });

    const result = await runExtractCommand({
      sourcePaths: paths,
      modelPath,
      packageJsonPath,
      route: "/",
      effectApis: [],
    });

    expect(
      result.report.effectOperations?.some((entry) =>
        entry.opId.includes("ACTION"),
      ),
    ).toBe(true);
  });

  it("canonicalizes imported server action op ids without friendly duplicates", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "modality-next-server-canonical-"),
    );
    const modelPath = join(dir, "model.json");
    const { packageJsonPath, paths } = await writeNextProject(dir, {
      "app/page.tsx": `
        'use client';
        import { useState } from 'react';
        import { save } from './actions';
        export default function Home() {
          const [status, setStatus] = useState('idle');
          return (
            <button onClick={async () => {
              setStatus('saving');
              await save();
              setStatus('done');
            }}>Save</button>
          );
        }
      `,
      "app/actions.ts": `
        'use server';
        export async function save() {}
      `,
    });

    const result = await runExtractCommand({
      sourcePaths: paths,
      modelPath,
      packageJsonPath,
      route: "/",
      effectApis: [],
    });

    const pendingVar = result.model.vars.find(
      (decl) => decl.id === "sys:pending",
    );
    const opValues =
      pendingVar?.domain.kind === "boundedList"
        ? (
            pendingVar.domain.inner as {
              fields: { opId: { values: string[] } };
            }
          ).fields.opId.values
        : [];
    const actionIds = opValues.filter((op) => op.startsWith("ACTION "));
    expect(actionIds).toHaveLength(1);
    expect(opValues).not.toContain("save");
    expect(
      result.model.transitions.some(
        (transition) =>
          transition.id.includes(actionIds[0] ?? "") &&
          transition.id.endsWith(".start"),
      ),
    ).toBe(true);
  });

  it("scopes colliding server action import aliases per client module", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "modality-next-server-alias-collision-"),
    );
    const modelPath = join(dir, "model.json");
    const { packageJsonPath, paths } = await writeNextProject(dir, {
      "app/account/page.tsx": `
        'use client';
        import { useState } from 'react';
        import { save } from '../account-actions';
        export default function AccountPage() {
          const [status, setStatus] = useState('idle');
          return (
            <button onClick={async () => {
              setStatus('saving');
              await save();
              setStatus('done');
            }}>Save account</button>
          );
        }
      `,
      "app/profile/page.tsx": `
        'use client';
        import { useState } from 'react';
        import { save } from '../profile-actions';
        export default function ProfilePage() {
          const [status, setStatus] = useState('idle');
          return (
            <button onClick={async () => {
              setStatus('saving');
              await save();
              setStatus('done');
            }}>Save profile</button>
          );
        }
      `,
      "app/local/page.tsx": `
        'use client';
        import { useState } from 'react';
        async function save() {}
        export default function LocalPage() {
          const [status, setStatus] = useState('idle');
          return (
            <button onClick={async () => {
              await save();
              setStatus('done');
            }}>Local save</button>
          );
        }
      `,
      "app/account-actions.ts": `
        'use server';
        export async function save() {}
      `,
      "app/profile-actions.ts": `
        'use server';
        export async function save() {}
      `,
    });

    const result = await runExtractCommand({
      sourcePaths: paths,
      modelPath,
      packageJsonPath,
      route: "/account",
      effectApis: [],
    });

    const pendingVar = result.model.vars.find(
      (decl) => decl.id === "sys:pending",
    );
    const opValues =
      pendingVar?.domain.kind === "boundedList"
        ? (
            pendingVar.domain.inner as {
              fields: { opId: { values: string[] } };
            }
          ).fields.opId.values
        : [];
    const actionIds = opValues.filter((op) => op.startsWith("ACTION "));
    expect(actionIds).toHaveLength(2);
    expect(opValues).not.toContain("save");
    expect(
      result.model.transitions.some(
        (transition) =>
          transition.id.includes(actionIds[0] ?? "") &&
          transition.id.endsWith(".start"),
      ),
    ).toBe(true);
    expect(
      result.model.transitions.some(
        (transition) =>
          transition.id.includes(actionIds[1] ?? "") &&
          transition.id.endsWith(".start"),
      ),
    ).toBe(true);
    expect(
      result.model.transitions.some((transition) =>
        transition.id.includes("LocalPage.onClick.save.start"),
      ),
    ).toBe(false);
  });

  it("discovers Pages Router dynamic route patterns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-next-pages-"));
    const modelPath = join(dir, "model.json");
    const { packageJsonPath, paths } = await writeNextProject(dir, {
      "pages/post/[pid].tsx": `
        export async function getServerSideProps() {
          return { props: { pid: '1' } };
        }
        export default function Post() { return null; }
      `,
    });

    const result = await runExtractCommand({
      sourcePaths: paths,
      modelPath,
      packageJsonPath,
      route: "/post/:pid",
    });

    expect(
      result.model.vars.find((decl) => decl.id === "sys:route")?.domain,
    ).toEqual({
      kind: "enum",
      values: ["/post/:pid"],
    });
  });
});

describe("builtin registry next selection", () => {
  it("selects next adapter when next is in dependencies", () => {
    expect(
      createBuiltinModalityRegistry({
        dependencies: { next: "^15.0.0", react: "^19.0.0" },
      }),
    ).toMatchObject({
      routerPluginId: "next",
      plugins: expect.arrayContaining([
        expect.objectContaining({
          id: "next",
          kind: "navigation",
          packageNames: ["next"],
        }),
      ]),
    });
  });

  it("prefers next over react-router when both are present", () => {
    expect(
      createBuiltinModalityRegistry({
        dependencies: {
          next: "^15.0.0",
          "react-router-dom": "^7.0.0",
        },
      }).routerPluginId,
    ).toBe("next");
  });
});
