import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runExtractCommand } from "./index.js";

describe("runExtractCommand", () => {
  it("extracts a minimal component", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-extract-smoke-"));
    const sourcePath = join(dir, "App.tsx");
    const modelPath = join(dir, "model.json");
    await writeFile(
      sourcePath,
      `
      import { useState } from 'react';
      export function App() {
        const [flag, setFlag] = useState(false);
        return <button onClick={() => setFlag(true)}>Set</button>;
      }
      `,
      "utf8",
    );
    const result = await runExtractCommand({ sourcePath, modelPath });
    expect(result.varCount).toBeGreaterThan(0);
    expect(result.transitionCount).toBeGreaterThan(0);
  });
});
