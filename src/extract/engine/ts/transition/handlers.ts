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
import type { EffectOpAliases } from "../effect-op-aliases.js";
import { lineAndColumn } from "../ast.js";
import { unextractableHandlerCaveat } from "../caveats.js";
import {
  jsxTagIdentifier,
  jsxTagName,
  resolveComponentEntry,
  resolveHandlerExpression,
  type ComponentRegistry,
} from "../components.js";
import { emptyContextBindings } from "../context.js";
import { safeId, tagStableIdKey, uniqueStrings } from "../ids.js";
import { inputTransitions } from "../input-transitions.js";
import type {
  BoundExpr,
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
  transitionsFromUseSubmitHandler,
  type ReactRouterSubmitContext,
} from "./router-submit.js";
import {
  resolveComponentPropTriggers,
  type ComponentPropTrigger,
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
import { gateUserTransitionForBoundary } from "./suspense.js";
import type { TransitionBinding } from "./concurrent.js";
import type { TimerRegistration } from "./timers.js";
import {
  isInputValueExpression,
  labelForEvent,
  locatorForEventAttribute,
} from "./ui.js";
import {
  semanticEventName,
  transitionIdFromSemanticName,
} from "./semantic-ids.js";

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

export interface HandlerExtractionContext {
  activeBoundary?: string;
  initialLocals?: Map<string, BoundExpr>;
  valueSuffix?: string;
  transitionBindings?: Map<string, TransitionBinding>;
  timerRegistrations?: TimerRegistration[];
  envTransitions?: Transition[];
  timerIndex?: { value: number };
  routerSubmitContext?: ReactRouterSubmitContext;
  effectOpAliases?: EffectOpAliases;
  types?: SemanticTypeContext;
  semanticName?: string;
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
  const attr = node.name.text;
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
  const semanticName = semanticEventName(node, resolvedHandler.name, baseLocator);
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
  routerPlugin: NavigationAdapter | undefined,
  disabledGuard: ParsedGuard | undefined,
  locator: Locator | undefined,
  routePatterns: readonly string[],
  contextBindings: ContextBindings,
  warnings: ExtractionWarning[],
  resetSymbols: ReadonlySet<string> = new Set(["RESET"]),
  handlerContext: HandlerExtractionContext = {},
): Transition[] {
  const summaryOptions = handlerSummaryOptions(
    source,
    fileName,
    component,
    handlers,
    resetSymbols,
    handlerContext,
  );
  if (containsAwaitInLoop(handler)) {
    const anchor = lineAndColumn(source, handler);
    warnings.push({
      message: `Unextractable handler ${component}.${attr} [await-in-loop] (${fileName}:${anchor.line}:${anchor.column})`,
      ...anchor,
      caveat: unextractableHandlerCaveat(
        `${component}.${attr}`,
        "await-in-loop",
        { file: fileName, ...anchor },
      ),
    });
    return [];
  }
  const routerCtx = handlerContext.routerSubmitContext;
  if (routerCtx && routerCtx.submitBindings.size > 0) {
    const submitTransitions = transitionsFromUseSubmitHandler(
      source,
      fileName,
      node,
      attr,
      handler,
      setters,
      component,
      warnings,
      routerCtx,
      disabledGuard,
      effectApis,
    );
    if (submitTransitions.length > 0) return submitTransitions;
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
    handlerContext.effectOpAliases ?? new Map(),
  );
  if (asyncTransitions.length > 0)
    return applyParsedGuard(asyncTransitions, disabledGuard);
  if (
    ts.isBlock(handler.body) &&
    containsAwaitedEffect(
      handler.body.statements,
      effectApis,
      fileName,
      handlerContext.effectOpAliases ?? new Map(),
    )
  ) {
    const anchor = lineAndColumn(source, handler);
    warnings.push({
      message: `Unextractable handler ${component}.${attr} [awaited-effect-in-block] (${fileName}:${anchor.line}:${anchor.column})`,
      ...anchor,
      caveat: unextractableHandlerCaveat(
        `${component}.${attr}`,
        "awaited-effect-in-block",
        { file: fileName, ...anchor },
      ),
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
          mergeLocals(handlerContext.initialLocals, initialLocals),
          valueSuffix,
          summaryOptions,
          handlerContext.semanticName,
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
          mergeLocals(handlerContext.initialLocals, initialLocals),
          valueSuffix,
          handlerContext.semanticName,
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
          mergeLocals(handlerContext.initialLocals, initialLocals) ?? new Map(),
          resetSymbols,
          valueSuffix,
          handlerContext.types,
          handlerContext.semanticName,
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
    handlerContext.initialLocals,
    undefined,
    handlerContext.semanticName,
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
    handlerContext.initialLocals,
    handlerContext.valueSuffix,
    summaryOptions,
    handlerContext.semanticName,
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
    handlerContext.semanticName,
  );
  if (loopTransitions.length > 0)
    return applyParsedGuard(loopTransitions, disabledGuard);
  const summary = callSummaryFromHandler(
    handler,
    setters,
    mergeLocals(
      componentScopeLocalsFor(node, setters, contextBindings),
      handlerContext.initialLocals,
    ),
  );
  if (!summary) return [];
  const inlined = inlinedHelperCall(
    summary.call,
    handlers,
    setters,
    summary.locals,
  );
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
  const setterCall = setterCallFrom(inlinedCall, setters, handlerContext.types);
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
        handlerContext.semanticName,
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
        semanticizeTransition(
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
          component,
          attr,
          handlerContext.semanticName,
          `${setter.stateName}.unrepresentable`,
          ".unrepresentable",
        ),
      ],
      disabledGuard,
    );
  }
  return applyParsedGuard(
    [
      {
        id: transitionIdFromSemanticName(
          component,
          attr,
          handlerContext.semanticName,
          setter.stateName,
        ),
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
  types?: SemanticTypeContext,
  semanticName?: string,
): Transition | undefined {
  const summary = callSummaryFromHandler(handler, setters, initialLocals);
  if (!summary) return undefined;
  const setterCall = setterCallFrom(summary.call, setters, types);
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
    id: transitionIdFromSemanticName(
      component,
      attr,
      semanticName,
      setterCall.setter.stateName,
      suffix,
    ),
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
  summaryOptions: Parameters<typeof summarizeHandlerStatements>[2] = {},
  semanticName?: string,
): Transition | undefined {
  const summaries = summarizeHandlerStatements(handler, setters, {
    handlers,
    resetSymbols,
    ...(initialLocals ? { initialLocals } : {}),
    ...summaryOptions,
  });
  const onlySummary = summaries?.[0];
  if (!summaries || summaries.length === 0) return undefined;
  if (
    summaries.length === 1 &&
    onlySummary &&
    onlySummary.effect.kind !== "if" &&
    !isSequentialSingleSummary(onlySummary) &&
    valueSuffix === undefined
  ) {
    return undefined;
  }
  const effect = effectFromSummaries(summaries);
  const effects = effect.kind === "seq" ? effect.effects : [effect];
  const writes = uniqueStrings(effects.flatMap(effectWriteVars));
  const suffix = valueSuffix ? `.${valueSuffix}` : "";
  const writeSegment = `${writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_")}.seq`;
  return {
    id: transitionIdFromSemanticName(
      component,
      attr,
      semanticName,
      writeSegment,
      suffix,
    ),
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
  semanticName?: string,
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
    semanticizeTransition(
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
      component,
      attr,
      semanticName,
      `${setter.stateName}.loop`,
      ".loop",
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
  semanticName?: string,
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
    true,
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
    id: transitionIdFromSemanticName(
      component,
      attr,
      semanticName,
      `${writeSuffix}.if`,
      suffix,
    ),
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
  semanticName?: string,
): Transition[] {
  return setters.map((setter) => ({
    id: transitionIdFromSemanticName(
      component,
      attr,
      semanticName,
      `${setter.stateName}.escaped`,
      ".escaped",
    ),
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

function semanticizeTransition(
  transition: Transition,
  component: string,
  attr: string,
  semanticName: string | undefined,
  fallbackSegment: string,
  semanticSuffix: string,
): Transition {
  if (!semanticName) return transition;
  return {
    ...transition,
    id: transitionIdFromSemanticName(
      component,
      attr,
      semanticName,
      fallbackSegment,
      semanticSuffix,
    ),
  };
}

function handlerSummaryOptions(
  source: ts.SourceFile,
  fileName: string,
  component: string,
  handlers: Map<string, ExtractableHandler>,
  resetSymbols: ReadonlySet<string>,
  handlerContext: HandlerExtractionContext,
): Parameters<typeof summarizeHandlerStatements>[2] {
  return {
    handlers,
    resetSymbols,
    component,
    timerContext: `${component}.handler`,
    timerIndex: handlerContext.timerIndex,
    timerBindings: new Map<string, string>(),
    timerRegistrations: handlerContext.timerRegistrations,
    transitionBindings: handlerContext.transitionBindings,
    envTransitions: handlerContext.envTransitions,
    fileName,
    source,
    types: handlerContext.types,
  };
}

function mergeLocals(
  base: Map<string, BoundExpr> | undefined,
  overrides: Map<string, BoundExpr> | undefined,
): Map<string, BoundExpr> | undefined {
  if (!base) return overrides;
  if (!overrides) return base;
  return new Map([...base, ...overrides]);
}

function isSequentialSingleSummary(summary: {
  effect: Transition["effect"];
}): boolean {
  if (summary.effect.kind === "assign") {
    return summary.effect.var.startsWith("sys:timer:");
  }
  if (summary.effect.kind === "seq") {
    return summary.effect.effects.some((effect) => effect.kind === "enqueue");
  }
  return false;
}

function applySuspenseGate(
  transitions: Transition[],
  activeBoundary: string | undefined,
): Transition[] {
  return transitions.map((transition) =>
    gateUserTransitionForBoundary(transition, activeBoundary),
  );
}
