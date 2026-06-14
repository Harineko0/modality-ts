import * as ts from "typescript";
import { callName, componentNameFor, extractableHandlerInitializer, isExtractableHandler, isPropertyAccessLike, isUseEffectCall, isUseReducerCall, isUseRefCall, isUseStateCall, lineAndColumn, literalValue, propertyName, providerComponentNames, startsUppercase } from "../../engine/ts/ast.js";
import { componentDeclarations, componentName, calledCustomHook, customHookDeclarationName, customHookDeclarations, detectStatefulListComponents, handlerExpression, inlineCustomHookState, isCustomHookDeclaration, isForwardablePropName, isIntrinsicJsxAttribute, jsxTagName, listRenderedHandlerInfo } from "../../engine/ts/components.js";
import { bindContextHookObjectDeclaration, bindSetter, discoverContextBindings, emptyContextBindings, setterBindingFromDecl, settersForComponent } from "../../engine/ts/context.js";
import { safeId, tagStableIdKey, uniqueStrings, withStableTransitionIds } from "../../engine/ts/ids.js";
import { inputTransitions } from "../../engine/ts/input-transitions.js";
import { jsxRouteTarget, routeMountGuard, routeMountReads, routeTargetValue, templateRoutePattern } from "../../engine/ts/routes.js";
import { staticNavigationTransitions } from "../../engine/ts/static-navigation.js";
import { firstValue, inferDomainFromTypeNode, inferUseStateDomain, initialValueForUseState, typeAliasDeclarations } from "../../engine/ts/domains.js";
import { type StateVarDecl, type Transition } from "modality-ts/core";
import type { RouterPlugin, StateSourcePlugin } from "../../engine/spi/index.js";
import type { ExtractableHandler, ExtractedModelSkeleton, ExtractionWarning, SetterBinding, UseStateExtractionOptions, UseStateExtractionResult } from "./types.js";
import { transitionsFromTimerCall, timerSetterTaints, refSetterTaint, handlerSchedulesModeledTimer } from "./transition/timers.js";
import { transitionsFromJsxAttribute, transitionsFromComponentPropAttribute, transitionsFromBoundedListAttribute } from "./transition/handlers.js";
import { combineParsedGuards, disabledGuardFor, renderGuardFor } from "./transition/guards.js";
import { componentGuardLocalsFor } from "./transition/locals.js";
import { forwardsComponentProp } from "./transition/component-props.js";
import { isEventAttribute } from "./transition/ui.js";
import { linkNavigationTransition } from "./transition/navigation.js";
import { transitionsFromUseEffect, useEffectWritesModeledState } from "./transition/effects.js";

export function extractUseStateVars(sourceText: string, options: UseStateExtractionOptions = {}): UseStateExtractionResult {
  return extractUseStateSkeleton(sourceText, options);
}

export function extractUseStateSkeleton(sourceText: string, options: UseStateExtractionOptions = {}): ExtractedModelSkeleton {
  const fileName = options.fileName ?? "App.tsx";
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const typeAliases = typeAliasDeclarations(source);
  const vars: StateVarDecl[] = options.stateVars ? [...options.stateVars] : [];
  const transitions: Transition[] = [];
  const warnings: ExtractionWarning[] = [];
  const route = options.route ?? "/";
  const routePatterns = options.routePatterns ?? [];
  const effectApis = new Set(options.effectApis ?? []);
  const sourcePlugins = options.sourcePlugins ?? [];
  const routerPlugin = options.routerPlugin;
  const setters = new Map<string, SetterBinding>();
  const contextBindings = discoverContextBindings(source, fileName, route, typeAliases);
  const globalTaints = new Set<string>();
  const components = componentDeclarations(source);
  const providerComponents = providerComponentNames(source);
  const customHooks = customHookDeclarations(source);
  const statefulListComponents = detectStatefulListComponents(source, components);
  const reportedStatefulListComponents = new Set<string>();
  const reportedCustomHooks = new Set<string>();
  if (options.stateVars && options.writeChannels) {
    for (const channel of options.writeChannels) {
      const decl = options.stateVars.find((candidate) => candidate.id === channel.varId);
      if (!decl) continue;
      bindSetter(setters, channel.symbolName, setterBindingFromDecl(decl));
    }
  }
  for (const decl of contextBindings.vars) {
    if (!vars.some((candidate) => candidate.id === decl.id)) vars.push(decl);
  }
  for (const [symbolName, setter] of contextBindings.setters) setters.set(symbolName, setter);
  const handlers = new Map<string, ExtractableHandler>();
  const visit = (node: ts.Node, componentName: string | undefined): void => {
    if (!componentName && isCustomHookDeclaration(node)) return;
    const nextComponent = componentNameFor(node) ?? componentName;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const handler = extractableHandlerInitializer(node.initializer);
      if (handler) handlers.set(node.name.text, handler);
    }
    if (ts.isFunctionDeclaration(node) && node.name && isExtractableHandler(node)) {
      handlers.set(node.name.text, node);
    }
    if (ts.isVariableDeclaration(node) && node.initializer && isUseReducerCall(node.initializer)) {
      warnings.push({ message: `Unsupported useReducer ${nextComponent ?? "Anonymous"}.useReducer`, ...lineAndColumn(source, node) });
    }
    bindContextHookObjectDeclaration(node, contextBindings, setters);
    if (ts.isVariableDeclaration(node) && nextComponent && inlineCustomHookState(source, fileName, node, customHooks, vars, setters, nextComponent, route)) {
      return;
    }
    const customHook = calledCustomHook(node, new Set(customHooks.keys()));
    if (customHook && nextComponent) {
      const key = `${nextComponent}.${customHook}`;
      if (!contextBindings.hookReturns.has(customHook) && !reportedCustomHooks.has(key)) {
        reportedCustomHooks.add(key);
        warnings.push({ message: `Unextractable custom hook ${key}`, ...lineAndColumn(source, node) });
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && isUseStateCall(node.initializer)) {
      if (nextComponent && statefulListComponents.has(nextComponent)) {
        if (!reportedStatefulListComponents.has(nextComponent)) {
          reportedStatefulListComponents.add(nextComponent);
          warnings.push({ message: `Unextractable stateful list item ${nextComponent}`, ...lineAndColumn(source, node) });
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
            scope: providerComponents.has(component) ? { kind: "global" } : { kind: "route-local", route },
            initial: initialValueForUseState(node.initializer, domain)
          });
        }
        if (setterName && ts.isBindingElement(setterName) && ts.isIdentifier(setterName.name)) {
          if (!options.writeChannels) bindSetter(setters, setterName.name.text, { varId, component, stateName: stateName.name.text, domain });
        }
      } else {
        warnings.push({ message: "Unsupported useState binding pattern", ...lineAndColumn(source, node) });
      }
    }
    const link = linkNavigationTransition(source, fileName, node, nextComponent ?? "Anonymous", routePatterns);
    if (link) transitions.push(link);
    const scopedSetters = settersForComponent(setters, nextComponent);
    const refTaint = refSetterTaint(node, scopedSetters);
    if (refTaint) {
      const key = `Global taint ${refTaint.varId}`;
      if (!globalTaints.has(key)) {
        globalTaints.add(key);
        warnings.push({ message: key, ...lineAndColumn(source, refTaint.node) });
      }
    }
    transitions.push(...transitionsFromTimerCall(source, fileName, node, scopedSetters, nextComponent ?? "Anonymous"));
    for (const timerTaint of timerSetterTaints(node, scopedSetters)) {
      const key = `Global taint ${timerTaint.varId}`;
      if (!globalTaints.has(key)) {
        globalTaints.add(key);
        warnings.push({ message: key, ...lineAndColumn(source, timerTaint.node) });
      }
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.initializer && isForwardablePropName(node.name.text) && !isIntrinsicJsxAttribute(node)) {
      const extracted = transitionsFromComponentPropAttribute(source, fileName, node, scopedSetters, handlers, components, nextComponent ?? "Anonymous", effectApis, options.asyncOutcomes ?? {}, sourcePlugins, routerPlugin, warnings);
      transitions.push(...extracted);
      if (extracted.length === 0) {
        warnings.push({ message: `Unextractable handler ${nextComponent ?? "Anonymous"}.${node.name.text}`, ...lineAndColumn(source, node) });
      }
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.initializer && isEventAttribute(node.name.text) && isIntrinsicJsxAttribute(node)) {
      const listInfo = listRenderedHandlerInfo(node, vars, nextComponent ?? "Anonymous");
      if (listInfo) {
        if (listInfo.domain.kind === "boundedList") {
          const extracted = transitionsFromBoundedListAttribute(source, fileName, node, scopedSetters, handlers, nextComponent ?? "Anonymous", {
            varId: listInfo.varId,
            domain: listInfo.domain,
            itemName: listInfo.itemName
          });
          if (extracted.length > 0) {
            transitions.push(...tagStableIdKey(extracted, node));
            ts.forEachChild(node, (child) => visit(child, nextComponent));
            return;
          }
        }
        warnings.push({ message: `Unextractable list-rendered handler ${nextComponent ?? "Anonymous"}.${node.name.text} over ${listInfo.domain.kind} ${listInfo.varId}`, ...lineAndColumn(source, node) });
        ts.forEachChild(node, (child) => visit(child, nextComponent));
        return;
      }
      const guardLocals = componentGuardLocalsFor(node, scopedSetters);
      const guard = combineParsedGuards([
        renderGuardFor(node, scopedSetters, warnings, source, nextComponent ?? "Anonymous", guardLocals),
        disabledGuardFor(node, scopedSetters, warnings, source, nextComponent ?? "Anonymous", guardLocals)
      ]);
      const extracted = transitionsFromJsxAttribute(source, fileName, node, scopedSetters, handlers, nextComponent ?? "Anonymous", effectApis, options.asyncOutcomes ?? {}, sourcePlugins, routerPlugin, guard, routePatterns, contextBindings, warnings);
      transitions.push(...extracted);
      if (extracted.length === 0 && !forwardsComponentProp(node, handlers, components.get(nextComponent ?? "")) && !handlerSchedulesModeledTimer(node, handlers, scopedSetters)) {
        warnings.push({ message: `Unextractable handler ${nextComponent ?? "Anonymous"}.${node.name.text}`, ...lineAndColumn(source, node) });
      }
    }
    if (ts.isCallExpression(node) && isUseEffectCall(node)) {
      const extracted = transitionsFromUseEffect(source, fileName, node, scopedSetters, nextComponent ?? "Anonymous");
      transitions.push(...extracted);
      if (extracted.length === 0 && useEffectWritesModeledState(node, scopedSetters) && !providerComponents.has(nextComponent ?? "")) {
        warnings.push({ message: `Unextractable effect ${nextComponent ?? "Anonymous"}.useEffect`, ...lineAndColumn(source, node) });
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextComponent));
  };
  visit(source, undefined);
  transitions.push(...staticNavigationTransitions(source, fileName, routePatterns, components));
  return { vars, transitions: withStableTransitionIds(transitions), warnings };
}
