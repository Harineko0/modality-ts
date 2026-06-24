import { modelInitialStates, modelSuccessors } from "modality-ts/check";
import {
  canonicalJson,
  canonicalState,
  type CheckReport,
  type Model,
  type ModelState,
} from "modality-ts/core";
import type { BenchmarkSearchLimits } from "../benchmark/manifest.js";

export interface ModelComparisonInput {
  baseline: Model;
  variant: Model;
  baselineReport?: CheckReport;
  variantReport?: CheckReport;
  searchLimits?: BenchmarkSearchLimits;
}

export interface StateSetDelta {
  baselineOnly: readonly string[];
  variantOnly: readonly string[];
}

export interface VerdictDelta {
  property: string;
  baseline?: string;
  variant?: string;
}

export interface ModelComparison {
  bisimilar: boolean;
  stateSetDelta?: StateSetDelta;
  verdictDelta?: readonly VerdictDelta[];
  boundHit?: boolean;
  baselineStates: number;
  variantStates: number;
}

export function compareModels(input: ModelComparisonInput): ModelComparison {
  const verdictDelta = compareVerdicts(
    input.baselineReport,
    input.variantReport,
  );

  // Metamorphic transforms are semantics-preserving, so an IR-preserving
  // transform yields a model whose vars/transitions are byte-identical to the
  // baseline (only provenance metadata such as source hashes differs). Identical
  // transition systems are bisimilar by construction, so we can decide stability
  // exactly and cheaply via a semantic fingerprint — and crucially avoid the
  // reachable-state enumeration below, which does not scale to realistic models
  // (their state space dwarfs any practical maxStates bound, producing spurious
  // `boundHit` inconclusives even for trivially-equivalent variants).
  if (
    semanticModelFingerprint(input.baseline) ===
    semanticModelFingerprint(input.variant)
  ) {
    return {
      bisimilar: verdictDelta.length === 0,
      ...(verdictDelta.length > 0 ? { verdictDelta } : {}),
      baselineStates: 0,
      variantStates: 0,
    };
  }

  const baselineStates = reachableStateSet(input.baseline, input.searchLimits);
  const variantStates = reachableStateSet(input.variant, input.searchLimits);
  const stateSetDelta = diffSets(baselineStates.states, variantStates.states);
  const boundHit = baselineStates.boundHit || variantStates.boundHit;
  const hasStateDelta =
    stateSetDelta.baselineOnly.length > 0 ||
    stateSetDelta.variantOnly.length > 0;
  const hasVerdictDelta = verdictDelta.length > 0;
  return {
    bisimilar: !boundHit && !hasStateDelta && !hasVerdictDelta,
    ...(hasStateDelta ? { stateSetDelta } : {}),
    ...(hasVerdictDelta ? { verdictDelta } : {}),
    ...(boundHit ? { boundHit: true } : {}),
    baselineStates: baselineStates.states.size,
    variantStates: variantStates.states.size,
  };
}

/**
 * Canonical fingerprint of a model's transition system (bounds + vars +
 * transitions), independent of declaration order and excluding provenance
 * metadata (id, source hashes, plugin list) that varies between a baseline and
 * a copied-app variant without changing behavior.
 */
function semanticModelFingerprint(model: Model): string {
  const vars = [...model.vars].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const transitions = [...model.transitions].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return canonicalJson({ bounds: model.bounds, vars, transitions });
}

function reachableStateSet(
  model: Model,
  searchLimits?: BenchmarkSearchLimits,
): { states: Set<string>; boundHit: boolean } {
  const maxStates = searchLimits?.maxStates ?? 1_000_000;
  const maxEdges = searchLimits?.maxEdges ?? 5_000_000;
  const maxFrontier = searchLimits?.maxFrontier ?? 250_000;
  const states = new Set<string>();
  const queue: ModelState[] = [];
  let edges = 0;
  let boundHit = false;

  for (const initial of modelInitialStates(model)) {
    const key = canonicalState(model, initial);
    if (!states.has(key)) {
      states.add(key);
      queue.push(initial);
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    if (
      states.size > maxStates ||
      edges > maxEdges ||
      queue.length - cursor > maxFrontier
    ) {
      boundHit = true;
      break;
    }
    const current = queue[cursor];
    if (!current) continue;
    for (const step of modelSuccessors(model, current)) {
      edges += 1;
      const key = canonicalState(model, step.post);
      if (!states.has(key)) {
        states.add(key);
        queue.push(step.post);
        if (states.size > maxStates) {
          boundHit = true;
          break;
        }
      }
      if (edges > maxEdges) {
        boundHit = true;
        break;
      }
    }
    if (boundHit) break;
  }

  return { states, boundHit };
}

function diffSets(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): StateSetDelta {
  return {
    baselineOnly: [...left]
      .filter((entry) => !right.has(entry))
      .sort()
      .slice(0, 5),
    variantOnly: [...right]
      .filter((entry) => !left.has(entry))
      .sort()
      .slice(0, 5),
  };
}

function compareVerdicts(
  baselineReport: CheckReport | undefined,
  variantReport: CheckReport | undefined,
): VerdictDelta[] {
  if (!baselineReport && !variantReport) return [];
  const baseline = verdictMap(baselineReport);
  const variant = verdictMap(variantReport);
  const properties = [
    ...new Set([...baseline.keys(), ...variant.keys()]),
  ].sort();
  return properties
    .map((property) => ({
      property,
      baseline: baseline.get(property),
      variant: variant.get(property),
    }))
    .filter((entry) => entry.baseline !== entry.variant);
}

function verdictMap(report: CheckReport | undefined): Map<string, string> {
  const entries = new Map<string, string>();
  for (const verdict of report?.verdicts ?? []) {
    entries.set(
      verdict.property,
      canonicalJson({
        status: verdict.status,
        message: verdict.message,
      }),
    );
  }
  return entries;
}
