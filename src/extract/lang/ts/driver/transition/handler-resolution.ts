import type { Locator, Transition, Value } from "modality-ts/core";
import * as ts from "typescript";
import { nodeRefFor } from "../../node-ref.js";
import type {
  RoutePlugin,
  RouteUseSubmitHandlerCtx,
  StateSourcePlugin,
} from "../../../../engine/spi/index.js";
import { isExtractableHandler, lineAndColumn } from "../ast.js";
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
  confidenceForEffects,
  statementHasAwaitedEffect,
  transitionsFromAsyncHandler,
  transitionsFromAsyncStatements,
} from "./async.js";
import { enumerateGuardedPaths } from "./branch-paths.js";
import {
  statementHasCallbackEffect,
  transitionsFromCallbackEffectHandler,
  transitionsFromCallbackEffectStatements,
} from "./callback-effects.js";
import {
  escapedSetters,
  effectWriteVars,
  havocSetterTransition,
  setterCallFrom,
  summarizeAsyncSegment,
} from "./effects.js";
import { setterArgumentExpr } from "./expressions.js";
import {
  applyParsedGuard,
  combineParsedGuards,
  type ParsedGuard,
} from "./guards.js";
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
import { flattenHandlerHelpers } from "./helper-inline.js";
import type { HandlerExtractionContext } from "./handlers.js";
import {
  callSummaryFromHandler,
  componentScopeLocalsFor,
  enclosingFunctionBody,
  inlinedHelperCall,
  variableDeclarations,
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
  const resolutionHandlers = new Map([
    ...handlers,
    ...componentLocalHandlersForNode(node),
  ]);
  const summaryOptions = handlerSummaryOptions(
    source,
    fileName,
    component,
    resolutionHandlers,
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
  const flattenableStatements = statementsForHelperFlattening(handler);
  if (flattenableStatements.length > 0) {
    const helperInlineOptions = {
      handlers: resolutionHandlers,
      setters,
    };
    const flatInitial = flattenHandlerHelpers(
      flattenableStatements,
      helperInlineOptions,
    );
    const flat =
      flatInitial.inlinedHelpers.length > 0
        ? flatInitial
        : (flattenConciseHelper(handler, helperInlineOptions) ?? flatInitial);
    if (flat.inlinedHelpers.length > 0) {
      const flatAsyncTransitions = transitionsFromAsyncStatements(
        source,
        fileName,
        attr,
        node,
        flat.statements,
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
      if (flatAsyncTransitions.length > 0)
        return applyParsedGuard(flatAsyncTransitions, disabledGuard);
      const flatCallbackTransitions = transitionsFromCallbackEffectStatements(
        source,
        fileName,
        attr,
        node,
        flat.statements,
        setters,
        component,
        effectApis,
        asyncOutcomes,
        locator,
        warnings,
        handlerContext.effectOpAliases ?? new Map(),
      );
      if (flatCallbackTransitions.length > 0)
        return applyParsedGuard(flatCallbackTransitions, disabledGuard);
      if (
        branchEnclosesModeledEffect(
          flat.statements,
          effectApis,
          setters,
          resolutionHandlers,
          fileName,
          handlerContext.effectOpAliases ?? new Map(),
        )
      ) {
        const flatBranchTransitions = transitionsFromBranchPaths(
          source,
          fileName,
          attr,
          node,
          flat.statements,
          setters,
          resolutionHandlers,
          component,
          effectApis,
          asyncOutcomes,
          locator,
          routePlugin,
          routePatterns,
          warnings,
          disabledGuard,
          contextBindings,
          handlerContext,
        );
        if (flatBranchTransitions.length > 0) return flatBranchTransitions;
        return [];
      }
      const flatSetterTransition = transitionFromFlattenedSetterStatements(
        source,
        fileName,
        node,
        attr,
        component,
        flat.statements,
        setters,
        locator,
        handlerContext.initialLocals,
        handlerContext.semanticName,
      );
      if (flatSetterTransition)
        return applyParsedGuard([flatSetterTransition], disabledGuard);
    }
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
  if (
    ts.isBlock(handler.body) &&
    branchEnclosesModeledEffect(
      handler.body.statements,
      effectApis,
      setters,
      resolutionHandlers,
      fileName,
      handlerContext.effectOpAliases ?? new Map(),
    )
  ) {
    const branchTransitions = transitionsFromBranchPaths(
      source,
      fileName,
      attr,
      node,
      handler.body.statements,
      setters,
      resolutionHandlers,
      component,
      effectApis,
      asyncOutcomes,
      locator,
      routePlugin,
      routePatterns,
      warnings,
      disabledGuard,
      contextBindings,
      handlerContext,
    );
    if (branchTransitions.length > 0) return branchTransitions;
  }
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
      asyncOutcomes,
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
          resolutionHandlers,
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
    resolutionHandlers,
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
    resolutionHandlers,
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

function componentLocalHandlersForNode(
  node: ts.Node,
): Map<string, ExtractableHandler> {
  const body = enclosingFunctionBody(node);
  if (!body) return new Map();
  const localHandlers = new Map<string, ExtractableHandler>();
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement)) break;
    for (const declaration of variableDeclarations(statement)) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        isExtractableHandler(declaration.initializer)
      ) {
        localHandlers.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return localHandlers;
}

function statementsForHelperFlattening(
  handler: ExtractableHandler,
): readonly ts.Statement[] {
  if (ts.isBlock(handler.body)) return handler.body.statements;
  return [ts.factory.createExpressionStatement(handler.body)];
}

function flattenConciseHelper(
  handler: ExtractableHandler,
  options: Parameters<typeof flattenHandlerHelpers>[1],
): ReturnType<typeof flattenHandlerHelpers> | undefined {
  if (ts.isBlock(handler.body)) return undefined;
  const call = helperInvocationCall(handler.body);
  if (!call || !ts.isIdentifier(call.expression)) return undefined;
  const helperName = call.expression.text;
  const helper = options.handlers.get(helperName);
  if (!helper || !ts.isBlock(helper.body) || options.setters.has(helperName)) {
    return undefined;
  }
  const nested = flattenHandlerHelpers(
    [ts.factory.createExpressionStatement(call)],
    options,
  );
  return nested.inlinedHelpers.length > 0 ? nested : undefined;
}

function helperInvocationCall(
  expression: ts.Expression,
): ts.CallExpression | undefined {
  if (ts.isCallExpression(expression)) return expression;
  if (
    ts.isAwaitExpression(expression) &&
    ts.isCallExpression(expression.expression)
  )
    return expression.expression;
  if (
    ts.isVoidExpression(expression) &&
    ts.isCallExpression(expression.expression)
  )
    return expression.expression;
  return undefined;
}

function transitionFromFlattenedSetterStatements(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  locator: Locator | undefined,
  initialLocals: Map<string, BoundExpr> | undefined,
  semanticName: string | undefined,
): Transition | undefined {
  const summaries = summarizeAsyncSegment(
    statements,
    setters,
    undefined,
    initialLocals,
  );
  const effects = summaries
    .map((summary) => summary.effect)
    .filter(
      (effect) => !(effect.kind === "seq" && effect.effects.length === 0),
    );
  if (effects.length === 0) return undefined;
  const singleEffect = effects.length === 1 ? effects[0] : undefined;
  const singleWrite =
    singleEffect?.kind === "assign"
      ? stateNameFromVarId(singleEffect.var)
      : undefined;
  return {
    id: transitionIdFromSemanticName(
      component,
      attr,
      singleWrite ? undefined : semanticName,
      singleWrite ? `${singleWrite}.seq` : "seq",
      singleWrite ? "" : ".seq",
    ),
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: singleEffect ?? { kind: "seq", effects },
    reads: [...new Set(summaries.flatMap((summary) => summary.reads))],
    writes: [...new Set(effects.flatMap(effectWriteVars))],
    confidence: confidenceForEffects(effects),
  };
}

function stateNameFromVarId(varId: string): string {
  return varId.split(/[.:]/u).at(-1) ?? varId;
}

function transitionsFromBranchPaths(
  source: ts.SourceFile,
  fileName: string,
  attr: string,
  node: ts.JsxAttribute,
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  locator: Locator | undefined,
  routePlugin: RoutePlugin | undefined,
  routePatterns: readonly string[],
  warnings: ExtractionWarning[],
  disabledGuard: ParsedGuard | undefined,
  contextBindings: ContextBindings,
  handlerContext: HandlerExtractionContext,
): Transition[] {
  const enumerated = enumerateGuardedPaths(statements, {
    setters,
    initialLocals: mergeLocals(
      componentScopeLocalsFor(node, setters, contextBindings),
      handlerContext.initialLocals,
    ),
  });
  if (enumerated.truncated) {
    const anchor = lineAndColumn(source, node);
    warnings.push({
      message: `Unextractable handler ${component}.${attr} [branch-paths-truncated] (${fileName}:${anchor.line}:${anchor.column})`,
      ...anchor,
      caveat: unextractableHandlerCaveat(
        `${component}.${attr}`,
        "branch-paths-truncated",
        { file: fileName, ...anchor },
      ),
    });
  }

  const transitions = enumerated.paths.flatMap((path, index) => {
    const flat = flattenHandlerHelpers(path.statements, { handlers, setters });
    const asyncTransitions = transitionsFromAsyncStatements(
      source,
      fileName,
      attr,
      node,
      flat.statements,
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
    const callbackTransitions =
      asyncTransitions.length > 0
        ? []
        : transitionsFromCallbackEffectStatements(
            source,
            fileName,
            attr,
            node,
            flat.statements,
            setters,
            component,
            effectApis,
            asyncOutcomes,
            locator,
            warnings,
            handlerContext.effectOpAliases ?? new Map(),
          );
    const pathTransitions =
      asyncTransitions.length > 0
        ? asyncTransitions
        : callbackTransitions.length > 0
          ? callbackTransitions
          : transitionArray(
              transitionFromFlattenedSetterStatements(
                source,
                fileName,
                node,
                attr,
                component,
                flat.statements,
                setters,
                locator,
                handlerContext.initialLocals,
                handlerContext.semanticName,
              ),
            );
    return applyParsedGuard(
      pathTransitions.map((transition) =>
        transition.cls === "user"
          ? { ...transition, id: `${transition.id}#path${index}` }
          : transition,
      ),
      combineParsedGuards([disabledGuard, path.guard]),
    );
  });

  return dedupeTransitions(transitions);
}

function dedupeTransitions(transitions: readonly Transition[]): Transition[] {
  const seen = new Set<string>();
  const deduped: Transition[] = [];
  for (const transition of transitions) {
    if (seen.has(transition.id)) continue;
    seen.add(transition.id);
    deduped.push(transition);
  }
  return deduped;
}

function transitionArray(
  transition: Transition | undefined,
): readonly Transition[] {
  return transition ? [transition] : [];
}

function branchEnclosesModeledEffect(
  statements: readonly ts.Statement[],
  effectApis: Set<string>,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  fileName: string,
  effectOpAliases: Parameters<typeof statementHasAwaitedEffect>[3],
): boolean {
  for (const statement of statements) {
    if (
      ts.isIfStatement(statement) &&
      ifStatementHasModeledArmEffect(
        statement,
        effectApis,
        setters,
        handlers,
        fileName,
        effectOpAliases,
      )
    )
      return true;
  }
  return false;
}

function ifStatementHasModeledArmEffect(
  statement: ts.IfStatement,
  effectApis: Set<string>,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  fileName: string,
  effectOpAliases: Parameters<typeof statementHasAwaitedEffect>[3],
): boolean {
  for (const arm of ifStatementArms(statement)) {
    const flat = flattenHandlerHelpers(arm, { handlers, setters });
    if (
      flat.statements.some(
        (candidate) =>
          statementHasAwaitedEffect(
            candidate,
            effectApis,
            fileName,
            effectOpAliases,
          ) ||
          statementHasCallbackEffect(
            candidate,
            effectApis,
            fileName,
            effectOpAliases,
          ),
      )
    )
      return true;
    if (
      flat.statements.some(
        (candidate) =>
          ts.isIfStatement(candidate) &&
          ifStatementHasModeledArmEffect(
            candidate,
            effectApis,
            setters,
            handlers,
            fileName,
            effectOpAliases,
          ),
      )
    )
      return true;
  }
  return false;
}

function ifStatementArms(statement: ts.IfStatement): readonly ts.Statement[][] {
  const arms: ts.Statement[][] = [
    statementsForBranchArm(statement.thenStatement),
  ];
  let elseStatement = statement.elseStatement;
  while (elseStatement) {
    if (ts.isIfStatement(elseStatement)) {
      arms.push(statementsForBranchArm(elseStatement.thenStatement));
      elseStatement = elseStatement.elseStatement;
      continue;
    }
    arms.push(statementsForBranchArm(elseStatement));
    break;
  }
  return arms;
}

function statementsForBranchArm(statement: ts.Statement): ts.Statement[] {
  return ts.isBlock(statement) ? Array.from(statement.statements) : [statement];
}
