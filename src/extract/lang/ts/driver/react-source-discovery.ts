import type {
  EffectIR,
  StateVarDecl,
  Transition,
  Value,
} from "modality-ts/core";
import * as ts from "typescript";
import type { SemanticTypeContext } from "../semantic-type-context.js";
import type {
  EffectPlugin,
  RouteFormSubmitCtx,
  RouteInventory,
  RoutePlugin,
  StateSourcePlugin,
  TypePlugin,
  WriteChannel,
} from "../../../engine/spi/index.js";
import { resolveImportedName } from "../../../engine/spi/index.js";
import {
  componentNameFor,
  currentEngineFramework,
  isExtractableHandler,
  isRecognizedUseStateCall,
  isUseReducerCall,
  isUseRefCall,
  lineAndColumn,
  recognizeHookFromTs,
  recognizeRenderBoundaryFromTs,
  unwrapHandlerInitializer,
} from "./ast.js";
import { globalTaintCaveat, unextractableEffectCaveat } from "./caveats.js";
import type { ComponentRegistry, CustomHookRegistry } from "./components.js";
import {
  calledCustomHook,
  inlineCustomHookState,
  isCustomHookDeclaration,
  isForwardablePropName,
  isIntrinsicJsxAttribute,
} from "./components.js";
import {
  bindContextHookObjectDeclaration,
  bindSetter,
  decodeSetterBinding,
  settersForComponent,
} from "./context.js";
import {
  domainInferenceWarnings,
  firstValue,
  inferUseStateDomainSemanticDetailed,
  initialValueForUseStateDetailed,
  useStateCallForSemanticInference,
} from "./domains.js";
import type { EnvironmentEventConfig } from "../../../compile/environment-config.js";
import {
  lowerSurfaceNodeFromTs,
  symbolRefFromIdentifier,
} from "./framework-bridge.js";
import { tagStableIdKey } from "./ids.js";
import {
  type JsxHandlerVisitContext,
  visitComponentPropJsxAttribute,
  visitEventJsxAttribute,
} from "./react-source-jsx-handlers.js";
import {
  resolveComponentRoutePattern,
  scopeForLocalState,
} from "./react-source-project.js";
import {
  deferredSyncTransition,
  extractUseDeferredValueBinding,
  extractUseTransitionBinding,
  type TransitionBinding,
} from "./transition/concurrent.js";
import {
  reactEffectWritesModeledState,
  transitionsFromUseEffect,
} from "./transition/effects.js";
import {
  environmentStateVarDecl,
  type WebSocketRegistration,
} from "./transition/environment-callbacks.js";
import { stateVarForName } from "./transition/expressions.js";
import { navigationJsxTransition } from "./transition/navigation.js";
import {
  boundaryIdForComponent,
  suspenseInitialForBoundary,
  suspenseStateVarDecl,
  transitionsFromSuspendingUse,
} from "./transition/suspense.js";
import { collectSetterTaintsFromEffectPlugins } from "./effect-ts-bridge.js";
import {
  type TimerRegistration,
  timerStateVarDecl,
} from "./transition/timers.js";
import { isEventAttribute } from "./transition/ui.js";
import type {
  ComponentDecl,
  ContextBindings,
  ExtractableHandler,
  ExtractionWarning,
  SetterBinding,
} from "./types.js";

export interface ReactSourceDiscoveryOptions {
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  types?: SemanticTypeContext;
  typePlugins?: readonly TypePlugin[];
  asyncOutcomes?: Record<string, { success: Value; error?: Value }>;
  effectPlugins?: readonly EffectPlugin[];
  environment?: EnvironmentEventConfig;
  setterFixedEffects?: ReadonlyMap<string, EffectIR>;
  resettableVarIds?: ReadonlySet<string>;
}

export interface ReactSourceDiscoveryContext {
  options: ReactSourceDiscoveryOptions;
  source: ts.SourceFile;
  fileName: string;
  route: string;
  routePatterns: readonly string[];
  typeAliases: Map<string, ts.TypeNode>;
  vars: StateVarDecl[];
  transitions: Transition[];
  warnings: ExtractionWarning[];
  effectApis: Set<string>;
  effectOpAliases: ReadonlyMap<string, ReadonlyMap<string, string>>;
  statePlugins: readonly StateSourcePlugin[];
  routePlugin: RoutePlugin | undefined;
  inventory: RouteInventory | undefined;
  setters: Map<string, SetterBinding>;
  contextBindings: ContextBindings;
  globalTaints: Set<string>;
  timerCounter: number;
  webSocketCounter: number;
  transitionBindingCounter: number;
  suspenseBoundaryCounter: number;
  transitionBindings: Map<string, TransitionBinding>;
  submitBindings: Map<string, boolean>;
  modeledSubmitHandlers: Set<string>;
  actionDataVarByComponent: Map<string, string>;
  components: ComponentRegistry;
  componentDisplayMap: Map<string, ComponentDecl>;
  customHooks: CustomHookRegistry;
  statefulListComponents: Set<string>;
  reportedStatefulListComponents: Set<string>;
  providerComponents: Set<string>;
  reportedCustomHooks: Set<string>;
  resetSymbols: ReadonlySet<string>;
  handlers: Map<string, ExtractableHandler>;
  renderBoundaries: Map<string, string>;
}

export interface ReactSourceDiscoveryCounters {
  timerCounter: number;
  webSocketCounter: number;
  transitionBindingCounter: number;
  suspenseBoundaryCounter: number;
}

export function discoverReactSourceTransitions(
  ctx: ReactSourceDiscoveryContext,
): ReactSourceDiscoveryCounters {
  const {
    options,
    source,
    fileName,
    route,
    routePatterns,
    typeAliases,
    vars,
    transitions,
    warnings,
    effectApis,
    effectOpAliases,
    statePlugins,
    routePlugin,
    inventory,
    setters,
    contextBindings,
    globalTaints,
    transitionBindings,
    submitBindings,
    modeledSubmitHandlers,
    actionDataVarByComponent,
    components,
    componentDisplayMap,
    customHooks,
    statefulListComponents,
    reportedStatefulListComponents,
    providerComponents,
    reportedCustomHooks,
    resetSymbols,
    handlers,
    renderBoundaries,
  } = ctx;
  let timerCounter = ctx.timerCounter;
  let webSocketCounter = ctx.webSocketCounter;
  let transitionBindingCounter = ctx.transitionBindingCounter;
  let suspenseBoundaryCounter = ctx.suspenseBoundaryCounter;
  const routerSubmitContext = (component: string): RouteFormSubmitCtx => ({
    sourceText: source.text,
    fileName,
    component,
    route:
      resolveComponentRoutePattern(routePlugin, inventory, component) ?? route,
    setters: settersForComponent(setters, component),
    actionDataVarId: actionDataVarByComponent.get(component),
    submitBindings,
    modeledSubmitHandlers,
    warnings,
  });
  const registerTimerVars = (
    registrations: readonly TimerRegistration[],
  ): void => {
    for (const registration of registrations) {
      if (!vars.some((decl) => decl.id === registration.varId)) {
        vars.push(timerStateVarDecl(registration.varId));
      }
    }
  };
  const registerWebSocketVars = (
    registrations: readonly WebSocketRegistration[],
  ): void => {
    for (const registration of registrations) {
      if (!vars.some((decl) => decl.id === registration.varId)) {
        vars.push(environmentStateVarDecl(registration.varId));
      }
    }
  };
  const finalizeHandlerTimerContext = (handlerContext: {
    timerRegistrations: TimerRegistration[];
    envTransitions: Transition[];
  }): Transition[] => {
    registerTimerVars(handlerContext.timerRegistrations);
    timerCounter += handlerContext.timerRegistrations.length;
    return handlerContext.envTransitions;
  };
  const visit = (
    node: ts.Node,
    componentName: string | undefined,
    activeBoundary: string | undefined,
  ): void => {
    if (!componentName && isCustomHookDeclaration(node)) return;
    const nextComponent = componentNameFor(node) ?? componentName;
    const effectiveBoundary =
      activeBoundary ??
      (nextComponent ? renderBoundaries.get(nextComponent) : undefined);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const handler = unwrapHandlerInitializer(node.initializer, {
        sourceFile: source,
        fileName,
        ...(options.types ? { types: options.types } : {}),
      });
      if (handler) handlers.set(node.name.text, handler);
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      isExtractableHandler(node)
    ) {
      handlers.set(node.name.text, node);
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isUseReducerCall(node.initializer)
    ) {
      warnings.push({
        message: `Unsupported useReducer ${nextComponent ?? "Anonymous"}.useReducer`,
        ...lineAndColumn(source, node),
      });
    }
    bindContextHookObjectDeclaration(
      node,
      contextBindings,
      setters,
      customHooks,
      options.types,
    );
    if (
      ts.isVariableDeclaration(node) &&
      nextComponent &&
      inlineCustomHookState(
        source,
        fileName,
        node,
        customHooks,
        vars,
        setters,
        nextComponent,
        route,
        typeAliases,
        warnings,
        scopeForLocalState(
          nextComponent,
          route,
          routePlugin,
          inventory,
          providerComponents.has(nextComponent),
        ),
        options.types,
        options.typePlugins,
      )
    ) {
      return;
    }
    const customHook = calledCustomHook(node, customHooks, options.types);
    if (customHook && nextComponent) {
      const key = `${nextComponent}.${customHook.displayName}`;
      if (
        !contextBindings.hookReturns.has(customHook.displayName) &&
        !reportedCustomHooks.has(key)
      ) {
        reportedCustomHooks.add(key);
        warnings.push({
          message: `Unextractable custom hook ${key}`,
          ...lineAndColumn(source, node),
        });
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      isRecognizedUseStateCall(node.initializer)
    ) {
      if (nextComponent && statefulListComponents.has(nextComponent)) {
        if (!reportedStatefulListComponents.has(nextComponent)) {
          reportedStatefulListComponents.add(nextComponent);
          warnings.push({
            message: `Unextractable stateful list item ${nextComponent}`,
            ...lineAndColumn(source, node),
          });
        }
        ts.forEachChild(node, (child) =>
          visit(child, nextComponent, effectiveBoundary),
        );
        return;
      }
      const stateName = node.name.elements[0];
      const setterName = node.name.elements[1];
      if (ts.isBindingElement(stateName) && ts.isIdentifier(stateName.name)) {
        const component = nextComponent ?? "Anonymous";
        const varId = `local:${component}.${stateName.name.text}`;
        const discovered = options.stateVars?.find(
          (candidate) => candidate.id === varId,
        );
        const anchor = lineAndColumn(source, node);
        const callForInference = useStateCallForSemanticInference(
          node.initializer,
          source,
          options.types,
          varId,
        );
        const inferred = inferUseStateDomainSemanticDetailed(
          callForInference,
          typeAliases,
          source,
          varId,
          options.types,
          options.typePlugins ?? [],
        );
        const domain = discovered?.domain ?? inferred.domain;
        warnings.push(...domainInferenceWarnings(inferred, anchor));
        const initialResult = initialValueForUseStateDetailed(
          callForInference,
          domain,
          source,
          varId,
        );
        warnings.push(...domainInferenceWarnings(initialResult, anchor));
        if (!options.stateVars) {
          vars.push({
            id: varId,
            domain,
            origin: { file: fileName, ...lineAndColumn(source, node) },
            scope: scopeForLocalState(
              component,
              route,
              routePlugin,
              inventory,
              providerComponents.has(component),
            ),
            initial: initialResult.value,
          });
        }
        if (
          setterName &&
          ts.isBindingElement(setterName) &&
          ts.isIdentifier(setterName.name)
        ) {
          if (!options.writeChannels) {
            const decl: StateVarDecl =
              discovered ??
              ({
                id: varId,
                domain,
                origin: { file: fileName, ...anchor },
                scope: scopeForLocalState(
                  component,
                  route,
                  routePlugin,
                  inventory,
                  providerComponents.has(component),
                ),
                initial: initialResult.value,
              } satisfies StateVarDecl);
            const binding = decodeSetterBinding(decl, statePlugins);
            if (options.types?.localSymbolKey?.(setterName.name)) {
              binding.symbolKey = options.types.localSymbolKey(setterName.name);
            }
            bindSetter(setters, setterName.name.text, binding);
          }
        }
      } else {
        warnings.push({
          message: "Unsupported useState binding pattern",
          ...lineAndColumn(source, node),
        });
      }
    }
    const activeComponent = nextComponent ?? "Anonymous";
    const engineFw = currentEngineFramework();
    const renderBoundary = recognizeRenderBoundaryFromTs(
      node,
      engineFw,
      fileName,
    );
    if (renderBoundary?.kind === "suspense") {
      const boundaryId = boundaryIdForComponent(
        nextComponent ?? "Anonymous",
        suspenseBoundaryCounter,
      );
      suspenseBoundaryCounter += 1;
      const suspenseBody = ts.isJsxElement(node)
        ? node
        : ts.isJsxSelfClosingElement(node)
          ? node
          : undefined;
      const initial = suspenseBody
        ? suspenseInitialForBoundary(suspenseBody)
        : "suspended";
      if (!vars.some((decl) => decl.id === `sys:suspense:${boundaryId}`)) {
        vars.push(
          suspenseStateVarDecl(boundaryId, initial, renderBoundary.domain),
        );
      }
      ts.forEachChild(node, (child) => visit(child, nextComponent, boundaryId));
      return;
    }
    const routePattern = resolveComponentRoutePattern(
      routePlugin,
      inventory,
      activeComponent,
    );
    const link = navigationJsxTransition(
      source,
      fileName,
      node,
      activeComponent,
      routePatterns,
      routePlugin,
      routePattern,
      inventory,
    );
    if (link) transitions.push(link);
    const scopedSetters = settersForComponent(setters, nextComponent);
    const formRecognition = routePlugin?.recognizeFormSubmit?.(
      lowerSurfaceNodeFromTs(node, fileName),
      routerSubmitContext(activeComponent),
    );
    if (formRecognition?.kind === "submit") {
      transitions.push(...tagStableIdKey(formRecognition.transitions, node));
    }
    const refTaint = detectRefSetterTaint(node, scopedSetters);
    const effectTaints = collectSetterTaintsFromEffectPlugins(
      options.effectPlugins ?? [],
      node,
      scopedSetters,
    );
    for (const taint of refTaint ? [refTaint, ...effectTaints] : effectTaints) {
      const anchor = lineAndColumn(source, taint.node);
      const caveat = globalTaintCaveat(taint.varId, {
        file: fileName,
        ...anchor,
      });
      if (!globalTaints.has(caveat.id)) {
        globalTaints.add(caveat.id);
        warnings.push({ message: caveat.reason, ...anchor, caveat });
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isForwardablePropName(node.name.text) &&
      !isIntrinsicJsxAttribute(node)
    ) {
      const jsxCtx: JsxHandlerVisitContext = {
        source,
        fileName,
        routePatterns,
        effectApis,
        asyncOutcomes: options.asyncOutcomes ?? {},
        statePlugins,
        routePlugin,
        contextBindings,
        resetSymbols,
        ...(options.types ? { types: options.types } : {}),
        effectOpAliases,
        ...(options.effectPlugins
          ? { effectPlugins: options.effectPlugins }
          : {}),
        vars,
        transitions,
        warnings,
        handlers,
        components,
        componentDisplayMap,
        setters,
        modeledSubmitHandlers,
        transitionBindings,
        timerCounter: { value: timerCounter },
        routerSubmitContext,
        finalizeHandlerTimerContext,
        registerTimerVars,
        visitChild: visit,
      };
      if (
        visitComponentPropJsxAttribute(
          jsxCtx,
          node,
          nextComponent,
          effectiveBoundary,
          scopedSetters,
        )
      ) {
        return;
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isEventAttribute(node.name.text) &&
      isIntrinsicJsxAttribute(node)
    ) {
      const jsxCtx: JsxHandlerVisitContext = {
        source,
        fileName,
        routePatterns,
        effectApis,
        asyncOutcomes: options.asyncOutcomes ?? {},
        statePlugins,
        routePlugin,
        contextBindings,
        resetSymbols,
        ...(options.types ? { types: options.types } : {}),
        effectOpAliases,
        ...(options.effectPlugins
          ? { effectPlugins: options.effectPlugins }
          : {}),
        vars,
        transitions,
        warnings,
        handlers,
        components,
        componentDisplayMap,
        setters,
        modeledSubmitHandlers,
        transitionBindings,
        timerCounter: { value: timerCounter },
        routerSubmitContext,
        finalizeHandlerTimerContext,
        registerTimerVars,
        visitChild: visit,
      };
      if (
        visitEventJsxAttribute(
          jsxCtx,
          node,
          nextComponent,
          effectiveBoundary,
          scopedSetters,
        )
      ) {
        return;
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      nextComponent &&
      ts.isIdentifier(node.name)
    ) {
      const deferredHook = recognizeHookFromTs(
        node.initializer,
        engineFw,
        fileName,
      );
      if (deferredHook?.hook.kind === "deferred") {
        const arg = node.initializer.arguments[0];
        const srcVarId =
          arg && ts.isIdentifier(arg)
            ? stateVarForName(arg.text, scopedSetters)
            : undefined;
        if (srcVarId) {
          const srcDecl = vars.find((decl) => decl.id === srcVarId);
          const srcDomain = srcDecl?.domain ?? { kind: "tokens", count: 1 };
          const deferred = extractUseDeferredValueBinding(
            node,
            nextComponent,
            srcVarId,
            srcDomain,
            srcDecl?.initial ?? firstValue(srcDomain),
            route,
            fileName,
            source,
            scopeForLocalState(
              nextComponent,
              route,
              routePlugin,
              inventory,
              providerComponents.has(nextComponent),
            ),
          );
          if (deferred && !vars.some((decl) => decl.id === deferred.id)) {
            vars.push(deferred);
            transitions.push(
              deferredSyncTransition(
                nextComponent,
                deferred.id,
                srcVarId,
                fileName,
                source,
                node,
              ),
            );
          }
        }
      }
    }
    if (ts.isVariableDeclaration(node) && nextComponent) {
      const hookRecognition = routePlugin?.recognizeFormSubmit?.(
        lowerSurfaceNodeFromTs(node, fileName),
        {
          ...routerSubmitContext(nextComponent),
          route:
            resolveComponentRoutePattern(
              routePlugin,
              inventory,
              nextComponent,
            ) ?? route,
        },
      );
      if (hookRecognition?.kind === "use-submit-binding") {
        submitBindings.set(hookRecognition.name, true);
      }
      if (hookRecognition?.kind === "action-data") {
        if (
          !vars.some((candidate) => candidate.id === hookRecognition.varDecl.id)
        )
          vars.push(hookRecognition.varDecl);
        actionDataVarByComponent.set(nextComponent, hookRecognition.varDecl.id);
        setters.set(hookRecognition.localName, hookRecognition.setterBinding);
      }
    }
    if (ts.isVariableDeclaration(node) && nextComponent) {
      const transitionBinding = extractUseTransitionBinding(
        node,
        nextComponent,
        transitionBindingCounter,
        route,
        fileName,
        source,
        scopeForLocalState(
          nextComponent,
          route,
          routePlugin,
          inventory,
          providerComponents.has(nextComponent),
        ),
      );
      if (transitionBinding) {
        transitionBindingCounter += 1;
        if (!vars.some((decl) => decl.id === transitionBinding.varDecl.id)) {
          vars.push(transitionBinding.varDecl);
        }
        transitionBindings.set(
          transitionBinding.binding.startTransitionName,
          transitionBinding.binding,
        );
      }
    }
    if (
      ts.isCallExpression(node) &&
      renderBoundary?.kind === "use" &&
      effectiveBoundary
    ) {
      transitions.push(
        ...transitionsFromSuspendingUse(
          source,
          fileName,
          node,
          activeComponent,
          effectiveBoundary,
        ),
      );
    }
    const effectHook =
      ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        ? recognizeHookFromTs(node, engineFw, fileName)
        : undefined;
    if (
      effectHook?.hook.kind === "effect" &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression)
    ) {
      const hookLabel = resolveImportedName(
        symbolRefFromIdentifier(node.expression, fileName),
        engineFw.ctx,
      );
      const effectPhase = effectHook.hook.phase;
      const timerRegistrations: TimerRegistration[] = [];
      const webSocketRegistrations: WebSocketRegistration[] = [];
      const envTransitions: Transition[] = [];
      const effectWarnings: ExtractionWarning[] = [];
      const extracted = transitionsFromUseEffect(
        source,
        fileName,
        node,
        scopedSetters,
        activeComponent,
        hookLabel,
        effectPhase,
        {
          timerRegistrations,
          webSocketRegistrations,
          envTransitions,
          warnings: effectWarnings,
          timerIndex: { value: timerCounter },
          webSocketIndex: { value: webSocketCounter },
          environment: options.environment,
          transitionBindings,
          types: options.types,
          effectPlugins: options.effectPlugins,
        },
      );
      registerTimerVars(timerRegistrations);
      registerWebSocketVars(webSocketRegistrations);
      timerCounter += timerRegistrations.length;
      webSocketCounter += webSocketRegistrations.length;
      warnings.push(...effectWarnings);
      transitions.push(...extracted, ...envTransitions);
      if (
        extracted.length === 0 &&
        reactEffectWritesModeledState(node, scopedSetters) &&
        !providerComponents.has(activeComponent)
      ) {
        const anchor = lineAndColumn(source, node);
        const id = `${activeComponent}.${hookLabel}`;
        warnings.push({
          message: `Unextractable effect ${id}`,
          ...anchor,
          caveat: unextractableEffectCaveat(activeComponent, hookLabel, {
            file: fileName,
            ...anchor,
          }),
        });
      }
    }
    ts.forEachChild(node, (child) =>
      visit(child, nextComponent, effectiveBoundary),
    );
  };
  visit(source, undefined, undefined);
  return {
    timerCounter,
    webSocketCounter,
    transitionBindingCounter,
    suspenseBoundaryCounter,
  };
}

function detectRefSetterTaint(
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
