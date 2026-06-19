import { canonicalJson, enumerateDomain } from "modality-ts/core";
import type {
  AbstractDomain,
  ExprIR,
  ModelState,
  StateVarDecl,
  TemplateFragment,
  Transition,
  Value,
} from "modality-ts/core";
import type { SourceDecl } from "modality-ts/extract/engine/spi";

export interface SwrTemplateOptions {
  id: string;
  op: string;
  payloadDomain: AbstractDomain;
  activeWhen?: ExprIR;
  revalidateOnFocus?: boolean;
  mutate?: boolean;
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
  currentKey?: string;
  windowSize?: number;
  evictedSummary?: boolean;
  activeWhen?: ExprIR;
  revalidateOnFocus?: boolean;
  mutate?: boolean;
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

export function templateForSwrDecl(decl: SourceDecl): TemplateFragment {
  const metadata = decl.metadata ?? {};
  return createSwrTemplate({
    id: stringMetadata(metadata, "id", decl.id.replace(/^swr:/, "")),
    op: stringMetadata(metadata, "op", decl.id),
    payloadDomain: domainMetadata(metadata.payloadDomain),
    activeWhen: exprMetadata(metadata.activeWhen),
    revalidateOnFocus: booleanMetadata(metadata, "revalidateOnFocus", false),
    sourceFile:
      decl.origin !== "system" && decl.origin !== "library-template"
        ? decl.origin.file
        : undefined,
  });
}

export function createSwrTemplate(
  options: SwrTemplateOptions,
): TemplateFragment {
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
          {
            kind: "enqueue",
            op: options.op,
            continuation: `swr:${options.id}:resolve`,
            args: {},
          },
        ],
      },
      reads: [...exprReadList(active)],
      writes: [validatingVar, "sys:pending"],
      confidence: "exact",
    },
    ...(options.revalidateOnFocus
      ? [fetchTransition(options, active, source, "focus")]
      : []),
    ...(options.mutate
      ? mutateTransitions(
          options,
          active,
          source,
          dataVar,
          validatingVar,
          errorVar,
        )
      : []),
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
          { kind: "assign", var: errorVar, expr: lit(true) },
        ],
      },
      reads: ["sys:pending"],
      writes: ["sys:pending", validatingVar, errorVar],
      confidence: "exact",
    },
  ];
  return { vars, transitions };

  function successTransitions(template: SwrTemplateOptions): Transition[] {
    return enumerateDomain(template.payloadDomain).map((value, index) => ({
      id: `swr:${template.id}:resolve:success:${index}`,
      cls: "env" as const,
      label: {
        kind: "resolve" as const,
        op: template.op,
        outcome: `success:${index}`,
      },
      source,
      guard: pendingIs(template.op),
      effect: {
        kind: "seq" as const,
        effects: [
          { kind: "dequeue" as const, index: 0 },
          { kind: "assign" as const, var: dataVar, expr: lit(value) },
          { kind: "assign" as const, var: validatingVar, expr: lit(false) },
          { kind: "assign" as const, var: errorVar, expr: lit(false) },
        ],
      },
      reads: ["sys:pending"],
      writes: ["sys:pending", dataVar, validatingVar, errorVar],
      confidence: "exact" as const,
    }));
  }
}

function fetchTransition(
  options: SwrTemplateOptions,
  active: ExprIR,
  source: Transition["source"],
  trigger: "timer" | "focus",
): Transition {
  const validatingVar = swrVarId(options.id, "isValidating");
  return {
    id:
      trigger === "timer"
        ? `swr:${options.id}:fetch`
        : `swr:${options.id}:focus-revalidate`,
    cls: "library",
    label:
      trigger === "timer"
        ? { kind: "timer", key: options.id }
        : { kind: "focus-revalidate", key: options.id },
    source,
    guard: active,
    effect: {
      kind: "seq",
      effects: [
        { kind: "assign", var: validatingVar, expr: lit(true) },
        {
          kind: "enqueue",
          op: options.op,
          continuation: `swr:${options.id}:resolve`,
          args: {},
        },
      ],
    },
    reads: [...exprReadList(active)],
    writes: [validatingVar, "sys:pending"],
    confidence: "exact",
  };
}

function mutateTransitions(
  options: SwrTemplateOptions,
  active: ExprIR,
  source: Transition["source"],
  dataVar: string,
  validatingVar: string,
  errorVar: string,
): Transition[] {
  return enumerateDomain(options.payloadDomain).map((value, index) => ({
    id: `swr:${options.id}:mutate:${index}`,
    cls: "library" as const,
    label: { kind: "internal" as const, text: `mutate ${options.id}:${index}` },
    source,
    guard: active,
    effect: {
      kind: "seq" as const,
      effects: [
        { kind: "assign" as const, var: dataVar, expr: lit(value) },
        { kind: "assign" as const, var: validatingVar, expr: lit(false) },
        { kind: "assign" as const, var: errorVar, expr: lit(false) },
      ],
    },
    reads: [...exprReadList(active)],
    writes: [dataVar, validatingVar, errorVar],
    confidence: "exact" as const,
  }));
}

export function createSwrKeyWindowTemplate(
  options: SwrKeyWindowTemplateOptions,
): TemplateFragment {
  const windowSize = options.windowSize ?? 2;
  const entries = selectKeyWindowEntries(
    options.entries,
    windowSize,
    options.currentKey,
  );
  const selectedIds = new Set(entries.map((entry) => entry.id));
  const hasEvictedEntries = options.entries.some(
    (entry) => !selectedIds.has(entry.id),
  );
  const fragments = entries.map((entry) =>
    createSwrTemplate({
      id: swrWindowEntryId(options.id, entry.id),
      op: entry.op ?? `${options.op}:${entry.id}`,
      payloadDomain: options.payloadDomain,
      activeWhen: combineActive(options.activeWhen, entry.activeWhen),
      revalidateOnFocus: options.revalidateOnFocus,
      mutate: options.mutate,
      sourceFile: options.sourceFile,
    }),
  );
  const summaryVars =
    options.evictedSummary !== false && hasEvictedEntries
      ? swrEvictedSummaryVars(options.id, options.payloadDomain)
      : [];
  return {
    vars: [...fragments.flatMap((fragment) => fragment.vars), ...summaryVars],
    transitions: fragments.flatMap((fragment) => fragment.transitions),
  };
}

function selectKeyWindowEntries(
  entries: readonly SwrKeyWindowEntry[],
  windowSize: number,
  currentKey: string | undefined,
): readonly SwrKeyWindowEntry[] {
  if (windowSize <= 0) return [];
  const currentIndex =
    currentKey === undefined
      ? -1
      : entries.findIndex((entry) => entry.id === currentKey);
  if (currentIndex < 0) return entries.slice(0, windowSize);
  const start = Math.max(0, currentIndex - windowSize + 1);
  return entries.slice(start, currentIndex + 1);
}

export function swrVars(options: SwrTemplateOptions): StateVarDecl[] {
  return [
    {
      id: swrVarId(options.id, "data"),
      domain: { kind: "option", inner: options.payloadDomain },
      origin: "library-template",
      scope: { kind: "global" },
      initial: null,
    },
    {
      id: swrVarId(options.id, "isValidating"),
      domain: { kind: "bool" },
      origin: "library-template",
      scope: { kind: "global" },
      initial: false,
    },
    {
      id: swrVarId(options.id, "error"),
      domain: { kind: "bool" },
      origin: "library-template",
      scope: { kind: "global" },
      initial: false,
    },
  ];
}

function swrEvictedSummaryVars(
  id: string,
  payloadDomain: AbstractDomain,
): StateVarDecl[] {
  const summaryId = swrWindowEvictedSummaryId(id);
  return [
    {
      id: swrVarId(summaryId, "data"),
      domain: { kind: "option", inner: payloadDomain },
      origin: "library-template",
      scope: { kind: "global" },
      initial: [null, ...enumerateDomain(payloadDomain)],
    },
    {
      id: swrVarId(summaryId, "isValidating"),
      domain: { kind: "bool" },
      origin: "library-template",
      scope: { kind: "global" },
      initial: false,
    },
    {
      id: swrVarId(summaryId, "error"),
      domain: { kind: "bool" },
      origin: "library-template",
      scope: { kind: "global" },
      initial: [false, true],
    },
  ];
}

export function swrView(
  state: ModelState,
  id: string,
  options: { active?: boolean } = {},
): SwrView {
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
    loadedSome:
      data === "1" ||
      data === "many" ||
      (Array.isArray(data) && data.length > 0),
  };
}

export function swrWindowView(
  state: ModelState,
  id: string,
  currentKey: string,
  options: { active?: boolean } = {},
): SwrView {
  const entryId = swrWindowEntryId(id, currentKey);
  return Object.hasOwn(state, swrVarId(entryId, "data"))
    ? swrView(state, entryId, options)
    : swrView(state, swrWindowEvictedSummaryId(id), options);
}

export function swrVarId(
  id: string,
  field: "data" | "isValidating" | "error",
): string {
  return `swr:${id}:${field}`;
}

export function swrWindowEntryId(id: string, key: string): string {
  return `${id}:${key}`;
}

export function swrWindowEvictedSummaryId(id: string): string {
  return `${id}:evicted`;
}

function stringMetadata(
  metadata: Record<string, Value>,
  key: string,
  fallback: string,
): string {
  const value = metadata[key];
  return typeof value === "string" ? value : fallback;
}

function booleanMetadata(
  metadata: Record<string, Value>,
  key: string,
  fallback: boolean,
): boolean {
  const value = metadata[key];
  return typeof value === "boolean" ? value : fallback;
}

function domainMetadata(value: Value | undefined): AbstractDomain {
  if (isDomain(value)) return value;
  return { kind: "tokens", count: 1 };
}

function exprMetadata(value: Value | undefined): ExprIR | undefined {
  return isExpr(value) ? value : undefined;
}

function isDomain(value: Value | undefined): value is AbstractDomain {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "kind" in value,
  );
}

function isExpr(value: Value | undefined): value is ExprIR {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "kind" in value,
  );
}

function pendingIs(op: string): ExprIR {
  return {
    kind: "eq",
    args: [{ kind: "read", var: "sys:pending", path: ["0", "opId"] }, lit(op)],
  };
}

function lit(value: Value): ExprIR {
  return { kind: "lit", value };
}

function _negateIr(expr: ExprIR): ExprIR {
  if (expr.kind === "not") return expr.args[0] ?? lit(true);
  return { kind: "not", args: [expr] };
}

function combineActive(
  global: ExprIR | undefined,
  local: ExprIR | undefined,
): ExprIR | undefined {
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
