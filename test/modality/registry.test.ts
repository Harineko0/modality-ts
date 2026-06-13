import { describe, expect, it } from "vitest";
import type { StateSourcePlugin } from "modality-ts/extraction/spi";
import { createBuiltinModalityRegistry, createModalityRegistry } from "../../src/modality/registry/index.js";

function plugin(id: string): StateSourcePlugin {
  return {
    id,
    version: "1.2.3",
    packageNames: [id],
    discover: () => [],
    writeChannels: () => [],
    harness: {
      setup: () => ({}),
      observe: () => "unobservable"
    }
  };
}

describe("modality plugin registry", () => {
  it("summarizes configured plugin ids deterministically", () => {
    expect(createModalityRegistry({ sourcePlugins: [plugin("swr"), plugin("use-state")] })).toMatchObject({
      sourcePluginIds: ["swr", "use-state"],
      plugins: [
        { id: "swr", version: "1.2.3", kind: "state-source", packageNames: ["swr"] },
        { id: "use-state", version: "1.2.3", kind: "state-source", packageNames: ["use-state"] }
      ]
    });
  });

  it("rejects duplicate source plugin ids", () => {
    expect(() => createModalityRegistry({ sourcePlugins: [plugin("swr"), plugin("swr")] })).toThrow("Duplicate source plugin swr");
  });

  it("rejects malformed plugin contracts at runtime", () => {
    expect(() => createModalityRegistry({ sourcePlugins: [{ id: "bad", version: "1.0.0", packageNames: ["bad"], discover: () => [] } as unknown as StateSourcePlugin] }))
      .toThrow("Invalid source plugin bad: writeChannels must be a function");
  });

  it("auto-registers built-ins from app dependencies", () => {
    expect(createBuiltinModalityRegistry({
      dependencies: {
        react: "^18.0.0",
        swr: "^2.0.0",
        "react-router-dom": "^6.0.0"
      }
    })).toMatchObject({
      sourcePluginIds: ["swr", "use-state"],
      routerPluginId: "router",
      plugins: [
        { id: "router", kind: "router", version: "0.1.0", packageNames: ["react-router", "react-router-dom"] },
        { id: "swr", kind: "state-source", version: "0.1.0", packageNames: ["swr"] },
        { id: "use-state", kind: "state-source", version: "0.1.0", packageNames: ["react"] }
      ]
    });
  });

  it("can disable built-in plugins by id", () => {
    expect(createBuiltinModalityRegistry({
      dependencies: { react: "^18.0.0", jotai: "^2.0.0", swr: "^2.0.0", "react-router-dom": "^6.0.0" },
      disabledPlugins: ["swr", "router"]
    })).toMatchObject({
      sourcePluginIds: ["jotai", "use-state"],
      plugins: [
        { id: "jotai", kind: "state-source" },
        { id: "use-state", kind: "state-source" }
      ]
    });
  });
});
