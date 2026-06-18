import type {
  EffectOpAliases,
} from "./effect-op-aliases.js";
import * as ts from "typescript";
import {
  componentNameFor,
  extractableHandlerInitializer,
  isExtractableHandler,
  isUseDeferredValueCall,
  isUseReducerCall,
  isUseStateCall,
  isUseCall,
  isSuspenseElement,
  lineAndColumn,
  providerComponentNames,
  reactEffectHookName,
} from "./ast.js";
import {
  globalTaintCaveat,
  unextractableEffectCaveat,
  unextractableHandlerCaveat,
} from "./caveats.js";

function unextractableHandlerAlreadyReported(
  warnings: readonly ExtractionWarning[],
  handlerId: string,
): boolean {
  return warnings.some(
    (warning) =>
      warning.caveat?.kind === "unextractable" &&
      warning.caveat.id === handlerId,
  );
}
import {
  componentDeclarations,
  calledCustomHook,
  customHookDeclarations,
  detectStatefulListComponents,
  inlineCustomHookState,
  isCustomHookDeclaration,
  isForwardablePropName,
  isIntrinsicJsxAttribute,
  literalListRenderedHandlerInfo,
  listRenderedHandlerInfo,
} from "./components.js";
import {
  bindContextHookObjectDeclaration,
  bindSetter,
  discoverContextBindings,
  setterBindingFromDecl,
  settersForComponent,
} from "./context.js";
import { safeId, tagStableIdKey, withStableTransitionIds } from "./ids.js";
import { staticNavigationTransitions } from "./static-navigation.js";
import {
  firstValue,
  domainInferenceWarnings,
  inferUseStateDomainSemanticDetailed,
  initialValueForUseStateDetailed,
  typeAliasDeclarations,
  useStateCallForSemanticInference,
} from "./domains.js";
import type {
  StateVarDecl,
  Transition,
  Value,
  EffectIR,
} from "modality-ts/core";
import type {
  ContextBindings,
  ExtractableHandler,
  ExtractionWarning,
  SetterBinding,
} from "./types.js";
import type {
  NavigationAdapter,
  RouteInventory,
  RouterPlugin,
  StateSourcePlugin,
  WriteChannel,
  SemanticTypeContext,
  DomainRefinementProvider,
} from "../spi/index.js";
import { resolve } from "node:path";
import {
  timerSetterTaints,
  refSetterTaint,
  handlerSchedulesModeledTimer,
  timerStateVarDecl,
  type TimerRegistration,
} from "./transition/timers.js";
import {
  environmentStateVarDecl,
  type WebSocketRegistration,
} from "./transition/environment-callbacks.js";
import {
  deferredSyncTransition,
  extractUseDeferredValueBinding,
  extractUseTransitionBinding,
  type TransitionBinding,
} from "./transition/concurrent.js";
import {
  boundaryIdForComponent,
  discoverComponentRenderBoundaries,
  suspenseStateVarDecl,
  suspenseInitialForBoundary,
  transitionsFromSuspendingUse,
} from "./transition/suspense.js";
import {
  transitionsFromJsxAttribute,
  transitionsFromComponentPropAttribute,
  transitionsFromBoundedListAttribute,
  transitionsFromBoundedListComponentPropAttribute,
  transitionsFromLiteralListAttribute,
} from "./transition/handlers.js";
import {
  combineParsedGuards,
  disabledGuardFor,
  renderGuardFor,
} from "./transition/guards.js";
import { componentGuardLocalsFor } from "./transition/locals.js";
import { stateVarForName } from "./transition/expressions.js";
import {
  forwardsComponentProp,
  componentPropDeferredToChildTrigger,
} from "./transition/component-props.js";
import { isEventAttribute } from "./transition/ui.js";
import { navigationJsxTransition } from "./transition/navigation.js";
import {
  transitionsFromUseEffect,
  reactEffectWritesModeledState,
} from "./transition/effects.js";
import {
  bindReactRouterActionDataRead,
  discoverUseSubmitBindings,
  isReactRouterFormElement,
  isUseActionDataCall,
  reactRouterActionDataVarDecl,
  transitionsFromReactRouterForm,
  type ReactRouterSubmitContext,
} from "./transition/router-submit.js";

export interface ReactSourceTransitionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  routePatterns?: readonly string[];
  asyncOutcomes?: Record<string, { success: Value; error?: Value }>;
  effectOpAliases?: EffectOpAliases;
  environment?: import("./environment-config.js").EnvironmentEventConfig;
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  sourcePlugins?: readonly StateSourcePlugin[];
  routerPlugin?: RouterPlugin;
  inventory?: RouteInventory;
  resetSymbols?: ReadonlySet<string>;
  setterFixedEffects?: ReadonlyMap<string, EffectIR>;
  resettableVarIds?: ReadonlySet<string>;
  relatedFragments?: readonly { sourceText: string; fileName: string }[];
  additionalTypeAliases?: ReadonlyMap<string, ts.TypeNode>;
  additionalComponentSources?: readonly string[];
  types?: SemanticTypeContext;
  domainRefinements?: readonly DomainRefinementProvider[];
}

export interface ReactSourceTransitionResult {
  vars: StateVarDecl[];
  transitions: Transition[];
  warnings: ExtractionWarning[];
}

export function extractReactSourceTransitions(
  sourceText: string,
  options: ReactSourceTransitionOptions = {},
): ReactSourceTransitionResult {
  const fileName = options.fileName ?? "App.tsx";
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const typeAliases = collectProjectTypeAliases(source, options);
  const vars: StateVarDecl[] = options.stateVars ? [...options.stateVars] : [];
  const transitions: Transition[] = [];
  const warnings: ExtractionWarning[] = [];
  const route = options.route ?? "/";
  const routePatterns = options.routePatterns ?? [];
  const effectOpAliases = options.effectOpAliases ?? new Map();
  const effectApis = new Set(options.effectApis ?? []);
  const sourcePlugins = options.sourcePlugins ?? [];
  const routerPlugin = options.routerPlugin;
  const inventory = options.inventory;
  const setters = new Map<string, SetterBinding>();
  const contextBindings = discoverContextBindings(
    source,
    fileName,
    route,
    typeAliases,
  );
  for (const fragment of options.additionalComponentSources ?? []) {
    const supplemental = ts.createSourceFile(
      fileName,
      fragment,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    mergeContextBindings(
      contextBindings,
      discoverContextBindings(supplemental, fileName, route, typeAliases),
    );
  }
  const globalTaints = new Set<string>();
  let timerCounter = 0;
  let webSocketCounter = 0;
  let transitionBindingCounter = 0;
  let suspenseBoundaryCounter = 0;
  const transitionBindings = new Map<string, TransitionBinding>();
  const submitBindings = new Map<string, boolean>();
  const modeledSubmitHandlers = new Set<string>();
  const actionDataVarByComponent = new Map<string, string>();
  const routerSubmitContext = (
    component: string,
  ): ReactRouterSubmitContext => ({
    route:
      resolveComponentRoutePattern(routerPlugin, inventory, component) ?? route,
    component,
    actionDataVarId: actionDataVarByComponent.get(component),
    submitBindings,
    modeledSubmitHandlers,
  });
  const components = componentDeclarations(source);
  for (const fragment of options.additionalComponentSources ?? []) {
    const supplemental = ts.createSourceFile(
      fileName,
      fragment,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    for (const [name, decl] of componentDeclarations(supplemental)) {
      if (!components.has(name)) components.set(name, decl);
    }
  }
  const providerComponents = providerComponentNames(source);
  const customHooks = customHookDeclarations(source);
  for (const fragment of options.additionalComponentSources ?? []) {
    const supplemental = ts.createSourceFile(
      fileName,
      fragment,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    for (const [name, decl] of customHookDeclarations(supplemental)) {
      if (!customHooks.has(name)) customHooks.set(name, decl);
    }
  }
  const statefulListComponents = detectStatefulListComponents(
    source,
    components,
  );
  const reportedStatefulListComponents = new Set<string>();
  const reportedCustomHooks = new Set<string>();
  for (const decl of contextBindings.vars) {
    if (!vars.some((candidate) => candidate.id === decl.id)) vars.push(decl);
  }
  const resetSymbols = options.resetSymbols ?? new Set<string>(["RESET"]);
  for (const channel of options.writeChannels ?? []) {
    const decl = vars.find((candidate) => candidate.id === channel.varId);
    if (!decl) continue;
    const binding = setterBindingFromDecl(decl);
    if (
      channel.id.endsWith(".reset") ||
      options.resettableVarIds?.has(channel.varId)
    ) {
      binding.resettable = true;
    }
    const fixedEffect = options.setterFixedEffects?.get(channel.symbolName);
    if (fixedEffect) binding.fixedEffect = fixedEffect;
    bindSetter(setters, channel.symbolName, binding);
  }
  for (const [symbolName, setter] of contextBindings.setters)
    setters.set(symbolName, setter);
  const handlers = new Map<string, ExtractableHandler>();
  const renderBoundaries = discoverComponentRenderBoundaries(
    source,
    components,
  );
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
      const handler = extractableHandlerInitializer(node.initializer);
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
    bindContextHookObjectDeclaration(node, contextBindings, setters);
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
          routerPlugin,
          inventory,
          providerComponents.has(nextComponent),
        ),
        options.types,
        options.domainRefinements,
      )
    ) {
      return;
    }
    const customHook = calledCustomHook(node, new Set(customHooks.keys()));
    if (customHook && nextComponent) {
      const key = `${nextComponent}.${customHook}`;
      if (
        !contextBindings.hookReturns.has(customHook) &&
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
      isUseStateCall(node.initializer)
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
          options.domainRefinements ?? [],
        );
        const domain = inferred.domain;
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
              routerPlugin,
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
          if (!options.writeChannels)
            bindSetter(setters, setterName.name.text, {
              varId,
              component,
              stateName: stateName.name.text,
              domain,
            });
        }
      } else {
        warnings.push({
          message: "Unsupported useState binding pattern",
          ...lineAndColumn(source, node),
        });
      }
    }
    const activeComponent = nextComponent ?? "Anonymous";
    if (isSuspenseElement(node)) {
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
        vars.push(suspenseStateVarDecl(boundaryId, initial));
      }
      ts.forEachChild(node, (child) => visit(child, nextComponent, boundaryId));
      return;
    }
    const routePattern = resolveComponentRoutePattern(
      routerPlugin,
      inventory,
      activeComponent,
    );
    const link = navigationJsxTransition(
      source,
      fileName,
      node,
      activeComponent,
      routePatterns,
      routerPlugin,
      routePattern,
      inventory,
    );
    if (link) transitions.push(link);
    const scopedSetters = settersForComponent(setters, nextComponent);
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      isReactRouterFormElement(node, source)
    ) {
      const formRoute = routePattern ?? route;
      const extracted = transitionsFromReactRouterForm(
        source,
        fileName,
        node,
        activeComponent,
        formRoute,
        scopedSetters,
        warnings,
        routerSubmitContext(activeComponent),
      );
      if (extracted.length > 0)
        transitions.push(...tagStableIdKey(extracted, node));
    }
    const refTaint = refSetterTaint(node, scopedSetters);
    if (refTaint) {
      const anchor = lineAndColumn(source, refTaint.node);
      const caveat = globalTaintCaveat(refTaint.varId, {
        file: fileName,
        ...anchor,
      });
      if (!globalTaints.has(caveat.id)) {
        globalTaints.add(caveat.id);
        warnings.push({ message: caveat.reason, ...anchor, caveat });
      }
    }
    for (const timerTaint of timerSetterTaints(node, scopedSetters)) {
      const anchor = lineAndColumn(source, timerTaint.node);
      const caveat = globalTaintCaveat(timerTaint.varId, {
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
      const componentPropHandlerContext = {
        activeBoundary: effectiveBoundary,
        transitionBindings,
        timerRegistrations: [] as TimerRegistration[],
        envTransitions: [] as Transition[],
        timerIndex: { value: timerCounter },
        routerSubmitContext: routerSubmitContext(nextComponent ?? "Anonymous"),
        effectOpAliases,
      };
      const literalListInfo = literalListRenderedHandlerInfo(node);
      if (literalListInfo) {
        const extracted = literalListInfo.values.flatMap((value) =>
          transitionsFromComponentPropAttribute(
            source,
            fileName,
            node,
            scopedSetters,
            handlers,
            components,
            nextComponent ?? "Anonymous",
            effectApis,
            options.asyncOutcomes ?? {},
            sourcePlugins,
            routerPlugin,
            warnings,
            routePatterns,
            contextBindings,
            resetSymbols,
            {
              ...componentPropHandlerContext,
              initialLocals: new Map([
                [
                  literalListInfo.itemName,
                  { expr: { kind: "lit", value }, reads: [] },
                ],
              ]),
              valueSuffix: safeId(String(value)),
            },
          ),
        );
        if (extracted.length > 0) {
          transitions.push(
            ...tagStableIdKey(extracted, node),
            ...finalizeHandlerTimerContext(componentPropHandlerContext),
          );
          ts.forEachChild(node, (child) =>
            visit(child, nextComponent, effectiveBoundary),
          );
          return;
        }
      }
      const listInfo = listRenderedHandlerInfo(
        node,
        vars,
        nextComponent ?? "Anonymous",
      );
      if (listInfo) {
        if (listInfo.domain.kind === "boundedList") {
          const extracted = transitionsFromBoundedListComponentPropAttribute(
            source,
            fileName,
            node,
            scopedSetters,
            handlers,
            components,
            nextComponent ?? "Anonymous",
            {
              varId: listInfo.varId,
              domain: listInfo.domain,
              itemName: listInfo.itemName,
            },
            effectApis,
            options.asyncOutcomes ?? {},
            sourcePlugins,
            routerPlugin,
            warnings,
            routePatterns,
            contextBindings,
            resetSymbols,
            componentPropHandlerContext,
          );
          if (extracted.length > 0) {
            transitions.push(
              ...tagStableIdKey(extracted, node),
              ...finalizeHandlerTimerContext(componentPropHandlerContext),
            );
            ts.forEachChild(node, (child) =>
              visit(child, nextComponent, effectiveBoundary),
            );
            return;
          }
        }
        warnings.push({
          message: `Unextractable list-rendered component prop handler ${nextComponent ?? "Anonymous"}.${node.name.text} over ${listInfo.domain.kind} ${listInfo.varId}`,
          ...lineAndColumn(source, node),
        });
        ts.forEachChild(node, (child) =>
          visit(child, nextComponent, effectiveBoundary),
        );
        return;
      }
      const extracted = transitionsFromComponentPropAttribute(
        source,
        fileName,
        node,
        scopedSetters,
        handlers,
        components,
        nextComponent ?? "Anonymous",
        effectApis,
        options.asyncOutcomes ?? {},
        sourcePlugins,
        routerPlugin,
        warnings,
        routePatterns,
        contextBindings,
        resetSymbols,
        componentPropHandlerContext,
      );
      transitions.push(
        ...extracted,
        ...finalizeHandlerTimerContext(componentPropHandlerContext),
      );
      const handlerId = `${nextComponent ?? "Anonymous"}.${node.name.text}`;
      if (
        extracted.length === 0 &&
        !componentPropDeferredToChildTrigger(
          source,
          node,
          components,
          scopedSetters,
          warnings,
        ) &&
        !unextractableHandlerAlreadyReported(warnings, handlerId)
      ) {
        const anchor = lineAndColumn(source, node);
        warnings.push({
          message: `Unextractable handler ${handlerId} [no-extractable-effect] (${fileName}:${anchor.line}:${anchor.column})`,
          ...anchor,
          caveat: unextractableHandlerCaveat(
            handlerId,
            "no-extractable-effect",
            { file: fileName, ...anchor },
          ),
        });
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isEventAttribute(node.name.text) &&
      isIntrinsicJsxAttribute(node)
    ) {
      const literalListInfo = literalListRenderedHandlerInfo(node);
      if (literalListInfo) {
        const guardLocals = componentGuardLocalsFor(node, scopedSetters);
        const guard = combineParsedGuards([
          renderGuardFor(
            node,
            scopedSetters,
            warnings,
            source,
            nextComponent ?? "Anonymous",
            guardLocals,
          ),
          disabledGuardFor(
            node,
            scopedSetters,
            warnings,
            source,
            nextComponent ?? "Anonymous",
            guardLocals,
          ),
        ]);
        const timerRegistrations: TimerRegistration[] = [];
        const envTransitions: Transition[] = [];
        const extracted = transitionsFromLiteralListAttribute(
          source,
          fileName,
          node,
          scopedSetters,
          handlers,
          nextComponent ?? "Anonymous",
          literalListInfo,
          effectApis,
          options.asyncOutcomes ?? {},
          sourcePlugins,
          routerPlugin,
          guard,
          routePatterns,
          contextBindings,
          warnings,
          resetSymbols,
          {
            activeBoundary: effectiveBoundary,
            transitionBindings,
            timerRegistrations,
            envTransitions,
            timerIndex: { value: timerCounter },
          },
        );
        registerTimerVars(timerRegistrations);
        timerCounter += timerRegistrations.length;
        if (extracted.length > 0) {
          transitions.push(
            ...tagStableIdKey(extracted, node),
            ...envTransitions,
          );
          ts.forEachChild(node, (child) =>
            visit(child, nextComponent, effectiveBoundary),
          );
          return;
        }
      }
      const listInfo = listRenderedHandlerInfo(
        node,
        vars,
        nextComponent ?? "Anonymous",
      );
      if (listInfo) {
        if (listInfo.domain.kind === "boundedList") {
          const extracted = transitionsFromBoundedListAttribute(
            source,
            fileName,
            node,
            scopedSetters,
            handlers,
            nextComponent ?? "Anonymous",
            {
              varId: listInfo.varId,
              domain: listInfo.domain,
              itemName: listInfo.itemName,
            },
          );
          if (extracted.length > 0) {
            transitions.push(...tagStableIdKey(extracted, node));
            ts.forEachChild(node, (child) =>
              visit(child, nextComponent, effectiveBoundary),
            );
            return;
          }
        }
        warnings.push({
          message: `Unextractable list-rendered handler ${nextComponent ?? "Anonymous"}.${node.name.text} over ${listInfo.domain.kind} ${listInfo.varId}`,
          ...lineAndColumn(source, node),
        });
        ts.forEachChild(node, (child) =>
          visit(child, nextComponent, effectiveBoundary),
        );
        return;
      }
      const guardLocals = componentGuardLocalsFor(node, scopedSetters);
      const guard = combineParsedGuards([
        renderGuardFor(
          node,
          scopedSetters,
          warnings,
          source,
          nextComponent ?? "Anonymous",
          guardLocals,
        ),
        disabledGuardFor(
          node,
          scopedSetters,
          warnings,
          source,
          nextComponent ?? "Anonymous",
          guardLocals,
        ),
      ]);
      const timerRegistrations: TimerRegistration[] = [];
      const envTransitions: Transition[] = [];
      const extracted = transitionsFromJsxAttribute(
        source,
        fileName,
        node,
        scopedSetters,
        handlers,
        nextComponent ?? "Anonymous",
        effectApis,
        options.asyncOutcomes ?? {},
        sourcePlugins,
        routerPlugin,
        guard,
        routePatterns,
        contextBindings,
        warnings,
        resetSymbols,
        {
          activeBoundary: effectiveBoundary,
          transitionBindings,
          timerRegistrations,
          envTransitions,
          timerIndex: { value: timerCounter },
          routerSubmitContext: routerSubmitContext(
            nextComponent ?? "Anonymous",
          ),
          effectOpAliases,
        },
      );
      registerTimerVars(timerRegistrations);
      timerCounter += timerRegistrations.length;
      transitions.push(...extracted);
      const handlerId = `${nextComponent ?? "Anonymous"}.${node.name.text}`;
      if (
        extracted.length === 0 &&
        !forwardsComponentProp(
          node,
          handlers,
          components.get(nextComponent ?? ""),
          components,
          scopedSetters,
          source,
          warnings,
        ) &&
        !handlerSchedulesModeledTimer(node, handlers, scopedSetters) &&
        !modeledSubmitHandlers.has(handlerId) &&
        !unextractableHandlerAlreadyReported(warnings, handlerId)
      ) {
        const anchor = lineAndColumn(source, node);
        warnings.push({
          message: `Unextractable handler ${handlerId} [no-extractable-effect] (${fileName}:${anchor.line}:${anchor.column})`,
          ...anchor,
          caveat: unextractableHandlerCaveat(
            handlerId,
            "no-extractable-effect",
            { file: fileName, ...anchor },
          ),
        });
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isUseDeferredValueCall(node.initializer) &&
      nextComponent &&
      ts.isIdentifier(node.name)
    ) {
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
            routerPlugin,
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
    if (ts.isVariableDeclaration(node) && nextComponent) {
      const submitName = discoverUseSubmitBindings(node);
      if (submitName) submitBindings.set(submitName, true);
      if (
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        isUseActionDataCall(node.initializer) &&
        ts.isIdentifier(node.name)
      ) {
        const component = nextComponent;
        const formRoute = resolveComponentRoutePattern(
          routerPlugin,
          inventory,
          component,
        );
        const actionRoute = formRoute ?? route;
        const decl = reactRouterActionDataVarDecl(component, actionRoute, {
          file: fileName,
          ...lineAndColumn(source, node),
        });
        if (!vars.some((candidate) => candidate.id === decl.id))
          vars.push(decl);
        actionDataVarByComponent.set(component, decl.id);
        bindReactRouterActionDataRead(
          setters,
          node.name.text,
          decl.id,
          component,
        );
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
          routerPlugin,
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
    if (ts.isCallExpression(node) && isUseCall(node) && effectiveBoundary) {
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
    const effectHook = ts.isCallExpression(node)
      ? reactEffectHookName(node)
      : undefined;
    if (effectHook && ts.isCallExpression(node)) {
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
        effectHook,
        {
          timerRegistrations,
          webSocketRegistrations,
          envTransitions,
          warnings: effectWarnings,
          timerIndex: { value: timerCounter },
          webSocketIndex: { value: webSocketCounter },
          environment: options.environment,
          transitionBindings,
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
        const id = `${activeComponent}.${effectHook}`;
        warnings.push({
          message: `Unextractable effect ${id}`,
          ...anchor,
          caveat: unextractableEffectCaveat(activeComponent, effectHook, {
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
  transitions.push(
    ...staticNavigationTransitions(
      source,
      fileName,
      routePatterns,
      components,
      routerPlugin,
      inventory,
    ),
  );
  return {
    vars,
    transitions: withStableTransitionIds(transitions),
    warnings,
  };
}

function collectProjectTypeAliases(
  primary: ts.SourceFile,
  options: ReactSourceTransitionOptions,
): Map<string, ts.TypeNode> {
  const aliases = typeAliasDeclarations(primary);
  if (options.types?.getSourceFile) {
    const seen = new Set<string>();
    const mergeFrom = (fragmentFileName: string): void => {
      const key =
        options.types?.canonicalFileName?.(fragmentFileName) ??
        resolve(fragmentFileName);
      if (seen.has(key)) return;
      seen.add(key);
      const sourceFile = options.types?.getSourceFile(fragmentFileName);
      if (!sourceFile) return;
      for (const [name, node] of typeAliasDeclarations(sourceFile)) {
        if (!aliases.has(name)) aliases.set(name, node);
      }
    };
    mergeFrom(primary.fileName);
    for (const fragment of options.relatedFragments ?? []) {
      mergeFrom(fragment.fileName);
    }
    return aliases;
  }
  for (const [name, typeNode] of options.additionalTypeAliases ?? []) {
    if (!aliases.has(name)) aliases.set(name, typeNode);
  }
  return aliases;
}

function mergeContextBindings(
  target: ContextBindings,
  source: ContextBindings,
): void {
  for (const decl of source.vars) {
    if (!target.vars.some((candidate) => candidate.id === decl.id)) {
      target.vars.push(decl);
    }
  }
  for (const [name, setter] of source.setters) {
    target.setters.set(name, setter);
  }
  for (const [hook, fields] of source.hookReturns) {
    const merged = target.hookReturns.get(hook) ?? new Map();
    for (const [field, setter] of fields) {
      merged.set(field, setter);
    }
    target.hookReturns.set(hook, merged);
  }
}

function resolveComponentRoutePattern(
  adapter: NavigationAdapter | undefined,
  inventory: RouteInventory | undefined,
  componentName: string,
): string | undefined {
  if (!adapter?.routeForComponent || !inventory) return undefined;
  return adapter.routeForComponent(componentName, inventory);
}

function scopeForLocalState(
  component: string,
  route: string,
  routerPlugin: NavigationAdapter | undefined,
  inventory: RouteInventory | undefined,
  providerGlobal: boolean,
): StateVarDecl["scope"] {
  if (providerGlobal) return { kind: "global" };
  const mountScope = routerPlugin?.mountScopeForComponent?.(
    component,
    inventory ?? { routes: [] },
  );
  if (mountScope) return mountScope;
  return { kind: "route-local", route };
}
