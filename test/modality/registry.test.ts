import { describe, expect, it } from "vitest";
import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import {
  createBuiltinModalityRegistry,
  createModalityRegistry,
} from "../../src/cli/registry/index.js";

function plugin(id: string): StateSourcePlugin {
  return {
    id,
    version: "1.2.3",
    packageNames: [id],
    discover: () => [],
    writeChannels: () => [],
    harness: {
      setup: () => ({}),
      observe: () => "unobservable",
    },
  };
}

describe("modality plugin registry", () => {
  it("summarizes configured plugin ids deterministically", () => {
    expect(
      createModalityRegistry({
        sourcePlugins: [plugin("swr"), plugin("use-state")],
      }),
    ).toMatchObject({
      sourcePluginIds: ["swr", "use-state"],
      plugins: [
        {
          id: "swr",
          version: "1.2.3",
          kind: "state-source",
          packageNames: ["swr"],
        },
        {
          id: "use-state",
          version: "1.2.3",
          kind: "state-source",
          packageNames: ["use-state"],
        },
      ],
    });
  });

  it("rejects duplicate source plugin ids", () => {
    expect(() =>
      createModalityRegistry({ sourcePlugins: [plugin("swr"), plugin("swr")] }),
    ).toThrow("Duplicate source plugin swr");
  });

  it("rejects malformed plugin contracts at runtime", () => {
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [
          {
            id: "bad",
            version: "1.0.0",
            packageNames: ["bad"],
            discover: () => [],
          } as unknown as StateSourcePlugin,
        ],
      }),
    ).toThrow("Invalid source plugin bad: writeChannels must be a function");
  });

  it("auto-registers built-ins from app dependencies", () => {
    expect(
      createBuiltinModalityRegistry({
        dependencies: {
          react: "^18.0.0",
          swr: "^2.0.0",
          zod: "^4.0.0",
          arktype: "^2.0.0",
          "react-router-dom": "^6.0.0",
        },
      }),
    ).toMatchObject({
      sourcePluginIds: ["swr", "use-state"],
      routerPluginId: "router",
      domainRefinementProviders: expect.arrayContaining([
        expect.objectContaining({ id: "zod" }),
        expect.objectContaining({ id: "arktype" }),
      ]),
      plugins: [
        {
          id: "arktype",
          kind: "domain-refinement",
          version: "0.1.0",
          packageNames: ["arktype"],
        },
        {
          id: "zod",
          kind: "domain-refinement",
          version: "0.1.0",
          packageNames: ["zod"],
        },
        {
          id: "router-effect-api",
          kind: "effect-api",
          version: "0.1.0",
          packageNames: ["react-router", "react-router-dom"],
        },
        {
          id: "router-module-roles",
          kind: "module-role",
          version: "0.1.0",
          packageNames: ["react-router", "react-router-dom"],
        },
        {
          id: "router",
          kind: "router",
          version: "0.1.0",
          packageNames: ["react-router", "react-router-dom"],
        },
        {
          id: "swr",
          kind: "state-source",
          version: "0.1.0",
          packageNames: ["swr"],
        },
        {
          id: "use-state",
          kind: "state-source",
          version: "0.1.0",
          packageNames: ["react"],
        },
      ],
    });
  });

  it("selects the Next adapter when next is a dependency", () => {
    expect(
      createBuiltinModalityRegistry({
        dependencies: {
          react: "^19.0.0",
          next: "^15.0.0",
        },
      }),
    ).toMatchObject({
      routerPluginId: "next",
      adapters: {
        moduleRoles: [expect.objectContaining({ id: "next-module-roles" })],
        effectApis: [expect.objectContaining({ id: "next-effect-api" })],
      },
      plugins: expect.arrayContaining([
        expect.objectContaining({
          id: "next",
          kind: "router",
          packageNames: ["next"],
        }),
        expect.objectContaining({
          id: "next-module-roles",
          kind: "module-role",
        }),
        expect.objectContaining({
          id: "next-effect-api",
          kind: "effect-api",
        }),
      ]),
    });
  });

  it("can disable built-in plugins by id", () => {
    expect(
      createBuiltinModalityRegistry({
        dependencies: {
          react: "^18.0.0",
          jotai: "^2.0.0",
          swr: "^2.0.0",
          zod: "^4.0.0",
          arktype: "^2.0.0",
          "react-router-dom": "^6.0.0",
        },
        disabledPlugins: ["swr", "router", "zod"],
      }),
    ).toMatchObject({
      sourcePluginIds: ["jotai", "use-state"],
      domainRefinementProviders: [expect.objectContaining({ id: "arktype" })],
      plugins: [
        { id: "arktype", kind: "domain-refinement" },
        { id: "jotai", kind: "state-source" },
        { id: "use-state", kind: "state-source" },
      ],
    });
  });

  it("enables domain refinement providers when dependencies are unknown", () => {
    expect(createBuiltinModalityRegistry()).toMatchObject({
      domainRefinementProviders: [
        expect.objectContaining({ id: "zod" }),
        expect.objectContaining({ id: "arktype" }),
      ],
    });
  });
});
