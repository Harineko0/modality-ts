import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { sourceWithReachableImports } from "./project.js";
import {
  createSemanticProject,
  loadSemanticProjectConfig,
} from "../../../extract/engine/ts/semantic-project.js";

describe("compiler-backed project surface", () => {
  async function surfaceWithResolver(
    dir: string,
    files: Record<string, string>,
    entryPath: string,
  ) {
    for (const [relativePath, text] of Object.entries(files)) {
      const absolutePath = join(dir, relativePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, text, "utf8");
    }
    const resolvedEntry = resolve(join(dir, entryPath));
    const entryText = await readFile(resolvedEntry, "utf8");
    const config = loadSemanticProjectConfig(dir);
    const resolver = createSemanticProject(
      [{ path: resolvedEntry, text: entryText }],
      config,
    );
    return sourceWithReachableImports(
      [{ path: resolvedEntry, text: entryText }],
      resolver,
    );
  }

  it("resolves path alias imports through the compiler resolver", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-surface-alias-"));
    const result = await surfaceWithResolver(
      dir,
      {
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "~/*": ["./src/*"] },
          },
        }),
        "src/ui/Button.tsx": `
          export function Button(props: { onClick: () => void }) {
            return <button onClick={props.onClick}>Tap</button>;
          }
        `,
        "src/App.tsx": `
          import { useState } from 'react';
          import { Button } from '~/ui/Button';
          export function App() {
            const [open, setOpen] = useState(false);
            return <Button onClick={() => setOpen(true)} />;
          }
        `,
      },
      "src/App.tsx",
    );
    const button = result.sources.find((entry) =>
      entry.path.endsWith("ui/Button.tsx"),
    );
    expect(button?.included).toBe(true);
    expect(button?.interactionText).toContain("onClick");
  });

  it("resolves extensionless relative imports through the compiler resolver", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "modality-surface-extensionless-"),
    );
    const result = await surfaceWithResolver(
      dir,
      {
        "tsconfig.json": "{}",
        "lib/utils.ts": `
          export function helper(onDone: () => void) {
            return <button onClick={onDone}>Done</button>;
          }
        `,
        "App.tsx": `
          import { useState } from 'react';
          import { helper } from './lib/utils';
          export function App() {
            const [done, setDone] = useState(false);
            return helper(() => setDone(true));
          }
        `,
      },
      "App.tsx",
    );
    const utils = result.sources.find((entry) =>
      entry.path.endsWith("utils.ts"),
    );
    expect(utils?.included).toBe(true);
    expect(utils?.interactionText).toContain("onClick");
  });

  it("resolves NodeNext .js specifiers to .ts sources through the compiler resolver", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-surface-nodenext-"));
    const result = await surfaceWithResolver(
      dir,
      {
        "package.json": JSON.stringify({ type: "module" }),
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            module: "nodenext",
            moduleResolution: "nodenext",
          },
        }),
        "foo.ts": `
          export function Foo(props: { onClick: () => void }) {
            return <button onClick={props.onClick}>Tap</button>;
          }
        `,
        "App.tsx": `
          import { useState } from 'react';
          import { Foo } from './foo.js';
          export function App() {
            const [open, setOpen] = useState(false);
            return <Foo onClick={() => setOpen(true)} />;
          }
        `,
      },
      "App.tsx",
    );
    const foo = result.sources.find((entry) => entry.path.endsWith("foo.ts"));
    expect(foo?.included).toBe(true);
    expect(foo?.interactionText).toContain("onClick");
  });

  it("follows re-exports from aliased modules through the compiler resolver", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-surface-reexport-"));
    const result = await surfaceWithResolver(
      dir,
      {
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "~/*": ["./src/*"] },
          },
        }),
        "src/components/Child.tsx": `
          import { useState } from 'react';
          export function Child() {
            const [count, setCount] = useState(0);
            return <button onClick={() => setCount(1)}>Count</button>;
          }
        `,
        "src/components/index.ts": `export { Child } from "./Child";`,
        "src/Home.tsx": `
          import { Child } from '~/components';
          export function Home() {
            return <Child />;
          }
        `,
      },
      "src/Home.tsx",
    );
    const child = result.sources.find((entry) =>
      entry.path.endsWith("components/Child.tsx"),
    );
    expect(child?.interactionText).toContain("onClick");
  });

  it("excludes type-only imports from the interaction surface", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-surface-type-only-"));
    const result = await surfaceWithResolver(
      dir,
      {
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "~/*": ["./src/*"] },
          },
        }),
        "src/lib/phase.ts": `
          export type Phase = 'alpha' | 'beta';
          export async function serverHelper() {
            await fetch('https://example.com/server');
          }
        `,
        "src/Route.tsx": `
          import { useState } from 'react';
          import type { Phase } from '~/lib/phase';
          export function Route() {
            const [phase, setPhase] = useState<Phase>('alpha');
            return <button onClick={() => setPhase('beta')}>Next</button>;
          }
        `,
      },
      "src/Route.tsx",
    );
    const phase = result.sources.find((entry) =>
      entry.path.endsWith("lib/phase.ts"),
    );
    expect(phase?.interactionText).not.toContain("serverHelper");
    expect(phase?.interactionText).not.toContain("fetch");
    expect(result.effectApis).not.toContain("GET https://example.com/server");
    expect(
      result.sources.find((entry) => entry.path.endsWith("Route.tsx"))
        ?.interactionText,
    ).toContain("onClick");
  });

  it("reports unresolved modules with source file, specifier, and import kind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-surface-unresolved-"));
    const result = await surfaceWithResolver(
      dir,
      {
        "tsconfig.json": "{}",
        "App.tsx": `
          import { useState } from 'react';
          import { Missing } from './missing';
          export function App() {
            const [open, setOpen] = useState(false);
            return <button onClick={() => setOpen(true)}>{Missing}</button>;
          }
        `,
      },
      "App.tsx",
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Unresolved import "\.\/missing" in .*App\.tsx/),
      ]),
    );
  });
});
