import * as ts from "typescript";
import { lineAndColumn } from "../ast.js";
import {
  handlerExpression,
  jsxTagName,
} from "../components.js";
import {
  bindContextHookObjectDeclaration,
  emptyContextBindings,
} from "../context.js";
import {
  safeId,
  tagStableIdKey,
  uniqueStrings,
} from "../ids.js";
import { inputTransitions } from "../input-transitions.js";
import {
  type AbstractDomain,
  type ExprIR,
  type Locator,
  type Transition,
  type Value,
} from "modality-ts/core";
import type { RouterPlugin, StateSourcePlugin } from "../../spi/index.js";
import type {
  BoundExpr,
  ComponentDecl,
  ContextBindings,
  ExtractableHandler,
  ExtractionWarning,
  EffectSummary,
  SetterBinding,
} from "../types.js";
import { transitionsFromAsyncHandler } from "./async.js";
import {
  componentPropTrigger,
  transparentComponentPropTrigger,
} from "./component-props.js";
import {
  escapedSetters,
  havocSetterTransition,
  isLoopStatement,
  setterCallFrom,
  setterAssignEffect,
  settersWrittenIn,
  summarizeSetterStatement,
  uniqueSetters,
} from "./effects.js";
import {
  booleanExpr,
  setterArgumentExpr,
  stateVarForName,
  valueExpr,
} from "./expressions.js";
import {
  applyParsedGuard,
  combineParsedGuards,
  disabledGuardFor,
  parseConjunctiveGuardExpression,
  parseGuardExpression,
  renderGuardFor,
  type ParsedGuard,
} from "./guards.js";
import { navigationTransition } from "./navigation.js";
import {
  noopCallTransition,
  pluginWriteTransition,
  swrMutateTransition,
} from "./plugin-calls.js";
import {
  isInputValueExpression,
  labelForEvent,
  locatorForEventAttribute,
} from "./ui.js";

export function transitionsFromJsxAttribute(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  sourcePlugins: readonly StateSourcePlugin[],
  routerPlugin: RouterPlugin | undefined,
  disabledGuard: ParsedGuard | undefined,
  routePatterns: readonly string[],
  contextBindings: ContextBindings,
  warnings: ExtractionWarning[],
): Transition[] {
  if (!node.initializer) return [];
  const expression = ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : undefined;
  const handler = handlerExpression(expression, handlers);
  if (!handler) return [];
  if (!ts.isIdentifier(node.name)) return [];
  const attr = node.name.text;
  const locator = locatorForEventAttribute(node);
  return tagStableIdKey(
    transitionsFromResolvedHandler(
      source,
      fileName,
      node,
      attr,
      handler,
      setters,
      handlers,
      component,
      effectApis,
      asyncOutcomes,
      sourcePlugins,
      routerPlugin,
      disabledGuard,
      locator,
      routePatterns,
      contextBindings,
      warnings,
    ),
    handler,
  );
}

export function transitionsFromComponentPropAttribute(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  components: Map<string, ComponentDecl>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  sourcePlugins: readonly StateSourcePlugin[],
  routerPlugin: RouterPlugin | undefined,
  warnings: ExtractionWarning[],
): Transition[] {
  if (!node.initializer || !ts.isIdentifier(node.name)) return [];
  const tag = jsxTagName(node);
  if (!tag) return [];
  const callee = components.get(tag);
  if (!callee) return [];
  const trigger =
    componentPropTrigger(source, callee, node.name.text, setters, warnings) ??
    transparentComponentPropTrigger(callee, node.name.text);
  if (!trigger) return [];
  const expression = ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : undefined;
  const handler = handlerExpression(expression, handlers);
  if (!handler) return [];
  const guardLocals = componentGuardLocalsFor(node, setters);
  const callerGuard = combineParsedGuards([
    renderGuardFor(node, setters, warnings, source, component, guardLocals),
    disabledGuardFor(node, setters, warnings, source, component, guardLocals),
  ]);
  return tagStableIdKey(
    transitionsFromResolvedHandler(
      source,
      fileName,
      node,
      trigger.attr,
      handler,
      setters,
      handlers,
      component,
      effectApis,
      asyncOutcomes,
      sourcePlugins,
      routerPlugin,
      combineParsedGuards([trigger.guard, callerGuard]),
      trigger.locator,
      [],
      emptyContextBindings(),
      warnings,
    ),
    handler,
  );
}

export function transitionsFromBoundedListAttribute(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  component: string,
  listInfo: {
    varId: string;
    domain: Extract<AbstractDomain, { kind: "boundedList" }>;
    itemName: string;
  },
): Transition[] {
  if (!node.initializer || !ts.isIdentifier(node.name)) return [];
  const expression = ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : undefined;
  const handler = handlerExpression(expression, handlers);
  if (!handler) return [];
  const attr = node.name.text;
  const summary = callSummaryFromHandler(
    handler,
    setters,
    new Map([[listInfo.itemName, readListItemBinding(listInfo.varId, 0)]]),
  );
  if (!summary) return [];
  const setterCall = setterCallFrom(summary.call, setters);
  if (!setterCall) return [];
  const baseLocator = locatorForEventAttribute(node);
  const transitions: Transition[] = [];
  for (let index = 0; index < listInfo.domain.maxLen; index += 1) {
    const locals = new Map(summary.locals);
    locals.set(listInfo.itemName, readListItemBinding(listInfo.varId, index));
    const assigned = setterArgumentExpr(
      setterCall.argument,
      setterCall.setter,
      setters,
      locals,
    );
    if (!assigned) return [];
    const locator = baseLocator
      ? { kind: "positional" as const, base: baseLocator, index }
      : undefined;
    const guard = boundedListIndexGuard(listInfo.varId, index);
    transitions.push({
      id: `${component}.${attr}.${setterCall.setter.stateName}.${index}`,
      cls: "user" as const,
      label: labelForEvent(attr, locator),
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard,
      effect: {
        kind: "assign" as const,
        var: setterCall.setter.varId,
        expr: assigned.expr,
      },
      reads: uniqueStrings([listInfo.varId, ...assigned.reads]),
      writes: [setterCall.setter.varId],
      confidence: index <= 1 ? ("exact" as const) : ("over-approx" as const),
    });
  }
  return transitions;
}

export function readListItemBinding(varId: string, index: number): BoundExpr {
  return {
    expr: { kind: "read", var: varId, path: [String(index)] },
    reads: [varId],
  };
}

export function boundedListIndexGuard(varId: string, index: number): ExprIR {
  const len = {
    kind: "lenCat" as const,
    arg: { kind: "read" as const, var: varId },
  };
  if (index === 0)
    return { kind: "neq", args: [len, { kind: "lit", value: "0" }] };
  return { kind: "eq", args: [len, { kind: "lit", value: "many" }] };
}

export function transitionsFromResolvedHandler(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  sourcePlugins: readonly StateSourcePlugin[],
  routerPlugin: RouterPlugin | undefined,
  disabledGuard: ParsedGuard | undefined,
  locator: Locator | undefined,
  routePatterns: readonly string[],
  contextBindings: ContextBindings,
  warnings: ExtractionWarning[],
): Transition[] {
  const asyncTransitions = transitionsFromAsyncHandler(
    source,
    fileName,
    attr,
    handler,
    setters,
    component,
    effectApis,
    asyncOutcomes,
    locator,
    routePatterns,
    warnings,
  );
  if (asyncTransitions.length > 0)
    return applyParsedGuard(asyncTransitions, disabledGuard);
  const conditionalTransition = conditionalTransitionFromHandler(
    source,
    fileName,
    node,
    attr,
    handler,
    setters,
    component,
    locator,
  );
  if (conditionalTransition)
    return applyParsedGuard([conditionalTransition], disabledGuard);
  const loopTransitions = loopWriteTransitions(
    source,
    fileName,
    node,
    attr,
    handler,
    setters,
    component,
    locator,
  );
  if (loopTransitions.length > 0)
    return applyParsedGuard(loopTransitions, disabledGuard);
  const sequentialTransition = sequentialTransitionFromHandler(
    source,
    fileName,
    node,
    attr,
    handler,
    setters,
    handlers,
    component,
    locator,
  );
  if (sequentialTransition)
    return applyParsedGuard([sequentialTransition], disabledGuard);
  const summary = callSummaryFromHandler(
    handler,
    setters,
    componentScopeLocalsFor(node, setters, contextBindings),
  );
  if (!summary) return [];
  const inlined = inlinedHelperCall(summary.call, handlers, setters);
  const inlinedCall = inlined?.call ?? summary.call;
  const locals = inlined?.locals ?? summary.locals;
  const navigation = navigationTransition(
    source,
    fileName,
    node,
    attr,
    component,
    inlinedCall,
    locator,
    routerPlugin,
    routePatterns,
  );
  if (navigation) return applyParsedGuard([navigation], disabledGuard);
  const pluginWrite = pluginWriteTransition(
    source,
    fileName,
    node,
    attr,
    component,
    inlinedCall,
    setters,
    locals,
    sourcePlugins,
    locator,
  );
  if (pluginWrite) return applyParsedGuard([pluginWrite], disabledGuard);
  const swrMutate = swrMutateTransition(
    source,
    fileName,
    node,
    attr,
    component,
    inlinedCall,
    locator,
  );
  if (swrMutate) return applyParsedGuard([swrMutate], disabledGuard);
  const noop = noopCallTransition(
    source,
    fileName,
    node,
    attr,
    component,
    inlinedCall,
    locator,
  );
  if (noop) return applyParsedGuard([noop], disabledGuard);
  const setterCall = setterCallFrom(inlinedCall, setters);
  if (!setterCall) {
    const escaped = escapedSetters(inlinedCall, setters, locals);
    if (escaped.length === 0) return [];
    return applyParsedGuard(
      escapedSetterTransitions(
        source,
        fileName,
        node,
        attr,
        component,
        escaped,
        locator,
      ),
      disabledGuard,
    );
  }
  const { setter, argument } = setterCall;
  if (
    (attr === "onChange" || attr === "onInput") &&
    isInputValueExpression(inlinedCall.arguments[0], handler.parameters[0])
  ) {
    return applyParsedGuard(
      inputTransitions(
        source,
        fileName,
        node,
        attr,
        component,
        setter,
        locator,
      ),
      disabledGuard,
    );
  }
  const assignment = setterArgumentExpr(argument, setter, setters, locals);
  if (!assignment) {
    return applyParsedGuard(
      [
        havocSetterTransition(
          source,
          fileName,
          node,
          attr,
          component,
          setter,
          locator,
          "unrepresentable",
        ),
      ],
      disabledGuard,
    );
  }
  return applyParsedGuard(
    [
      {
        id: `${component}.${attr}.${setter.stateName}`,
        cls: "user",
        label: labelForEvent(attr, locator),
        source: [{ file: fileName, ...lineAndColumn(source, node) }],
        guard: { kind: "lit", value: true },
        effect: { kind: "assign", var: setter.varId, expr: assignment.expr },
        reads: assignment.reads,
        writes: [setter.varId],
        confidence: "exact",
      },
    ],
    disabledGuard,
  );
}

export function sequentialTransitionFromHandler(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  component: string,
  locator: Locator | undefined,
): Transition | undefined {
  if (!ts.isBlock(handler.body)) return undefined;
  const locals = new Map<string, BoundExpr>();
  const summaries: EffectSummary[] = [];
  for (const statement of handler.body.statements) {
    if (bindConstStatement(statement, setters, locals)) continue;
    const helper = helperSummariesFromStatement(statement, handlers, setters);
    if (helper) {
      summaries.push(...helper);
      continue;
    }
    const summary = summarizeSetterStatement(statement, setters, locals);
    if (!summary) return undefined;
    summaries.push(summary);
  }
  if (summaries.length <= 1) return undefined;
  const effects = summaries.map((summary) => summary.effect);
  const writes = uniqueStrings(effects.flatMap(effectWriteVars));
  return {
    id: `${component}.${attr}.${writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_")}.seq`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "seq", effects },
    reads: uniqueStrings(summaries.flatMap((summary) => summary.reads)),
    writes,
    confidence: effects.some((effect) => effect.kind === "havoc")
      ? "over-approx"
      : "exact",
  };
}

export function helperSummariesFromStatement(
  statement: ts.Statement,
  handlers: Map<string, ExtractableHandler>,
  setters: Map<string, SetterBinding>,
): EffectSummary[] | undefined {
  if (
    !ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression) ||
    !ts.isIdentifier(statement.expression.expression)
  )
    return undefined;
  const helper = handlers.get(statement.expression.expression.text);
  if (!helper || !ts.isBlock(helper.body)) return undefined;
  const locals = new Map<string, BoundExpr>();
  const summaries: EffectSummary[] = [];
  for (const child of helper.body.statements) {
    if (bindConstStatement(child, setters, locals)) continue;
    const summary = summarizeSetterStatement(child, setters, locals);
    if (summary) summaries.push(summary);
  }
  return summaries.length > 0 ? summaries : undefined;
}

export function loopWriteTransitions(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  locator: Locator | undefined,
): Transition[] {
  if (!ts.isBlock(handler.body)) return [];
  const loopSetters: SetterBinding[] = [];
  for (const statement of handler.body.statements) {
    if (!isLoopStatement(statement)) continue;
    for (const setter of settersWrittenIn(statement, setters))
      loopSetters.push(setter);
  }
  return uniqueSetters(loopSetters).map((setter) =>
    havocSetterTransition(
      source,
      fileName,
      node,
      attr,
      component,
      setter,
      locator,
      "loop",
    ),
  );
}

export function conditionalTransitionFromHandler(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  locator: Locator | undefined,
): Transition | undefined {
  const body = handler.body;
  if (
    !ts.isBlock(body) ||
    body.statements.length !== 1 ||
    !ts.isIfStatement(body.statements[0])
  )
    return undefined;
  const statement = body.statements[0];
  const condition = parseGuardExpression(statement.expression, setters);
  if (!condition) return undefined;
  const thenEffect =
    singleSetterEffect(statement.thenStatement, setters) ?? identityEffect();
  const elseEffect = statement.elseStatement
    ? (singleSetterEffect(statement.elseStatement, setters) ?? identityEffect())
    : identityEffect();
  if (thenEffect.kind === "seq" && elseEffect.kind === "seq") return undefined;
  const writes = [
    ...new Set([
      ...effectWriteVars(thenEffect),
      ...effectWriteVars(elseEffect),
    ]),
  ];
  const suffix =
    writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_") ||
    "if";
  return {
    id: `${component}.${attr}.${suffix}.if`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: {
      kind: "if",
      cond: condition.expr,
      // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
      then: thenEffect,
      else: elseEffect,
    },
    reads: condition.reads,
    writes,
    confidence: "exact",
  };
}

export function singleSetterEffect(
  statement: ts.Statement,
  setters: Map<string, SetterBinding>,
): Extract<Transition["effect"], { kind: "assign" }> | undefined {
  if (ts.isBlock(statement) && statement.statements.length === 1)
    return setterAssignEffect(statement.statements[0], setters);
  return setterAssignEffect(statement, setters);
}

export function identityEffect(): Extract<
  Transition["effect"],
  { kind: "seq" }
> {
  return { kind: "seq", effects: [] };
}

export function effectWriteVars(effect: Transition["effect"]): string[] {
  if (
    effect.kind === "assign" ||
    effect.kind === "havoc" ||
    effect.kind === "choose"
  )
    return [effect.var];
  if (effect.kind === "seq") return effect.effects.flatMap(effectWriteVars);
  if (effect.kind === "if")
    return [...effectWriteVars(effect.then), ...effectWriteVars(effect.else)];
  if (effect.kind === "enqueue" || effect.kind === "dequeue")
    return ["sys:pending"];
  if (effect.kind === "navigate") return ["sys:route", "sys:history"];
  return [...effect.ref.declaredWrites];
}

export function stateNameForVar(
  varId: string,
  setters: Map<string, SetterBinding>,
): string | undefined {
  return [...setters.values()].find((setter) => setter.varId === varId)
    ?.stateName;
}

export function componentGuardLocalsFor(
  attribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
): Map<string, BoundExpr> {
  const body = enclosingFunctionBody(attribute);
  if (!body) return new Map();
  const locals = new Map<string, BoundExpr>();
  for (const statement of body.statements) {
    if (statement.pos > attribute.pos) break;
    if (ts.isReturnStatement(statement)) break;
    bindConstStatement(statement, setters, locals, true);
  }
  return locals;
}

export function componentScopeLocalsFor(
  attribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  contextBindings: ContextBindings,
): Map<string, BoundExpr> {
  const body = enclosingFunctionBody(attribute);
  if (!body) return new Map();
  const locals = new Map<string, BoundExpr>();
  for (const statement of body.statements) {
    if (statement.pos > attribute.pos) break;
    if (ts.isReturnStatement(statement)) break;
    bindConstStatement(statement, setters, locals, true);
    for (const declaration of variableDeclarations(statement)) {
      bindContextHookObjectDeclaration(declaration, contextBindings, setters);
    }
  }
  return locals;
}

export function variableDeclarations(node: ts.Node): ts.VariableDeclaration[] {
  if (!ts.isVariableStatement(node)) return [];
  return [...node.declarationList.declarations];
}

export function enclosingFunctionBody(node: ts.Node): ts.Block | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isFunctionExpression(current) ||
        ts.isArrowFunction(current)) &&
      current.body &&
      ts.isBlock(current.body)
    ) {
      return current.body;
    }
    current = current.parent;
  }
  return undefined;
}

export function callSummaryFromHandler(
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  initialLocals: Map<string, BoundExpr> = new Map(),
): { call: ts.CallExpression; locals: Map<string, BoundExpr> } | undefined {
  const body = handler.body;
  if (ts.isCallExpression(body))
    return { call: body, locals: new Map(initialLocals) };
  if (ts.isVoidExpression(body) && ts.isCallExpression(body.expression))
    return { call: body.expression, locals: new Map(initialLocals) };
  if (ts.isBlock(body)) {
    const locals = new Map<string, BoundExpr>(initialLocals);
    for (let index = 0; index < body.statements.length; index += 1) {
      const statement = body.statements[index];
      const isLast = index === body.statements.length - 1;
      if (
        isLast &&
        ts.isExpressionStatement(statement) &&
        ts.isCallExpression(statement.expression)
      )
        return { call: statement.expression, locals };
      if (
        isLast &&
        ts.isExpressionStatement(statement) &&
        ts.isVoidExpression(statement.expression) &&
        ts.isCallExpression(statement.expression.expression)
      )
        return { call: statement.expression.expression, locals };
      if (!bindConstStatement(statement, setters, locals)) return undefined;
    }
  }
  return undefined;
}

export function bindConstStatement(
  statement: ts.Statement,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>,
  partialBoolean = false,
): boolean {
  if (!ts.isVariableStatement(statement)) return false;
  if (
    (ts.getCombinedNodeFlags(statement.declarationList) &
      ts.NodeFlags.Const) ===
    0
  )
    return false;
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
      return false;
    const setterAlias = ts.isIdentifier(declaration.initializer)
      ? (setters.get(declaration.initializer.text) ??
        locals.get(declaration.initializer.text)?.setter)
      : undefined;
    const binding: BoundExpr | undefined = setterAlias
      ? { expr: { kind: "lit", value: null }, reads: [], setter: setterAlias }
      : (valueExpr(declaration.initializer, setters, locals) ??
        (partialBoolean
          ? parseConjunctiveGuardExpression(
              declaration.initializer,
              setters,
              locals,
            )
          : booleanExpr(declaration.initializer, setters, locals)));
    if (!binding) return false;
    locals.set(declaration.name.text, binding);
  }
  return true;
}

export function inlinedHelperCall(
  call: ts.CallExpression,
  handlers: Map<string, ExtractableHandler>,
  setters: Map<string, SetterBinding>,
): { call: ts.CallExpression; locals: Map<string, BoundExpr> } | undefined {
  if (!ts.isIdentifier(call.expression) || call.arguments.length !== 0)
    return undefined;
  const helper = handlers.get(call.expression.text);
  return helper ? callSummaryFromHandler(helper, setters) : undefined;
}

export function escapedSetterTransitions(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  setters: readonly SetterBinding[],
  locator: Locator | undefined,
): Transition[] {
  return setters.map((setter) => ({
    id: `${component}.${attr}.${setter.stateName}.escaped`,
    cls: "user" as const,
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit" as const, value: true },
    effect: { kind: "havoc" as const, var: setter.varId },
    reads: [],
    writes: [setter.varId],
    confidence: "over-approx" as const,
  }));
}
