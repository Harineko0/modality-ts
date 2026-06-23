import type {
  EffectIR,
  ExprIR,
  StateVarDecl,
  TemplateFragment,
  Transition,
  Value,
} from "modality-ts/core";
import { enumerateDomain } from "modality-ts/core";
import type {
  RouteActionDescriptor,
  RouteExecutionDescriptor,
  RouteExecutionResource,
  RouteLoaderDescriptor,
} from "modality-ts/extract/engine/spi";

const PENDING_QUEUE_VAR = "sys:pending";
const LOCATION_CURRENT_VAR = "sys:route";

export function routeResourceVarId(resourceId: string): string {
  return `route:resource:${sanitizeId(resourceId)}:state`;
}

export function routeLoaderVarId(
  loaderId: string,
  field: "data" | "status" | "stale",
): string {
  return `route:loader:${sanitizeId(loaderId)}:${field}`;
}

export function routeActionVarId(actionId: string, field: "status"): string {
  return `route:action:${sanitizeId(actionId)}:${field}`;
}

export function routeRevalidationOpId(actionId: string): string {
  return `REVALIDATE ${actionId}`;
}

export function buildRouteExecutionTemplate(
  descriptor: RouteExecutionDescriptor | undefined,
): TemplateFragment {
  if (!descriptor) return { vars: [], transitions: [] };
  const vars = [
    ...descriptor.resources.map(routeResourceVar),
    ...descriptor.loaders.flatMap(routeLoaderVars),
    ...descriptor.actions.map(routeActionStatusVar),
  ];
  const resourcesById = new Map(
    descriptor.resources.map((resource) => [resource.id, resource]),
  );
  const loadersById = new Map(
    descriptor.loaders.map((loader) => [loader.id, loader]),
  );
  const transitions = [
    ...descriptor.loaders.flatMap((loader) =>
      loaderTransitions(loader, resourcesById),
    ),
    ...descriptor.actions.flatMap((action) =>
      actionTransitions(action, loadersById),
    ),
  ];
  return { vars, transitions };
}

function routeResourceVar(resource: RouteExecutionResource): StateVarDecl {
  const values = enumerateDomain(resource.domain);
  return {
    id: routeResourceVarId(resource.id),
    domain: resource.domain,
    origin: "library-template",
    scope: { kind: "global" },
    role: { kind: "cache-entry", group: resource.id },
    initial: values[0] ?? null,
  };
}

function routeLoaderVars(loader: RouteLoaderDescriptor): StateVarDecl[] {
  return [
    {
      id: routeLoaderVarId(loader.id, "data"),
      domain: { kind: "option", inner: loader.producesDomain },
      origin: "library-template",
      scope: { kind: "global" },
      role: { kind: "cache-entry", group: loader.id },
      initial: null,
    },
    {
      id: routeLoaderVarId(loader.id, "status"),
      domain: { kind: "enum", values: ["pending", "success", "error"] },
      origin: "library-template",
      scope: { kind: "global" },
      initial: "pending",
    },
    {
      id: routeLoaderVarId(loader.id, "stale"),
      domain: { kind: "bool" },
      origin: "library-template",
      scope: { kind: "global" },
      initial: true,
    },
  ];
}

function routeActionStatusVar(action: RouteActionDescriptor): StateVarDecl {
  return {
    id: routeActionVarId(action.id, "status"),
    domain: { kind: "enum", values: ["idle", "pending", "success", "error"] },
    origin: "library-template",
    scope: { kind: "global" },
    initial: "idle",
  };
}

function loaderTransitions(
  loader: RouteLoaderDescriptor,
  resourcesById: ReadonlyMap<string, RouteExecutionResource>,
): Transition[] {
  const dataVar = routeLoaderVarId(loader.id, "data");
  const statusVar = routeLoaderVarId(loader.id, "status");
  const staleVar = routeLoaderVarId(loader.id, "stale");
  const resourceVars = loader.readsResources
    .filter((id) => resourcesById.has(id))
    .map(routeResourceVarId);
  const source = [] as const;
  return [
    {
      id: `route:loader:${sanitizeId(loader.id)}:fetch`,
      cls: "library",
      label: { kind: "timer", key: `route-loader:${loader.id}` },
      source,
      guard: andExpr([routeIs(loader.routePattern), readIs(staleVar, true)]),
      effect: seq([
        assignLit(statusVar, "pending"),
        {
          kind: "enqueue",
          op: loader.op,
          continuation: `route:loader:${loader.id}:resolve`,
          args: {},
        },
      ]),
      reads: [LOCATION_CURRENT_VAR, staleVar],
      writes: [statusVar, PENDING_QUEUE_VAR],
      confidence: "over-approx",
    },
    ...loaderSuccessTransitions(loader, dataVar, statusVar, staleVar, [
      ...resourceVars,
    ]),
    {
      id: `route:loader:${sanitizeId(loader.id)}:resolve:error`,
      cls: "env",
      label: { kind: "resolve", op: loader.op, outcome: "error" },
      source,
      guard: pendingOpIs(loader.op),
      effect: seq([
        { kind: "dequeue", index: 0 },
        assignLit(statusVar, "error"),
        assignLit(staleVar, false),
      ]),
      reads: [PENDING_QUEUE_VAR],
      writes: [PENDING_QUEUE_VAR, statusVar, staleVar],
      confidence: "over-approx",
    },
  ];
}

function loaderSuccessTransitions(
  loader: RouteLoaderDescriptor,
  dataVar: string,
  statusVar: string,
  staleVar: string,
  resourceVars: readonly string[],
): Transition[] {
  const values = loaderDataValues(loader);
  return values.map((value, index) => ({
    id: `route:loader:${sanitizeId(loader.id)}:resolve:success:${index}`,
    cls: "env" as const,
    label: { kind: "resolve" as const, op: loader.op, outcome: "success" },
    source: [],
    guard: pendingOpIs(loader.op),
    effect: seq([
      { kind: "dequeue", index: 0 },
      { kind: "assign", var: dataVar, expr: { kind: "lit", value } },
      assignLit(statusVar, "success"),
      assignLit(staleVar, false),
    ]),
    reads: [PENDING_QUEUE_VAR, ...resourceVars],
    writes: [PENDING_QUEUE_VAR, dataVar, statusVar, staleVar],
    confidence: "over-approx" as const,
  }));
}

function actionTransitions(
  action: RouteActionDescriptor,
  loadersById: ReadonlyMap<string, RouteLoaderDescriptor>,
): Transition[] {
  const statusVar = routeActionVarId(action.id, "status");
  const resourceVars = action.mutatesResources.map(routeResourceVarId);
  const revalidateOp = routeRevalidationOpId(action.id);
  const revalidatedLoaders = action.revalidates
    .map((loaderId) => loadersById.get(loaderId))
    .filter((loader): loader is RouteLoaderDescriptor => Boolean(loader));
  return [
    {
      id: `route:action:${sanitizeId(action.id)}:invoke`,
      cls: "user",
      label: { kind: "internal", text: `invoke ${action.op}` },
      source: [],
      guard: {
        kind: "neq",
        args: [
          { kind: "read", var: statusVar },
          { kind: "lit", value: "pending" },
        ],
      },
      effect: seq([
        assignLit(statusVar, "pending"),
        {
          kind: "enqueue",
          op: action.op,
          continuation: `route:action:${action.id}:resolve`,
          args: {},
        },
      ]),
      reads: [statusVar],
      writes: [statusVar, PENDING_QUEUE_VAR],
      confidence: "over-approx",
    },
    {
      id: `route:action:${sanitizeId(action.id)}:resolve:success`,
      cls: "env",
      label: { kind: "resolve", op: action.op, outcome: "success" },
      source: [],
      guard: pendingOpIs(action.op),
      effect: seq([
        { kind: "dequeue", index: 0 },
        assignLit(statusVar, "success"),
        ...resourceVars.map(
          (varId): EffectIR => ({ kind: "havoc", var: varId }),
        ),
        {
          kind: "enqueue",
          op: revalidateOp,
          continuation: `route:action:${action.id}:revalidate`,
          args: {},
        },
      ]),
      reads: [PENDING_QUEUE_VAR],
      writes: [PENDING_QUEUE_VAR, statusVar, ...resourceVars],
      confidence: "over-approx",
    },
    {
      id: `route:action:${sanitizeId(action.id)}:resolve:error`,
      cls: "env",
      label: { kind: "resolve", op: action.op, outcome: "error" },
      source: [],
      guard: pendingOpIs(action.op),
      effect: seq([
        { kind: "dequeue", index: 0 },
        assignLit(statusVar, "error"),
      ]),
      reads: [PENDING_QUEUE_VAR],
      writes: [PENDING_QUEUE_VAR, statusVar],
      confidence: "over-approx",
    },
    {
      id: `route:action:${sanitizeId(action.id)}:revalidate`,
      cls: "library",
      label: { kind: "internal", text: `revalidate ${action.id}` },
      source: [],
      guard: pendingOpIs(revalidateOp),
      effect: seq([
        { kind: "dequeue", index: 0 },
        ...revalidatedLoaders.flatMap((loader): EffectIR[] => [
          assignLit(routeLoaderVarId(loader.id, "stale"), true),
          {
            kind: "enqueue",
            op: loader.op,
            continuation: `route:loader:${loader.id}:resolve`,
            args: {},
          },
        ]),
      ]),
      reads: [PENDING_QUEUE_VAR],
      writes: [
        PENDING_QUEUE_VAR,
        ...revalidatedLoaders.map((loader) =>
          routeLoaderVarId(loader.id, "stale"),
        ),
      ],
      confidence: "over-approx",
    },
  ];
}

function loaderDataValues(loader: RouteLoaderDescriptor): Value[] {
  const values = enumerateDomain(loader.producesDomain);
  return loader.gated ? [null, ...values] : values;
}

function routeIs(routePattern: string): ExprIR {
  return {
    kind: "eq",
    args: [
      { kind: "read", var: LOCATION_CURRENT_VAR },
      { kind: "lit", value: routePattern },
    ],
  };
}

function readIs(varId: string, value: Value): ExprIR {
  return {
    kind: "eq",
    args: [
      { kind: "read", var: varId },
      { kind: "lit", value },
    ],
  };
}

function pendingOpIs(op: string): ExprIR {
  return {
    kind: "eq",
    args: [
      { kind: "read", var: PENDING_QUEUE_VAR, path: ["0", "opId"] },
      { kind: "lit", value: op },
    ],
  };
}

function assignLit(varId: string, value: Value): EffectIR {
  return { kind: "assign", var: varId, expr: { kind: "lit", value } };
}

function seq(effects: readonly EffectIR[]): EffectIR {
  return { kind: "seq", effects };
}

function andExpr(args: readonly ExprIR[]): ExprIR {
  if (args.length === 1) return args[0]!;
  return { kind: "and", args };
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9:_-]+/g, "_");
}
