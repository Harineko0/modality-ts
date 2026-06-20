import type { ModelState, Property, Value } from "modality-ts/core/props";
import { evalStatePredicate } from "modality-ts/core/props";

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

export interface ModalityAssertionStore<TContext> {
  getSnapshot(): TContext;
  subscribe(listener: () => void): () => void;
}

export interface ModalityAssertionEvent<TContext = unknown> {
  result: ObservableInvariantResult;
  context: TContext;
}

export interface ModalityAssertionOptions<TContext = unknown> {
  onResult?: (event: ModalityAssertionEvent<TContext>) => void;
  onViolation?: (event: ModalityAssertionEvent<TContext>) => void;
  throwOnViolation?: boolean;
}

export interface ModalityAssertionController {
  check(): ObservableInvariantResult;
  start(): () => void;
}

export function observable<TContext>(
  varId: string,
  read: (context: TContext) => Value,
): Observable<TContext> {
  return { var: varId, read };
}

export function assertObservableState<TContext>(
  expected: ModelState,
  observables: readonly Observable<TContext>[],
  context: TContext,
): ObservableAssertion {
  const mismatches = observables
    .map((probe) => ({
      var: probe.var,
      expected: expected[probe.var],
      actual: probe.read(context),
    }))
    .filter(
      (mismatch) =>
        stableJson(mismatch.expected) !== stableJson(mismatch.actual),
    );
  return { ok: mismatches.length === 0, mismatches };
}

export function assertObservableStateOrThrow<TContext>(
  expected: ModelState,
  observables: readonly Observable<TContext>[],
  context: TContext,
): void {
  const assertion = assertObservableState(expected, observables, context);
  if (!assertion.ok) {
    throw new Error(
      `Observable state mismatch: ${assertion.mismatches.map((mismatch) => `${mismatch.var} expected=${stableJson(mismatch.expected)} actual=${stableJson(mismatch.actual)}`).join("; ")}`,
    );
  }
}

export function readObservableState<TContext>(
  observables: readonly Observable<TContext>[],
  context: TContext,
): ModelState {
  return Object.fromEntries(
    observables.map((probe) => [probe.var, probe.read(context)]),
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

class UnobservableReadError extends Error {
  constructor(readonly varId: string) {
    super(`unobservable read: ${varId}`);
  }
}

export function evaluateObservableInvariants<TContext>(
  properties: readonly Property[],
  observables: readonly Observable<TContext>[],
  context: TContext,
): ObservableInvariantResult {
  const state = readObservableState(observables, context);
  const observableIds = new Set(observables.map((probe) => probe.var));
  const violations: ObservableInvariantViolation[] = [];
  const skipped: ObservableInvariantSkip[] = [];
  for (const property of properties) {
    // Runtime assertion only supports AG(atom(pred)) — the "always" shape.
    const atomPredicate =
      property.kind === "temporal" &&
      property.formula.kind === "AG" &&
      property.formula.arg.kind === "atom"
        ? property.formula.arg.predicate
        : undefined;
    if (!atomPredicate) {
      skipped.push({
        property: property.name,
        reason: `unsupported property kind for runtime assertion: ${property.kind}${property.kind === "temporal" ? ` (formula: ${property.formula.kind})` : ""}`,
      });
      continue;
    }
    const missingReads = (property.reads ?? []).filter(
      (read) => !observableIds.has(read),
    );
    if (missingReads.length > 0) {
      skipped.push({
        property: property.name,
        reason: `unobservable reads: ${missingReads.join(",")}`,
      });
      continue;
    }
    try {
      if (
        !evalStatePredicate(
          atomPredicate,
          runtimeCheckedState(state, observableIds),
        )
      ) {
        violations.push({
          property: property.name,
          message: "observable invariant failed",
        });
      }
    } catch (error) {
      if (error instanceof UnobservableReadError) {
        skipped.push({
          property: property.name,
          reason: `unobservable reads: ${error.varId}`,
        });
        continue;
      }
      violations.push({
        property: property.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    ok: violations.length === 0 && skipped.length === 0,
    state,
    violations,
    skipped,
  };
}

function runtimeCheckedState(
  state: ModelState,
  observableIds: ReadonlySet<string>,
): ModelState {
  return new Proxy(state, {
    get(target, key, receiver) {
      if (typeof key === "string" && !observableIds.has(key))
        throw new UnobservableReadError(key);
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
}

export function assertObservableInvariantsOrThrow<TContext>(
  properties: readonly Property[],
  observables: readonly Observable<TContext>[],
  context: TContext,
): void {
  const result = evaluateObservableInvariants(properties, observables, context);
  if (!result.ok) {
    throw new Error(
      `Observable invariant violation: ${result.violations.map((violation) => `${violation.property}: ${violation.message}`).join("; ")}`,
    );
  }
}

export function createModalityAssertions<TContext>(
  properties: readonly Property[],
  observables: readonly Observable<TContext>[],
  store: ModalityAssertionStore<TContext>,
  options: ModalityAssertionOptions<TContext> = {},
): ModalityAssertionController {
  const check = (): ObservableInvariantResult => {
    const context = store.getSnapshot();
    const result = evaluateObservableInvariants(
      properties,
      observables,
      context,
    );
    const event = { result, context };
    options.onResult?.(event);
    if (!result.ok) {
      options.onViolation?.(event);
      if (options.throwOnViolation) {
        throw new Error(
          `Observable invariant violation: ${result.violations.map((violation) => `${violation.property}: ${violation.message}`).join("; ")}`,
        );
      }
    }
    return result;
  };
  return {
    check,
    start() {
      check();
      return store.subscribe(() => {
        check();
      });
    },
  };
}
