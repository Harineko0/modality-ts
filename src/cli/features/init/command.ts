import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface InitCommandOptions {
  cwd?: string;
}

export interface InitCommandResult {
  configPath: string;
  lines: string[];
}

export async function runInitCommand(
  options: InitCommandOptions = {},
): Promise<InitCommandResult> {
  const configPath = join(options.cwd ?? process.cwd(), "modality.config.ts");
  await writeFile(
    configPath,
    [
      'import type { ModalityConfig } from "modality-ts/cli/extract";',
      "",
      "export default {",
      '  route: "/",',
      "  bounds: {",
      "    maxDepth: 12,",
      "    maxPending: 3,",
      "    maxInternalSteps: 16,",
      "  },",
      "} satisfies ModalityConfig;",
      "",
    ].join("\n"),
    { encoding: "utf8", flag: "wx" },
  );
  return {
    configPath,
    lines: [`config=${configPath}`],
  };
}
