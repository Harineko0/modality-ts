import { canonicalJson } from "@modality/kernel";
import type { ModelState, Property, Value } from "@modality/kernel";

export interface Observable<TContext = unknown> {
  var: string;
  read(context: TContext): Value;
}

export interface ObservableMismatch {
  var: string;
  expected: Value | undefined;
  actual: Value | undefined;
}

export interface ObservableAssertion {
  ok: boolean;
  mismatches: ObservableMismatch[];
}

export interface ObservableInvariantViolation {
  property: string;
  message: string;
}

export interface ObservableInvariantSkip {
  property: string;
  reason: string;
}

export interface ObservableInvariantResult {
  ok: boolean;
  state: ModelState;
  violations: ObservableInvariantViolation[];
  skipped: ObservableInvariantSkip[];
}

export function observable<TContext>(varId: string, read: (context: TContext) => Value): Observable<TContext> {
  return { var: varId, read };
}

export function assertObservableState<TContext>(
  expected: ModelState,
  observables: readonly Observable<TContext>[],
  context: TContext
): ObservableAssertion {
  const mismatches = observables
    .map((probe) => ({ var: probe.var, expected: expected[probe.var], actual: probe.read(context) }))
    .filter((mismatch) => canonicalJson(mismatch.expected) !== canonicalJson(mismatch.actual));
  return { ok: mismatches.length === 0, mismatches };
}

export function assertObservableStateOrThrow<TContext>(
  expected: ModelState,
  observables: readonly Observable<TContext>[],
  context: TContext
): void {
  const assertion = assertObservableState(expected, observables, context);
  if (!assertion.ok) {
    throw new Error(`Observable state mismatch: ${assertion.mismatches.map((mismatch) => `${mismatch.var} expected=${canonicalJson(mismatch.expected)} actual=${canonicalJson(mismatch.actual)}`).join("; ")}`);
  }
}

export function readObservableState<TContext>(observables: readonly Observable<TContext>[], context: TContext): ModelState {
  return Object.fromEntries(observables.map((probe) => [probe.var, probe.read(context)]));
}

export function evaluateObservableInvariants<TContext>(
  properties: readonly Property[],
  observables: readonly Observable<TContext>[],
  context: TContext
): ObservableInvariantResult {
  const state = readObservableState(observables, context);
  const observableIds = new Set(observables.map((probe) => probe.var));
  const violations: ObservableInvariantViolation[] = [];
  const skipped: ObservableInvariantSkip[] = [];
  for (const property of properties) {
    if (property.kind !== "always") {
      skipped.push({ property: property.name, reason: `unsupported property kind: ${property.kind}` });
      continue;
    }
    const missingReads = (property.reads ?? []).filter((read) => !observableIds.has(read));
    if (missingReads.length > 0) {
      skipped.push({ property: property.name, reason: `unobservable reads: ${missingReads.join(",")}` });
      continue;
    }
    try {
      if (!property.predicate(state)) {
        violations.push({ property: property.name, message: "observable invariant failed" });
      }
    } catch (error) {
      violations.push({ property: property.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: violations.length === 0, state, violations, skipped };
}

export function assertObservableInvariantsOrThrow<TContext>(
  properties: readonly Property[],
  observables: readonly Observable<TContext>[],
  context: TContext
): void {
  const result = evaluateObservableInvariants(properties, observables, context);
  if (!result.ok) {
    throw new Error(`Observable invariant violation: ${result.violations.map((violation) => `${violation.property}: ${violation.message}`).join("; ")}`);
  }
}
