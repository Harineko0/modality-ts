import { runConformCommand } from "../../src/cli/conform.js";

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function readNumberFlag(name: string): number | undefined {
  const value = readFlag(name);
  return value === undefined ? undefined : Number(value);
}

async function main(): Promise<void> {
  const result = await runConformCommand({
    modelPath: readFlag("--model"),
    mode: readFlag("--mode") as "abstract" | "action" | undefined,
    harnessPath: readFlag("--harness"),
    walkCount: readNumberFlag("--count"),
    depth: readNumberFlag("--depth"),
    seed: readNumberFlag("--seed"),
    reportPath: readFlag("--report"),
    fixtureId: readFlag("--fixture"),
  });
  for (const line of result.lines) console.log(line);
  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(4);
});
