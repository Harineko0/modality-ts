import { domainFingerprint } from "./domains.js";
import type { StateVarDecl } from "./types.js";

export function dedupeVarsById(vars: readonly StateVarDecl[]): StateVarDecl[] {
  const deduped: StateVarDecl[] = [];
  const indexes = new Map<string, number>();

  for (const decl of vars) {
    const existingIndex = indexes.get(decl.id);
    if (existingIndex === undefined) {
      indexes.set(decl.id, deduped.length);
      deduped.push(decl);
      continue;
    }

    const existing = deduped[existingIndex];
    if (!existing) continue;
    assertMergeCompatible(existing, decl);
    const mergedDomain = mergeAssignedDomain(existing.domain, decl.domain);
    const existingDomain = domainFingerprint(existing.domain);
    const duplicateDomain = domainFingerprint(decl.domain);
    const mergedDomainFingerprint = domainFingerprint(mergedDomain);
    if (
      existingDomain !== duplicateDomain &&
      mergedDomainFingerprint === existingDomain
    ) {
      throw new Error(
        `Cannot merge duplicate var ${decl.id}: unsupported domain merge ${existingDomain} and ${duplicateDomain}`,
      );
    }
    if (mergedDomainFingerprint === existingDomain) {
      continue;
    }
    if (mergedDomainFingerprint === duplicateDomain) {
      deduped[existingIndex] = { ...existing, domain: mergedDomain };
      continue;
    }
    deduped[existingIndex] = { ...existing, domain: mergedDomain };
  }

  return deduped;
}

export function mergeAssignedDomain(
  left: StateVarDecl["domain"],
  right: StateVarDecl["domain"],
): StateVarDecl["domain"] {
  if (left.kind === "enum" && right.kind === "enum")
    return mergeArgDomains(left, right);
  if (left.kind === "boundedInt" && right.kind === "boundedInt")
    return mergeArgDomains(left, right);
  if (left.kind === "tokens") return right;
  if (domainFingerprint(left) === domainFingerprint(right)) return left;
  return left;
}

export function mergeArgDomains(
  left: StateVarDecl["domain"] | undefined,
  right: StateVarDecl["domain"],
): StateVarDecl["domain"] {
  if (!left) return right;
  if (left.kind === "enum" && right.kind === "enum")
    return {
      kind: "enum",
      values: [...new Set([...left.values, ...right.values])].sort(),
    };
  if (left.kind === "boundedInt" && right.kind === "boundedInt")
    return {
      kind: "boundedInt",
      min: Math.min(left.min, right.min),
      max: Math.max(left.max, right.max),
    };
  if (left.kind === right.kind) return left;
  return { kind: "tokens", count: 1 };
}

function assertMergeCompatible(left: StateVarDecl, right: StateVarDecl): void {
  const leftRest = comparableDecl(left);
  const rightRest = comparableDecl(right);
  if (leftRest === rightRest) return;
  throw new Error(
    `Cannot merge duplicate var ${left.id}: declarations differ outside domain`,
  );
}

function comparableDecl(decl: StateVarDecl): string {
  return JSON.stringify({
    id: decl.id,
    origin: decl.origin,
    scope: decl.scope,
    initial: decl.initial,
    role: decl.role,
  });
}
