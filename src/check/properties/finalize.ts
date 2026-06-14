import type { Model, ModelState, Property } from "modality-ts/core";
import type {
  CompactEdge,
  Edge,
  GraphRecording,
  PropertyVerdict,
} from "../types.js";
import {
  makeTraceStep,
  replayCheckedVerdict,
  traceTo,
  type TraceContext,
} from "../traces/trace.js";
import { facts } from "../traces/step-facts.js";
import { failingSuffixWithin } from "./leads-to.js";
import { unreachableWitness } from "./reachable-from.js";

export function finalizeProperties(
  model: Model,
  properties: readonly Property[],
  traceCtx: TraceContext,
  graph: GraphRecording,
  verdicts: Map<string, PropertyVerdict>,
): void {
  for (const property of properties) {
    if (verdicts.has(property.name)) continue;
    try {
      finalizeProperty(model, property, traceCtx, graph, verdicts);
    } catch (error) {
      verdicts.set(property.name, {
        status: "error",
        property: property.name,
        message: (error as Error).message,
      });
    }
  }
}

function finalizeProperty(
  model: Model,
  property: Property,
  traceCtx: TraceContext,
  graph: GraphRecording,
  verdicts: Map<string, PropertyVerdict>,
): void {
  if (property.kind === "reachable") {
    verdicts.set(property.name, {
      status: "vacuous-warning",
      property: property.name,
      message: "No reachable witness within bounds",
    });
  }
  if (property.kind === "reachableFrom") {
    const reverseEdges =
      graph.mode === "reverse"
        ? graph.reverseEdges
        : graph.compactEdges.map((edge) => ({
            preCanon: edge.preCanon,
            postCanon: edge.postCanon,
          }));
    const witness = unreachableWitness(
      model,
      property,
      traceCtx.states,
      reverseEdges,
    );
    if (witness) {
      verdicts.set(property.name, {
        status: "violated",
        property: property.name,
        trace: traceTo(traceCtx, witness[0]),
        replayable: false,
        replayBlockedReason:
          "reachableFrom counterexamples assert absence of a path and are not replayable",
      });
    }
  }
  if (property.kind === "leadsToWithin") {
    finalizeLeadsToWithin(model, property, traceCtx, graph, verdicts);
  }
}

function finalizeLeadsToWithin(
  model: Model,
  property: Extract<Property, { kind: "leadsToWithin" }>,
  traceCtx: TraceContext,
  graph: GraphRecording,
  verdicts: Map<string, PropertyVerdict>,
): void {
  const triggerEdges = resolveTriggerEdges(model, property, traceCtx, graph);
  if (triggerEdges.length === 0) {
    verdicts.set(property.name, {
      status: "vacuous-warning",
      property: property.name,
      message: "Trigger never fired within bounds",
    });
    return;
  }
  const failure = triggerEdges
    .map((edge) => ({
      edge,
      suffix: failingSuffixWithin(model, property, edge.post),
    }))
    .find((candidate) => candidate.suffix);
  if (failure) {
    const suffix = failure.suffix ?? [];
    verdicts.set(
      property.name,
      replayCheckedVerdict("violated", property.name, {
        steps: [
          ...traceTo(traceCtx, failure.edge.preCanon).steps,
          makeTraceStep(
            failure.edge.pre,
            failure.edge.post,
            failure.edge.transition,
          ),
          ...suffix.map((edge) =>
            makeTraceStep(edge.pre, edge.post, edge.transition),
          ),
        ],
      }),
    );
  }
}

function resolveTriggerEdges(
  model: Model,
  property: Extract<Property, { kind: "leadsToWithin" }>,
  traceCtx: TraceContext,
  graph: GraphRecording,
): Edge[] {
  if (graph.mode === "full") {
    return graph.fullEdges.filter((edge) => property.trigger(edge.step));
  }
  const compactEdges =
    graph.mode === "compact" ? graph.compactEdges : graph.fullEdges;
  return compactEdges
    .filter((edge) =>
      "triggeredProperties" in edge
        ? edge.triggeredProperties.includes(property.name)
        : property.trigger(edge.step),
    )
    .map((edge) => materializeEdge(model, traceCtx, edge));
}

function materializeEdge(
  model: Model,
  traceCtx: TraceContext,
  edge: CompactEdge | Edge,
): Edge {
  if ("transition" in edge) return edge;
  const pre = traceCtx.states.get(edge.preCanon);
  const post = traceCtx.states.get(edge.postCanon);
  const transition = model.transitions.find(
    (candidate) => candidate.id === edge.transitionId,
  );
  if (!pre || !post || !transition) {
    throw new Error(
      `missing edge materialization for ${edge.preCanon} -> ${edge.postCanon}`,
    );
  }
  return {
    preCanon: edge.preCanon,
    postCanon: edge.postCanon,
    pre,
    post,
    transition,
    step: facts(pre, post, transition),
  };
}
