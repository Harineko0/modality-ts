import type { RouteInventory } from "modality-ts/extract/engine/spi";
import { describe, expect, it } from "vitest";
import { sourceWithReachableImports } from "../../src/cli/features/extract/project.js";
import {
  nextEffectApiProvider,
  nextModuleRolePlugin,
} from "../../src/extract/plugins/route/next/index.js";

describe("sourceWithReachableImports next boundaries", () => {
  const inventory: RouteInventory = {
    routes: [
      {
        pattern: "/",
        kind: "page",
        file: "/proj/app/page.tsx",
      },
    ],
  };
  const nextProviders = {
    moduleRoleAdapters: [nextModuleRolePlugin()],
    effectApiProviders: [nextEffectApiProvider()],
  };

  it("excludes server page handlers unless a client island is imported", async () => {
    const result = await sourceWithReachableImports(
      [
        {
          path: "/proj/app/page.tsx",
          text: `
            import { Counter } from "../components/Counter";
            export default function Home() {
              return (
                <>
                  <button onClick={() => console.log("server")}>Server</button>
                  <Counter />
                </>
              );
            }
          `,
        },
        {
          path: "/proj/components/Counter.tsx",
          text: `
            "use client";
            export function Counter() {
              return <button onClick={() => console.log("client")}>Client</button>;
            }
          `,
        },
      ],
      { paths: [] },
      { ...nextProviders, inventory },
    );

    const page = result.sources.find((entry) =>
      entry.path.endsWith("app/page.tsx"),
    );
    const counter = result.sources.find((entry) =>
      entry.path.endsWith("components/Counter.tsx"),
    );
    expect(page?.interactionText).not.toContain(
      'onClick={() => console.log("server")}',
    );
    expect(counter?.interactionText).toContain(
      'onClick={() => console.log("client")}',
    );
  });

  it('includes "use client" components imported from server pages in interaction surface', async () => {
    const result = await sourceWithReachableImports(
      [
        {
          path: "/proj/app/page.tsx",
          text: `
            import { Island } from "../components/Island";
            export default function Home() {
              return <Island />;
            }
          `,
        },
        {
          path: "/proj/components/Island.tsx",
          text: `
            "use client";
            export function Island() {
              return <button onClick={() => {}}>Tap</button>;
            }
          `,
        },
      ],
      { paths: [] },
      { ...nextProviders, inventory },
    );

    const island = result.sources.find((entry) =>
      entry.path.endsWith("components/Island.tsx"),
    );
    expect(island?.interactionText).toContain("onClick");
    expect(island?.included).toBe(true);
  });

  it('excludes "use server" action files from interaction but discovers server effect APIs', async () => {
    const result = await sourceWithReachableImports(
      [
        {
          path: "/proj/app/page.tsx",
          text: `
            import { save } from "./actions";
            export default function Home() {
              return <form action={save}><button>Save</button></form>;
            }
          `,
        },
        {
          path: "/proj/app/actions.ts",
          text: `
            "use server";
            export async function save() {
              await fetch("https://example.com/save");
            }
          `,
        },
      ],
      { paths: [] },
      { ...nextProviders, inventory },
    );

    const actions = result.sources.find((entry) =>
      entry.path.endsWith("app/actions.ts"),
    );
    expect(actions?.interactionText.trim()).toBe("");
    expect(actions?.excludedReason).toBe("server-only module");
    expect(result.effectApis).toEqual(
      expect.arrayContaining([
        `ACTION /proj/app/actions.ts#save`,
        "GET https://example.com/save",
      ]),
    );
  });

  it("does not drag css imports into interaction surface", async () => {
    const result = await sourceWithReachableImports(
      [
        {
          path: "/proj/app/page.tsx",
          text: `
            import styles from "./page.module.css";
            export default function Home() {
              return <main className={styles.root}>Hello</main>;
            }
          `,
        },
        {
          path: "/proj/app/page.module.css",
          text: ".root { color: red; }",
        },
      ],
      { paths: [] },
      { ...nextProviders, inventory },
    );

    const css = result.sources.find((entry) =>
      entry.path.endsWith("page.module.css"),
    );
    expect(css?.included).toBeFalsy();
    expect(
      result.sources.some((entry) => entry.interactionText.includes(".root")),
    ).toBe(false);
  });
});
