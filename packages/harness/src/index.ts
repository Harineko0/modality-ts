import type { AbstractDomain, Locator, ModelState, Trace, TraceStep, Value } from "@modality-ts/kernel";

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

export interface DomReplayActorOptions {
  document?: Document;
  stabilize?: () => Promise<void> | void;
  navigate?: ReplayActor["navigate"];
  resolve?: ReplayActor["resolve"];
  focusRevalidate?: ReplayActor["focusRevalidate"];
  timer?: ReplayActor["timer"];
}

export interface ModalityReplayHarness extends DomReplayActorOptions {
  sources?: readonly ObservationSource[];
}

export interface ActionReplayDriverOptions {
  inputValues?: Record<string, string>;
  assertViolation?: () => Promise<boolean> | boolean;
}

export interface ObservationSource {
  id?: string;
  observe(varId: string): { value: Value } | "unobservable";
}

export interface ObservedModelState {
  state: ModelState;
  unobservable: readonly string[];
}

export interface WitnessOptions {
  tokenWitnesses?: Record<string, Value>;
  elementWitness?: Value;
}

export async function replayTrace(trace: Trace, driver: ReplayDriver, options: ReplayOptions = {}): Promise<ReplayVerdict> {
  const compare = options.compareState ?? defaultCompareState;
  for (let index = 0; index < trace.steps.length; index += 1) {
    const step = trace.steps[index]!;
    let preState: ModelState;
    try {
      preState = driver.currentState();
    } catch (error) {
      return { status: "inconclusive", stepsRun: index, reason: error instanceof Error ? error.message : String(error) };
    }
    const preMismatch = compare(step.pre, preState);
    if (preMismatch) return { status: "not-reproduced", stepsRun: index, divergenceStep: index + 1, reason: `precondition mismatch: ${preMismatch}` };
    try {
      await driver.apply(step);
    } catch (error) {
      return { status: "inconclusive", stepsRun: index, reason: error instanceof Error ? error.message : String(error) };
    }
    let postState: ModelState;
    try {
      postState = driver.currentState();
    } catch (error) {
      return { status: "inconclusive", stepsRun: index + 1, reason: error instanceof Error ? error.message : String(error) };
    }
    const postMismatch = compare(step.post, postState);
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

export function statesFromTrace(trace: Trace): ModelState[] {
  return trace.steps.length === 0 ? [{}] : [trace.steps[0]!.pre, ...trace.steps.map((step) => step.post)];
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

export class ObservableActionReplayDriver implements ReplayDriver {
  constructor(
    private readonly actor: ReplayActor,
    private readonly varIds: readonly string[],
    private readonly sources: readonly ObservationSource[],
    private readonly options: ActionReplayDriverOptions = {}
  ) {}

  currentState(): ModelState {
    const observed = observeModelState(this.varIds, this.sources);
    if (observed.unobservable.length > 0) {
      throw new Error(`Unobservable model vars: ${observed.unobservable.join(", ")}`);
    }
    return observed.state;
  }

  async apply(step: TraceStep): Promise<void> {
    await dispatchReplayStep(step, this.actor, this.options);
  }

  async assertViolation(): Promise<boolean> {
    return this.options.assertViolation ? this.options.assertViolation() : true;
  }
}

export class TraceBackedActionReplayDriver implements ReplayDriver {
  private readonly states: readonly ModelState[];
  private index = 0;

  constructor(
    trace: Trace,
    private readonly actor: ReplayActor,
    private readonly options: ActionReplayDriverOptions = {}
  ) {
    this.states = statesFromTrace(trace);
  }

  currentState(): ModelState {
    return this.states[Math.min(this.index, this.states.length - 1)]!;
  }

  async apply(step: TraceStep): Promise<void> {
    await dispatchReplayStep(step, this.actor, this.options);
    this.index = Math.min(this.index + 1, this.states.length - 1);
  }

  async assertViolation(): Promise<boolean> {
    return this.options.assertViolation ? this.options.assertViolation() : true;
  }
}

export function observeModelState(varIds: readonly string[], sources: readonly ObservationSource[]): ObservedModelState {
  const state: ModelState = {};
  const unobservable: string[] = [];
  for (const varId of varIds) {
    const observed = firstObserved(varId, sources);
    if (observed === "unobservable") {
      unobservable.push(varId);
    } else {
      state[varId] = observed.value;
    }
  }
  return { state, unobservable };
}

export function observationSource(id: string, observe: (varId: string) => { value: Value } | "unobservable"): ObservationSource {
  return { id, observe };
}

export function createDomReplayActor(options: DomReplayActorOptions = {}): ReplayActor {
  const doc = options.document ?? globalThis.document;
  if (!doc) throw new Error("createDomReplayActor requires a document");
  return {
    click: async (locator) => {
      const element = locateOne(doc, locator);
      assertEnabled(element, locator);
      if (typeof element.click === "function") element.click();
      else dispatchDomEvent(doc, element, "click", { bubbles: true, cancelable: true });
    },
    submit: async (locator) => {
      const element = locateOne(doc, locator);
      assertEnabled(element, locator);
      const submitTarget = formFor(element);
      if (submitTarget && typeof submitTarget.requestSubmit === "function") submitTarget.requestSubmit();
      else dispatchDomEvent(doc, submitTarget ?? element, "submit", { bubbles: true, cancelable: true });
    },
    input: async (locator, value) => {
      const element = locateOne(doc, locator) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      assertEnabled(element, locator);
      element.value = value;
      dispatchDomEvent(doc, element, "input", { bubbles: true });
      dispatchDomEvent(doc, element, "change", { bubbles: true });
    },
    navigate: options.navigate,
    resolve: options.resolve,
    focusRevalidate: options.focusRevalidate,
    timer: options.timer,
    stabilize: options.stabilize
  };
}

function firstObserved(varId: string, sources: readonly ObservationSource[]): { value: Value } | "unobservable" {
  for (const source of sources) {
    const observed = source.observe(varId);
    if (observed !== "unobservable") return observed;
  }
  return "unobservable";
}

function locateOne(doc: Document, locator: Locator): HTMLElement {
  const matches = locateAll(doc, locator);
  const element = matches[0];
  if (!element) throw new Error(`No element found for ${formatLocator(locator)}`);
  return element;
}

function locateAll(doc: Document, locator: Locator): HTMLElement[] {
  if (locator.kind === "positional") return locateAll(doc, locator.base).slice(locator.index, locator.index + 1);
  if (locator.kind === "testId") return [...doc.querySelectorAll(`[data-testid="${cssString(locator.value)}"]`)] as HTMLElement[];
  const candidates = [...doc.querySelectorAll(roleSelector(locator.role))] as HTMLElement[];
  return candidates.filter((element) => elementRole(element) === locator.role && (!locator.name || elementName(element) === locator.name));
}

function roleSelector(role: string): string {
  const implicit = role === "button" ? "button,input[type=button],input[type=submit]" :
    role === "textbox" ? "input:not([type]),input[type=text],textarea" :
    role === "combobox" ? "select" :
    role === "radio" ? "input[type=radio]" :
    role === "form" ? "form" :
    "";
  return implicit ? `[role="${cssString(role)}"],${implicit}` : `[role="${cssString(role)}"]`;
}

function elementRole(element: HTMLElement): string | undefined {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "form") return "form";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (type === "button" || type === "submit") return "button";
    if (type === "radio") return "radio";
    return "textbox";
  }
  return undefined;
}

function elementName(element: HTMLElement): string {
  return element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "";
}

function assertEnabled(element: HTMLElement, locator: Locator): void {
  if ((element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled || element.getAttribute("aria-disabled") === "true") {
    throw new Error(`Element is disabled for ${formatLocator(locator)}`);
  }
}

function formFor(element: HTMLElement): HTMLFormElement | undefined {
  if (element.tagName.toLowerCase() === "form") return element as HTMLFormElement;
  return (element as HTMLButtonElement | HTMLInputElement).form ?? undefined;
}

function dispatchDomEvent(doc: Document, element: HTMLElement, type: string, init: EventInit): void {
  const EventCtor = doc.defaultView?.Event ?? Event;
  element.dispatchEvent(new EventCtor(type, init));
}

function cssString(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function formatLocator(locator: Locator): string {
  return JSON.stringify(locator);
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
