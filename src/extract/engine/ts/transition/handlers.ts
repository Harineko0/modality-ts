import type {
  AbstractDomain,
  ExprIR,
  Locator,
  Transition,
  Value,
} from "modality-ts/core";
import * as ts from "typescript";
import type { RouterPlugin, StateSourcePlugin } from "../../spi/index.js";
import { lineAndColumn } from "../ast.js";
import { handlerExpression, jsxTagName } from "../components.js";
import { emptyContextBindings } from "../context.js";
import { safeId, tagStableIdKey, uniqueStrings } from "../ids.js";
import { inputTransitions } from "../input-transitions.js";
import type {
  BoundExpr,
  ComponentDecl,
  ContextBindings,
  ExtractableHandler,
  ExtractionWarning,
  SetterBinding,
} from "../types.js";
import {
  containsAwaitedEffect,
  containsAwaitInLoop,
  transitionsFromAsyncHandler,
} from "./async.js";
import {
  componentPropTrigger,
  transparentComponentPropTrigger,
} from "./component-props.js";
import {
  effectWriteVars,
  escapedSetters,
  havocSetterTransition,
  identityEffect,
  isLoopStatement,
  setterCallFrom,
  settersWrittenIn,
  singleSetterEffect,
  uniqueSetters,
} from "./effects.js";
import { setterArgumentExpr } from "./expressions.js";
import {
  applyParsedGuard,
  combineParsedGuards,
  disabledGuardFor,
  type ParsedGuard,
  parseGuardExpression,
  renderGuardFor,
} from "./guards.js";
import {
  callSummaryFromHandler,
  componentGuardLocalsFor,
  componentScopeLocalsFor,
  inlinedHelperCall,
} from "./locals.js";
import { navigationTransition } from "./navigation.js";
import {
  noopCallTransition,
  pluginWriteTransition,
  swrMutateTransition,
} from "./plugin-calls.js";
import {
  effectFromSummaries,
  summarizeHandlerStatements,
} from "./statement-summary.js";
import {
  isInputValueExpression,
  labelForEvent,
  locatorForEventAttribute,
} from "./ui.js";

function booleanControlledCallbackValues(attr: string): boolean[] | undefined {
  if (attr === "onOpenChange" || attr === "onCheckedChange") {
    return [true, false];
  }
  return undefined;
}

function booleanCallbackParameterBindings(
  handler: ExtractableHandler,
  attr: string,
): Map<string, BoundExpr>[] | undefined {
  const values = booleanControlledCallbackValues(attr);
  if (!values) return undefined;
  const firstParam = handler.parameters[0];
  if (!firstParam || !ts.isIdentifier(firstParam.name)) return undefined;
  const paramName = firstParam.name.text;
  return values.map(
    (value) =>
      new Map([
        [paramName, { expr: { kind: "lit", value }, reads: [] as string[] }],
      ]),
  );
}

function booleanCallbackValueSuffix(
  initialLocals: Map<string, BoundExpr>,
): string | undefined {
  for (const binding of initialLocals.values()) {
    if (binding.expr.kind === "lit") {
      const value = binding.expr.value;
      if (value === true || value === false) return String(value);
    }
  }
  return undefined;
}

function directSetterBooleanCallbackTransitions(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  setter: SetterBinding,
  component: string,
  disabledGuard: ParsedGuard | undefined,
  locator: Locator | undefined,
): Transition[] {
  const values = booleanControlledCallbackValues(attr);
  if (!values || setter.domain.kind !== "bool") return [];
  return applyParsedGuard(
    values.map((value) => ({
      id: `${component}.${attr}.${setter.stateName}.${value}`,
      cls: "user" as const,
      label: labelForEvent(attr, locator),
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard: { kind: "lit" as const, value: true },
      effect: {
        kind: "assign" as const,
        var: setter.varId,
        expr: { kind: "lit" as const, value },
      },
      reads: [],
      writes: [setter.varId],
      confidence: "exact" as const,
    })),
    disabledGuard,
  );
}

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
  resetSymbols: ReadonlySet<string> = new Set(["RESET"]),
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
      resetSymbols,
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
  const attr = node.name.text;
  const guardLocals = componentGuardLocalsFor(node, setters);
  const callerGuard = combineParsedGuards([
    renderGuardFor(node, setters, warnings, source, component, guardLocals),
    disabledGuardFor(node, setters, warnings, source, component, guardLocals),
  ]);
  const combinedGuard = combineParsedGuards([trigger.guard, callerGuard]);
  if (expression && ts.isIdentifier(expression)) {
    const setter = setters.get(expression.text);
    if (setter && booleanControlledCallbackValues(attr)) {
      const directTransitions = directSetterBooleanCallbackTransitions(
        source,
        fileName,
        node,
        attr,
        setter,
        component,
        combinedGuard,
        trigger.locator,
      );
      if (directTransitions.length > 0) {
        return tagStableIdKey(directTransitions, node);
      }
    }
  }
  const handler = handlerExpression(expression, handlers);
  if (!handler) return [];
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
      combinedGuard,
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
  resetSymbols: ReadonlySet<string> = new Set(["RESET"]),
): Transition[] {
  if (containsAwaitInLoop(handler)) {
    const { line, column } = lineAndColumn(source, handler);
    warnings.push({
      message: `Unextractable handler ${component}.${attr} [await-in-loop] (${fileName}:${line}:${column})`,
      line,
    });
    return [];
  }
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
    routerPlugin,
    routePatterns,
    warnings,
  );
  if (asyncTransitions.length > 0)
    return applyParsedGuard(asyncTransitions, disabledGuard);
  if (
    ts.isBlock(handler.body) &&
    containsAwaitedEffect(handler.body.statements, effectApis)
  ) {
    const { line, column } = lineAndColumn(source, handler);
    warnings.push({
      message: `Unextractable handler ${component}.${attr} [awaited-effect-in-block] (${fileName}:${line}:${column})`,
      line,
    });
    return [];
  }
  const callbackBindings = booleanCallbackParameterBindings(handler, attr);
  if (callbackBindings) {
    const callbackTransitions = callbackBindings.flatMap((initialLocals) => {
      const valueSuffix = booleanCallbackValueSuffix(initialLocals);
      const transition =
        sequentialTransitionFromHandler(
          source,
          fileName,
          node,
          attr,
          handler,
          setters,
          handlers,
          component,
          locator,
          resetSymbols,
          initialLocals,
          valueSuffix,
        ) ??
        conditionalTransitionFromHandler(
          source,
          fileName,
          node,
          attr,
          handler,
          setters,
          component,
          locator,
          initialLocals,
          valueSuffix,
        ) ??
        singleSetterTransitionFromHandler(
          source,
          fileName,
          node,
          attr,
          handler,
          setters,
          component,
          locator,
          initialLocals,
          resetSymbols,
          valueSuffix,
        );
      return transition ? [transition] : [];
    });
    if (callbackTransitions.length === callbackBindings.length) {
      return applyParsedGuard(callbackTransitions, disabledGuard);
    }
  }
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
    resetSymbols,
  );
  if (sequentialTransition)
    return applyParsedGuard([sequentialTransition], disabledGuard);
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
  const assignment = setterArgumentExpr(
    argument,
    setter,
    setters,
    locals,
    resetSymbols,
  );
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

function singleSetterTransitionFromHandler(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  locator: Locator | undefined,
  initialLocals: Map<string, BoundExpr>,
  resetSymbols: ReadonlySet<string>,
  valueSuffix?: string,
): Transition | undefined {
  const summary = callSummaryFromHandler(handler, setters, initialLocals);
  if (!summary) return undefined;
  const setterCall = setterCallFrom(summary.call, setters);
  if (!setterCall) return undefined;
  const assignment = setterArgumentExpr(
    setterCall.argument,
    setterCall.setter,
    setters,
    initialLocals,
    resetSymbols,
  );
  if (!assignment) return undefined;
  const suffix = valueSuffix ? `.${valueSuffix}` : "";
  return {
    id: `${component}.${attr}.${setterCall.setter.stateName}${suffix}`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: {
      kind: "assign",
      var: setterCall.setter.varId,
      expr: assignment.expr,
    },
    reads: assignment.reads,
    writes: [setterCall.setter.varId],
    confidence: "exact",
  };
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
  resetSymbols: ReadonlySet<string> = new Set(["RESET"]),
  initialLocals?: Map<string, BoundExpr>,
  valueSuffix?: string,
): Transition | undefined {
  const summaries = summarizeHandlerStatements(handler, setters, {
    handlers,
    resetSymbols,
    ...(initialLocals ? { initialLocals } : {}),
  });
  const onlySummary = summaries?.[0];
  if (
    !summaries ||
    summaries.length === 0 ||
    (summaries.length === 1 && onlySummary?.effect.kind !== "if")
  )
    return undefined;
  const effect = effectFromSummaries(summaries);
  const effects = effect.kind === "seq" ? effect.effects : [effect];
  const writes = uniqueStrings(effects.flatMap(effectWriteVars));
  const suffix = valueSuffix ? `.${valueSuffix}` : "";
  return {
    id: `${component}.${attr}.${writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_")}.seq${suffix}`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect,
    reads: uniqueStrings(summaries.flatMap((summary) => summary.reads)),
    writes,
    confidence: effects.some((effect) => effect.kind === "havoc")
      ? "over-approx"
      : "exact",
  };
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
  const visit = (candidate: ts.Node): void => {
    if (isLoopStatement(candidate)) {
      loopSetters.push(...settersWrittenIn(candidate, setters));
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(handler.body);
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
  initialLocals: Map<string, BoundExpr> = new Map(),
  valueSuffix?: string,
): Transition | undefined {
  const body = handler.body;
  if (
    !ts.isBlock(body) ||
    body.statements.length !== 1 ||
    !ts.isIfStatement(body.statements[0])
  )
    return undefined;
  const statement = body.statements[0];
  const condition = parseGuardExpression(
    statement.expression,
    setters,
    initialLocals,
  );
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
  const writeSuffix =
    writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_") ||
    "if";
  const suffix = valueSuffix ? `.${valueSuffix}` : "";
  return {
    id: `${component}.${attr}.${writeSuffix}.if${suffix}`,
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

export function stateNameForVar(
  varId: string,
  setters: Map<string, SetterBinding>,
): string | undefined {
  return [...setters.values()].find((setter) => setter.varId === varId)
    ?.stateName;
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
