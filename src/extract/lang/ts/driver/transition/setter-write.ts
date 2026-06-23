import type { EffectIR } from "modality-ts/core";
import * as ts from "typescript";
import type { SemanticTypeContext } from "../../semantic-type-context.js";
import { callName } from "../ast.js";
import { resolveSetterBinding } from "../context.js";
import type {
  BoundExpr,
  EffectSummary,
  SetterBinding,
  SetterCall,
} from "../types.js";
import { setterArgumentExpr } from "./expressions.js";

export interface StatementSummaryResetOptions {
  resetSymbols?: ReadonlySet<string>;
  snapshotReads?: boolean;
  snapshottedReads?: ReadonlySet<string>;
  types?: SemanticTypeContext;
}

export function setterCallFrom(
  call: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  types?: SemanticTypeContext,
): SetterCall | undefined {
  if (ts.isIdentifier(call.expression) && call.arguments.length === 0) {
    const setter = resolveSetterBinding(setters, call.expression, types);
    if (setter?.resettable || setter?.fixedEffect) {
      return {
        setter,
        argument: ts.factory.createNull(),
      };
    }
    return undefined;
  }
  if (ts.isIdentifier(call.expression) && call.arguments.length === 1) {
    const setter = resolveSetterBinding(setters, call.expression, types);
    const argument = call.arguments[0];
    if (
      !setter ||
      !argument ||
      !setterNameMatchesTarget(call.expression.text, setter)
    ) {
      return undefined;
    }
    return { setter, argument };
  }
  const name = callName(call.expression);
  const atomArg = call.arguments[0];
  if (
    name &&
    call.arguments.length === 2 &&
    atomArg &&
    ts.isIdentifier(atomArg)
  ) {
    const setter = setters.get(`${name}:${atomArg.text}`);
    const argument = call.arguments[1];
    return setter && argument ? { setter, argument } : undefined;
  }
  return undefined;
}

function setterNameMatchesTarget(
  setterName: string,
  setter: SetterBinding,
): boolean {
  if (setter.fixedEffect) return true;
  if (setter.stateName === setterName) return true;
  if (!setterName.startsWith("set") || setterName.length <= 3) return true;
  const expected = `${setterName[3]!.toLowerCase()}${setterName.slice(4)}`;
  const target = setter.stateName.split(/[.:]/u).at(-1) ?? setter.stateName;
  return (
    target === expected ||
    target === `${expected}Atom` ||
    expected === `${target}Local` ||
    expected === `${target}State`
  );
}

export function summarizeSetterWrite(
  setterCall: SetterCall,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
  resetOptions: StatementSummaryResetOptions = {},
): EffectSummary {
  if (
    setterCall.setter.fixedEffect &&
    setterCall.argument.kind === ts.SyntaxKind.NullKeyword
  ) {
    return {
      effect: setterCall.setter.fixedEffect,
      reads: [],
    };
  }
  if (
    setterCall.setter.resettable &&
    setterCall.setter.initial !== undefined &&
    setterCall.argument.kind === ts.SyntaxKind.NullKeyword
  ) {
    return {
      effect: {
        kind: "assign",
        var: setterCall.setter.varId,
        expr: { kind: "lit", value: setterCall.setter.initial },
      },
      reads: [],
    };
  }
  const assignment = setterArgumentExpr(
    setterCall.argument,
    setterCall.setter,
    setters,
    locals,
    resetOptions.resetSymbols,
    resetOptions.snapshotReads ?? true,
    resetOptions.snapshottedReads,
  );
  if (!assignment) {
    return {
      effect: { kind: "havoc", var: setterCall.setter.varId },
      reads: [],
    };
  }
  return {
    effect: {
      kind: "assign",
      var: setterCall.setter.varId,
      expr: assignment.expr,
    },
    reads: assignment.reads,
  };
}

export function summarizeSetterCall(
  call: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
  resetOptions: StatementSummaryResetOptions = {},
): EffectSummary | undefined {
  const setterCall = setterCallFrom(call, setters, resetOptions.types);
  if (!setterCall) return undefined;
  return summarizeSetterWrite(setterCall, setters, locals, resetOptions);
}

export function setterLeafEffect(
  call: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
  resetOptions: StatementSummaryResetOptions = {},
): { effect: EffectIR; reads: string[] } | undefined {
  return summarizeSetterCall(call, setters, locals, resetOptions);
}
