import { canonicalJson, enumerateDomain } from "@modality/kernel";
import type { AbstractDomain, ExprIR, ModelState, StateVarDecl, TemplateFragment, Transition, Value } from "@modality/kernel";

export interface SwrTemplateOptions {
  id: string;
  op: string;
  payloadDomain: AbstractDomain;
  activeWhen?: ExprIR;
  sourceFile?: string;
}

export interface SwrKeyWindowEntry {
  id: string;
  op?: string;
  activeWhen?: ExprIR;
}

export interface SwrKeyWindowTemplateOptions {
  id: string;
  op: string;
  payloadDomain: AbstractDomain;
  entries: readonly SwrKeyWindowEntry[];
  windowSize?: number;
  activeWhen?: ExprIR;
  sourceFile?: string;
}

export interface SwrView {
  active: boolean;
  data: Value | null;
  error: boolean;
  isLoading: boolean;
  isValidating: boolean;
  loadedEmpty: boolean;
  loadedSome: boolean;
}

export function createSwrTemplate(options: SwrTemplateOptions): TemplateFragment {
  const vars = swrVars(options);
  const active = options.activeWhen ?? lit(true);
  const source = options.sourceFile ? [{ file: options.sourceFile }] : [];
  const dataVar = swrVarId(options.id, "data");
  const validatingVar = swrVarId(options.id, "isValidating");
  const errorVar = swrVarId(options.id, "error");
  const transitions: Transition[] = [
    {
      id: `swr:${options.id}:fetch`,
      cls: "library",
      label: { kind: "timer", key: options.id },
      source,
      guard: active,
      effect: {
        kind: "seq",
        effects: [
          { kind: "assign", var: validatingVar, expr: lit(true) },
          { kind: "enqueue", op: options.op, continuation: `swr:${options.id}:resolve`, args: {} }
        ]
      },
      reads: [...exprReadList(active)],
      writes: [validatingVar, "sys:pending"],
      confidence: "exact"
    },
    ...successTransitions(options),
    {
      id: `swr:${options.id}:resolve:error`,
      cls: "env",
      label: { kind: "resolve", op: options.op, outcome: "error" },
      source,
      guard: pendingIs(options.op),
      effect: {
        kind: "seq",
        effects: [
          { kind: "dequeue", index: 0 },
          { kind: "assign", var: validatingVar, expr: lit(false) },
          { kind: "assign", var: errorVar, expr: lit(true) }
        ]
      },
      reads: ["sys:pending"],
      writes: ["sys:pending", validatingVar, errorVar],
      confidence: "exact"
    }
  ];
  return { vars, transitions };

  function successTransitions(template: SwrTemplateOptions): Transition[] {
    return enumerateDomain(template.payloadDomain).map((value, index) => ({
      id: `swr:${template.id}:resolve:success:${index}`,
      cls: "env" as const,
      label: { kind: "resolve" as const, op: template.op, outcome: `success:${index}` },
      source,
      guard: pendingIs(template.op),
      effect: {
        kind: "seq" as const,
        effects: [
          { kind: "dequeue" as const, index: 0 },
          { kind: "assign" as const, var: dataVar, expr: lit(value) },
          { kind: "assign" as const, var: validatingVar, expr: lit(false) },
          { kind: "assign" as const, var: errorVar, expr: lit(false) }
        ]
      },
      reads: ["sys:pending"],
      writes: ["sys:pending", dataVar, validatingVar, errorVar],
      confidence: "exact" as const
    }));
  }
}

export function createSwrKeyWindowTemplate(options: SwrKeyWindowTemplateOptions): TemplateFragment {
  const windowSize = options.windowSize ?? 2;
  const entries = options.entries.slice(0, windowSize);
  const fragments = entries.map((entry) =>
    createSwrTemplate({
      id: swrWindowEntryId(options.id, entry.id),
      op: entry.op ?? `${options.op}:${entry.id}`,
      payloadDomain: options.payloadDomain,
      activeWhen: combineActive(options.activeWhen, entry.activeWhen),
      sourceFile: options.sourceFile
    })
  );
  return {
    vars: fragments.flatMap((fragment) => fragment.vars),
    transitions: fragments.flatMap((fragment) => fragment.transitions)
  };
}

export function swrVars(options: SwrTemplateOptions): StateVarDecl[] {
  return [
    { id: swrVarId(options.id, "data"), domain: { kind: "option", inner: options.payloadDomain }, origin: "library-template", scope: { kind: "global" }, initial: null },
    { id: swrVarId(options.id, "isValidating"), domain: { kind: "bool" }, origin: "library-template", scope: { kind: "global" }, initial: false },
    { id: swrVarId(options.id, "error"), domain: { kind: "bool" }, origin: "library-template", scope: { kind: "global" }, initial: false }
  ];
}

export function swrView(state: ModelState, id: string, options: { active?: boolean } = {}): SwrView {
  const data = state[swrVarId(id, "data")] ?? null;
  const error = state[swrVarId(id, "error")] === true;
  const isValidating = state[swrVarId(id, "isValidating")] === true;
  return {
    active: options.active ?? true,
    data,
    error,
    isLoading: data === null && isValidating,
    isValidating,
    loadedEmpty: data === "0",
    loadedSome: data === "1" || data === "many" || (Array.isArray(data) && data.length > 0)
  };
}

export function swrWindowView(state: ModelState, id: string, currentKey: string, options: { active?: boolean } = {}): SwrView {
  return swrView(state, swrWindowEntryId(id, currentKey), options);
}

export function swrVarId(id: string, field: "data" | "isValidating" | "error"): string {
  return `swr:${id}:${field}`;
}

export function swrWindowEntryId(id: string, key: string): string {
  return `${id}:${key}`;
}

function pendingIs(op: string): ExprIR {
  return { kind: "eq", args: [{ kind: "read", var: "sys:pending", path: ["0", "opId"] }, lit(op)] };
}

function lit(value: Value): ExprIR {
  return { kind: "lit", value };
}

function combineActive(global: ExprIR | undefined, local: ExprIR | undefined): ExprIR | undefined {
  if (!global) return local;
  if (!local) return global;
  return { kind: "and", args: [global, local] };
}

function exprReadList(expr: ExprIR): string[] {
  const reads = new Set<string>();
  const walk = (node: ExprIR): void => {
    if (node.kind === "read") reads.add(node.var);
    if ("args" in node) node.args.forEach(walk);
    if (node.kind === "updateField") {
      walk(node.target);
      walk(node.value);
    }
    if (node.kind === "tagIs" || node.kind === "lenCat") walk(node.arg);
  };
  walk(expr);
  return [...reads];
}

export function outcomeFor(value: Value): string {
  return canonicalJson(value);
}
