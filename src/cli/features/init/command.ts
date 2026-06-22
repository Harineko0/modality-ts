import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface InitCommandOptions {
  cwd?: string;
}

export interface InitCommandResult {
  configPath: string;
  lines: string[];
}

interface SourceScaffold {
  readonly id: string;
  readonly factory: string;
  readonly module: string;
  readonly packageNames: readonly string[];
}

const SOURCE_SCAFFOLD: readonly SourceScaffold[] = [
  {
    id: "use-state",
    factory: "useStateSource",
    module: "modality-ts/extract/sources/use-state",
    packageNames: ["react"],
  },
  {
    id: "jotai",
    factory: "jotaiSource",
    module: "modality-ts/extract/sources/jotai",
    packageNames: ["jotai"],
  },
  {
    id: "swr",
    factory: "swrSource",
    module: "modality-ts/extract/sources/swr",
    packageNames: ["swr"],
  },
  {
    id: "zustand",
    factory: "zustandSource",
    module: "modality-ts/extract/sources/zustand",
    packageNames: ["zustand"],
  },
  {
    id: "tanstack-query",
    factory: "tanstackQuerySource",
    module: "modality-ts/extract/sources/tanstack-query",
    packageNames: ["@tanstack/react-query"],
  },
  {
    id: "redux",
    factory: "reduxSource",
    module: "modality-ts/extract/sources/redux",
    packageNames: ["@reduxjs/toolkit", "react-redux", "redux"],
  },
];

const BOUNDS_BLOCK = [
  "  bounds: {",
  "    maxDepth: 12,",
  "    maxPending: 3,",
  "    maxInternalSteps: 16,",
  "  },",
];

export async function detectSourceScaffolds(
  cwd: string,
): Promise<readonly SourceScaffold[]> {
  const packageJsonPath = join(cwd, "package.json");
  let manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  try {
    manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const dependencies = {
    ...(manifest.peerDependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.dependencies ?? {}),
  };
  return SOURCE_SCAFFOLD.filter((scaffold) =>
    scaffold.packageNames.some(
      (packageName) => dependencies[packageName] !== undefined,
    ),
  );
}

function renderConfigContent(scaffolds: readonly SourceScaffold[]): string {
  if (scaffolds.length === 0) {
    return [
      'import type { ModalityConfig } from "modality-ts/cli/extract";',
      "",
      "export default {",
      ...BOUNDS_BLOCK,
      "} satisfies ModalityConfig;",
      "",
    ].join("\n");
  }

  const importLines = scaffolds.map(
    (scaffold) => `import { ${scaffold.factory} } from "${scaffold.module}";`,
  );
  const pluginCalls = scaffolds
    .map((scaffold) => `    ${scaffold.factory}(),`)
    .join("\n");

  return [
    'import type { ModalityConfig } from "modality-ts/cli/extract";',
    ...importLines,
    "",
    "export default {",
    "  plugins: [",
    pluginCalls,
    "  ],",
    "  // framework: reactFramework(),",
    ...BOUNDS_BLOCK,
    "} satisfies ModalityConfig;",
    "",
  ].join("\n");
}

export async function runInitCommand(
  options: InitCommandOptions = {},
): Promise<InitCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = join(cwd, "modality.config.ts");
  const scaffolds = await detectSourceScaffolds(cwd);
  await writeFile(configPath, renderConfigContent(scaffolds), {
    encoding: "utf8",
    flag: "wx",
  });
  const lines = [`config=${configPath}`];
  if (scaffolds.length > 0) {
    lines.push(`plugins=${scaffolds.map((scaffold) => scaffold.id).join(",")}`);
  }
  return {
    configPath,
    lines,
  };
}
