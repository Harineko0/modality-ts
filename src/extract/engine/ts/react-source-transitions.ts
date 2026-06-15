import * as ts from "typescript";
import {
  componentNameFor,
  extractableHandlerInitializer,
  isExtractableHandler,
  isUseEffectCall,
  isUseReducerCall,
  isUseStateCall,
  lineAndColumn,
  providerComponentNames,
} from "./ast.js";
import {
  componentDeclarations,
  calledCustomHook,
  customHookDeclarations,
  detectStatefulListComponents,
  inlineCustomHookState,
  isCustomHookDeclaration,
  isForwardablePropName,
  isIntrinsicJsxAttribute,
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
  inferUseStateDomain,
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
  transitionsFromTimerCall,
  timerSetterTaints,
  refSetterTaint,
  handlerSchedulesModeledTimer,
} from "./transition/timers.js";
import {
  transitionsFromJsxAttribute,
  transitionsFromComponentPropAttribute,
  transitionsFromBoundedListAttribute,
} from "./transition/handlers.js";
import {
  combineParsedGuards,
  disabledGuardFor,
  renderGuardFor,
} from "./transition/guards.js";
import { componentGuardLocalsFor } from "./transition/locals.js";
import { forwardsComponentProp } from "./transition/component-props.js";
import { isEventAttribute } from "./transition/ui.js";
import { navigationJsxTransition } from "./transition/navigation.js";
import {
  transitionsFromUseEffect,
  useEffectWritesModeledState,
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
  const visit = (node: ts.Node, componentName: string | undefined): void => {
    if (!componentName && isCustomHookDeclaration(node)) return;
    const nextComponent = componentNameFor(node) ?? componentName;
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
        ts.forEachChild(node, (child) => visit(child, nextComponent));
        return;
      }
      const stateName = node.name.elements[0];
      const setterName = node.name.elements[1];
      if (ts.isBindingElement(stateName) && ts.isIdentifier(stateName.name)) {
        const domain = inferUseStateDomain(node.initializer, typeAliases);
        const component = nextComponent ?? "Anonymous";
        const varId = `local:${component}.${stateName.name.text}`;
        if (!options.stateVars) {
          vars.push({
            id: varId,
            domain,
            origin: { file: fileName, ...lineAndColumn(source, node) },
            scope: providerComponents.has(component)
              ? { kind: "global" }
              : { kind: "route-local", route },
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
    );
    if (link) transitions.push(link);
    const scopedSetters = settersForComponent(setters, nextComponent);
    const refTaint = refSetterTaint(node, scopedSetters);
    if (refTaint) {
      const key = `Global taint ${refTaint.varId}`;
      if (!globalTaints.has(key)) {
        globalTaints.add(key);
        warnings.push({
          message: key,
          ...lineAndColumn(source, refTaint.node),
        });
      }
    }
    transitions.push(
      ...transitionsFromTimerCall(
        source,
        fileName,
        node,
        scopedSetters,
        nextComponent ?? "Anonymous",
      ),
    );
    for (const timerTaint of timerSetterTaints(node, scopedSetters)) {
      const key = `Global taint ${timerTaint.varId}`;
      if (!globalTaints.has(key)) {
        globalTaints.add(key);
        warnings.push({
          message: key,
          ...lineAndColumn(source, timerTaint.node),
        });
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
      if (extracted.length === 0) {
        const { line, column } = lineAndColumn(source, node);
        warnings.push({
          message: `Unextractable handler ${nextComponent ?? "Anonymous"}.${node.name.text} [no-extractable-effect] (${fileName}:${line}:${column})`,
          line,
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
            ts.forEachChild(node, (child) => visit(child, nextComponent));
            return;
          }
        }
        warnings.push({
          message: `Unextractable list-rendered handler ${nextComponent ?? "Anonymous"}.${node.name.text} over ${listInfo.domain.kind} ${listInfo.varId}`,
          ...lineAndColumn(source, node),
        });
        ts.forEachChild(node, (child) => visit(child, nextComponent));
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
      );
      transitions.push(...extracted);
      if (
        extracted.length === 0 &&
        !forwardsComponentProp(
          node,
          handlers,
          components.get(nextComponent ?? ""),
        ) &&
        !handlerSchedulesModeledTimer(node, handlers, scopedSetters)
      ) {
        const { line, column } = lineAndColumn(source, node);
        warnings.push({
          message: `Unextractable handler ${nextComponent ?? "Anonymous"}.${node.name.text} [no-extractable-effect] (${fileName}:${line}:${column})`,
          line,
        });
      }
    }
    if (ts.isCallExpression(node) && isUseEffectCall(node)) {
      const extracted = transitionsFromUseEffect(
        source,
        fileName,
        node,
        scopedSetters,
        nextComponent ?? "Anonymous",
      );
      transitions.push(...extracted);
      if (
        extracted.length === 0 &&
        useEffectWritesModeledState(node, scopedSetters) &&
        !providerComponents.has(nextComponent ?? "")
      ) {
        warnings.push({
          message: `Unextractable effect ${nextComponent ?? "Anonymous"}.useEffect`,
          ...lineAndColumn(source, node),
        });
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextComponent));
  };
  visit(source, undefined);
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
  return { vars, transitions: withStableTransitionIds(transitions), warnings };
}

function resolveComponentRoutePattern(
  adapter: NavigationAdapter | undefined,
  inventory: RouteInventory | undefined,
  componentName: string,
): string | undefined {
  if (!adapter?.routeForComponent || !inventory) return undefined;
  return adapter.routeForComponent(componentName, inventory);
}
