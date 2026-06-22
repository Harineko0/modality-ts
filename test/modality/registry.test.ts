import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import { describe, expect, it } from "vitest";
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
        statePlugins: [plugin("swr"), plugin("use-state")],
      }),
    ).toMatchObject({
      statePluginIds: ["swr", "use-state"],
      plugins: [
        {
          id: "swr",
          version: "1.2.3",
          kind: "observation",
          packageNames: ["swr"],
        },
        {
          id: "use-state",
          version: "1.2.3",
          kind: "observation",
          packageNames: ["use-state"],
        },
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
      createModalityRegistry({ statePlugins: [plugin("swr"), plugin("swr")] }),
    ).toThrow("Duplicate source plugin swr");
  });

  it("rejects malformed plugin contracts at runtime", () => {
    expect(() =>
      createModalityRegistry({
        statePlugins: [
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
      statePluginIds: ["swr", "use-state"],
      routePluginId: "router",
      typePlugins: expect.arrayContaining([
        expect.objectContaining({ id: "zod" }),
        expect.objectContaining({ id: "arktype" }),
      ]),
      plugins: expect.arrayContaining([
        expect.objectContaining({ id: "arktype", kind: "type" }),
        expect.objectContaining({ id: "zod", kind: "type" }),
        expect.objectContaining({ id: "timers", kind: "effect" }),
        expect.objectContaining({ id: "websocket", kind: "effect" }),
        expect.objectContaining({ id: "router", kind: "route" }),
        expect.objectContaining({ id: "swr", kind: "state-source" }),
        expect.objectContaining({ id: "use-state", kind: "state-source" }),
      ]),
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
      routePluginId: "next",
      adapters: {
        moduleRoles: [expect.objectContaining({ id: "next-module-roles" })],
        effectApis: [expect.objectContaining({ id: "next-effect-api" })],
      },
      plugins: expect.arrayContaining([
        expect.objectContaining({
          id: "next",
          kind: "route",
          packageNames: ["next"],
        }),
        expect.objectContaining({
          id: "next-module-roles",
          kind: "module-roles",
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
      statePluginIds: ["jotai", "use-state"],
      typePlugins: [expect.objectContaining({ id: "arktype" })],
      plugins: expect.arrayContaining([
        expect.objectContaining({ id: "arktype", kind: "type" }),
        expect.objectContaining({ id: "timers", kind: "effect" }),
        expect.objectContaining({ id: "websocket", kind: "effect" }),
        expect.objectContaining({ id: "jotai", kind: "state-source" }),
        expect.objectContaining({ id: "use-state", kind: "state-source" }),
      ]),
    });
  });

  it("enables domain refinement providers when dependencies are unknown", () => {
    expect(createBuiltinModalityRegistry()).toMatchObject({
      typePlugins: [
        expect.objectContaining({ id: "zod" }),
        expect.objectContaining({ id: "arktype" }),
      ],
    });
  });
});
