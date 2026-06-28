import { dirname } from "node:path";
import {
  effectReads,
  effectWrites,
  type EffectIR,
  exprReads,
  type GuardIR,
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

/**
 * Gate user-interaction transitions to the route where their component mounts.
 *
 * A button click or form change extracted from a component can only happen while
 * that component is rendered, i.e. while the app is on the component's route. The
 * extracted interaction transitions carry no such guard, so in action-mode
 * conformance a walk fires e.g. a risk-page button from `/login`, where the live
 * harness cannot find the element. Adding `sys:route == R` removes those
 * impossible firings — a fidelity improvement that also shrinks the state space.
 *
 * Resolution is deliberately conservative so it can only add a correct guard or
 * skip, never mis-gate: a transition is gated only when every one of its source
 * files sits under the directory of a single LEAF route (a route with no child
 * routes) whose pattern is a value of the `sys:route` domain. Shared layout or
 * app-shell components — which live above any leaf route directory, or under a
 * non-leaf route visible across its children — match nothing and stay ungated.
 */
export function applyLeafRouteInteractionGuards(
  model: Model,
  inventory: RouteInventory,
): Model {
  const routeValues = routeEnumValues(model);
  if (routeValues.size === 0) return model;
  const routeNodes = inventory.routes.filter(
    (node): node is (typeof inventory.routes)[number] & { file: string } =>
      typeof node.file === "string" &&
      (node.kind === "page" || node.kind === "index"),
  );
  const patterns = routeNodes.map((node) => node.pattern);
  const isLeaf = (pattern: string): boolean =>
    !patterns.some(
      (other) => other !== pattern && other.startsWith(`${pattern}/`),
    );
  const leafDirs = routeNodes
    .filter((node) => routeValues.has(node.pattern) && isLeaf(node.pattern))
    .map((node) => ({ key: routeDirKey(node.file), pattern: node.pattern }))
    .filter((entry) => entry.key.length > 0)
    .sort((left, right) => right.key.length - left.key.length);
  if (leafDirs.length === 0) return model;

  let changed = false;
  const transitions = model.transitions.map((transition) => {
    if (transition.cls !== "user") return transition;
    const route = resolveLeafRouteForSources(transition.source, leafDirs);
    if (!route) return transition;
    changed = true;
    return {
      ...transition,
      guard: andRouteGuard(transition.guard, route),
      reads: transition.reads.includes("sys:route")
        ? transition.reads
        : [...transition.reads, "sys:route"],
    };
  });
  return changed ? { ...model, transitions } : model;
}

function resolveLeafRouteForSources(
  source: Model["transitions"][number]["source"],
  leafDirs: readonly { key: string; pattern: string }[],
): string | undefined {
  const files = [...new Set(source.map((anchor) => anchor.file))];
  if (files.length === 0) return undefined;
  let resolved: string | undefined;
  for (const file of files) {
    // Inventory route files are relative to the source tree while transition
    // anchors are absolute, so match by path segments (boundary-delimited)
    // rather than resolving against the process cwd. leafDirs is ordered by key
    // length, so the first hit is the most specific (deepest) route.
    const haystack = `/${dirname(file).split("\\").join("/")}/`;
    const match = leafDirs.find((leaf) => haystack.includes(`/${leaf.key}/`));
    // A source outside every leaf-route directory (shared layout, app shell)
    // means the component is not confined to one route — leave it ungated.
    if (!match) return undefined;
    if (resolved !== undefined && resolved !== match.pattern) return undefined;
    resolved = match.pattern;
  }
  return resolved;
}

function andRouteGuard(guard: GuardIR, route: string): GuardIR {
  const onRoute: GuardIR = {
    kind: "eq",
    args: [
      { kind: "read", var: "sys:route" },
      { kind: "lit", value: route },
    ],
  };
  if (guard.kind === "lit" && guard.value === true) return onRoute;
  return { kind: "and", args: [guard, onRoute] };
}

function routeEnumValues(model: Model): Set<string> {
  const route = model.vars.find((decl) => decl.id === "sys:route");
  if (route?.domain.kind === "enum") {
    return new Set(
      route.domain.values.filter(
        (value): value is string => typeof value === "string",
      ),
    );
  }
  return new Set();
}

/**
 * The route file's directory as a base-independent path key: forward-slashed and
 * stripped of leading `./`/`../` segments, e.g. `../routes/x/index.tsx` ->
 * `routes/x`. Matched as a delimited segment against transition source paths.
 */
function routeDirKey(file: string): string {
  const dir = dirname(file).split("\\").join("/");
  return dir.replace(/^(?:\.\.?\/)+/, "");
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
