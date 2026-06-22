import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const FORBIDDEN_RECOGNITION =
  /\b(React|react|JSX|jsx|TSX|Suspense|lazy|useState|useEffect|useRef|useTransition|useDeferredValue|useContext|useCallback|useMemo|startTransition|flushSync|Form|useSubmit|useActionData|setTimeout|setInterval|WebSocket|Promise\.all|fetch|confirm|onClick|onSubmit|onChange|event\.target|select|option|radio|Jotai|jotai|SWR|swr|zustand|TanStack|redux)\b/;

const FORBIDDEN_TS_CORE =
  /\b(typescript|ts\.|SourceFile|TypeNode|CallExpression|Jsx|SemanticTypeContext)\b/;

async function collectProductFiles(
  dir: string,
  acc: string[] = [],
): Promise<string[]> {
  if (!existsSync(dir)) return acc;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      await collectProductFiles(path, acc);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    acc.push(path);
  }
  return acc;
}

async function readProductFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("plugin layering remediation — legacy driver removal", () => {
  it("deletes statement-summary, surface-bridge-slot, and wiring install", () => {
    expect(
      existsSync(
        resolve(
          repoRoot,
          "src/extract/engine/ts/transition/statement-summary.ts",
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        resolve(repoRoot, "src/extract/engine/ts/surface-bridge-slot.ts"),
      ),
    ).toBe(false);
    expect(existsSync(resolve(repoRoot, "src/extract/wiring/install.ts"))).toBe(
      false,
    );
  });

  it("keeps pipeline free of direct react-source-transitions imports", async () => {
    const pipelineDir = resolve(repoRoot, "src/extract/engine/pipeline");
    const files = await collectProductFiles(pipelineDir);
    for (const file of files) {
      if (file.endsWith("register-react-extractor.ts")) continue;
      const text = await readProductFile(file);
      expect(text).not.toMatch(/react-source-transitions/);
    }
  });

  it("keeps compile product code free of framework recognition strings", async () => {
    const roots = [resolve(repoRoot, "src/extract/compile")];
    for (const root of roots) {
      const files = await collectProductFiles(root);
      for (const file of files) {
        if (file.includes("/engine/spi/")) continue;
        const text = await readProductFile(file);
        const lines = text.split("\n").filter((line) => {
          const trimmed = line.trim();
          return (
            trimmed.length > 0 &&
            !trimmed.startsWith("//") &&
            !trimmed.startsWith("*")
          );
        });
        for (const line of lines) {
          if (line.includes('case "jsx"')) continue;
          expect(line).not.toMatch(FORBIDDEN_RECOGNITION);
        }
      }
    }
  });

  it("keeps compile product code free of typescript imports", async () => {
    const roots = [resolve(repoRoot, "src/extract/compile")];
    for (const root of roots) {
      const files = await collectProductFiles(root);
      for (const file of files) {
        if (file.includes("/engine/spi/")) continue;
        const text = await readProductFile(file);
        expect(text).not.toMatch(/from ["']typescript["']/);
        const lines = text.split("\n").filter((line) => {
          const trimmed = line.trim();
          return (
            trimmed.length > 0 &&
            !trimmed.startsWith("//") &&
            !trimmed.startsWith("*")
          );
        });
        for (const line of lines) {
          expect(line).not.toMatch(FORBIDDEN_TS_CORE);
        }
      }
    }
  });

  it("places language-agnostic formalization helpers under compile/", async () => {
    const effectsPath = resolve(repoRoot, "src/extract/compile/effects.ts");
    expect(existsSync(effectsPath)).toBe(true);
    const numericUnderEngine = existsSync(
      resolve(repoRoot, "src/extract/engine/ts/numeric/abstraction.ts"),
    );
    expect(numericUnderEngine).toBe(true);
  });

  it("enforces file-size guard under 1000 lines for layered-plugin product files", async () => {
    const roots = [
      resolve(repoRoot, "src/extract/compile"),
      resolve(repoRoot, "src/extract/lang"),
      resolve(repoRoot, "src/extract/frameworks"),
      resolve(repoRoot, "src/extract/plugins"),
      resolve(repoRoot, "src/extract/effect-models"),
      resolve(repoRoot, "src/extract/sources"),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      const files = await collectProductFiles(root);
      for (const file of files) {
        const lineCount = (await readProductFile(file)).split("\n").length;
        if (lineCount > 1000) offenders.push(`${file} (${lineCount})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
