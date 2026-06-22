import type { Locator, Transition, Value } from "modality-ts/core";
import * as ts from "typescript";
import { nodeRefFor } from "../../../lang/ts/node-ref.js";
import type {
  RoutePlugin,
  RouteUseSubmitHandlerCtx,
  StateSourcePlugin,
} from "../../spi/index.js";
import { lineAndColumn } from "../ast.js";
import { unextractableHandlerCaveat } from "../caveats.js";
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
  statementHasCallbackEffect,
  transitionsFromCallbackEffectHandler,
} from "./callback-effects.js";
import {
  escapedSetters,
  havocSetterTransition,
  setterCallFrom,
} from "./effects.js";
import { setterArgumentExpr } from "./expressions.js";
import { applyParsedGuard, type ParsedGuard } from "./guards.js";
import {
  booleanCallbackParameterBindings,
  booleanCallbackValueSuffix,
} from "./handler-jsx-attrs.js";
import {
  conditionalTransitionFromHandler,
  escapedSetterTransitions,
  loopWriteTransitions,
  semanticizeTransition,
  sequentialTransitionFromHandler,
  singleSetterTransitionFromHandler,
} from "./handler-sequential.js";
import type { HandlerExtractionContext } from "./handlers.js";
import {
  callSummaryFromHandler,
  componentScopeLocalsFor,
  inlinedHelperCall,
} from "./locals.js";
import { navigationTransition } from "./navigation.js";
import {
  noopCallTransition,
  pluginWriteTransition,
  swrMutateTransition,
} from "./plugin-calls.js";
import { transitionIdFromSemanticName } from "./semantic-ids.js";
import type { summarizeHandlerStatements } from "./statement-driver.js";
import { isInputValueExpression, labelForEvent } from "./ui.js";

export function mergeLocals(
  base: Map<string, BoundExpr> | undefined,
  overrides: Map<string, BoundExpr> | undefined,
): Map<string, BoundExpr> | undefined {
  if (!base) return overrides;
  if (!overrides) return base;
  return new Map([...base, ...overrides]);
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
  statePlugins: readonly StateSourcePlugin[],
  routePlugin: RoutePlugin | undefined,
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
  if (routerCtx && routerCtx.submitBindings.size > 0 && routePlugin) {
    const recognized = routePlugin.recognizeUseSubmitHandler?.(
      nodeRefFor(node, fileName),
      { origin: nodeRefFor(handler, fileName) },
      {
        ...routerCtx,
        attr,
        effectApis,
        disabledGuard:
          disabledGuard as RouteUseSubmitHandlerCtx["disabledGuard"],
      },
    );
    if (recognized && recognized.transitions.length > 0)
      return recognized.transitions;
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
    routePlugin,
    routePatterns,
    warnings,
    handlerContext.effectOpAliases ?? new Map(),
  );
  if (asyncTransitions.length > 0)
    return applyParsedGuard(asyncTransitions, disabledGuard);
  // Callback-style (non-awaited) effect API calls, e.g. mutate(args, {onError})
  if (
    ts.isBlock(handler.body) &&
    handler.body.statements.some((stmt) =>
      statementHasCallbackEffect(
        stmt,
        effectApis,
        fileName,
        handlerContext.effectOpAliases ?? new Map(),
      ),
    )
  ) {
    const cbTransitions = transitionsFromCallbackEffectHandler(
      source,
      fileName,
      attr,
      handler,
      setters,
      component,
      effectApis,
      locator,
      warnings,
      handlerContext.effectOpAliases ?? new Map(),
    );
    if (cbTransitions.length > 0)
      return applyParsedGuard(cbTransitions, disabledGuard);
  }
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
    routePlugin,
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
    statePlugins,
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
    effectPlugins: handlerContext.effectPlugins,
  };
}
