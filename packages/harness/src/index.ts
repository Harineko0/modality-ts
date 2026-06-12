import type { AbstractDomain, Locator, ModelState, Trace, TraceStep, Value } from "@modality/kernel";

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

export interface WitnessOptions {
  tokenWitnesses?: Record<string, Value>;
  elementWitness?: Value;
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
      await callActor("input", actor.input, label.locator, options.inputValues?.[label.valueClass] ?? inputWitness(label.valueClass), label.valueClass);
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

export function witnessValue(domain: AbstractDomain, value?: Value, options: WitnessOptions = {}): Value {
  if (value !== undefined && value !== null) {
    if (domain.kind === "lengthCat") return witnessLengthCat(value);
    if (domain.kind === "tokens" && typeof value === "string") return options.tokenWitnesses?.[value] ?? value;
    if (domain.kind === "option") return witnessValue(domain.inner, value, options);
    if (domain.kind === "record" && isRecord(value)) return witnessRecord(domain.fields, value, options);
    if (domain.kind === "tagged" && isRecord(value) && typeof value[domain.tag] === "string") {
      const variant = domain.variants[value[domain.tag] as string];
      return variant ? { ...(witnessValue(variant, value, options) as object), [domain.tag]: value[domain.tag] } : value;
    }
    if (domain.kind === "boundedList" && Array.isArray(value)) return value.map((item) => witnessValue(domain.inner, item, options));
    return value;
  }
  switch (domain.kind) {
    case "bool":
      return false;
    case "enum":
      return domain.values[0] ?? "";
    case "boundedInt":
      return domain.min;
    case "option":
      return null;
    case "record":
      return witnessRecord(domain.fields, undefined, options);
    case "tagged": {
      const [tagValue, variant] = Object.entries(domain.variants)[0] ?? ["unknown", { kind: "record", fields: {} } as const];
      return { ...(witnessValue(variant, undefined, options) as object), [domain.tag]: tagValue };
    }
    case "tokens": {
      const token = domain.names?.[0] ?? "tok1";
      return options.tokenWitnesses?.[token] ?? token;
    }
    case "lengthCat":
      return [];
    case "boundedList":
      return [];
  }
}

export function inputWitness(valueClass: string): string {
  switch (valueClass) {
    case "empty":
    case "0":
      return "";
    case "nonEmpty":
    case "1":
    case "many":
    case "valid":
      return "modality";
    case "invalid":
      return "!";
    default:
      return valueClass.includes("|") ? inputWitness(valueClass.split("|").find((part) => part !== "empty") ?? valueClass.split("|")[0]!) : valueClass;
  }
}

function witnessLengthCat(value: Value): Value {
  if (value === "0") return [];
  if (value === "1") return ["item1"];
  if (value === "many") return ["item1", "item2", "item3"];
  return value;
}

function witnessRecord(fields: Record<string, AbstractDomain>, value: Record<string, Value> | undefined, options: WitnessOptions): Value {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, witnessValue(field, value?.[key], options)]));
}

function isRecord(value: Value): value is Record<string, Value> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
