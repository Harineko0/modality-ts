import type {
  AbstractDomain,
  ExprIR,
  Locator,
  Transition,
  Value,
} from "modality-ts/core";
import * as ts from "typescript";
import type {
  NavigationAdapter,
  SemanticTypeContext,
  StateSourcePlugin,
} from "../../spi/index.js";
import { lineAndColumn } from "../ast.js";
import {
  type ComponentRegistry,
  jsxTagIdentifier,
  jsxTagName,
  resolveComponentEntry,
  resolveHandlerExpression,
} from "../components.js";
import { emptyContextBindings } from "../context.js";
import { safeId, tagStableIdKey, uniqueStrings } from "../ids.js";
import type {
  BoundExpr,
  ContextBindings,
  ExtractableHandler,
  ExtractionWarning,
  SetterBinding,
} from "../types.js";
import {
  type ComponentPropTrigger,
  resolveComponentPropTriggers,
} from "./component-props.js";
import { setterCallFrom } from "./effects.js";
import { setterArgumentExpr } from "./expressions.js";
import {
  applyParsedGuard,
  combineParsedGuards,
  disabledGuardFor,
  type ParsedGuard,
  renderGuardFor,
} from "./guards.js";
import {
  mergeLocals,
  transitionsFromResolvedHandler,
} from "./handler-resolution.js";
import type { HandlerExtractionContext } from "./handlers.js";
import { callSummaryFromHandler, componentGuardLocalsFor } from "./locals.js";
import {
  semanticEventName,
  transitionIdFromSemanticName,
} from "./semantic-ids.js";
import { gateUserTransitionForBoundary } from "./suspense.js";
import { labelForEvent, locatorForEventAttribute } from "./ui.js";

export function booleanControlledCallbackValues(
  attr: string,
): boolean[] | undefined {
  if (attr === "onOpenChange" || attr === "onCheckedChange") {
    return [true, false];
  }
  return undefined;
}

export function booleanCallbackParameterBindings(
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

export function booleanCallbackValueSuffix(
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
  routerPlugin: NavigationAdapter | undefined,
  disabledGuard: ParsedGuard | undefined,
  routePatterns: readonly string[],
  contextBindings: ContextBindings,
  warnings: ExtractionWarning[],
  resetSymbols: ReadonlySet<string> = new Set(["RESET"]),
  handlerContext: HandlerExtractionContext = {},
): Transition[] {
  if (!node.initializer) return [];
  const expression = ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : undefined;
  if (!ts.isIdentifier(node.name)) return [];
  const attr = node.name.text;
  const locator = locatorForEventAttribute(node);
  const resolvedHandler = resolveHandlerExpression(expression, handlers);
  if (!resolvedHandler) return [];
  const handler = resolvedHandler.handler;
  const semanticName = semanticEventName(node, resolvedHandler.name, locator);
  const timerRegistrations = handlerContext.timerRegistrations ?? [];
  const envTransitions = handlerContext.envTransitions ?? [];
  const timerIndex = handlerContext.timerIndex ?? { value: 0 };
  return tagStableIdKey(
    applySuspenseGate(
      [
        ...transitionsFromResolvedHandler(
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
          {
            ...handlerContext,
            ...(semanticName ? { semanticName } : {}),
            timerRegistrations,
            envTransitions,
            timerIndex,
          },
        ),
        ...envTransitions,
      ],
      handlerContext.activeBoundary,
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
  components: ComponentRegistry,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  sourcePlugins: readonly StateSourcePlugin[],
  routerPlugin: NavigationAdapter | undefined,
  warnings: ExtractionWarning[],
  routePatterns: readonly string[] = [],
  contextBindings: ContextBindings = emptyContextBindings(),
  resetSymbols: ReadonlySet<string> = new Set(["RESET"]),
  handlerContext: HandlerExtractionContext = {},
  types?: SemanticTypeContext,
): Transition[] {
  if (!node.initializer || !ts.isIdentifier(node.name)) return [];
  const tag = jsxTagIdentifier(node) ?? jsxTagName(node);
  if (!tag) return [];
  const callee = resolveComponentEntry(components, tag, types)?.decl;
  if (!callee) return [];
  const triggers = resolveComponentPropTriggers(
    source,
    callee,
    node.name.text,
    components,
    setters,
    warnings,
    {},
    types,
  );
  if (triggers.length === 0) return [];
  const expression = ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : undefined;
  const guardLocals = componentGuardLocalsFor(node, setters);
  const callerGuard = combineParsedGuards([
    renderGuardFor(node, setters, warnings, source, component, guardLocals),
    disabledGuardFor(node, setters, warnings, source, component, guardLocals),
  ]);
  return triggers.flatMap((trigger) =>
    transitionsForComponentPropTrigger(
      source,
      fileName,
      node,
      trigger,
      expression,
      setters,
      handlers,
      component,
      effectApis,
      asyncOutcomes,
      sourcePlugins,
      routerPlugin,
      callerGuard,
      routePatterns,
      contextBindings,
      warnings,
      resetSymbols,
      handlerContext,
    ),
  );
}

function transitionsForComponentPropTrigger(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  trigger: ComponentPropTrigger,
  expression: ts.Expression | undefined,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  sourcePlugins: readonly StateSourcePlugin[],
  routerPlugin: NavigationAdapter | undefined,
  callerGuard: ParsedGuard | undefined,
  routePatterns: readonly string[],
  contextBindings: ContextBindings,
  warnings: ExtractionWarning[],
  resetSymbols: ReadonlySet<string>,
  handlerContext: HandlerExtractionContext,
): Transition[] {
  const combinedGuard = combineParsedGuards([trigger.guard, callerGuard]);
  const triggerSuffix = trigger.pathSuffix ? `.${trigger.pathSuffix}` : "";
  if (expression && ts.isIdentifier(expression)) {
    const setter = setters.get(expression.text);
    if (setter && booleanControlledCallbackValues(trigger.attr)) {
      const directTransitions = directSetterBooleanCallbackTransitions(
        source,
        fileName,
        node,
        trigger.attr,
        setter,
        `${component}${triggerSuffix}`,
        combinedGuard,
        trigger.locator,
      );
      if (directTransitions.length > 0) {
        return tagStableIdKey(directTransitions, node);
      }
    }
  }
  const resolvedHandler = resolveHandlerExpression(expression, handlers);
  if (!resolvedHandler) return [];
  const handler = resolvedHandler.handler;
  const semanticName = semanticEventName(
    node,
    resolvedHandler.name,
    trigger.locator,
  );
  const transitions = transitionsFromResolvedHandler(
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
    routePatterns,
    contextBindings,
    warnings,
    resetSymbols,
    { ...handlerContext, ...(semanticName ? { semanticName } : {}) },
  );
  if (trigger.pathSuffix) {
    return transitions.map((transition) => ({
      ...transition,
      id: `${transition.id}${triggerSuffix}`,
    }));
  }
  return tagStableIdKey(transitions, handler);
}

export function transitionsFromBoundedListComponentPropAttribute(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  components: ComponentRegistry,
  component: string,
  listInfo: {
    varId: string;
    domain: Extract<AbstractDomain, { kind: "boundedList" }>;
    itemName: string;
  },
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  sourcePlugins: readonly StateSourcePlugin[],
  routerPlugin: NavigationAdapter | undefined,
  warnings: ExtractionWarning[],
  routePatterns: readonly string[] = [],
  contextBindings: ContextBindings = emptyContextBindings(),
  resetSymbols: ReadonlySet<string> = new Set(["RESET"]),
  handlerContext: HandlerExtractionContext = {},
  types?: SemanticTypeContext,
): Transition[] {
  if (!node.initializer || !ts.isIdentifier(node.name)) return [];
  const tag = jsxTagIdentifier(node) ?? jsxTagName(node);
  if (!tag) return [];
  const callee = resolveComponentEntry(components, tag, types)?.decl;
  if (!callee) return [];
  const triggers = resolveComponentPropTriggers(
    source,
    callee,
    node.name.text,
    components,
    setters,
    warnings,
    {},
    types,
  );
  if (triggers.length === 0) return [];
  const expression = ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : undefined;
  const resolvedHandler = resolveHandlerExpression(expression, handlers);
  if (!resolvedHandler) return [];
  const handler = resolvedHandler.handler;
  const guardLocals = componentGuardLocalsFor(node, setters);
  const callerGuard = combineParsedGuards([
    renderGuardFor(node, setters, warnings, source, component, guardLocals),
    disabledGuardFor(node, setters, warnings, source, component, guardLocals),
  ]);
  const transitions: Transition[] = [];
  for (const trigger of triggers) {
    for (let index = 0; index < listInfo.domain.maxLen; index += 1) {
      const initialLocals = mergeLocals(
        handlerContext.initialLocals,
        new Map([
          [listInfo.itemName, readListItemBinding(listInfo.varId, index)],
        ]),
      );
      const listGuard: ParsedGuard = {
        expr: boundedListIndexGuard(listInfo.varId, index),
        reads: [listInfo.varId],
      };
      const combinedGuard = combineParsedGuards([
        trigger.guard,
        callerGuard,
        listGuard,
      ]);
      const baseLocator = trigger.locator;
      const locator = baseLocator
        ? { kind: "positional" as const, base: baseLocator, index }
        : undefined;
      const semanticName = semanticEventName(
        node,
        resolvedHandler.name,
        trigger.locator,
      );
      const extracted = applyParsedGuard(
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
          undefined,
          locator,
          routePatterns,
          contextBindings,
          warnings,
          resetSymbols,
          {
            ...handlerContext,
            ...(semanticName ? { semanticName } : {}),
            initialLocals,
            valueSuffix: String(index),
          },
        ),
        combinedGuard,
      );
      const triggerSuffix = trigger.pathSuffix ? `.${trigger.pathSuffix}` : "";
      transitions.push(
        ...extracted.map((transition) => ({
          ...transition,
          id: triggerSuffix
            ? `${transition.id}${triggerSuffix}`
            : transition.id,
          confidence:
            index <= 1 ? transition.confidence : ("over-approx" as const),
        })),
      );
    }
  }
  return tagStableIdKey(transitions, handler);
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
  types?: SemanticTypeContext,
): Transition[] {
  if (!node.initializer || !ts.isIdentifier(node.name)) return [];
  const expression = ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : undefined;
  const resolvedHandler = resolveHandlerExpression(expression, handlers);
  if (!resolvedHandler) return [];
  const handler = resolvedHandler.handler;
  const attr = node.name.text;
  const summary = callSummaryFromHandler(
    handler,
    setters,
    new Map([[listInfo.itemName, readListItemBinding(listInfo.varId, 0)]]),
  );
  if (!summary) return [];
  const setterCall = setterCallFrom(summary.call, setters, types);
  if (!setterCall) return [];
  const baseLocator = locatorForEventAttribute(node);
  const semanticName = semanticEventName(
    node,
    resolvedHandler.name,
    baseLocator,
  );
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
      id: transitionIdFromSemanticName(
        component,
        attr,
        semanticName,
        setterCall.setter.stateName,
        `.${index}`,
      ),
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

export function transitionsFromLiteralListAttribute(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  component: string,
  listInfo: {
    itemName: string;
    values: readonly Value[];
  },
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  sourcePlugins: readonly StateSourcePlugin[],
  routerPlugin: NavigationAdapter | undefined,
  disabledGuard: ParsedGuard | undefined,
  routePatterns: readonly string[],
  contextBindings: ContextBindings,
  warnings: ExtractionWarning[],
  resetSymbols: ReadonlySet<string> = new Set(["RESET"]),
  handlerContext: HandlerExtractionContext = {},
): Transition[] {
  if (!node.initializer || !ts.isIdentifier(node.name)) return [];
  const expression = ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : undefined;
  const resolvedHandler = resolveHandlerExpression(expression, handlers);
  if (!resolvedHandler) return [];
  const handler = resolvedHandler.handler;
  const attr = node.name.text;
  const baseLocator = locatorForEventAttribute(node);
  return listInfo.values.flatMap((value, index) => {
    const locator = baseLocator
      ? { kind: "positional" as const, base: baseLocator, index }
      : undefined;
    const semanticName = semanticEventName(node, resolvedHandler.name, locator);
    return transitionsFromResolvedHandler(
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
      {
        ...handlerContext,
        ...(semanticName ? { semanticName } : {}),
        initialLocals: mergeLocals(
          handlerContext.initialLocals,
          new Map([
            [listInfo.itemName, { expr: { kind: "lit", value }, reads: [] }],
          ]),
        ),
        valueSuffix: safeId(String(value)),
      },
    );
  });
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

function applySuspenseGate(
  transitions: Transition[],
  activeBoundary: string | undefined,
): Transition[] {
  return transitions.map((transition) =>
    gateUserTransitionForBoundary(transition, activeBoundary),
  );
}
