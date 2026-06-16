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
import { tagStableIdKey, withStableTransitionIds } from "./ids.js";
import { staticNavigationTransitions } from "./static-navigation.js";
import {
  firstValue,
  domainInferenceWarnings,
  inferUseStateDomainDetailed,
  initialValueForUseState,
  typeAliasDeclarations,
} from "./domains.js";
import type {
  StateVarDecl,
  Transition,
  Value,
  EffectIR,
} from "modality-ts/core";
import type {
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
} from "../spi/index.js";
import {
  timerSetterTaints,
  refSetterTaint,
  handlerSchedulesModeledTimer,
  timerStateVarDecl,
  type TimerRegistration,
} from "./transition/timers.js";
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
  transitionsFromLiteralListAttribute,
} from "./transition/handlers.js";
import {
  combineParsedGuards,
  disabledGuardFor,
  renderGuardFor,
} from "./transition/guards.js";
import { componentGuardLocalsFor } from "./transition/locals.js";
import { stateVarForName } from "./transition/expressions.js";
import { forwardsComponentProp } from "./transition/component-props.js";
import { isEventAttribute } from "./transition/ui.js";
import { navigationJsxTransition } from "./transition/navigation.js";
import {
  transitionsFromUseEffect,
  reactEffectWritesModeledState,
} from "./transition/effects.js";

export interface ReactSourceTransitionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  routePatterns?: readonly string[];
  asyncOutcomes?: Record<string, { success: Value; error?: Value }>;
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  sourcePlugins?: readonly StateSourcePlugin[];
  routerPlugin?: RouterPlugin;
  inventory?: RouteInventory;
  resetSymbols?: ReadonlySet<string>;
  setterFixedEffects?: ReadonlyMap<string, EffectIR>;
  resettableVarIds?: ReadonlySet<string>;
  additionalTypeAliases?: ReadonlyMap<string, ts.TypeNode>;
  additionalComponentSources?: readonly string[];
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
  const typeAliases = typeAliasDeclarations(source);
  for (const [name, typeNode] of options.additionalTypeAliases ?? []) {
    if (!typeAliases.has(name)) typeAliases.set(name, typeNode);
  }
  const vars: StateVarDecl[] = options.stateVars ? [...options.stateVars] : [];
  const transitions: Transition[] = [];
  const warnings: ExtractionWarning[] = [];
  const route = options.route ?? "/";
  const routePatterns = options.routePatterns ?? [];
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
  const globalTaints = new Set<string>();
  let timerCounter = 0;
  let transitionBindingCounter = 0;
  let suspenseBoundaryCounter = 0;
  const transitionBindings = new Map<string, TransitionBinding>();
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
        scopeForLocalState(
          nextComponent,
          route,
          routerPlugin,
          inventory,
          providerComponents.has(nextComponent),
        ),
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
        const inferred = inferUseStateDomainDetailed(
          node.initializer,
          typeAliases,
          source,
          varId,
        );
        const domain = inferred.domain;
        warnings.push(...domainInferenceWarnings(inferred, anchor));
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
            initial: initialValueForUseState(node.initializer, domain),
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
      );
      transitions.push(...extracted);
      const handlerId = `${nextComponent ?? "Anonymous"}.${node.name.text}`;
      if (
        extracted.length === 0 &&
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
        ) &&
        !handlerSchedulesModeledTimer(node, handlers, scopedSetters) &&
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
      const envTransitions: Transition[] = [];
      const extracted = transitionsFromUseEffect(
        source,
        fileName,
        node,
        scopedSetters,
        activeComponent,
        effectHook,
        {
          timerRegistrations,
          envTransitions,
          timerIndex: { value: timerCounter },
          transitionBindings,
        },
      );
      registerTimerVars(timerRegistrations);
      timerCounter += timerRegistrations.length;
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
