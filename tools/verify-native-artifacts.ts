import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const REQUIRED_NATIVE_ARTIFACTS = [
  "modality-checker.linux-x64-gnu.node",
  "modality-checker.linux-arm64-gnu.node",
  "modality-checker.darwin-arm64.node",
  "modality-checker.darwin-x64.node",
  "modality-checker.win32-x64-msvc.node",
] as const;

export function missingNativeArtifacts(
  nativeDir: string,
  required: readonly string[] = REQUIRED_NATIVE_ARTIFACTS,
): string[] {
  return required.filter((filename) => !existsSync(join(nativeDir, filename)));
}

export function packFileList(cwd = process.cwd()): string[] {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd,
    encoding: "utf8",
  });
  const parsed = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>;
  return parsed[0]?.files.map((entry) => entry.path) ?? [];
}

function main(): void {
  const nativeDir = join(process.cwd(), "native");
  const missing = missingNativeArtifacts(nativeDir);
  if (missing.length > 0) {
    const present = existsSync(nativeDir)
      ? readdirSync(nativeDir).filter((entry) => entry.endsWith(".node"))
      : [];
    console.error(
      `Missing required native artifacts in ${nativeDir}: ${missing.join(", ")}`,
    );
    if (present.length > 0) {
      console.error(`Present: ${present.join(", ")}`);
    }
    process.exit(1);
  }

  const files = packFileList();
  const missingFromPack = REQUIRED_NATIVE_ARTIFACTS.filter(
    (artifact) => !files.includes(`native/${artifact}`),
  );
  if (!files.some((path) => path.startsWith("dist/"))) {
    console.error("npm pack dry-run did not include dist/** files");
    process.exit(1);
  }
  if (missingFromPack.length > 0) {
    console.error(
      `npm pack dry-run is missing native artifacts: ${missingFromPack.join(", ")}`,
    );
    process.exit(1);
  }

  console.log(
    `Verified ${REQUIRED_NATIVE_ARTIFACTS.length} native artifacts and dist/** in npm pack output.`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
