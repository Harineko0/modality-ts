import * as ts from "typescript";
import { callName, lineAndColumn, literalValue, propertyName } from "../ast.js";
import { safeId } from "../ids.js";
import {
  effectReads,
  effectWrites,
  type Locator,
  type Transition,
} from "modality-ts/core";
import type { CallSite, M0Ctx, StateSourcePlugin } from "../../spi/index.js";
import type { BoundExpr, SetterBinding } from "../types.js";
import { stateVarForName } from "./expressions.js";
import { labelForEvent } from "./ui.js";

export function pluginWriteTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>,
  sourcePlugins: readonly StateSourcePlugin[],
  locator: Locator | undefined,
): Transition | undefined {
  const callee = callName(call.expression);
  if (!callee) return undefined;
  const ctx: M0Ctx = {
    read: (name, path) => {
      const local = locals.get(name);
      if (local?.expr.kind === "read") {
        return {
          kind: "read",
          var: local.expr.var,
          path: [...(local.expr.path ?? []), ...(path ?? [])],
        };
      }
      const varId = stateVarForName(name, setters) ?? name;
      return {
        kind: "read",
        var: varId,
        ...(path && path.length > 0 ? { path } : {}),
      };
    },
    locator,
  };
  const callSite: CallSite = {
    callee,
    arguments: call.arguments.map(callArgumentValue),
    source: { file: fileName, ...lineAndColumn(source, call) },
  };
  for (const plugin of sourcePlugins) {
    const summary = plugin.summarizeWrite?.(callSite, ctx);
    if (!summary || summary === "unsupported") continue;
    const reads = [...effectReads(summary)].sort();
    const writes = [...effectWrites(summary)].sort();
    return {
      id: `${component}.${attr}.${safeId(plugin.id)}.${safeId(callee)}`,
      cls: "user",
      label: labelForEvent(attr, locator),
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard: { kind: "lit", value: true },
      effect: summary,
      reads,
      writes,
      confidence: "exact",
    };
  }
  return undefined;
}

export function callArgumentValue(argument: ts.Expression): unknown {
  const literal = literalValue(argument);
  if (literal !== undefined) return literal;
  if (ts.isIdentifier(argument)) return argument.text;
  if (ts.isObjectLiteralExpression(argument)) {
    const fields: Record<string, unknown> = {};
    for (const property of argument.properties) {
      if (!ts.isPropertyAssignment(property)) return argument.getText();
      const name = propertyName(property.name);
      if (!name) return argument.getText();
      fields[name] = callArgumentValue(property.initializer);
    }
    return fields;
  }
  return argument.getText();
}

export function swrMutateTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  locator: Locator | undefined,
): Transition | undefined {
  if (
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== "mutate" ||
    call.arguments.length !== 0
  )
    return undefined;
  return {
    id: `${component}.${attr}.mutate`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "seq", effects: [] },
    reads: [],
    writes: [],
    confidence: "exact",
  };
}

export function noopCallTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  locator: Locator | undefined,
): Transition | undefined {
  const name = callName(call.expression) ?? call.expression.getText(source);
  if (!isKnownPureUiCall(name)) return undefined;
  return {
    id: `${component}.${attr}.${safeId(name)}.noop`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "seq", effects: [] },
    reads: [],
    writes: [],
    confidence: "exact",
  };
}

export function isKnownPureUiCall(name: string): boolean {
  return (
    name.endsWith(".click") ||
    name === "confirm" ||
    name === "navigator.clipboard.writeText" ||
    name.endsWith(".writeText")
  );
}
