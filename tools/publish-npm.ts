import { spawnSync } from "node:child_process";

const publishOrder = [
  "@modality-ts/kernel",
  "@modality-ts/checker",
  "@modality-ts/extraction",
  "@modality-ts/harness",
  "@modality-ts/runtime",
  "@modality-ts/source-jotai",
  "@modality-ts/source-router",
  "@modality-ts/source-swr",
  "@modality-ts/source-use-state",
  "@modality-ts/modality"
] as const;

const extraArgs = process.argv.slice(2);

for (const packageName of publishOrder) {
  const args = ["-r", "--filter", packageName, "publish", "--access", "public", "--no-git-checks", ...extraArgs];
  console.log(`\n> pnpm ${args.join(" ")}`);
  const result = spawnSync("pnpm", args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
