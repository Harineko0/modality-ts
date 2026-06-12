import { canonicalJson } from "@modality/kernel";
import type { ModelState, Value } from "@modality/kernel";

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
