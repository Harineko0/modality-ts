import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkModel } from "modality-ts/check";
import { always } from "../../../../test/helpers/property-builders.js";
import { lit, neq, readVar, UNMOUNTED } from "modality-ts/core";
import { createBuiltinModalityRegistry } from "../../registry/index.js";
import { runExtractCommand } from "./index.js";

async function writeTanstackProject(
  root: string,
  files: Record<string, string>,
): Promise<{ packageJsonPath: string; paths: string[] }> {
  const packageJsonPath = join(root, "package.json");
  await writeFile(
    packageJsonPath,
    JSON.stringify({
      dependencies: {
        "@tanstack/react-router": "^1.0.0",
        react: "^18.0.0",
      },
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

describe("runExtractCommand tanstack router", () => {
  it("discovers file-based routes, plugin provenance, and Link navigation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-tanstack-file-"));
    const modelPath = join(dir, "model.json");
    const { packageJsonPath, paths } = await writeTanstackProject(dir, {
      "src/routes/__root.tsx": `
        import { createFileRoute, Outlet } from '@tanstack/react-router'
        export const Route = createFileRoute('/')({ component: Root })
        function Root() { return <Outlet /> }
      `,
      "src/routes/index.tsx": `
        import { createFileRoute, Link } from '@tanstack/react-router'
        export const Route = createFileRoute('/')({ component: HomePage })
        function HomePage() { return <Link to="/posts">Posts</Link> }
      `,
      "src/routes/posts.tsx": `
        import { createFileRoute } from '@tanstack/react-router'
        export const Route = createFileRoute('/posts')({ component: PostsPage })
        function PostsPage() { return <p>Posts</p> }
      `,
      "src/routes/posts.$postId.tsx": `
        import { createFileRoute } from '@tanstack/react-router'
        export const Route = createFileRoute('/posts/$postId')({ component: PostPage })
        function PostPage() { return <p>Post</p> }
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
        expect.objectContaining({ kind: "navigation", id: "tanstack-router" }),
        expect.objectContaining({
          kind: "module-roles",
          id: "tanstack-module-roles",
        }),
        expect.objectContaining({
          kind: "effect-api",
          id: "tanstack-effect-api",
        }),
        expect.objectContaining({
          kind: "cache-storage",
          id: "tanstack-cache-storage",
        }),
      ]),
    );
    const routeVar = result.model.vars.find((decl) => decl.id === "sys:route");
    expect(routeVar?.domain).toEqual({
      kind: "enum",
      values: expect.arrayContaining(["/", "/posts", "/posts/:postId"]),
    });
    expect(
      result.report.routeCoverage?.routes?.some(
        (route) => route.pattern === "/posts" && route.modeled,
      ),
    ).toBe(true);
    expect(result.report.routeCoverage?.configured).toBeGreaterThanOrEqual(3);
    expect(result.report.routeCoverage?.modeled).toBeGreaterThanOrEqual(2);
    const nav = result.model.transitions.find(
      (transition) =>
        transition.cls === "nav" && transition.id.includes("Link"),
    );
    expect(nav?.writes).toEqual(
      expect.arrayContaining(["sys:route", "sys:history"]),
    );
  });

  it("extracts static code-based route trees with useNavigate transitions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-tanstack-code-"));
    const modelPath = join(dir, "model.json");
    const routerPath = join(dir, "src/router.tsx");
    const { packageJsonPath } = await writeTanstackProject(dir, {
      "src/router.tsx": `
        import {
          createRootRoute,
          createRoute,
          createRouter,
          Link,
          useNavigate,
        } from '@tanstack/react-router'

        function Root() { return null }
        function Home() {
          const navigate = useNavigate()
          return (
            <main>
              <Link to="/about">About</Link>
              <button onClick={() => navigate({ to: '/about' })}>Go</button>
            </main>
          )
        }
        function About() { return <p>About</p> }

        const rootRoute = createRootRoute({ component: Root })
        const pathlessRoute = createRoute({
          getParentRoute: () => rootRoute,
          id: '_pathless',
          component: Root,
        })
        const indexRoute = createRoute({
          getParentRoute: () => pathlessRoute,
          path: '/',
          component: Home,
        })
        const aboutRoute = createRoute({
          getParentRoute: () => rootRoute,
          path: 'about',
          component: About,
        })
        export const routeTree = rootRoute.addChildren([
          pathlessRoute.addChildren([indexRoute]),
          aboutRoute,
        ])
        export const router = createRouter({ routeTree })
      `,
    });

    const result = await runExtractCommand({
      sourcePath: routerPath,
      modelPath,
      packageJsonPath,
      route: "/",
    });

    expect(
      result.model.vars.find((decl) => decl.id === "sys:route")?.domain,
    ).toEqual({
      kind: "enum",
      values: expect.arrayContaining(["/", "/about"]),
    });
    expect(
      result.model.transitions.some((transition) => transition.cls === "nav"),
    ).toBe(true);
    expect(
      result.model.vars.some((decl) => decl.id === "sys:tanstack:branch"),
    ).toBe(true);
  });

  it("discovers loader/beforeLoad effect APIs and loader cache vars", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-tanstack-loader-"));
    const modelPath = join(dir, "model.json");
    const { packageJsonPath, paths } = await writeTanstackProject(dir, {
      "src/routes/__root.tsx": `
        import { createFileRoute, Outlet } from '@tanstack/react-router'
        export const Route = createFileRoute('/')({ component: Root })
        function Root() { return <Outlet /> }
      `,
      "src/routes/dashboard.tsx": `
        import { createFileRoute, redirect } from '@tanstack/react-router'
        import { fetchDashboard } from '../server/dashboard.server'
        export const Route = createFileRoute('/dashboard')({
          loader: () => fetchDashboard(),
          beforeLoad: () => { throw redirect({ to: '/login' }) },
          component: DashboardPage,
        })
        function DashboardPage() {
          return <button onClick={() => {}}>refresh</button>
        }
      `,
      "src/routes/login.tsx": `
        import { createFileRoute } from '@tanstack/react-router'
        export const Route = createFileRoute('/login')({ component: LoginPage })
        function LoginPage() { return <p>Login</p> }
      `,
      "src/server/dashboard.server.ts": `
        export async function fetchDashboard() {
          return fetch('/api/dashboard')
        }
      `,
    });

    const result = await runExtractCommand({
      sourcePaths: paths,
      modelPath,
      packageJsonPath,
      route: "/dashboard",
    });

    expect(
      result.report.effectOperations?.map((entry) => entry.opId).sort(),
    ).toEqual(
      expect.arrayContaining(["BEFORE_LOAD /dashboard", "LOADER /dashboard"]),
    );
    expect(
      result.model.vars.some((decl) =>
        decl.id.startsWith("sys:tanstack:loader-cache:"),
      ),
    ).toBe(true);
    expect(
      result.model.transitions.some(
        (transition) =>
          transition.cls === "nav" &&
          (transition.id.includes("redirect") ||
            transition.id.includes("/login")),
      ) ||
        result.report.routeCoverage?.routes?.some(
          (route) => route.pattern === "/dashboard",
        ),
    ).toBe(true);
  });

  it("mounts route-local state on the active TanStack page", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-tanstack-mount-"));
    const modelPath = join(dir, "model.json");
    const { packageJsonPath, paths } = await writeTanstackProject(dir, {
      "src/routes/__root.tsx": `
        import { createFileRoute, Outlet } from '@tanstack/react-router'
        export const Route = createFileRoute('/')({ component: Root })
        function Root() { return <Outlet /> }
      `,
      "src/routes/index.tsx": `
        import { createFileRoute, Link } from '@tanstack/react-router'
        export const Route = createFileRoute('/')({ component: HomePage })
        function HomePage() { return <Link to="/panel">Panel</Link> }
      `,
      "src/routes/panel.tsx": `
        import { createFileRoute } from '@tanstack/react-router'
        import { useState } from 'react'
        export const Route = createFileRoute('/panel')({ component: PanelPage })
        function PanelPage() {
          const [count, setCount] = useState(0)
          return <button onClick={() => setCount(count + 1)}>{count}</button>
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
        name: "panelCountMountedAfterNav",
        reads: [countVar!.id],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("verified");
  });

  it("registers TanStack observation providers for replay harness codegen", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: {
        "@tanstack/react-router": "^1.0.0",
        react: "^18.0.0",
      },
    });
    expect(registry.routerPluginId).toBe("tanstack-router");
    expect(
      registry.adapters.observations.some(
        (provider) => provider.id === "tanstack-router-observation",
      ),
    ).toBe(true);
  });
});
