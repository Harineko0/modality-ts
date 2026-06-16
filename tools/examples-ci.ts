import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheckCommand } from "../src/cli/check.ts";
import { runCiCommand } from "../src/cli/ci.ts";
import { runExtractCommand } from "../src/cli/extract.ts";
import { runReplayCommand } from "../src/cli/replay.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = join(repoRoot, "examples", "demo-app");

async function main(): Promise<void> {
  const startedAt = Date.now();
  const artifactDir = await mkdtemp(join(tmpdir(), "modality-examples-ci-"));
  try {
    const sourcePath = join(demoDir, "App.tsx");
    const propsPath = join(demoDir, "app.props.ts");
    const modelPath = join(artifactDir, "model.json");
    const reportPath = join(artifactDir, "report.json");
    const tracesDir = join(artifactDir, "traces");
    const replayTestsDir = join(artifactDir, "replay-tests");
    const ciArtifactDir = join(artifactDir, ".modality");

    const extracted = await runExtractCommand({
      sourcePath,
      modelPath,
      effectApis: ["api.placeOrder"],
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    assert(
      extracted.report.coverage.unextractable === 0,
      "demo extraction has unextractable handlers",
    );
    assert(
      extracted.report.coverage.percentExactOrOverlay === 1,
      "demo extraction is below 100% exact/overlay",
    );

    const checked = await runCheckCommand({
      modelPath,
      propsPath,
      reportPath,
      tracesDir,
      replayTestsDir,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const violations = checked.check.verdicts.filter(
      (verdict) => verdict.status === "violated",
    );
    assert(
      violations.length === 3,
      `expected 3 seeded bugs, got ${violations.length}`,
    );
    assert(
      checked.check.verdicts.map((verdict) => verdict.property).join(",") ===
        "noDoubleSubmit,guestCannotReachAdmin,guestDoesNotSeeUserCache",
      "unexpected demo property set",
    );
    assert(Date.now() - startedAt < 60_000, "demo check exceeded one minute");

    const replayStatuses = await replayStatusesForViolations(tracesDir);
    const reproduced = replayStatuses.filter(
      (status) => status === "reproduced",
    ).length;
    assert(
      reproduced >= 2,
      `expected at least 2 reproduced replays, got ${reproduced}`,
    );

    const overlayLines = await countOverlayLines(demoDir);
    assert(
      overlayLines <= 100,
      `overlay line budget exceeded: ${overlayLines}`,
    );

    const ci = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir: ciArtifactDir,
      sourcePath,
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    assert(
      ci.exitCode === 2,
      `expected CI to fail on seeded bugs with exit 2, got ${ci.exitCode}`,
    );
    assert(
      ci.lines.includes("violations=3 errors=0"),
      "CI did not report 3 violations and 0 errors",
    );
    assert(
      ci.lines.includes("determinism=passed"),
      "CI determinism check failed",
    );
    assert(
      ci.lines.includes("source-freshness=passed"),
      "CI source freshness check failed",
    );

    console.log(
      `examples-ci: passed violations=3 reproduced=${reproduced}/3 overlayLines=${overlayLines} elapsedMs=${Date.now() - startedAt}`,
    );
  } finally {
    await rm(artifactDir, { recursive: true, force: true });
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function replayStatusesForViolations(
  tracesDir: string,
): Promise<string[]> {
  const traceNames = (await readdir(tracesDir))
    .filter((name) => name.endsWith(".violated.trace.json"))
    .sort();
  const statuses: string[] = [];
  for (const traceName of traceNames) {
    const replay = await runReplayCommand({
      tracePath: join(tracesDir, traceName),
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    statuses.push(replay.report.verdict.status);
  }
  return statuses;
}

async function countOverlayLines(root: string): Promise<number> {
  const names = await readdir(root, { recursive: true });
  let lines = 0;
  for (const name of names) {
    const relative = String(name);
    if (!isOverlayFile(relative)) continue;
    const text = await readFile(join(root, relative), "utf8");
    lines += text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length;
  }
  return lines;
}

function isOverlayFile(path: string): boolean {
  return (
    /(^|\/)(modality\.)?overlay\.(json|mjs|js|ts)$/.test(path) ||
    path.endsWith(".overlay.ts")
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
