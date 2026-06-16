import * as ts from "typescript";
import { callName, lineAndColumn } from "../ast.js";
import { safeId, uniqueStrings } from "../ids.js";
import type { EffectIR, ExprIR, Transition } from "modality-ts/core";
import type {
  BoundExpr,
  ExtractableHandler,
  ExtractionWarning,
  SetterBinding,
} from "../types.js";
import {
  confidenceForEffects,
  containsAwaitedEffect,
  pendingIs,
} from "./async.js";
import { effectWriteVars, summarizeAsyncSegment } from "./effects.js";
import { valueExpr } from "./expressions.js";
import {
  applyParsedGuard,
  jsxAttributeBoolean,
  jsxElementForAttribute,
  submitButtonDisabledAttribute,
  type ParsedGuard,
} from "./guards.js";
import {
  labelForEvent,
  locatorForEventAttribute,
  locatorForJsxElement,
  stringAttribute,
} from "./ui.js";

export interface ReactRouterSubmitContext {
  route: string;
  component: string;
  actionDataVarId?: string;
  submitBindings: Map<string, boolean>;
  modeledSubmitHandlers: Set<string>;
}

export function isReactRouterFormElement(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  source: ts.SourceFile,
): boolean {
  const tag = node.tagName.getText(source);
  return tag === "Form";
}

export function isActionFormMethod(
  attrs: ts.JsxAttributes,
  source: ts.SourceFile,
): boolean {
  const method = stringAttribute(attrs, "method");
  if (!method) return false;
  return method.toLowerCase() !== "get";
}

export function routeActionOpId(route: string): string {
  return `ACTION ${route}`;
}

export function discoverUseSubmitBindings(
  node: ts.VariableDeclaration,
): string | undefined {
  if (!ts.isIdentifier(node.name) || !node.initializer) return undefined;
  if (
    ts.isCallExpression(node.initializer) &&
    ts.isIdentifier(node.initializer.expression) &&
    node.initializer.expression.text === "useSubmit"
  )
    return node.name.text;
  return undefined;
}

export function isUseActionDataCall(node: ts.CallExpression): boolean {
  return (
    ts.isIdentifier(node.expression) && node.expression.text === "useActionData"
  );
}

export function reactRouterActionDataVarDecl(
  component: string,
  route: string,
  origin?: import("modality-ts/core").StateVarDecl["origin"],
): import("modality-ts/core").StateVarDecl {
  const routePart = route ? `${safeId(route)}:` : "";
  return {
    id: `router:actionData:${routePart}${component}`,
    domain: { kind: "enum", values: ["none", "success", "error"] },
    initial: "none",
    origin: origin ?? "system",
    scope: { kind: "route-local", route },
  };
}

export function bindReactRouterActionDataRead(
  setters: Map<string, SetterBinding>,
  localName: string,
  varId: string,
  component: string,
): void {
  setters.set(localName, {
    varId,
    component,
    stateName: localName,
    domain: { kind: "enum", values: ["none", "success", "error"] },
    initial: "none",
  });
}

function hiddenInputArgs(
  form: ts.JsxElement | ts.JsxSelfClosingElement,
  setters: Map<string, SetterBinding>,
  source: ts.SourceFile,
): { args: Record<string, ExprIR>; reads: string[] } {
  const args: Record<string, ExprIR> = {};
  const reads = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(source);
      if (tag === "input") {
        const type = stringAttribute(node.attributes, "type");
        const name = stringAttribute(node.attributes, "name");
        if (type === "hidden" && name) {
          const valueAttr = node.attributes.properties.find(
            (property): property is ts.JsxAttribute =>
              ts.isJsxAttribute(property) &&
              ts.isIdentifier(property.name) &&
              property.name.text === "value",
          );
          const extracted = hiddenInputValue(valueAttr, setters);
          if (extracted) {
            args[name] = extracted.expr;
            for (const read of extracted.reads) reads.add(read);
          } else {
            args[name] = { kind: "lit", value: `token:${name}` };
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(form);
  return { args, reads: [...reads] };
}

function supportedHiddenValueWrapper(
  call: ts.CallExpression,
): "JSON.stringify" | "String" | "Number" | undefined {
  if (ts.isIdentifier(call.expression)) {
    if (call.expression.text === "String") return "String";
    if (call.expression.text === "Number") return "Number";
    return undefined;
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === "JSON" &&
    ts.isIdentifier(call.expression.name) &&
    call.expression.name.text === "stringify"
  ) {
    return "JSON.stringify";
  }
  return undefined;
}

function hiddenInputValue(
  attribute: ts.JsxAttribute | undefined,
  setters: Map<string, SetterBinding>,
): BoundExpr | undefined {
  if (!attribute?.initializer) return undefined;
  if (ts.isStringLiteral(attribute.initializer))
    return {
      expr: { kind: "lit", value: attribute.initializer.text },
      reads: [],
    };
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression
  ) {
    const expr = attribute.initializer.expression;
    if (ts.isCallExpression(expr)) {
      const wrapper = supportedHiddenValueWrapper(expr);
      if (wrapper && expr.arguments[0]) {
        const inner = valueExpr(expr.arguments[0], setters, new Map(), false);
        if (inner) return inner;
      }
    }
    return valueExpr(expr, setters, new Map(), false);
  }
  return undefined;
}

export function submitButtonDisabledGuardForForm(
  form: ts.JsxElement | ts.JsxSelfClosingElement,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
  source: ts.SourceFile,
  component: string,
): ParsedGuard | undefined {
  if (!ts.isJsxElement(form)) {
    const onSubmit = form.attributes.properties.find(
      (property): property is ts.JsxAttribute =>
        ts.isJsxAttribute(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "onSubmit",
    );
    if (onSubmit)
      return submitButtonDisabledAttribute(onSubmit)
        ? disabledFromSubmitAttr(onSubmit, setters, warnings, source, component)
        : undefined;
    return formSubmitButtonDisabled(form, setters, warnings, source, component);
  }
  const onSubmit = form.openingElement.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "onSubmit",
  );
  if (onSubmit) {
    const disabled = submitButtonDisabledAttribute(onSubmit);
    if (disabled)
      return disabledFromSubmitAttr(
        onSubmit,
        setters,
        warnings,
        source,
        component,
      );
  }
  return formSubmitButtonDisabled(form, setters, warnings, source, component);
}

function disabledFromSubmitAttr(
  onSubmit: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
  source: ts.SourceFile,
  component: string,
): ParsedGuard | undefined {
  const disabled = submitButtonDisabledAttribute(onSubmit);
  if (!disabled) return undefined;
  const parsed = jsxAttributeBoolean(disabled, setters, new Map());
  if (!parsed) {
    warnings.push({
      message: `Unsupported disabled guard ${component}.onSubmit`,
      ...lineAndColumn(source, disabled),
    });
    return undefined;
  }
  return { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads };
}

function formSubmitButtonDisabled(
  form: ts.JsxElement | ts.JsxSelfClosingElement,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
  source: ts.SourceFile,
  component: string,
): ParsedGuard | undefined {
  let disabledAttr: ts.JsxAttribute | undefined;
  const visit = (node: ts.Node): void => {
    if (disabledAttr) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (
        tag === "button" &&
        stringAttribute(node.attributes, "type") === "submit"
      ) {
        disabledAttr = node.attributes.properties.find(
          (property): property is ts.JsxAttribute =>
            ts.isJsxAttribute(property) &&
            ts.isIdentifier(property.name) &&
            (property.name.text === "disabled" ||
              property.name.text === "aria-disabled"),
        );
        if (disabledAttr) return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(form);
  if (!disabledAttr) return undefined;
  const parsed = jsxAttributeBoolean(disabledAttr, setters, new Map());
  if (!parsed) {
    warnings.push({
      message: `Unsupported disabled guard ${component}.onSubmit`,
      ...lineAndColumn(source, disabledAttr),
    });
    return undefined;
  }
  return { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads };
}

export function transitionsFromReactRouterForm(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  component: string,
  route: string,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
  ctx: ReactRouterSubmitContext,
): Transition[] {
  if (!isReactRouterFormElement(node, source)) return [];
  if (!isActionFormMethod(node.attributes, source)) return [];
  const op = routeActionOpId(route);
  const form: ts.JsxElement | ts.JsxSelfClosingElement = ts.isJsxOpeningElement(
    node,
  )
    ? node.parent
    : node;
  const { args, reads: argReads } = hiddenInputArgs(form, setters, source);
  const locator = locatorForJsxElement(node, source);
  const disabledGuard = submitButtonDisabledGuardForForm(
    form,
    setters,
    warnings,
    source,
    component,
  );
  const baseId = `${component}.onSubmit.${op}`;
  const sourceAnchor = [{ file: fileName, ...lineAndColumn(source, node) }];
  const enqueue: Transition = {
    id: `${baseId}.start`,
    cls: "user",
    label: labelForEvent("onSubmit", locator),
    source: sourceAnchor,
    guard: { kind: "lit", value: true },
    effect: {
      kind: "seq",
      effects: [
        {
          kind: "enqueue",
          op,
          continuation: `${baseId}.cont`,
          args,
        },
      ],
    },
    reads: argReads,
    writes: ["sys:pending"],
    confidence: "exact",
  };
  const successEffects: EffectIR[] = [{ kind: "dequeue", index: 0 }];
  const errorEffects: EffectIR[] = [{ kind: "dequeue", index: 0 }];
  if (ctx.actionDataVarId) {
    successEffects.push({
      kind: "assign",
      var: ctx.actionDataVarId,
      expr: { kind: "lit", value: "success" },
    });
    errorEffects.push({
      kind: "assign",
      var: ctx.actionDataVarId,
      expr: { kind: "lit", value: "error" },
    });
  }
  const success: Transition = {
    id: `${baseId}.success`,
    cls: "env",
    label: { kind: "resolve", op, outcome: "success" },
    source: sourceAnchor,
    guard: pendingIs(op),
    effect: { kind: "seq", effects: successEffects },
    reads: ["sys:pending"],
    writes: uniqueStrings([
      "sys:pending",
      ...successEffects.flatMap(effectWriteVars),
    ]),
    confidence: "exact",
  };
  const error: Transition = {
    id: `${baseId}.error`,
    cls: "env",
    label: { kind: "resolve", op, outcome: "error" },
    source: sourceAnchor,
    guard: pendingIs(op),
    effect: { kind: "seq", effects: errorEffects },
    reads: ["sys:pending"],
    writes: uniqueStrings([
      "sys:pending",
      ...errorEffects.flatMap(effectWriteVars),
    ]),
    confidence: "exact",
  };
  const onSubmit = node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "onSubmit",
  );
  if (onSubmit) ctx.modeledSubmitHandlers.add(`${component}.onSubmit`);
  return applyParsedGuard([enqueue, success, error], disabledGuard);
}

function isSubmitCall(
  call: ts.CallExpression,
  submitBindings: Map<string, boolean>,
): boolean {
  const name = callName(call.expression);
  return Boolean(name && submitBindings.has(name));
}

function submitMethodIsPost(call: ts.CallExpression): boolean {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return true;
  for (const prop of options.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "method" &&
      ts.isStringLiteral(prop.initializer)
    )
      return prop.initializer.text.toLowerCase() !== "get";
  }
  return true;
}

function findSubmitCall(
  handler: ExtractableHandler,
  submitBindings: Map<string, boolean>,
): ts.CallExpression | undefined {
  if (!ts.isBlock(handler.body)) return undefined;
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && isSubmitCall(node, submitBindings)) {
      if (submitMethodIsPost(node)) found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of handler.body.statements) visit(statement);
  return found;
}

function statementsBeforeSubmit(
  handler: ExtractableHandler,
  submitCall: ts.CallExpression,
): ts.Statement[] {
  if (!ts.isBlock(handler.body)) return [];
  const statements: ts.Statement[] = [];
  for (const statement of handler.body.statements) {
    let containsSubmit = false;
    const visit = (node: ts.Node): void => {
      if (node === submitCall) containsSubmit = true;
      else ts.forEachChild(node, visit);
    };
    visit(statement);
    if (containsSubmit) break;
    statements.push(statement);
  }
  return statements;
}

export function transitionsFromUseSubmitHandler(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  warnings: ExtractionWarning[],
  ctx: ReactRouterSubmitContext,
  disabledGuard: ParsedGuard | undefined,
  effectApis: Set<string>,
): Transition[] {
  const submitCall = findSubmitCall(handler, ctx.submitBindings);
  if (!submitCall) return [];
  const preStatements = statementsBeforeSubmit(handler, submitCall);
  if (containsAwaitedEffect(preStatements, effectApis)) {
    const anchor = lineAndColumn(source, submitCall);
    warnings.push({
      message: `Unextractable handler ${component}.${attr} [awaited-effect-before-submit] (${fileName}:${anchor.line}:${anchor.column})`,
      ...anchor,
    });
    return [];
  }
  const preSummaries = summarizeAsyncSegment(preStatements, setters);
  const preEffects = preSummaries.map((summary) => summary.effect);
  const op = routeActionOpId(ctx.route);
  const formElement = jsxElementForAttribute(node);
  const { args, reads: argReads } =
    formElement &&
    (ts.isJsxElement(formElement) || ts.isJsxSelfClosingElement(formElement))
      ? hiddenInputArgs(formElement, setters, source)
      : { args: {}, reads: [] as string[] };
  const locator = locatorForEventAttribute(node);
  const baseId = `${component}.${attr}.${op}`;
  const sourceAnchor = [{ file: fileName, ...lineAndColumn(source, node) }];
  const preReads = uniqueStrings([
    ...preSummaries.flatMap((summary) => summary.reads),
    ...argReads,
  ]);
  const enqueue: Transition = {
    id: `${baseId}.start`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: sourceAnchor,
    guard: { kind: "lit", value: true },
    effect: {
      kind: "seq",
      effects: [
        ...preEffects,
        {
          kind: "enqueue",
          op,
          continuation: `${baseId}.cont`,
          args,
        },
      ],
    },
    reads: preReads,
    writes: uniqueStrings([
      ...preEffects.flatMap(effectWriteVars),
      "sys:pending",
    ]),
    confidence: confidenceForEffects(preEffects),
  };
  const successEffects: EffectIR[] = [{ kind: "dequeue", index: 0 }];
  const errorEffects: EffectIR[] = [{ kind: "dequeue", index: 0 }];
  if (ctx.actionDataVarId) {
    successEffects.push({
      kind: "assign",
      var: ctx.actionDataVarId,
      expr: { kind: "lit", value: "success" },
    });
    errorEffects.push({
      kind: "assign",
      var: ctx.actionDataVarId,
      expr: { kind: "lit", value: "error" },
    });
  }
  const success: Transition = {
    id: `${baseId}.success`,
    cls: "env",
    label: { kind: "resolve", op, outcome: "success" },
    source: sourceAnchor,
    guard: pendingIs(op),
    effect: { kind: "seq", effects: successEffects },
    reads: ["sys:pending"],
    writes: uniqueStrings([
      "sys:pending",
      ...successEffects.flatMap(effectWriteVars),
    ]),
    confidence: "exact",
  };
  const error: Transition = {
    id: `${baseId}.error`,
    cls: "env",
    label: { kind: "resolve", op, outcome: "error" },
    source: sourceAnchor,
    guard: pendingIs(op),
    effect: { kind: "seq", effects: errorEffects },
    reads: ["sys:pending"],
    writes: uniqueStrings([
      "sys:pending",
      ...errorEffects.flatMap(effectWriteVars),
    ]),
    confidence: "exact",
  };
  ctx.modeledSubmitHandlers.add(`${component}.${attr}`);
  return applyParsedGuard([enqueue, success, error], disabledGuard);
}
