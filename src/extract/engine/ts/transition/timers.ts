import * as ts from "typescript";
import {
  callName,
  isUseRefCall,
  lineAndColumn,
} from "../ast.js";
import { handlerExpression } from "../components.js";
import { safeId, uniqueStrings } from "../ids.js";
import type { Transition } from "modality-ts/core";
import type {
  ExtractableHandler,
  EffectSummary,
  SetterBinding,
} from "../types.js";
import {
  effectWriteVars,
  settersWrittenIn,
  uniqueSetters,
} from "./effects.js";
import { stateNameForVar } from "./handlers.js";
import { summarizeHandlerStatements } from "./statement-summary.js";

export function refSetterTaint(
  node: ts.Node,
  setters: Map<string, SetterBinding>,
): { varId: string; node: ts.Node } | undefined {
  if (
    ts.isVariableDeclaration(node) &&
    node.initializer &&
    isUseRefCall(node.initializer)
  ) {
    const arg = node.initializer.arguments[0];
    if (arg && ts.isIdentifier(arg)) {
      const setter = setters.get(arg.text);
      if (setter) return { varId: setter.varId, node: arg };
    }
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(node.left) &&
    node.left.name.text === "current" &&
    ts.isIdentifier(node.right)
  ) {
    const setter = setters.get(node.right.text);
    if (setter) return { varId: setter.varId, node: node.right };
  }
  return undefined;
}

export function timerSetterTaints(
  node: ts.Node,
  setters: Map<string, SetterBinding>,
): { varId: string; node: ts.Node }[] {
  if (!ts.isCallExpression(node)) return [];
  const name = callName(node.expression);
  if (name !== "setTimeout" && name !== "setInterval") return [];
  const callback = node.arguments[0];
  if (
    !callback ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  )
    return [];
  if (timerCallbackSummaries(callback, setters)) return [];
  return uniqueSetters(settersWrittenIn(callback.body, setters)).map(
    (setter) => ({ varId: setter.varId, node: callback }),
  );
}

export function transitionsFromTimerCall(
  source: ts.SourceFile,
  fileName: string,
  node: ts.Node,
  setters: Map<string, SetterBinding>,
  component: string,
): Transition[] {
  if (!ts.isCallExpression(node)) return [];
  const name = callName(node.expression);
  if (name !== "setTimeout" && name !== "setInterval") return [];
  const callback = node.arguments[0];
  if (
    !callback ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  )
    return [];
  const summaries = timerCallbackSummaries(callback, setters);
  if (!summaries || summaries.length === 0) return [];
  const effects = summaries.map((summary) => summary.effect);
  const writes = uniqueStrings(effects.flatMap(effectWriteVars));
  const suffix =
    writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_") ||
    "callback";
  return [
    {
      id: `${component}.${name}.${suffix}`,
      cls: "env",
      label: { kind: "timer", key: `${component}.${name}.${suffix}` },
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard: { kind: "lit", value: true },
      effect: effects.length === 1 ? effects[0]! : { kind: "seq", effects },
      reads: uniqueStrings(summaries.flatMap((summary) => summary.reads)),
      writes,
      confidence: effects.some((effect) => effect.kind === "havoc")
        ? "over-approx"
        : "exact",
    },
  ];
}

export function timerCallbackSummaries(
  callback: ExtractableHandler,
  setters: Map<string, SetterBinding>,
): EffectSummary[] | undefined {
  return summarizeHandlerStatements(callback, setters);
}

export function handlerSchedulesModeledTimer(
  attribute: ts.JsxAttribute,
  handlers: Map<string, ExtractableHandler>,
  setters: Map<string, SetterBinding>,
): boolean {
  if (!attribute.initializer) return false;
  const expression = ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined;
  const handler = handlerExpression(expression, handlers);
  if (!handler) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      const callback = node.arguments[0];
      if (
        (name === "setTimeout" || name === "setInterval") &&
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        timerCallbackSummaries(callback, setters)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(handler.body);
  return found;
}
