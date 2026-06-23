import type { StateVarDecl, Transition, Value } from "modality-ts/core";
import * as ts from "typescript";
import type { SemanticTypeContext } from "../../lang/ts/semantic-type-context.js";
import type {
  EffectPlugin,
  RouteFormSubmitCtx,
  RoutePlugin,
  StateSourcePlugin,
} from "../spi/index.js";
import { lineAndColumn } from "./ast.js";
import { unextractableHandlerCaveat } from "./caveats.js";
import type { ComponentRegistry } from "./components.js";
import {
  jsxTagIdentifier,
  jsxTagName,
  listRenderedHandlerInfo,
  literalListRenderedHandlerInfo,
  resolveComponentEntry,
} from "./components.js";
import { safeId, tagStableIdKey } from "./ids.js";
import {
  componentPropDeferredToChildTrigger,
  forwardsComponentProp,
} from "./transition/component-props.js";
import type { TransitionBinding } from "./transition/concurrent.js";
import {
  combineParsedGuards,
  disabledGuardFor,
  renderGuardFor,
} from "./transition/guards.js";
import {
  transitionsFromBoundedListAttribute,
  transitionsFromBoundedListComponentPropAttribute,
  transitionsFromComponentPropAttribute,
  transitionsFromJsxAttribute,
  transitionsFromLiteralListAttribute,
} from "./transition/handlers.js";
import { componentGuardLocalsFor } from "./transition/locals.js";
import { anyEffectPluginHandlesSchedule } from "./effect-ts-bridge.js";
import { type TimerRegistration } from "./transition/timers.js";
import type {
  ComponentDecl,
  ContextBindings,
  ExtractableHandler,
  ExtractionWarning,
  SetterBinding,
} from "./types.js";

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

export interface JsxHandlerVisitContext {
  source: ts.SourceFile;
  fileName: string;
  routePatterns: readonly string[];
  effectApis: Set<string>;
  asyncOutcomes: Record<string, { success: Value; error?: Value }>;
  statePlugins: readonly StateSourcePlugin[];
  routePlugin: RoutePlugin | undefined;
  contextBindings: ContextBindings;
  resetSymbols: ReadonlySet<string>;
  types?: SemanticTypeContext;
  effectOpAliases: ReadonlyMap<string, ReadonlyMap<string, string>>;
  effectPlugins?: readonly EffectPlugin[];
  vars: StateVarDecl[];
  transitions: Transition[];
  warnings: ExtractionWarning[];
  handlers: Map<string, ExtractableHandler>;
  components: ComponentRegistry;
  componentDisplayMap: Map<string, ComponentDecl>;
  setters: Map<string, SetterBinding>;
  modeledSubmitHandlers: Set<string>;
  transitionBindings: Map<string, TransitionBinding>;
  timerCounter: { value: number };
  routerSubmitContext: (component: string) => RouteFormSubmitCtx;
  finalizeHandlerTimerContext: (handlerContext: {
    timerRegistrations: TimerRegistration[];
    envTransitions: Transition[];
  }) => Transition[];
  registerTimerVars: (registrations: readonly TimerRegistration[]) => void;
  visitChild: (
    node: ts.Node,
    componentName: string | undefined,
    activeBoundary: string | undefined,
  ) => void;
}

export function visitComponentPropJsxAttribute(
  ctx: JsxHandlerVisitContext,
  node: ts.JsxAttribute,
  nextComponent: string | undefined,
  effectiveBoundary: string | undefined,
  scopedSetters: Map<string, SetterBinding>,
): boolean {
  if (!ts.isIdentifier(node.name)) return false;
  const attrName = node.name.text;
  const componentPropHandlerContext = {
    activeBoundary: effectiveBoundary,
    transitionBindings: ctx.transitionBindings,
    timerRegistrations: [] as TimerRegistration[],
    envTransitions: [] as Transition[],
    timerIndex: ctx.timerCounter,
    routerSubmitContext: ctx.routerSubmitContext(nextComponent ?? "Anonymous"),
    effectOpAliases: ctx.effectOpAliases,
    effectPlugins: ctx.effectPlugins,
  };
  const literalListInfo = literalListRenderedHandlerInfo(node);
  if (literalListInfo) {
    const extracted = literalListInfo.values.flatMap((value) =>
      transitionsFromComponentPropAttribute(
        ctx.source,
        ctx.fileName,
        node,
        scopedSetters,
        ctx.handlers,
        ctx.components,
        nextComponent ?? "Anonymous",
        ctx.effectApis,
        ctx.asyncOutcomes,
        ctx.statePlugins,
        ctx.routePlugin,
        ctx.warnings,
        ctx.routePatterns,
        ctx.contextBindings,
        ctx.resetSymbols,
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
        ctx.types,
      ),
    );
    if (extracted.length > 0) {
      ctx.transitions.push(
        ...tagStableIdKey(extracted, node),
        ...ctx.finalizeHandlerTimerContext(componentPropHandlerContext),
      );
      ts.forEachChild(node, (child) =>
        ctx.visitChild(child, nextComponent, effectiveBoundary),
      );
      return true;
    }
  }
  const listInfo = listRenderedHandlerInfo(
    node,
    ctx.vars,
    nextComponent ?? "Anonymous",
  );
  if (listInfo) {
    if (listInfo.domain.kind === "boundedList") {
      const extracted = transitionsFromBoundedListComponentPropAttribute(
        ctx.source,
        ctx.fileName,
        node,
        scopedSetters,
        ctx.handlers,
        ctx.components,
        nextComponent ?? "Anonymous",
        {
          varId: listInfo.varId,
          domain: listInfo.domain,
          itemName: listInfo.itemName,
        },
        ctx.effectApis,
        ctx.asyncOutcomes,
        ctx.statePlugins,
        ctx.routePlugin,
        ctx.warnings,
        ctx.routePatterns,
        ctx.contextBindings,
        ctx.resetSymbols,
        componentPropHandlerContext,
        ctx.types,
      );
      if (extracted.length > 0) {
        ctx.transitions.push(
          ...tagStableIdKey(extracted, node),
          ...ctx.finalizeHandlerTimerContext(componentPropHandlerContext),
        );
        ts.forEachChild(node, (child) =>
          ctx.visitChild(child, nextComponent, effectiveBoundary),
        );
        return true;
      }
    }
    ctx.warnings.push({
      message: `Unextractable list-rendered component prop handler ${nextComponent ?? "Anonymous"}.${attrName} over ${listInfo.domain.kind} ${listInfo.varId}`,
      ...lineAndColumn(ctx.source, node),
    });
    ts.forEachChild(node, (child) =>
      ctx.visitChild(child, nextComponent, effectiveBoundary),
    );
    return true;
  }
  const extracted = transitionsFromComponentPropAttribute(
    ctx.source,
    ctx.fileName,
    node,
    scopedSetters,
    ctx.handlers,
    ctx.components,
    nextComponent ?? "Anonymous",
    ctx.effectApis,
    ctx.asyncOutcomes,
    ctx.statePlugins,
    ctx.routePlugin,
    ctx.warnings,
    ctx.routePatterns,
    ctx.contextBindings,
    ctx.resetSymbols,
    componentPropHandlerContext,
    ctx.types,
  );
  ctx.transitions.push(
    ...extracted,
    ...ctx.finalizeHandlerTimerContext(componentPropHandlerContext),
  );
  const handlerId = `${nextComponent ?? "Anonymous"}.${attrName}`;
  const tag = jsxTagIdentifier(node) ?? jsxTagName(node);
  const localComponent = tag
    ? resolveComponentEntry(ctx.components, tag, ctx.types)?.decl
    : undefined;
  if (
    extracted.length === 0 &&
    !componentPropDeferredToChildTrigger(
      ctx.source,
      node,
      ctx.components,
      scopedSetters,
      ctx.warnings,
      ctx.types,
    ) &&
    !unextractableHandlerAlreadyReported(ctx.warnings, handlerId)
  ) {
    // Fallback: if the handler is registered (e.g. via handleSubmit unwrap),
    // extract ctx.transitions directly from the handler body using the prop name
    // as the event attribute. This handles ctx.handlers passed to external (non-local)
    // child ctx.components, where the trigger chain cannot be resolved.
    const fallbackExtracted = localComponent
      ? []
      : transitionsFromJsxAttribute(
          ctx.source,
          ctx.fileName,
          node,
          scopedSetters,
          ctx.handlers,
          nextComponent ?? "Anonymous",
          ctx.effectApis,
          ctx.asyncOutcomes,
          ctx.statePlugins,
          ctx.routePlugin,
          undefined,
          ctx.routePatterns,
          ctx.contextBindings,
          ctx.warnings,
          ctx.resetSymbols,
          {
            ...componentPropHandlerContext,
            effectOpAliases: ctx.effectOpAliases,
          },
        );
    if (fallbackExtracted.length > 0) {
      ctx.transitions.push(
        ...fallbackExtracted,
        ...ctx.finalizeHandlerTimerContext(componentPropHandlerContext),
      );
    } else {
      const anchor = lineAndColumn(ctx.source, node);
      ctx.warnings.push({
        message: `Unextractable handler ${handlerId} [no-extractable-effect] (${ctx.fileName}:${anchor.line}:${anchor.column})`,
        ...anchor,
        caveat: unextractableHandlerCaveat(handlerId, "no-extractable-effect", {
          file: ctx.fileName,
          ...anchor,
        }),
      });
    }
  }
  return false;
}

export function visitEventJsxAttribute(
  ctx: JsxHandlerVisitContext,
  node: ts.JsxAttribute,
  nextComponent: string | undefined,
  effectiveBoundary: string | undefined,
  scopedSetters: Map<string, SetterBinding>,
): boolean {
  if (!ts.isIdentifier(node.name)) return false;
  const attrName = node.name.text;
  const literalListInfo = literalListRenderedHandlerInfo(node);
  if (literalListInfo) {
    const guardLocals = componentGuardLocalsFor(node, scopedSetters);
    const guard = combineParsedGuards([
      renderGuardFor(
        node,
        scopedSetters,
        ctx.warnings,
        ctx.source,
        nextComponent ?? "Anonymous",
        guardLocals,
      ),
      disabledGuardFor(
        node,
        scopedSetters,
        ctx.warnings,
        ctx.source,
        nextComponent ?? "Anonymous",
        guardLocals,
      ),
    ]);
    const timerRegistrations: TimerRegistration[] = [];
    const envTransitions: Transition[] = [];
    const extracted = transitionsFromLiteralListAttribute(
      ctx.source,
      ctx.fileName,
      node,
      scopedSetters,
      ctx.handlers,
      nextComponent ?? "Anonymous",
      literalListInfo,
      ctx.effectApis,
      ctx.asyncOutcomes,
      ctx.statePlugins,
      ctx.routePlugin,
      guard,
      ctx.routePatterns,
      ctx.contextBindings,
      ctx.warnings,
      ctx.resetSymbols,
      {
        activeBoundary: effectiveBoundary,
        transitionBindings: ctx.transitionBindings,
        timerRegistrations,
        envTransitions,
        timerIndex: ctx.timerCounter,
      },
    );
    ctx.registerTimerVars(timerRegistrations);
    ctx.timerCounter.value += timerRegistrations.length;
    if (extracted.length > 0) {
      ctx.transitions.push(
        ...tagStableIdKey(extracted, node),
        ...envTransitions,
      );
      ts.forEachChild(node, (child) =>
        ctx.visitChild(child, nextComponent, effectiveBoundary),
      );
      return true;
    }
  }
  const listInfo = listRenderedHandlerInfo(
    node,
    ctx.vars,
    nextComponent ?? "Anonymous",
  );
  if (listInfo) {
    if (listInfo.domain.kind === "boundedList") {
      const extracted = transitionsFromBoundedListAttribute(
        ctx.source,
        ctx.fileName,
        node,
        scopedSetters,
        ctx.handlers,
        nextComponent ?? "Anonymous",
        {
          varId: listInfo.varId,
          domain: listInfo.domain,
          itemName: listInfo.itemName,
        },
        ctx.types,
      );
      if (extracted.length > 0) {
        ctx.transitions.push(...tagStableIdKey(extracted, node));
        ts.forEachChild(node, (child) =>
          ctx.visitChild(child, nextComponent, effectiveBoundary),
        );
        return true;
      }
    }
    ctx.warnings.push({
      message: `Unextractable list-rendered handler ${nextComponent ?? "Anonymous"}.${attrName} over ${listInfo.domain.kind} ${listInfo.varId}`,
      ...lineAndColumn(ctx.source, node),
    });
    ts.forEachChild(node, (child) =>
      ctx.visitChild(child, nextComponent, effectiveBoundary),
    );
    return true;
  }
  const guardLocals = componentGuardLocalsFor(node, scopedSetters);
  const guard = combineParsedGuards([
    renderGuardFor(
      node,
      scopedSetters,
      ctx.warnings,
      ctx.source,
      nextComponent ?? "Anonymous",
      guardLocals,
    ),
    disabledGuardFor(
      node,
      scopedSetters,
      ctx.warnings,
      ctx.source,
      nextComponent ?? "Anonymous",
      guardLocals,
    ),
  ]);
  const timerRegistrations: TimerRegistration[] = [];
  const envTransitions: Transition[] = [];
  const extracted = transitionsFromJsxAttribute(
    ctx.source,
    ctx.fileName,
    node,
    scopedSetters,
    ctx.handlers,
    nextComponent ?? "Anonymous",
    ctx.effectApis,
    ctx.asyncOutcomes,
    ctx.statePlugins,
    ctx.routePlugin,
    guard,
    ctx.routePatterns,
    ctx.contextBindings,
    ctx.warnings,
    ctx.resetSymbols,
    {
      activeBoundary: effectiveBoundary,
      transitionBindings: ctx.transitionBindings,
      timerRegistrations,
      envTransitions,
      timerIndex: ctx.timerCounter,
      routerSubmitContext: ctx.routerSubmitContext(
        nextComponent ?? "Anonymous",
      ),
      effectOpAliases: ctx.effectOpAliases,
      types: ctx.types,
      effectPlugins: ctx.effectPlugins,
    },
  );
  ctx.registerTimerVars(timerRegistrations);
  ctx.timerCounter.value += timerRegistrations.length;
  ctx.transitions.push(...extracted);
  const handlerId = `${nextComponent ?? "Anonymous"}.${attrName}`;
  if (
    extracted.length === 0 &&
    !forwardsComponentProp(
      node,
      ctx.handlers,
      ctx.componentDisplayMap.get(nextComponent ?? ""),
      ctx.components,
      scopedSetters,
      ctx.source,
      ctx.warnings,
      ctx.types,
    ) &&
    !anyEffectPluginHandlesSchedule(
      ctx.effectPlugins ?? [],
      node,
      ctx.handlers,
      scopedSetters,
    ) &&
    !ctx.modeledSubmitHandlers.has(handlerId) &&
    !unextractableHandlerAlreadyReported(ctx.warnings, handlerId)
  ) {
    const anchor = lineAndColumn(ctx.source, node);
    ctx.warnings.push({
      message: `Unextractable handler ${handlerId} [no-extractable-effect] (${ctx.fileName}:${anchor.line}:${anchor.column})`,
      ...anchor,
      caveat: unextractableHandlerCaveat(handlerId, "no-extractable-effect", {
        file: ctx.fileName,
        ...anchor,
      }),
    });
  }
  return false;
}
