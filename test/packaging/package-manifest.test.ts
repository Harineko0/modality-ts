import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const exampleApps = ["demo-app", "checkout-app", "todo-app"];

describe("example app package manifests", () => {
  for (const app of exampleApps) {
    it(`${app} declares modality-ts in devDependencies`, () => {
      const manifestPath = join(
        import.meta.dirname,
        "..",
        "..",
        "examples",
        app,
        "package.json",
      );
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        devDependencies?: Record<string, string>;
      };
      expect(manifest.devDependencies?.["modality-ts"]).toBeDefined();
    });
  }
});
