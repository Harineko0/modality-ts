import type { Model, ModelState, Property } from "modality-ts/core";
import type { Edge, Parent, PropertyVerdict } from "../types.js";
import { makeTraceStep, replayCheckedVerdict, traceTo } from "../traces/trace.js";
import { failingSuffixWithin } from "./leads-to.js";
import { unreachableWitness } from "./reachable-from.js";

export function finalizeProperties(
  model: Model,
  properties: readonly Property[],
  parents: Map<string, Parent>,
  states: Map<string, ModelState>,
  edges: readonly Edge[],
  verdicts: Map<string, PropertyVerdict>
): void {
  for (const property of properties) {
    if (verdicts.has(property.name)) continue;
    try {
      finalizeProperty(model, property, parents, states, edges, verdicts);
    } catch (error) {
      verdicts.set(property.name, { status: "error", property: property.name, message: (error as Error).message });
    }
  }
}

function finalizeProperty(
  model: Model,
  property: Property,
  parents: Map<string, Parent>,
  states: Map<string, ModelState>,
  edges: readonly Edge[],
  verdicts: Map<string, PropertyVerdict>
): void {
  if (property.kind === "reachable") {
    verdicts.set(property.name, { status: "vacuous-warning", property: property.name, message: "No reachable witness within bounds" });
  }
  if (property.kind === "reachableFrom") {
    const witness = unreachableWitness(model, property, states, edges);
    if (witness) {
      verdicts.set(property.name, {
        status: "violated",
        property: property.name,
        trace: traceTo(parents, witness[0]),
        replayable: false,
        replayBlockedReason: "reachableFrom counterexamples assert absence of a path and are not replayable"
      });
    }
  }
  if (property.kind === "leadsToWithin") {
    finalizeLeadsToWithin(model, property, parents, edges, verdicts);
  }
}

function finalizeLeadsToWithin(
  model: Model,
  property: Extract<Property, { kind: "leadsToWithin" }>,
  parents: Map<string, Parent>,
  edges: readonly Edge[],
  verdicts: Map<string, PropertyVerdict>
): void {
  const triggerEdges = edges.filter((edge) => property.trigger(edge.step));
  if (triggerEdges.length === 0) {
    verdicts.set(property.name, { status: "vacuous-warning", property: property.name, message: "Trigger never fired within bounds" });
    return;
  }
  const failure = triggerEdges.map((edge) => ({ edge, suffix: failingSuffixWithin(model, property, edge.post) })).find((candidate) => candidate.suffix);
  if (failure) {
    verdicts.set(property.name, replayCheckedVerdict("violated", property.name, {
      steps: [
        ...traceTo(parents, failure.edge.preCanon).steps,
        makeTraceStep(failure.edge.pre, failure.edge.post, failure.edge.transition),
        ...failure.suffix!.map((edge) => makeTraceStep(edge.pre, edge.post, edge.transition))
      ]
    }));
  }
}
