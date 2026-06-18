import type { EffectIR, Model, StateVarDecl } from "modality-ts/core";
import { timerStateVarDecl } from "../../../extract/engine/ts/transition/timers.js";
import { environmentStateVarDecl } from "../../../extract/engine/ts/transition/environment-callbacks.js";
import { confirmStateVarDecl } from "../../../extract/engine/ts/transition/async.js";
import type { EffectOpAliases } from "../../../extract/engine/ts/effect-op-aliases.js";
import { suspenseStateVarDecl } from "../../../extract/engine/ts/transition/suspense.js";

export function synthesizeSystemVars(
  transitions: readonly Model["transitions"][number][],
  effectApis: readonly string[],
  effectOpAliases: EffectOpAliases,
  vars: readonly StateVarDecl[],
  maxPending: number,
): StateVarDecl[] {
  const timerIds = collectSystemVarIds(transitions, "sys:timer:");
  const suspenseIds = collectSystemVarIds(transitions, "sys:suspense:");
  const webSocketIds = collectSystemVarIds(transitions, "sys:websocket:");
  const confirmIds = collectSystemVarIds(transitions, "sys:confirm:");
  return [
    ...pendingVars(effectApis, transitions, vars, maxPending, effectOpAliases),
    ...timerIds.sort().map((id) => timerStateVarDecl(id)),
    ...suspenseIds
      .sort()
      .map((id) => suspenseStateVarDecl(id.replace(/^sys:suspense:/, ""))),
    ...webSocketIds.sort().map((id) => environmentStateVarDecl(id)),
    ...confirmIds.sort().map((id) => confirmStateVarDecl(id)),
  ];
}

function collectSystemVarIds(
  transitions: readonly Model["transitions"][number][],
  prefix: string,
): string[] {
  const ids = new Set<string>();
  const visit = (effect: EffectIR): void => {
    if (effect.kind === "assign" && effect.var.startsWith(prefix))
      ids.add(effect.var);
    if (effect.kind === "havoc" && effect.var.startsWith(prefix))
      ids.add(effect.var);
    if (effect.kind === "seq") effect.effects.forEach(visit);
    if (effect.kind === "if") {
      visit(effect.then);
      visit(effect.else);
    }
  };
  for (const transition of transitions) {
    visit(transition.effect);
    for (const varId of [...transition.reads, ...transition.writes]) {
      if (varId.startsWith(prefix)) ids.add(varId);
    }
  }
  return [...ids];
}

function pendingVars(
  effectApis: readonly string[],
  transitions: readonly Model["transitions"][number][] = [],
  vars: readonly StateVarDecl[] = [],
  maxPending = 3,
  effectOpAliases: EffectOpAliases = new Map(),
): StateVarDecl[] {
  const canonicalOp = (op: string): string => {
    for (const perFile of effectOpAliases.values()) {
      const canonical = perFile.get(op);
      if (canonical) return canonical;
    }
    return op;
  };
  const enqueues = transitions.flatMap((transition) =>
    enqueueOps(transition.effect),
  );
  const opValues = new Set<string>();
  const continuationValues = new Set<string>();
  const argFields: Record<string, StateVarDecl["domain"]> = {};
  const varsById = new Map(vars.map((decl) => [decl.id, decl]));
  if (enqueues.length > 0) {
    for (const enqueue of enqueues) {
      const op = canonicalOp(enqueue.op);
      opValues.add(op);
      continuationValues.add(enqueue.continuation);
      for (const [name, expr] of Object.entries(enqueue.args)) {
        const domain = pendingArgDomain(expr, varsById);
        if (domain) argFields[name] = mergeArgDomains(argFields[name], domain);
      }
    }
  } else {
    for (const op of effectApis) {
      const canonical = canonicalOp(op);
      opValues.add(canonical);
      continuationValues.add(`App.onClick.${canonical}.cont`);
      continuationValues.add(`App.onSubmit.${canonical}.cont`);
      continuationValues.add(`App.onChange.${canonical}.cont`);
    }
  }
  if (opValues.size === 0) opValues.add("noop");
  if (continuationValues.size === 0) continuationValues.add("noop");
  const ops = [...opValues].sort();
  const continuations = [...continuationValues].sort();
  return [
    {
      id: "sys:pending",
      domain: {
        kind: "boundedList",
        inner: {
          kind: "record",
          fields: {
            opId: { kind: "enum", values: ops },
            continuation: { kind: "enum", values: continuations },
            args: { kind: "record", fields: argFields },
          },
        },
        maxLen: maxPending,
      },
      origin: "system",
      scope: { kind: "global" },
      role: { kind: "pending-queue" },
      initial: [],
    },
  ];
}

function enqueueOps(effect: EffectIR): {
  op: string;
  continuation: string;
  args: Extract<EffectIR, { kind: "enqueue" }>["args"];
}[] {
  if (effect.kind === "enqueue")
    return [
      { op: effect.op, continuation: effect.continuation, args: effect.args },
    ];
  if (effect.kind === "seq") return effect.effects.flatMap(enqueueOps);
  if (effect.kind === "if")
    return [...enqueueOps(effect.then), ...enqueueOps(effect.else)];
  return [];
}

function pendingArgDomain(
  expr: Extract<EffectIR, { kind: "enqueue" }>["args"][string],
  varsById: ReadonlyMap<string, StateVarDecl>,
): StateVarDecl["domain"] | undefined {
  if (expr.kind === "lit") return domainForLiteral(expr.value);
  if (expr.kind !== "read" && expr.kind !== "readPre")
    return { kind: "tokens", count: 1 };
  const domain = varsById.get(expr.var)?.domain;
  if (!domain) return { kind: "tokens", count: 1 };
  return expr.path?.length ? { kind: "tokens", count: 1 } : domain;
}

function domainForLiteral(value: unknown): StateVarDecl["domain"] {
  if (typeof value === "boolean") return { kind: "bool" };
  if (typeof value === "number")
    return { kind: "boundedInt", min: value, max: value };
  if (typeof value === "string") return { kind: "enum", values: [value] };
  if (value === null)
    return { kind: "option", inner: { kind: "tokens", count: 1 } };
  return { kind: "tokens", count: 1 };
}

function mergeArgDomains(
  left: StateVarDecl["domain"] | undefined,
  right: StateVarDecl["domain"],
): StateVarDecl["domain"] {
  if (!left) return right;
  if (left.kind === "enum" && right.kind === "enum")
    return {
      kind: "enum",
      values: [...new Set([...left.values, ...right.values])].sort(),
    };
  if (left.kind === "boundedInt" && right.kind === "boundedInt")
    return {
      kind: "boundedInt",
      min: Math.min(left.min, right.min),
      max: Math.max(left.max, right.max),
    };
  if (left.kind === right.kind) return left;
  return { kind: "tokens", count: 1 };
}
