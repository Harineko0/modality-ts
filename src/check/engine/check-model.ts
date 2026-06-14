import { canonicalState, validateModel } from "modality-ts/core";
import type { Model, ModelState, Property } from "modality-ts/core";
import { effectContainsEnqueue, recordMaxDepthBoundHits } from "../diagnostics/bounds.js";
import { vacuityWarnings } from "../diagnostics/vacuity.js";
import { finalizeProperties } from "../properties/finalize.js";
import { observeEdge, observeStates } from "../properties/observe.js";
import { applyEffect } from "../runtime/effects.js";
import { sliceModelForProperty } from "../slicing/slice-model.js";
import { facts } from "../traces/step-facts.js";
import type { CheckOptions, CheckResult, Edge, Parent, PropertyVerdict } from "../types.js";
import { initialStates } from "./initial-states.js";
import { stabilize } from "./stabilize.js";
import { changedVars, compareStates, initialChangedVars } from "./state-utils.js";
import { enabledTransitions, installEnabledHook } from "./transitions.js";

export function checkModel(model: Model, properties: readonly Property[], options: CheckOptions = {}): CheckResult {
  if (options.slicing && properties.length > 0 && properties.every((property) => property.reads !== undefined)) {
    return checkModelSliced(model, properties);
  }
  return checkModelCore(model, properties);
}

function checkModelCore(model: Model, properties: readonly Property[]): CheckResult {
  const validation = validateModel(model);
  if (!validation.ok) return invalidModelResult(properties, validation.errors);

  installEnabledHook(model);
  const parents = new Map<string, Parent>();
  const states = new Map<string, ModelState>();
  const edges: Edge[] = [];
  const enabledTransitionIds = new Set<string>();
  const boundHits = new Set<string>();
  let frontier = seedFrontier(model, parents, states);
  const verdicts = new Map<string, PropertyVerdict>();
  let depth = 0;
  let edgeCount = 0;
  observeStates(model, properties, frontier, parents, verdicts);

  while (frontier.length > 0 && depth < model.bounds.maxDepth) {
    const result = exploreDepth(model, properties, frontier, parents, states, edges, verdicts, enabledTransitionIds, boundHits);
    frontier = result.next;
    edgeCount += result.edges;
    observeStates(model, properties, frontier, parents, verdicts);
    depth += 1;
  }

  recordMaxDepthBoundHits(model, frontier, enabledTransitionIds, boundHits);
  finalizeProperties(model, properties, parents, states, edges, verdicts);
  return {
    verdicts: properties.map((property) => verdicts.get(property.name) ?? { status: "verified-within-bounds", property: property.name }),
    stats: { states: parents.size, edges: edgeCount, depth },
    vacuityWarnings: vacuityWarnings(model, states, enabledTransitionIds),
    boundHits: [...boundHits].sort()
  };
}

function invalidModelResult(properties: readonly Property[], errors: readonly string[]): CheckResult {
  return {
    verdicts: properties.map((property) => ({ status: "error", property: property.name, message: errors.join("; ") })),
    stats: { states: 0, edges: 0, depth: 0 },
    vacuityWarnings: [],
    boundHits: []
  };
}

function seedFrontier(model: Model, parents: Map<string, Parent>, states: Map<string, ModelState>): ModelState[] {
  const frontier = initialStates(model).flatMap((state) => stabilize(model, state, initialChangedVars(model))).sort(compareStates(model));
  for (const state of frontier) {
    const canon = canonicalState(model, state);
    if (!parents.has(canon)) {
      parents.set(canon, { parent: null, transition: null, pre: null, post: state });
      states.set(canon, state);
    }
  }
  return frontier;
}

function exploreDepth(
  model: Model,
  properties: readonly Property[],
  frontier: readonly ModelState[],
  parents: Map<string, Parent>,
  states: Map<string, ModelState>,
  edges: Edge[],
  verdicts: Map<string, PropertyVerdict>,
  enabledTransitionIds: Set<string>,
  boundHits: Set<string>
): { next: ModelState[]; edges: number } {
  const next: ModelState[] = [];
  let edgeCount = 0;
  for (const pre of frontier) {
    const preCanon = canonicalState(model, pre);
    for (const transition of enabledTransitions(model, pre)) {
      enabledTransitionIds.add(transition.id);
      const rawPosts = applyEffect(model, pre, transition.effect, {
        onBoundHit: (hit) => {
          boundHits.add(hit.startsWith("token cap exhausted") ? `token cap exhausted at ${transition.id}` : `${hit} at ${transition.id}`);
        }
      });
      if (rawPosts.length === 0 && effectContainsEnqueue(transition.effect)) {
        boundHits.add(`pending cap saturated at ${transition.id}`);
      }
      for (const rawPost of rawPosts) {
        for (const post of stabilize(model, rawPost, changedVars(pre, rawPost))) {
          edgeCount += 1;
          const postCanon = canonicalState(model, post);
          const step = facts(pre, post, transition);
          edges.push({ preCanon, postCanon, pre, post, transition, step });
          observeEdge(model, properties, pre, post, transition, step, parents, verdicts);
          if (!parents.has(postCanon)) {
            parents.set(postCanon, { parent: preCanon, transition, pre, post });
            states.set(postCanon, post);
            next.push(post);
          }
        }
      }
    }
  }
  return { next: next.sort(compareStates(model)), edges: edgeCount };
}

function checkModelSliced(model: Model, properties: readonly Property[]): CheckResult {
  const groups = new Map<string, { model: Model; properties: Property[] }>();
  for (const property of properties) {
    const slice = sliceModelForProperty(model, property);
    const key = slice.vars.map((decl) => decl.id).join("\0");
    const group = groups.get(key);
    if (group) group.properties.push(property);
    else groups.set(key, { model: slice, properties: [property] });
  }
  return combineSlicedResults(properties, [...groups.values()].map((group) => checkModelCore(group.model, group.properties)));
}

function combineSlicedResults(properties: readonly Property[], results: readonly CheckResult[]): CheckResult {
  const verdicts = new Map<string, PropertyVerdict>();
  let states = 0;
  let edges = 0;
  let depth = 0;
  const vacuity = new Set<string>();
  const boundHits = new Set<string>();
  for (const result of results) {
    for (const verdict of result.verdicts) verdicts.set(verdict.property, verdict);
    for (const warning of result.vacuityWarnings) vacuity.add(warning);
    for (const hit of result.boundHits) boundHits.add(hit);
    states += result.stats.states;
    edges += result.stats.edges;
    depth = Math.max(depth, result.stats.depth);
  }
  return {
    verdicts: properties.map((property) => verdicts.get(property.name) ?? { status: "error", property: property.name, message: "missing sliced verdict" }),
    stats: { states, edges, depth },
    vacuityWarnings: [...vacuity].sort(),
    boundHits: [...boundHits].sort()
  };
}
