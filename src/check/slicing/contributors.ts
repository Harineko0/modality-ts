import {
  collectRecordDomainFieldPaths,
  domainCardinality,
  type Model,
  type StateSpaceContributor,
  type StateSpaceContributors,
  type StateVarDecl,
} from "modality-ts/core";

export interface ModelEconomics {
  contributors: StateSpaceContributors;
}

export interface SliceEconomics {
  retainedBits: number;
  prunedBits: number;
  topContributors: readonly StateSpaceContributor[];
  prunedTopContributors: readonly StateSpaceContributor[];
  retainedSystemVars: readonly string[];
  prunedSystemVars: readonly string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function contributorForVar(
  decl: StateVarDecl,
  prunedFieldPaths?: readonly string[][],
): StateSpaceContributor {
  const cardinality = domainCardinality(decl.domain);
  const bits = cardinality < 1 ? 0 : round2(Math.log2(cardinality));
  const scope =
    decl.scope.kind === "global" ? "global" : `mount:${decl.scope.id}`;
  const origin =
    typeof decl.origin === "string" ? decl.origin : decl.origin.file;
  return {
    varId: decl.id,
    domainKind: decl.domain.kind,
    bits,
    scope,
    origin,
    ...(prunedFieldPaths && prunedFieldPaths.length > 0
      ? { prunedFieldPaths }
      : {}),
  };
}

function isSystemVar(decl: StateVarDecl): boolean {
  return decl.origin === "system" || decl.role !== undefined;
}

function topContributors(
  contributors: readonly StateSpaceContributor[],
  limit = 20,
): readonly StateSpaceContributor[] {
  return [...contributors]
    .sort((a, b) => b.bits - a.bits || a.varId.localeCompare(b.varId))
    .slice(0, limit);
}

export function buildStateContributors(
  model: Model,
  limit = 20,
): StateSpaceContributors {
  const contributors = model.vars.map((decl) => contributorForVar(decl));
  const totalBits = round2(contributors.reduce((sum, c) => sum + c.bits, 0));
  const topVars = topContributors(contributors, limit);
  const bySourceMap = new Map<string, number>();
  for (const c of contributors) {
    bySourceMap.set(
      c.origin,
      round2((bySourceMap.get(c.origin) ?? 0) + c.bits),
    );
  }
  const bySource = [...bySourceMap.entries()]
    .map(([source, bits]) => ({ source, bits }))
    .sort((a, b) => b.bits - a.bits || a.source.localeCompare(b.source));
  return { totalBits, topVars, bySource };
}

export function compareModelEconomics(
  full: Model,
  slice: Model,
  limit = 20,
  retainedFieldPaths?: ReadonlyMap<string, readonly string[][]>,
): SliceEconomics {
  const sliceVarIds = new Set(slice.vars.map((decl) => decl.id));
  const fullDeclsById = new Map(full.vars.map((decl) => [decl.id, decl]));
  const retainedDecls = slice.vars;
  const prunedDecls = full.vars.filter((decl) => !sliceVarIds.has(decl.id));
  const retainedContributors = retainedDecls.map((decl) => {
    const explicitPaths = retainedFieldPaths?.get(decl.id);
    const inferredPaths =
      explicitPaths ??
      (() => {
        const fullDecl = fullDeclsById.get(decl.id);
        if (fullDecl?.domain.kind !== "record") return undefined;
        if (decl.domain.kind !== "record") return undefined;
        const fullPaths = collectRecordDomainFieldPaths(fullDecl.domain);
        const slicePaths = collectRecordDomainFieldPaths(decl.domain);
        if (fullPaths.length === slicePaths.length) return undefined;
        const sliceKeys = new Set(slicePaths.map((path) => path.join("\0")));
        const pruned = fullPaths
          .filter((path) => !sliceKeys.has(path.join("\0")))
          .map((path) => [...path]);
        return pruned.length > 0 ? pruned : undefined;
      })();
    return contributorForVar(decl, inferredPaths);
  });
  const prunedContributors = prunedDecls.map((decl) => contributorForVar(decl));
  const retainedBits = round2(
    retainedContributors.reduce((sum, c) => sum + c.bits, 0),
  );
  const prunedBits = round2(
    prunedContributors.reduce((sum, c) => sum + c.bits, 0),
  );
  return {
    retainedBits,
    prunedBits,
    topContributors: topContributors(retainedContributors, limit),
    prunedTopContributors: topContributors(prunedContributors, limit),
    retainedSystemVars: retainedDecls
      .filter(isSystemVar)
      .map((decl) => decl.id)
      .sort(),
    prunedSystemVars: prunedDecls
      .filter(isSystemVar)
      .map((decl) => decl.id)
      .sort(),
  };
}
