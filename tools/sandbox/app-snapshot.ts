import { cp, lstat, readdir, symlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Materializes an isolated, runnable copy of a benchmark app for mutation /
 * metamorphic experiments.
 *
 * Three things must hold for the copy's replay harness to load:
 *   1. The app source tree is copied (so a single file can be mutated).
 *   2. The app's `node_modules` is linked (so app files resolve `modality-ts`
 *      and other deps).
 *   3. Sibling workspace directories the harness imports via `../<name>` (e.g.
 *      a shared `shared/` package) remain resolvable. These live OUTSIDE the
 *      app root and are not part of the copy, so we symlink each sibling into
 *      the snapshot parent. The symlink points at the real in-repo directory,
 *      so any `modality-ts` package self-reference inside those siblings still
 *      resolves (Node resolves through the symlink to its real path, which is
 *      inside the `modality-ts` package).
 *
 * Without step 3, `../shared/...` imports fail with "Cannot find module" and
 * every replay verdict degrades to `inconclusive`.
 */
export async function materializeAppSnapshot(
  appRoot: string,
  copiedRoot: string,
): Promise<void> {
  await cp(appRoot, copiedRoot, {
    dereference: true,
    recursive: true,
    filter: (source) => !isIgnoredTreeEntry(source),
  });
  await linkDependencyTree(appRoot, copiedRoot);
  await linkSiblingWorkspaceEntries(appRoot, copiedRoot);
}

export function isIgnoredTreeEntry(path: string): boolean {
  const normalized = path.split(/[/\\]/g);
  const name = normalized[normalized.length - 1];
  return ["node_modules", ".next", "dist", "coverage"].includes(name ?? "");
}

async function linkDependencyTree(
  sourceRoot: string,
  copiedRoot: string,
): Promise<void> {
  const sourceNodeModules = join(sourceRoot, "node_modules");
  try {
    const stats = await lstat(sourceNodeModules);
    if (!stats.isDirectory() && !stats.isSymbolicLink()) return;
  } catch {
    return;
  }
  await symlink(sourceNodeModules, join(copiedRoot, "node_modules"), "dir");
}

/**
 * Symlinks every sibling *directory* of the app root (other than the app
 * itself) into the snapshot's parent directory, preserving `../<sibling>`
 * relative imports made by the replay harness — e.g. a shared workspace package
 * imported as `../shared/...`. Each link targets the real in-repo directory so
 * package self-references inside the sibling continue to resolve (Node follows
 * the symlink to its real path, which is inside the `modality-ts` package).
 *
 * Only directories are linked: relative imports resolve against sibling source
 * trees, and this keeps the snapshot from mirroring unrelated sibling files.
 */
async function linkSiblingWorkspaceEntries(
  appRoot: string,
  copiedRoot: string,
): Promise<void> {
  const sourceParent = dirname(appRoot);
  const targetParent = dirname(copiedRoot);
  const appDirName = basename(appRoot);
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(sourceParent, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === appDirName) continue;
    if (!entry.isDirectory()) continue;
    if (isIgnoredTreeEntry(entry.name)) continue;
    const target = join(targetParent, entry.name);
    try {
      await lstat(target);
      continue; // already materialized (e.g. the copied app dir itself)
    } catch {
      // not present yet — create the link below
    }
    await symlink(join(sourceParent, entry.name), target, "dir");
  }
}
