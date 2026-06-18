import type { StateVarDecl, EffectIR } from "modality-ts/core";
import type {
  NavigationAdapter,
  StateSourcePlugin,
  WriteChannel,
} from "modality-ts/extract/engine/spi";
import { extractSharedReactTransitions } from "../shared/react-transition-extract.js";
import type { ExtractedModelSkeleton } from "../use-state/types.js";
import { discoverZustandStoresDetailed } from "./discover.js";
import {
  discoverZustandSafetyWarnings,
  discoverZustandWriteChannels,
  discoverZustandWritesDetailed,
} from "./writes.js";
import { augmentZustandActionSelectorSource } from "./augment.js";
import { zustandSource } from "./plugin.js";

export interface ZustandExtractionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  routePatterns?: readonly string[];
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  sourcePlugins?: readonly StateSourcePlugin[];
  routerPlugin?: NavigationAdapter;
}

export function extractZustandSkeleton(
  sourceText: string,
  options: ZustandExtractionOptions = {},
): ExtractedModelSkeleton {
  const fileName = options.fileName ?? "App.tsx";
  const route = options.route ?? "/";
  const augmentedSource = augmentZustandActionSelectorSource(
    sourceText,
    fileName,
  );
  const discovery = discoverZustandStoresDetailed(augmentedSource, fileName);
  const writeDiscovery = discoverZustandWritesDetailed(
    augmentedSource,
    fileName,
  );
  const { setterFixedEffects, extraChannels } = mergeAugmentedActionBindings(
    augmentedSource,
    writeDiscovery,
  );
  const vars = [
    ...discovery.decls
      .map((decl) => decl.var)
      .filter((decl): decl is StateVarDecl => Boolean(decl)),
    ...(options.stateVars ?? []),
  ];
  const writeChannels = [
    ...discoverZustandWriteChannels(augmentedSource, fileName),
    ...extraChannels,
    ...(options.writeChannels ?? []),
  ];
  const sourcePlugins = [zustandSource(), ...(options.sourcePlugins ?? [])];
  const safetyWarnings = discoverZustandSafetyWarnings(
    augmentedSource,
    fileName,
  ).map((warning) => ({
    message: warning.message,
    ...(warning.source ? { line: warning.source.line } : {}),
  }));
  const discoveryWarnings = discovery.warnings.map((warning) => ({
    message: warning.message,
    ...(warning.source ? { line: warning.source.line } : {}),
  }));
  const { transitions, warnings = [] } = extractSharedReactTransitions({
    sourceText: augmentedSource,
    fileName,
    route,
    effectApis: options.effectApis ?? [],
    routePatterns: options.routePatterns ?? [],
    stateVars: vars,
    ...(writeChannels.length > 0 ? { writeChannels } : {}),
    sourcePlugins,
    setterFixedEffects,
    resettableVarIds: writeDiscovery.resettableVarIds,
    ...(options.routerPlugin ? { routerPlugin: options.routerPlugin } : {}),
  });
  return {
    vars,
    transitions: applyZustandFixedEffects([...transitions], setterFixedEffects),
    warnings: [...safetyWarnings, ...discoveryWarnings, ...warnings],
  };
}

function applyZustandFixedEffects(
  transitions: import("modality-ts/core").Transition[],
  setterFixedEffects: ReadonlyMap<string, EffectIR>,
): import("modality-ts/core").Transition[] {
  if (setterFixedEffects.size === 0) return transitions;
  const effectsByVar = new Map<string, EffectIR>();
  for (const effect of setterFixedEffects.values()) {
    const varId = primaryWrittenVar(effect);
    if (varId) effectsByVar.set(varId, effect);
  }
  return transitions.map((transition) => {
    if (transition.effect.kind !== "assign") return transition;
    if (
      transition.effect.expr.kind !== "lit" ||
      transition.effect.expr.value !== null
    ) {
      return transition;
    }
    const fixed = effectsByVar.get(transition.effect.var);
    return fixed ? { ...transition, effect: fixed } : transition;
  });
}

function mergeAugmentedActionBindings(
  augmentedSource: string,
  writeDiscovery: {
    setterFixedEffects: Map<string, EffectIR>;
    channels: WriteChannel[];
  },
): {
  setterFixedEffects: Map<string, EffectIR>;
  extraChannels: WriteChannel[];
} {
  const setterFixedEffects = new Map(writeDiscovery.setterFixedEffects);
  const extraChannels: WriteChannel[] = [];
  for (const [actionName, effect] of writeDiscovery.setterFixedEffects) {
    const bindName = `__zustand_bind_${actionName}`;
    if (!augmentedSource.includes(bindName)) continue;
    setterFixedEffects.set(bindName, effect);
    const varId = primaryWrittenVar(effect);
    if (!varId) continue;
    extraChannels.push({
      id: `zustand:bind:${actionName}`,
      varId,
      symbolName: bindName,
      source: { file: "App.tsx", line: 1, column: 1 },
    });
  }
  return { setterFixedEffects, extraChannels };
}

function primaryWrittenVar(effect: EffectIR): string | undefined {
  if (effect.kind === "assign") return effect.var;
  if (effect.kind === "seq") {
    for (const child of effect.effects) {
      const target = primaryWrittenVar(child);
      if (target) return target;
    }
  }
  return undefined;
}
