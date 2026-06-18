import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { routeMountScope } from "../../../extract/engine/ts/routes.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkSchemaExtractTemp } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import type { Model } from "modality-ts/core";
import { runExtractCommand } from "./index.js";

describe("runExtractCommand", () => {
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
    ).toEqual(routeMountScope("/custom-analytics"));
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
      ).toEqual(routeMountScope(testCase.route));
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
