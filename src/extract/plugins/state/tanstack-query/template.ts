import type {
  AbstractDomain,
  ExprIR,
  ModelState,
  StateVarDecl,
  TemplateFragment,
  Transition,
  Value,
} from "modality-ts/core";
import { enumerateDomain } from "modality-ts/core";
import type { SourceDecl } from "modality-ts/extract/engine/spi";
import { queryVarId } from "./ids.js";
import { queryMetadataFromRecord } from "./types.js";

export interface TanstackQueryTemplateOptions {
  id: string;
  op: string;
  payloadDomain: AbstractDomain;
  activeWhen?: ExprIR;
  enabled?: boolean;
  staleTime?: "static" | "infinity" | "default";
  retry?: boolean | number;
  refetchOnMount?: boolean;
  refetchOnWindowFocus?: boolean;
  refetchOnReconnect?: boolean;
  refetchInterval?: boolean;
  hasInitialData?: boolean;
  sourceFile?: string;
}

export interface TanstackQueryView {
  data: Value | null;
  error: boolean;
  status: "pending" | "success" | "error";
  fetchStatus: "idle" | "fetching" | "paused";
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isRefetching: boolean;
  isStale: boolean;
  isPaused: boolean;
  loadedEmpty: boolean;
  loadedSome: boolean;
}

export function templateForTanstackQueryDecl(
  decl: SourceDecl,
): TemplateFragment {
  const metadata = queryMetadataFromRecord(decl.metadata);
  if (!metadata) return { vars: [], transitions: [] };
  return createTanstackQueryTemplate({
    id: metadata.queryKey.id,
    op: metadata.op,
    payloadDomain: metadata.payloadDomain,
    activeWhen: metadata.queryKey.activeWhen,
    enabled: metadata.enabled,
    staleTime: metadata.staleTime,
    retry: metadata.retry,
    refetchOnMount: metadata.refetchOnMount,
    refetchOnWindowFocus: metadata.refetchOnWindowFocus,
    refetchOnReconnect: metadata.refetchOnReconnect,
    refetchInterval: metadata.refetchInterval,
    hasInitialData: metadata.hasInitialData,
    sourceFile:
      decl.origin !== "system" && decl.origin !== "library-template"
        ? decl.origin.file
        : undefined,
  });
}

export function createTanstackQueryTemplate(
  options: TanstackQueryTemplateOptions,
): TemplateFragment {
  const vars = tanstackQueryVars(options);
  const active = combineActive(
    options.activeWhen,
    options.enabled === false ? lit(false) : lit(true),
  );
  const source = options.sourceFile ? [{ file: options.sourceFile }] : [];
  const dataVar = queryVarId(options.id, "data");
  const statusVar = queryVarId(options.id, "status");
  const fetchStatusVar = queryVarId(options.id, "fetchStatus");
  const staleVar = queryVarId(options.id, "stale");
  const invalidatedVar = queryVarId(options.id, "invalidated");
  const failureCountVar = queryVarId(options.id, "failureCount");
  const autoFetch =
    options.enabled !== false &&
    (options.refetchOnMount !== false || !options.hasInitialData);
  const transitions: Transition[] = [];

  if (autoFetch) {
    transitions.push(
      fetchTransition(options, active, source, "mount"),
      ...successTransitions(
        options,
        source,
        dataVar,
        statusVar,
        fetchStatusVar,
        staleVar,
        failureCountVar,
      ),
      errorTransition(
        options,
        source,
        dataVar,
        statusVar,
        fetchStatusVar,
        failureCountVar,
      ),
    );
  } else {
    transitions.push(
      ...successTransitions(
        options,
        source,
        dataVar,
        statusVar,
        fetchStatusVar,
        staleVar,
        failureCountVar,
      ),
      errorTransition(
        options,
        source,
        dataVar,
        statusVar,
        fetchStatusVar,
        failureCountVar,
      ),
    );
  }

  if (
    options.refetchOnWindowFocus !== false &&
    options.staleTime !== "infinity"
  ) {
    transitions.push(
      refetchEnvTransition(
        options,
        active,
        source,
        "focus",
        staleVar,
        fetchStatusVar,
      ),
    );
  }
  if (
    options.refetchOnReconnect !== false &&
    options.staleTime !== "infinity"
  ) {
    transitions.push(
      refetchEnvTransition(
        options,
        active,
        source,
        "reconnect",
        staleVar,
        fetchStatusVar,
      ),
    );
  }
  if (options.refetchInterval) {
    transitions.push(
      refetchEnvTransition(
        options,
        active,
        source,
        "interval",
        staleVar,
        fetchStatusVar,
      ),
    );
  }

  transitions.push(
    invalidateTransition(
      options,
      source,
      staleVar,
      invalidatedVar,
      fetchStatusVar,
    ),
    ...setDataTransitions(
      options,
      source,
      dataVar,
      statusVar,
      staleVar,
      invalidatedVar,
    ),
    removeQueryTransition(
      options,
      source,
      dataVar,
      statusVar,
      fetchStatusVar,
      staleVar,
      invalidatedVar,
    ),
    resetQueryTransition(
      options,
      source,
      dataVar,
      statusVar,
      fetchStatusVar,
      staleVar,
      invalidatedVar,
      failureCountVar,
    ),
    cancelQueryTransition(options, source, fetchStatusVar),
    manualRefetchTransition(options, active, source, fetchStatusVar),
  );

  if (options.staleTime === "default") {
    transitions.push(staleEnvTransition(options, source, staleVar));
  }

  return { vars, transitions };
}

export function tanstackQueryVars(
  options: TanstackQueryTemplateOptions,
): StateVarDecl[] {
  const initialStatus = options.hasInitialData ? "success" : "pending";
  const initialStale =
    options.hasInitialData === true &&
    options.staleTime !== "infinity" &&
    options.staleTime !== "static";
  return [
    {
      id: queryVarId(options.id, "data"),
      domain: { kind: "option", inner: options.payloadDomain },
      origin: "library-template",
      scope: { kind: "global" },
      initial: options.hasInitialData
        ? (enumerateDomain(options.payloadDomain)[0] ?? null)
        : null,
    },
    {
      id: queryVarId(options.id, "status"),
      domain: { kind: "enum", values: ["pending", "success", "error"] },
      origin: "library-template",
      scope: { kind: "global" },
      initial: initialStatus,
    },
    {
      id: queryVarId(options.id, "fetchStatus"),
      domain: { kind: "enum", values: ["idle", "fetching", "paused"] },
      origin: "library-template",
      scope: { kind: "global" },
      initial: "idle",
    },
    {
      id: queryVarId(options.id, "stale"),
      domain: { kind: "bool" },
      origin: "library-template",
      scope: { kind: "global" },
      initial: initialStale,
    },
    {
      id: queryVarId(options.id, "invalidated"),
      domain: { kind: "bool" },
      origin: "library-template",
      scope: { kind: "global" },
      initial: false,
    },
    {
      id: queryVarId(options.id, "failureCount"),
      domain: { kind: "enum", values: ["0", "1", "max"] },
      origin: "library-template",
      scope: { kind: "global" },
      initial: "0",
    },
  ];
}

export function tanstackQueryView(
  state: ModelState,
  keyId: string,
  options: { placeholderData?: Value | null } = {},
): TanstackQueryView {
  const data =
    state[queryVarId(keyId, "data")] ?? options.placeholderData ?? null;
  const status = (state[queryVarId(keyId, "status")] ??
    "pending") as TanstackQueryView["status"];
  const fetchStatus = (state[queryVarId(keyId, "fetchStatus")] ??
    "idle") as TanstackQueryView["fetchStatus"];
  const isStale = state[queryVarId(keyId, "stale")] === true;
  const isFetching = fetchStatus === "fetching";
  const isPending = status === "pending";
  const isSuccess = status === "success";
  const isError = status === "error";
  return {
    data,
    error: isError,
    status,
    fetchStatus,
    isPending,
    isSuccess,
    isError,
    isFetching,
    isLoading: isPending && isFetching,
    isRefetching: isSuccess && isFetching,
    isStale,
    isPaused: fetchStatus === "paused",
    loadedEmpty: data === "0" || data === "empty",
    loadedSome:
      data === "1" ||
      data === "many" ||
      data === "onePage" ||
      data === "manyPages" ||
      (Array.isArray(data) && data.length > 0),
  };
}

function fetchTransition(
  options: TanstackQueryTemplateOptions,
  active: ExprIR,
  source: Transition["source"],
  trigger: "mount" | "refetch",
): Transition {
  const fetchStatusVar = queryVarId(options.id, "fetchStatus");
  return {
    id: `tanstack-query:${options.id}:fetch:${trigger}`,
    cls: "library",
    label:
      trigger === "mount"
        ? { kind: "timer", key: options.id }
        : { kind: "internal", text: `refetch ${options.id}` },
    source,
    guard: active,
    effect: {
      kind: "seq",
      effects: [
        { kind: "assign", var: fetchStatusVar, expr: lit("fetching") },
        {
          kind: "enqueue",
          op: options.op,
          continuation: `tanstack-query:${options.id}:resolve`,
          args: {},
        },
      ],
    },
    reads: [...exprReadList(active), queryVarId(options.id, "stale")],
    writes: [fetchStatusVar, "sys:pending"],
    confidence: "exact",
  };
}

function successTransitions(
  options: TanstackQueryTemplateOptions,
  source: Transition["source"],
  dataVar: string,
  statusVar: string,
  fetchStatusVar: string,
  staleVar: string,
  failureCountVar: string,
): Transition[] {
  return enumerateDomain(options.payloadDomain).map((value, index) => ({
    id: `tanstack-query:${options.id}:resolve:success:${index}`,
    cls: "env" as const,
    label: {
      kind: "resolve" as const,
      op: options.op,
      outcome: `success:${index}`,
    },
    source,
    guard: pendingIs(options.op),
    effect: {
      kind: "seq" as const,
      effects: [
        { kind: "dequeue" as const, index: 0 },
        { kind: "assign" as const, var: dataVar, expr: lit(value) },
        { kind: "assign" as const, var: statusVar, expr: lit("success") },
        { kind: "assign" as const, var: fetchStatusVar, expr: lit("idle") },
        {
          kind: "assign" as const,
          var: staleVar,
          expr: lit(
            !(
              options.staleTime === "infinity" || options.staleTime === "static"
            ),
          ),
        },
        { kind: "assign" as const, var: failureCountVar, expr: lit("0") },
      ],
    },
    reads: ["sys:pending"],
    writes: [
      "sys:pending",
      dataVar,
      statusVar,
      fetchStatusVar,
      staleVar,
      failureCountVar,
    ],
    confidence: "exact" as const,
  }));
}

function errorTransition(
  options: TanstackQueryTemplateOptions,
  source: Transition["source"],
  dataVar: string,
  statusVar: string,
  fetchStatusVar: string,
  failureCountVar: string,
): Transition {
  return {
    id: `tanstack-query:${options.id}:resolve:error`,
    cls: "env",
    label: { kind: "resolve", op: options.op, outcome: "error" },
    source,
    guard: pendingIs(options.op),
    effect: {
      kind: "seq",
      effects: [
        { kind: "dequeue", index: 0 },
        { kind: "assign", var: statusVar, expr: lit("error") },
        { kind: "assign", var: fetchStatusVar, expr: lit("idle") },
        {
          kind: "assign",
          var: failureCountVar,
          expr: lit(options.retry === false ? "max" : "1"),
        },
      ],
    },
    reads: ["sys:pending", dataVar],
    writes: ["sys:pending", statusVar, fetchStatusVar, failureCountVar],
    confidence: "exact",
  };
}

function refetchEnvTransition(
  options: TanstackQueryTemplateOptions,
  active: ExprIR,
  source: Transition["source"],
  trigger: "focus" | "reconnect" | "interval",
  staleVar: string,
  fetchStatusVar: string,
): Transition {
  return {
    id: `tanstack-query:${options.id}:refetch:${trigger}`,
    cls: "env",
    label: { kind: "env", key: trigger, outcome: options.id },
    source,
    guard: {
      kind: "and",
      args: [active, { kind: "read", var: staleVar }],
    },
    effect: {
      kind: "seq",
      effects: [
        { kind: "assign", var: fetchStatusVar, expr: lit("fetching") },
        {
          kind: "enqueue",
          op: options.op,
          continuation: `tanstack-query:${options.id}:resolve`,
          args: {},
        },
      ],
    },
    reads: [...exprReadList(active), staleVar],
    writes: [fetchStatusVar, "sys:pending"],
    confidence: "exact",
  };
}

function staleEnvTransition(
  options: TanstackQueryTemplateOptions,
  source: Transition["source"],
  staleVar: string,
): Transition {
  return {
    id: `tanstack-query:${options.id}:stale`,
    cls: "env",
    label: { kind: "env", key: "staleTime", outcome: options.id },
    source,
    guard: { kind: "lit", value: true },
    effect: { kind: "assign", var: staleVar, expr: lit(true) },
    reads: [queryVarId(options.id, "status")],
    writes: [staleVar],
    confidence: "exact",
  };
}

function invalidateTransition(
  options: TanstackQueryTemplateOptions,
  source: Transition["source"],
  staleVar: string,
  invalidatedVar: string,
  fetchStatusVar: string,
): Transition {
  return {
    id: `tanstack-query:${options.id}:invalidate`,
    cls: "library",
    label: { kind: "internal", text: `invalidate ${options.id}` },
    source,
    guard: { kind: "lit", value: true },
    effect: {
      kind: "seq",
      effects: [
        { kind: "assign", var: staleVar, expr: lit(true) },
        { kind: "assign", var: invalidatedVar, expr: lit(true) },
        { kind: "assign", var: fetchStatusVar, expr: lit("fetching") },
        {
          kind: "enqueue",
          op: options.op,
          continuation: `tanstack-query:${options.id}:resolve`,
          args: {},
        },
      ],
    },
    reads: [],
    writes: [staleVar, invalidatedVar, fetchStatusVar, "sys:pending"],
    confidence: "exact",
  };
}

function setDataTransitions(
  options: TanstackQueryTemplateOptions,
  source: Transition["source"],
  dataVar: string,
  statusVar: string,
  staleVar: string,
  invalidatedVar: string,
): Transition[] {
  return enumerateDomain(options.payloadDomain).map((value, index) => ({
    id: `tanstack-query:${options.id}:setData:${index}`,
    cls: "library" as const,
    label: {
      kind: "internal" as const,
      text: `setQueryData ${options.id}:${index}`,
    },
    source,
    guard: { kind: "lit" as const, value: true },
    effect: {
      kind: "seq" as const,
      effects: [
        { kind: "assign" as const, var: dataVar, expr: lit(value) },
        { kind: "assign" as const, var: statusVar, expr: lit("success") },
        { kind: "assign" as const, var: staleVar, expr: lit(false) },
        { kind: "assign" as const, var: invalidatedVar, expr: lit(false) },
      ],
    },
    reads: [],
    writes: [dataVar, statusVar, staleVar, invalidatedVar],
    confidence: "exact" as const,
  }));
}

function removeQueryTransition(
  options: TanstackQueryTemplateOptions,
  source: Transition["source"],
  dataVar: string,
  statusVar: string,
  fetchStatusVar: string,
  staleVar: string,
  invalidatedVar: string,
): Transition {
  return {
    id: `tanstack-query:${options.id}:remove`,
    cls: "library",
    label: { kind: "internal", text: `removeQueries ${options.id}` },
    source,
    guard: { kind: "lit", value: true },
    effect: {
      kind: "seq",
      effects: [
        { kind: "assign", var: dataVar, expr: lit(null) },
        { kind: "assign", var: statusVar, expr: lit("pending") },
        { kind: "assign", var: fetchStatusVar, expr: lit("idle") },
        { kind: "assign", var: staleVar, expr: lit(false) },
        { kind: "assign", var: invalidatedVar, expr: lit(false) },
      ],
    },
    reads: [],
    writes: [dataVar, statusVar, fetchStatusVar, staleVar, invalidatedVar],
    confidence: "exact",
  };
}

function resetQueryTransition(
  options: TanstackQueryTemplateOptions,
  source: Transition["source"],
  dataVar: string,
  statusVar: string,
  fetchStatusVar: string,
  staleVar: string,
  invalidatedVar: string,
  failureCountVar: string,
): Transition {
  return {
    id: `tanstack-query:${options.id}:reset`,
    cls: "library",
    label: { kind: "internal", text: `resetQueries ${options.id}` },
    source,
    guard: { kind: "lit", value: true },
    effect: {
      kind: "seq",
      effects: [
        { kind: "assign", var: dataVar, expr: lit(null) },
        { kind: "assign", var: statusVar, expr: lit("pending") },
        { kind: "assign", var: fetchStatusVar, expr: lit("fetching") },
        { kind: "assign", var: staleVar, expr: lit(false) },
        { kind: "assign", var: invalidatedVar, expr: lit(false) },
        { kind: "assign", var: failureCountVar, expr: lit("0") },
        {
          kind: "enqueue",
          op: options.op,
          continuation: `tanstack-query:${options.id}:resolve`,
          args: {},
        },
      ],
    },
    reads: [],
    writes: [
      dataVar,
      statusVar,
      fetchStatusVar,
      staleVar,
      invalidatedVar,
      failureCountVar,
      "sys:pending",
    ],
    confidence: "exact",
  };
}

function cancelQueryTransition(
  options: TanstackQueryTemplateOptions,
  source: Transition["source"],
  fetchStatusVar: string,
): Transition {
  return {
    id: `tanstack-query:${options.id}:cancel`,
    cls: "library",
    label: { kind: "internal", text: `cancelQueries ${options.id}` },
    source,
    guard: { kind: "lit", value: true },
    effect: { kind: "assign", var: fetchStatusVar, expr: lit("idle") },
    reads: [queryVarId(options.id, "data")],
    writes: [fetchStatusVar],
    confidence: "exact",
  };
}

function manualRefetchTransition(
  options: TanstackQueryTemplateOptions,
  active: ExprIR,
  source: Transition["source"],
  _fetchStatusVar: string,
): Transition {
  return fetchTransition(options, active, source, "refetch");
}

export function createTanstackMutationTemplate(
  mutationId: string,
  payloadDomain: AbstractDomain,
  op: string,
  sourceFile?: string,
): TemplateFragment {
  const source = sourceFile ? [{ file: sourceFile }] : [];
  const statusVar = `tanstack-mutation:${mutationId}:status`;
  const dataVar = `tanstack-mutation:${mutationId}:data`;
  const errorVar = `tanstack-mutation:${mutationId}:error`;
  const variablesVar = `tanstack-mutation:${mutationId}:variables`;
  const failureCountVar = `tanstack-mutation:${mutationId}:failureCount`;
  const vars: StateVarDecl[] = [
    {
      id: statusVar,
      domain: { kind: "enum", values: ["idle", "pending", "success", "error"] },
      origin: "library-template",
      scope: { kind: "global" },
      initial: "idle",
    },
    {
      id: dataVar,
      domain: { kind: "option", inner: payloadDomain },
      origin: "library-template",
      scope: { kind: "global" },
      initial: null,
    },
    {
      id: errorVar,
      domain: { kind: "bool" },
      origin: "library-template",
      scope: { kind: "global" },
      initial: false,
    },
    {
      id: variablesVar,
      domain: { kind: "tokens", count: 1 },
      origin: "library-template",
      scope: { kind: "global" },
      initial: "token:0",
    },
    {
      id: failureCountVar,
      domain: { kind: "enum", values: ["0", "1", "max"] },
      origin: "library-template",
      scope: { kind: "global" },
      initial: "0",
    },
  ];
  const transitions: Transition[] = [
    {
      id: `tanstack-mutation:${mutationId}:mutate`,
      cls: "user",
      label: { kind: "internal", text: `mutate ${mutationId}` },
      source,
      guard: { kind: "lit", value: true },
      effect: {
        kind: "seq",
        effects: [
          { kind: "assign", var: statusVar, expr: lit("pending") },
          { kind: "assign", var: errorVar, expr: lit(false) },
          {
            kind: "enqueue",
            op,
            continuation: `tanstack-mutation:${mutationId}:resolve`,
            args: {},
          },
        ],
      },
      reads: [],
      writes: [statusVar, errorVar, "sys:pending"],
      confidence: "exact",
    },
    ...enumerateDomain(payloadDomain).map((value, index) => ({
      id: `tanstack-mutation:${mutationId}:resolve:success:${index}`,
      cls: "env" as const,
      label: {
        kind: "resolve" as const,
        op,
        outcome: `success:${index}`,
      },
      source,
      guard: pendingIs(op),
      effect: {
        kind: "seq" as const,
        effects: [
          { kind: "dequeue" as const, index: 0 },
          { kind: "assign" as const, var: dataVar, expr: lit(value) },
          { kind: "assign" as const, var: statusVar, expr: lit("success") },
          { kind: "assign" as const, var: errorVar, expr: lit(false) },
          { kind: "assign" as const, var: failureCountVar, expr: lit("0") },
        ],
      },
      reads: ["sys:pending"],
      writes: ["sys:pending", dataVar, statusVar, errorVar, failureCountVar],
      confidence: "exact" as const,
    })),
    {
      id: `tanstack-mutation:${mutationId}:resolve:error`,
      cls: "env",
      label: { kind: "resolve", op, outcome: "error" },
      source,
      guard: pendingIs(op),
      effect: {
        kind: "seq",
        effects: [
          { kind: "dequeue", index: 0 },
          { kind: "assign", var: statusVar, expr: lit("error") },
          { kind: "assign", var: errorVar, expr: lit(true) },
          { kind: "assign", var: failureCountVar, expr: lit("1") },
        ],
      },
      reads: ["sys:pending"],
      writes: ["sys:pending", statusVar, errorVar, failureCountVar],
      confidence: "exact",
    },
    {
      id: `tanstack-mutation:${mutationId}:reset`,
      cls: "library",
      label: { kind: "internal", text: `reset ${mutationId}` },
      source,
      guard: { kind: "lit", value: true },
      effect: {
        kind: "seq",
        effects: [
          { kind: "assign", var: statusVar, expr: lit("idle") },
          { kind: "assign", var: dataVar, expr: lit(null) },
          { kind: "assign", var: errorVar, expr: lit(false) },
          { kind: "assign", var: failureCountVar, expr: lit("0") },
        ],
      },
      reads: [],
      writes: [statusVar, dataVar, errorVar, failureCountVar],
      confidence: "exact",
    },
  ];
  return { vars, transitions };
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

function combineActive(global: ExprIR | undefined, local: ExprIR): ExprIR {
  if (!global) return local;
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

export { queryVarId };
