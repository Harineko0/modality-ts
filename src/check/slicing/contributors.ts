import {
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

function contributorForVar(decl: StateVarDecl): StateSpaceContributor {
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
  const contributors = model.vars.map(contributorForVar);
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
): SliceEconomics {
  const sliceVarIds = new Set(slice.vars.map((decl) => decl.id));
  const retainedDecls = full.vars.filter((decl) => sliceVarIds.has(decl.id));
  const prunedDecls = full.vars.filter((decl) => !sliceVarIds.has(decl.id));
  const retainedContributors = retainedDecls.map(contributorForVar);
  const prunedContributors = prunedDecls.map(contributorForVar);
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
