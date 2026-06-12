import type { ModelState, Trace, TraceStep } from "@modality/kernel";

export type ReplayVerdict =
  | { status: "reproduced"; stepsRun: number }
  | { status: "not-reproduced"; stepsRun: number; divergenceStep: number; reason: string }
  | { status: "inconclusive"; stepsRun: number; reason: string };

export interface ReplayDriver {
  currentState(): ModelState;
  apply(step: TraceStep): Promise<void> | void;
  assertViolation?(): Promise<boolean> | boolean;
}

export interface ReplayOptions {
  compareState?: (expected: ModelState, actual: ModelState) => string | undefined;
}

export async function replayTrace(trace: Trace, driver: ReplayDriver, options: ReplayOptions = {}): Promise<ReplayVerdict> {
  const compare = options.compareState ?? defaultCompareState;
  for (let index = 0; index < trace.steps.length; index += 1) {
    const step = trace.steps[index]!;
    const preMismatch = compare(step.pre, driver.currentState());
    if (preMismatch) return { status: "not-reproduced", stepsRun: index, divergenceStep: index + 1, reason: `precondition mismatch: ${preMismatch}` };
    try {
      await driver.apply(step);
    } catch (error) {
      return { status: "inconclusive", stepsRun: index, reason: error instanceof Error ? error.message : String(error) };
    }
    const postMismatch = compare(step.post, driver.currentState());
    if (postMismatch) return { status: "not-reproduced", stepsRun: index + 1, divergenceStep: index + 1, reason: `postcondition mismatch: ${postMismatch}` };
  }
  const violationObserved = driver.assertViolation ? await driver.assertViolation() : true;
  return violationObserved ? { status: "reproduced", stepsRun: trace.steps.length } : { status: "not-reproduced", stepsRun: trace.steps.length, divergenceStep: trace.steps.length, reason: "final violation was not observed" };
}

export class StateSequenceDriver implements ReplayDriver {
  private index = 0;

  constructor(private readonly states: readonly ModelState[], private readonly failAtStep?: number) {
    if (states.length === 0) throw new Error("StateSequenceDriver requires at least one state");
  }

  currentState(): ModelState {
    return this.states[Math.min(this.index, this.states.length - 1)]!;
  }

  apply(_step: TraceStep): void {
    if (this.failAtStep !== undefined && this.index + 1 === this.failAtStep) {
      throw new Error(`driver failed at step ${this.failAtStep}`);
    }
    this.index = Math.min(this.index + 1, this.states.length - 1);
  }
}

function defaultCompareState(expected: ModelState, actual: ModelState): string | undefined {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of [...keys].sort()) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) {
      return `${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`;
    }
  }
  return undefined;
}
