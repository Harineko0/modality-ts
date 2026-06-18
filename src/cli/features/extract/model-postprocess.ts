import type { EffectIR, Model, StateVarDecl } from "modality-ts/core";
import type {
  NavigationAdapter,
  RouteInventory,
} from "modality-ts/extract/engine/spi";
import {
  buildFieldPruningMetadata,
  fieldPruningCollapseCaveats,
} from "../../../extract/engine/ts/field-pruning.js";
import { mergeExtractionCaveats, emptyExtractionCaveats } from "./report.js";

export function applyMountScopesFromRouter(
  vars: readonly StateVarDecl[],
  adapter: NavigationAdapter,
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

function mergeAssignedDomain(
  left: StateVarDecl["domain"],
  right: StateVarDecl["domain"],
): StateVarDecl["domain"] {
  if (left.kind === "enum" && right.kind === "enum")
    return mergeArgDomains(left, right);
  if (left.kind === "boundedInt" && right.kind === "boundedInt")
    return mergeArgDomains(left, right);
  if (left.kind === "tokens") return right;
  return left;
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

function mergeArgDomains(
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
