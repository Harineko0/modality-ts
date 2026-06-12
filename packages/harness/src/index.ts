import type { Locator, ModelState, Trace, TraceStep } from "@modality/kernel";

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

export interface ReplayActor {
  click?(locator: Locator): Promise<void> | void;
  submit?(locator: Locator): Promise<void> | void;
  input?(locator: Locator, value: string, valueClass: string): Promise<void> | void;
  navigate?(mode: "push" | "back", to?: string): Promise<void> | void;
  resolve?(op: string, outcome: string): Promise<void> | void;
  focusRevalidate?(key?: string): Promise<void> | void;
  timer?(key?: string): Promise<void> | void;
  stabilize?(): Promise<void> | void;
}

export interface ActionReplayDriverOptions {
  inputValues?: Record<string, string>;
  assertViolation?: () => Promise<boolean> | boolean;
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

export class ActionReplayDriver implements ReplayDriver {
  constructor(
    private readonly actor: ReplayActor,
    private readonly observe: () => ModelState,
    private readonly options: ActionReplayDriverOptions = {}
  ) {}

  currentState(): ModelState {
    return this.observe();
  }

  async apply(step: TraceStep): Promise<void> {
    await dispatchReplayStep(step, this.actor, this.options);
  }

  async assertViolation(): Promise<boolean> {
    return this.options.assertViolation ? this.options.assertViolation() : true;
  }
}

export async function dispatchReplayStep(step: TraceStep, actor: ReplayActor, options: ActionReplayDriverOptions = {}): Promise<void> {
  const label = step.label;
  switch (label.kind) {
    case "click":
      if (!label.locator) throw new Error(`Missing locator for click step ${step.transitionId}`);
      await callActor("click", actor.click, label.locator);
      break;
    case "submit":
      if (!label.locator) throw new Error(`Missing locator for submit step ${step.transitionId}`);
      await callActor("submit", actor.submit, label.locator);
      break;
    case "input":
      if (!label.locator) throw new Error(`Missing locator for input step ${step.transitionId}`);
      await callActor("input", actor.input, label.locator, options.inputValues?.[label.valueClass] ?? label.valueClass, label.valueClass);
      break;
    case "navigate":
      await callActor("navigate", actor.navigate, label.mode, label.to);
      break;
    case "resolve":
      await callActor("resolve", actor.resolve, label.op, label.outcome);
      break;
    case "focus-revalidate":
      await callActor("focus-revalidate", actor.focusRevalidate, label.key);
      break;
    case "timer":
      await callActor("timer", actor.timer, label.key);
      break;
    case "internal":
      break;
  }
  await actor.stabilize?.();
}

async function callActor<TArgs extends unknown[]>(name: string, fn: ((...args: TArgs) => Promise<void> | void) | undefined, ...args: TArgs): Promise<void> {
  if (!fn) throw new Error(`Replay actor does not support ${name}`);
  await fn(...args);
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
