import * as ts from "typescript";
import {
  isUseDeferredValueCall,
  isUseTransitionCall,
  lineAndColumn,
} from "../ast.js";
import { uniqueStrings } from "../ids.js";
import type {
  EffectIR,
  ExprIR,
  StateVarDecl,
  Transition,
} from "modality-ts/core";
import type { SetterBinding, EffectSummary } from "../types.js";
import { summarizeHandlerStatements } from "./statement-summary.js";
import { pendingIs } from "./async.js";

export interface TransitionBinding {
  varId: string;
  setterName: string;
  startTransitionName: string;
  index: number;
}

export function transitionVarId(component: string, index: number): string {
  return `local:${component}.isPending#${index}`;
}

export function deferredVarId(component: string, srcVarId: string): string {
  const suffix = srcVarId.split(".").at(-1) ?? srcVarId;
  return `local:${component}.deferred:${suffix}`;
}

export function extractUseTransitionBinding(
  node: ts.VariableDeclaration,
  component: string,
  index: number,
  route: string,
  fileName: string,
  source: ts.SourceFile,
  scope: StateVarDecl["scope"],
): { varDecl: StateVarDecl; binding: TransitionBinding } | undefined {
  if (!node.initializer || !isUseTransitionCall(node.initializer))
    return undefined;
  if (!ts.isArrayBindingPattern(node.name)) return undefined;
  const pending = node.name.elements[0];
  const starter = node.name.elements[1];
  if (
    !pending ||
    !starter ||
    !ts.isBindingElement(pending) ||
    !ts.isIdentifier(pending.name) ||
    !ts.isBindingElement(starter) ||
    !ts.isIdentifier(starter.name)
  ) {
    return undefined;
  }
  const varId = transitionVarId(component, index);
  return {
    varDecl: {
      id: varId,
      domain: { kind: "bool" },
      origin: { file: fileName, ...lineAndColumn(source, node) },
      scope,
      initial: false,
    },
    binding: {
      varId,
      setterName: starter.name.text,
      startTransitionName: starter.name.text,
      index,
    },
  };
}

export function extractUseDeferredValueBinding(
  node: ts.VariableDeclaration,
  component: string,
  srcVarId: string,
  srcDomain: StateVarDecl["domain"],
  srcInitial: StateVarDecl["initial"],
  route: string,
  fileName: string,
  source: ts.SourceFile,
  scope: StateVarDecl["scope"],
): StateVarDecl | undefined {
  if (!node.initializer || !isUseDeferredValueCall(node.initializer))
    return undefined;
  if (!ts.isIdentifier(node.name)) return undefined;
  return {
    id: deferredVarId(component, srcVarId),
    domain: srcDomain,
    origin: { file: fileName, ...lineAndColumn(source, node) },
    scope,
    // The deferred value mirrors its source, so it must start at the source's
    // initial value (sharing its domain). `false` would be invalid for any
    // non-bool source domain and fail model well-formedness validation.
    initial: srcInitial,
  };
}

export function deferredSyncTransition(
  component: string,
  deferredId: string,
  srcVarId: string,
  fileName: string,
  source: ts.SourceFile,
  node: ts.Node,
): Transition {
  return {
    id: `${component}.deferred.sync.${deferredId.split(".").at(-1)}`,
    cls: "internal",
    label: { kind: "internal", text: `${component}.deferred.sync` },
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: {
      kind: "assign",
      var: deferredId,
      expr: { kind: "read", var: srcVarId },
    },
    reads: [srcVarId],
    writes: [deferredId],
    confidence: "exact",
    triggeredBy: [srcVarId],
    phase: 1,
  };
}

export interface StartTransitionScheduleResult {
  scheduleSummary: EffectSummary;
  resolveTransition: Transition;
}

export function startTransitionScheduleFromCall(
  source: ts.SourceFile,
  fileName: string,
  node: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  component: string,
  binding: TransitionBinding,
): StartTransitionScheduleResult | undefined {
  const callback = node.arguments[0];
  if (
    !callback ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  ) {
    return undefined;
  }
  const summaries = summarizeHandlerStatements(callback, setters);
  if (!summaries || summaries.length === 0) return undefined;
  const effects = summaries.map((summary) => summary.effect);
  const op = `transition:${component}#${binding.index}`;
  const baseId = `${component}.${binding.startTransitionName}.${op}`;
  const commitEffects: EffectIR[] = [
    ...effects,
    { kind: "assign", var: binding.varId, expr: { kind: "lit", value: false } },
  ];
  const scheduleSummary: EffectSummary = {
    effect: {
      kind: "seq",
      effects: [
        {
          kind: "assign",
          var: binding.varId,
          expr: { kind: "lit", value: true },
        },
        {
          kind: "enqueue",
          op,
          continuation: `${baseId}.commit`,
          args: {},
        },
      ],
    },
    reads: [],
  };
  const resolve: Transition = {
    id: `${baseId}.success`,
    cls: "env",
    label: { kind: "resolve", op, outcome: "success" },
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: pendingIs(op),
    effect: {
      kind: "seq",
      effects: [{ kind: "dequeue", index: 0 }, ...commitEffects],
    },
    reads: uniqueStrings(["sys:pending", ...summaries.flatMap((s) => s.reads)]),
    writes: uniqueStrings([
      "sys:pending",
      binding.varId,
      ...effects.flatMap((effect) =>
        effect.kind === "assign"
          ? [effect.var]
          : effect.kind === "havoc"
            ? [effect.var]
            : [],
      ),
    ]),
    confidence: summaries.some((s) => s.effect.kind === "havoc")
      ? "over-approx"
      : "exact",
  };
  return { scheduleSummary, resolveTransition: resolve };
}

export function transitionsFromStartTransitionCall(
  source: ts.SourceFile,
  fileName: string,
  node: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  component: string,
  binding: TransitionBinding,
): Transition[] {
  const scheduled = startTransitionScheduleFromCall(
    source,
    fileName,
    node,
    setters,
    component,
    binding,
  );
  if (!scheduled) return [];
  const op = `transition:${component}#${binding.index}`;
  const baseId = `${component}.${binding.startTransitionName}.${op}`;
  return [
    {
      id: `${baseId}.start`,
      cls: "internal",
      label: { kind: "internal", text: baseId },
      source: scheduled.resolveTransition.source,
      guard: { kind: "lit", value: true },
      effect: scheduled.scheduleSummary.effect,
      reads: scheduled.scheduleSummary.reads,
      writes: uniqueStrings([binding.varId, "sys:pending"]),
      confidence: "exact",
    },
    scheduled.resolveTransition,
  ];
}

export function isPendingReadGuard(varId: string, expr: ExprIR): boolean {
  return expr.kind === "read" && expr.var === varId;
}
