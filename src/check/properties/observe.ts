import { canonicalState, UNMOUNTED } from "modality-ts/core";
import type {
  Model,
  ModelState,
  Property,
  StateVarDecl,
  StepFacts,
  Transition,
} from "modality-ts/core";
import type { PropertyVerdict } from "../types.js";
import { checkedState } from "./checked-state.js";
import {
  makeTraceStep,
  replayCheckedVerdict,
  traceTo,
  type TraceContext,
} from "../traces/trace.js";

const routeLocalReadCache = new WeakMap<
  Model,
  WeakMap<Property, StateVarDecl[]>
>();

function routeLocalReads(model: Model, property: Property): StateVarDecl[] {
  const modelCache = routeLocalReadCache.get(model);
  const cached = modelCache?.get(property);
  if (cached) return cached;

  const decls = computeRouteLocalReads(model, property);
  if (modelCache) {
    modelCache.set(property, decls);
  } else {
    routeLocalReadCache.set(model, new WeakMap([[property, decls]]));
  }
  return decls;
}

function computeRouteLocalReads(
  model: Model,
  property: Pick<Property, "name" | "reads" | "includeUnmounted">,
): StateVarDecl[] {
  if (property.includeUnmounted) return [];
  const reads = property.reads ?? [];
  const decls: StateVarDecl[] = [];
  const routes = new Set<string>();
  for (const id of reads) {
    const decl = model.vars.find((candidate) => candidate.id === id);
    if (decl?.scope.kind === "route-local") {
      routes.add(decl.scope.route);
      decls.push(decl);
    }
  }
  if (routes.size > 1) {
    throw new Error(
      `${property.name}: reads route-local vars from multiple routes: ${[...routes].sort().join(", ")}`,
    );
  }
  return decls;
}

function propertyMountedInState(
  model: Model,
  property: Property,
  state: ModelState,
): boolean {
  const locals = routeLocalReads(model, property);
  if (locals.length === 0) return true;
  const route = state["sys:route"];
  for (const decl of locals) {
    if (decl.scope.kind !== "route-local") continue;
    if (route !== decl.scope.route) return false;
    if (state[decl.id] === UNMOUNTED) return false;
  }
  return true;
}

function propertyMountedForEdge(
  model: Model,
  property: Property,
  pre: ModelState,
  post: ModelState,
): boolean {
  return (
    propertyMountedInState(model, property, pre) &&
    propertyMountedInState(model, property, post)
  );
}

export function observeStates(
  model: Model,
  properties: readonly Property[],
  candidates: readonly ModelState[],
  traceCtx: TraceContext,
  verdicts: Map<string, PropertyVerdict>,
): void {
  for (const state of candidates) {
    const canon = canonicalState(model, state);
    for (const property of properties) {
      if (verdicts.has(property.name)) continue;
      try {
        if (
          property.kind === "always" &&
          propertyMountedInState(model, property, state) &&
          !property.predicate(
            checkedState(model, property, state, "state predicate"),
          )
        ) {
          verdicts.set(
            property.name,
            replayCheckedVerdict(
              "violated",
              property.name,
              traceTo(traceCtx, canon),
            ),
          );
        }
        if (
          property.kind === "reachable" &&
          propertyMountedInState(model, property, state) &&
          property.predicate(
            checkedState(model, property, state, "state predicate"),
          )
        ) {
          verdicts.set(
            property.name,
            replayCheckedVerdict(
              "reachable",
              property.name,
              traceTo(traceCtx, canon),
            ),
          );
        }
      } catch (error) {
        verdicts.set(property.name, {
          status: "error",
          property: property.name,
          message: (error as Error).message,
        });
      }
    }
  }
}

export function observeEdge(
  model: Model,
  properties: readonly Property[],
  pre: ModelState,
  post: ModelState,
  transition: Transition,
  step: StepFacts,
  traceCtx: TraceContext,
  verdicts: Map<string, PropertyVerdict>,
): void {
  for (const property of properties) {
    if (verdicts.has(property.name)) continue;
    if (property.kind !== "alwaysStep") continue;
    try {
      if (
        propertyMountedForEdge(model, property, pre, post) &&
        !property.predicate(
          checkedState(model, property, pre, "step pre-state"),
          step,
          checkedState(model, property, post, "step post-state"),
        )
      ) {
        const preCanon = canonicalState(model, pre);
        verdicts.set(
          property.name,
          replayCheckedVerdict("violated", property.name, {
            steps: [
              ...traceTo(traceCtx, preCanon).steps,
              makeTraceStep(pre, post, transition),
            ],
          }),
        );
      }
    } catch (error) {
      verdicts.set(property.name, {
        status: "error",
        property: property.name,
        message: (error as Error).message,
      });
    }
  }
}
