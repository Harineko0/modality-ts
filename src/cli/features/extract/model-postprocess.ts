import {
  effectReads,
  effectWrites,
  type EffectIR,
  exprReads,
  mergeArgDomains,
  mergeAssignedDomain,
  type Model,
  type StateVarDecl,
} from "modality-ts/core";
import type {
  RouteInventory,
  RoutePlugin,
} from "modality-ts/extract/engine/spi";
import {
  buildFieldPruningMetadata,
  fieldPruningCollapseCaveats,
} from "../../../extract/lang/ts/driver/field-pruning.js";
import { emptyExtractionCaveats, mergeExtractionCaveats } from "./report.js";

export function applyMountScopesFromRouter(
  vars: readonly StateVarDecl[],
  adapter: RoutePlugin,
  inventory: RouteInventory,
): StateVarDecl[] {
  if (!adapter.mountScopeForComponent) return [...vars];
  return vars.map((decl) => {
    if (!decl.id.startsWith("local:")) return decl;
    const component = decl.id.slice("local:".length).split(".")[0];
    if (!component) return decl;
    const scope = adapter.mountScopeForComponent?.(component, inventory);
    return scope ? { ...decl, scope } : decl;
  });
}

export function refineAssignedLiteralDomains(
  vars: readonly StateVarDecl[],
  transitions: readonly Model["transitions"][number][],
): StateVarDecl[] {
  const refinements = new Map<string, StateVarDecl["domain"]>();
  for (const transition of transitions) {
    for (const [varId, domain] of assignedLiteralDomains(transition.effect)) {
      refinements.set(varId, mergeArgDomains(refinements.get(varId), domain));
    }
  }
  return vars.map((decl) => {
    if (decl.origin === "library-template") return decl;
    const refinement = refinements.get(decl.id);
    return refinement
      ? { ...decl, domain: mergeAssignedDomain(decl.domain, refinement) }
      : decl;
  });
}

/**
 * Drop store-scoped atom duplicates that no transition reads or writes.
 *
 * A store-less Jotai `<Provider>` (or a `useAtom(atom, { store })` with a store
 * the model cannot distinguish from the default) makes extraction emit a
 * provider-scoped twin `atom:NAME@store:SCOPE` alongside the canonical
 * `atom:NAME`. When every read/write resolves to the unscoped twin — the common
 * case once route components live in separate files from the provider — the
 * scoped twin is inert: it stays at its initial value forever. The conformance
 * observation map strips the `@store:` suffix and observes the *same* live atom
 * for both ids, so the inert twin always diverges from the real value. Removing
 * a variable no transition reads or writes is semantics-preserving for the model
 * (its value can never change a guard or effect), and only the redundant twin —
 * never a uniquely-named scoped store — is eligible, since the unscoped twin
 * must also be present.
 */
export function pruneRedundantStoreScopedAtoms(model: Model): Model {
  const declaredIds = new Set(model.vars.map((decl) => decl.id));
  const referenced = new Set<string>();
  for (const transition of model.transitions) {
    for (const read of transition.reads) referenced.add(read);
    for (const write of transition.writes) referenced.add(write);
    for (const read of exprReads(transition.guard)) referenced.add(read);
    for (const read of effectReads(transition.effect)) referenced.add(read);
    for (const write of effectWrites(transition.effect)) referenced.add(write);
  }
  const prunable = (id: string): boolean => {
    const match = /^(atom:[^@]+)@store:.+$/.exec(id);
    return (
      match !== null &&
      declaredIds.has(match[1] as string) &&
      !referenced.has(id)
    );
  };
  if (!model.vars.some((decl) => prunable(decl.id))) return model;
  return {
    ...model,
    vars: model.vars.filter((decl) => !prunable(decl.id)),
  };
}

export function attachFieldPruning(model: Model): Model {
  const fieldPruning = buildFieldPruningMetadata(model);
  if (fieldPruning.entries.length === 0) return model;
  const collapseCaveats = fieldPruningCollapseCaveats(model, fieldPruning);
  return {
    ...model,
    metadata: {
      ...model.metadata,
      fieldPruning,
      extractionCaveats: mergeExtractionCaveats(
        model.metadata?.extractionCaveats ?? emptyExtractionCaveats(),
        collapseCaveats,
      ),
    },
  };
}

function assignedLiteralDomains(
  effect: EffectIR,
): Array<[string, StateVarDecl["domain"]]> {
  if (effect.kind === "assign" && effect.expr.kind === "lit")
    return [[effect.var, domainForLiteral(effect.expr.value)]];
  if (effect.kind === "choose") {
    return effect.among
      .filter(
        (expr): expr is Extract<typeof expr, { kind: "lit" }> =>
          expr.kind === "lit",
      )
      .map((expr) => [effect.var, domainForLiteral(expr.value)]);
  }
  if (effect.kind === "seq")
    return effect.effects.flatMap(assignedLiteralDomains);
  if (effect.kind === "if")
    return [
      ...assignedLiteralDomains(effect.then),
      ...assignedLiteralDomains(effect.else),
    ];
  return [];
}

function domainForLiteral(value: unknown): StateVarDecl["domain"] {
  if (typeof value === "boolean") return { kind: "bool" };
  if (typeof value === "number")
    return { kind: "boundedInt", min: value, max: value };
  if (typeof value === "string") return { kind: "enum", values: [value] };
  if (value === null)
    return { kind: "option", inner: { kind: "tokens", count: 1 } };
  return { kind: "tokens", count: 1 };
}
