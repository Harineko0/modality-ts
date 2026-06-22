import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EffectIR } from "modality-ts/core";

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export async function mkSchemaExtractTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await symlink(
    join(repoRoot, "node_modules"),
    join(dir, "node_modules"),
    "dir",
  );
  return dir;
}

export function navigatesTo(effect: EffectIR, route: string): boolean {
  if (
    effect.kind === "assign" &&
    effect.var === "sys:route" &&
    effect.expr.kind === "lit" &&
    effect.expr.value === route
  ) {
    return true;
  }
  if (effect.kind === "seq")
    return effect.effects.some((child) => navigatesTo(child, route));
  if (effect.kind === "if")
    return navigatesTo(effect.then, route) || navigatesTo(effect.else, route);
  return false;
}
