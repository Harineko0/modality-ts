import type { EffectIR, StateVarDecl } from "modality-ts/core";
import type {
  RoutePlugin,
  StateSourcePlugin,
  WriteChannel,
} from "modality-ts/extract/engine/spi";
import { extractSharedReactTransitions } from "../../shared/react-transition-extract.js";
import type { ExtractedModelSkeleton } from "../use-state/types.js";
import { reduxSource } from "./plugin.js";
import { discoverReduxStoresDetailed } from "./store.js";
import {
  discoverReduxSafetyWarnings,
  discoverReduxWriteChannels,
  discoverReduxWritesDetailed,
  primeReduxDiscovery,
} from "./writes.js";

export interface ReduxExtractionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  routePatterns?: readonly string[];
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  statePlugins?: readonly StateSourcePlugin[];
  routePlugin?: RoutePlugin;
}

export function extractReduxSkeleton(
  sourceText: string,
  options: ReduxExtractionOptions = {},
): ExtractedModelSkeleton {
  const fileName = options.fileName ?? "App.tsx";
  const route = options.route ?? "/";
  primeReduxDiscovery(sourceText, fileName);
  const discovery = discoverReduxStoresDetailed(sourceText, fileName);
  const writeDiscovery = discoverReduxWritesDetailed(sourceText, fileName);
  const vars = [
    ...discovery.decls
      .map((decl) => decl.var)
      .filter((decl): decl is StateVarDecl => Boolean(decl)),
    ...(options.stateVars ?? []),
  ];
  const writeChannels = [
    ...discoverReduxWriteChannels(sourceText, fileName),
    ...(options.writeChannels ?? []),
  ];
  const statePlugins = [reduxSource(), ...(options.statePlugins ?? [])];
  const safetyWarnings = discoverReduxSafetyWarnings(sourceText, fileName).map(
    (warning) => ({
      message: warning.message,
      ...(warning.source
        ? {
            line: warning.source.line,
            column: warning.source.column,
            source: warning.source,
          }
        : {}),
      ...(warning.caveat ? { caveat: warning.caveat } : {}),
      ...(warning.confidence ? { confidence: warning.confidence } : {}),
      ...(warning.producer ? { producer: warning.producer } : {}),
    }),
  );
  const discoveryWarnings = discovery.warnings.map((warning) => ({
    message: warning.message,
    ...(warning.source
      ? {
          line: warning.source.line,
          column: warning.source.column,
          source: warning.source,
        }
      : {}),
    ...(warning.caveat ? { caveat: warning.caveat } : {}),
  }));
  const { transitions, warnings = [] } = extractSharedReactTransitions({
    sourceText,
    fileName,
    route,
    effectApis: options.effectApis ?? [],
    routePatterns: options.routePatterns ?? [],
    stateVars: vars,
    ...(writeChannels.length > 0 ? { writeChannels } : {}),
    statePlugins,
    setterFixedEffects: writeDiscovery.dispatchFixedEffects,
    ...(options.routePlugin ? { routePlugin: options.routePlugin } : {}),
  });
  return {
    vars,
    transitions: applyReduxFixedEffects(
      [...transitions],
      writeDiscovery.dispatchFixedEffects,
    ),
    warnings: [...safetyWarnings, ...discoveryWarnings, ...warnings],
  };
}

function applyReduxFixedEffects(
  transitions: import("modality-ts/core").Transition[],
  dispatchFixedEffects: ReadonlyMap<string, EffectIR>,
): import("modality-ts/core").Transition[] {
  if (dispatchFixedEffects.size === 0) return transitions;
  return transitions.map((transition) => {
    if (transition.effect.kind !== "assign") return transition;
    if (
      transition.effect.expr.kind !== "lit" ||
      transition.effect.expr.value !== true
    ) {
      return transition;
    }
    for (const [symbol, effect] of dispatchFixedEffects) {
      if (transition.id.includes(symbol)) {
        const reads = [...collectReads(effect)];
        const writes = [...collectWrites(effect)];
        return {
          ...transition,
          effect,
          reads,
          writes,
          confidence: effectIncludesHavoc(effect) ? "over-approx" : "exact",
        };
      }
    }
    return transition;
  });
}

function collectReads(effect: EffectIR): Set<string> {
  const reads = new Set<string>();
  if (effect.kind === "assign" && effect.expr.kind === "read") {
    reads.add(effect.expr.var);
  }
  if (effect.kind === "seq") {
    for (const child of effect.effects) {
      for (const read of collectReads(child)) reads.add(read);
    }
  }
  return reads;
}

function collectWrites(effect: EffectIR): Set<string> {
  const writes = new Set<string>();
  if (effect.kind === "assign") writes.add(effect.var);
  if (effect.kind === "havoc") writes.add(effect.var);
  if (effect.kind === "seq") {
    for (const child of effect.effects) {
      for (const write of collectWrites(child)) writes.add(write);
    }
  }
  return writes;
}

function effectIncludesHavoc(effect: EffectIR): boolean {
  if (effect.kind === "havoc") return true;
  if (effect.kind === "seq") {
    return effect.effects.some((child) => effectIncludesHavoc(child));
  }
  return false;
}
