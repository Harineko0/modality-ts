import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { tanstackRouterAdapter } from "modality-ts/extract/sources/tanstack-router";
import { reactRouterAdapter } from "modality-ts/extract/sources/router";
import {
  attachRouteInventory,
  loadExtractionProject,
  resolveExtractionRoute,
} from "./extraction-project.js";

async function writeProject(
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relativePath, text] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, text, "utf8");
  }
}

describe("attachRouteInventory", () => {
  it("attaches TanStack inventory when extracting a project with src/routes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-tanstack-project-"));
    const entry = join(dir, "src/main.tsx");
    await writeProject(dir, {
      "src/main.tsx": `export {}`,
      "src/routes/__root.tsx": `export const Route = {}`,
      "src/routes/index.tsx": `export const Route = {}`,
      "src/routes/about.tsx": `export const Route = {}`,
    });
    const project = await loadExtractionProject([entry]);
    const attached = await attachRouteInventory(
      { ...project, configStartDir: dir },
      tanstackRouterAdapter(),
    );
    expect(attached.inventory.routes.length).toBeGreaterThan(0);
    expect(
      attached.inventory.routes.some((node) => node.pattern === "/about"),
    ).toBe(true);
  });

  it("resolves a route for a single file inside src/routes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-tanstack-file-"));
    const aboutPath = join(dir, "src/routes/about.tsx");
    await writeProject(dir, {
      "src/routes/__root.tsx": `export const Route = {}`,
      "src/routes/about.tsx": `
        import { createFileRoute } from '@tanstack/react-router'
        export const Route = createFileRoute('/about')({ component: AboutPage })
        export function AboutPage() { return <div /> }
      `,
    });
    const project = await attachRouteInventory(
      await loadExtractionProject([aboutPath]),
      tanstackRouterAdapter(),
    );
    expect(resolveExtractionRoute(project, {}, {}, [aboutPath])).toBe("/about");
  });

  it("keeps React Router app/routes.ts fallback for the router adapter", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "modality-react-router-fallback-"),
    );
    await writeProject(dir, {
      "app/routes.ts": `
        import { index, route } from "@react-router/dev/routes";
        export default [
          index("routes/home.tsx"),
          route("settings", "routes/settings.tsx"),
        ];
      `,
      "app/routes/home.tsx": `export default function Home() { return null }`,
      "app/routes/settings.tsx": `export default function Settings() { return null }`,
    });
    const project = await attachRouteInventory(
      await loadExtractionProject([dir]),
      reactRouterAdapter(),
    );
    expect(project.inventory.routes.map((node) => node.pattern).sort()).toEqual(
      ["/", "/settings"],
    );
    const settingsPath = resolve(dir, "app/routes/settings.tsx");
    expect(resolveExtractionRoute(project, {}, {}, [settingsPath])).toBe(
      "/settings",
    );
  });
});
