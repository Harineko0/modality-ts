import type { Value } from "modality-ts/core";
import type {
  ExtractCtx,
  SourceExtractionResult,
  WriteChannel,
} from "../../engine/spi/index.js";
import type { EffectOpAliases } from "../../compile/effect-op-aliases.js";
import { isEffectOpAliasesPopulated } from "../../compile/effect-op-aliases.js";
import { extractReactSourceTransitions } from "../../lang/ts/driver/react-source-transitions.js";

export type SharedReactTransitionCtx = Omit<
  ExtractCtx,
  "stateVars" | "writeChannels"
> & {
  stateVars?: readonly ExtractCtx["stateVars"][number][];
  writeChannels?: readonly WriteChannel[];
  asyncOutcomes?: Record<string, { success: Value; error?: Value }>;
  effectOpAliases?: EffectOpAliases;
  environment?: import("../../compile/environment-config.js").EnvironmentEventConfig;
  inventory?: import("../../engine/spi/index.js").RouteInventory;
  resetSymbols?: ReadonlySet<string>;
  setterFixedEffects?: ReadonlyMap<string, import("modality-ts/core").EffectIR>;
  resettableVarIds?: ReadonlySet<string>;
};

function reactSourceTransitionOptions(ctx: SharedReactTransitionCtx) {
  return {
    route: ctx.route,
    fileName: ctx.fileName,
    effectApis: ctx.effectApis,
    routePatterns: ctx.routePatterns,
    asyncOutcomes: ctx.asyncOutcomes,
    ...(isEffectOpAliasesPopulated(ctx.effectOpAliases)
      ? { effectOpAliases: ctx.effectOpAliases }
      : {}),
    statePlugins: ctx.statePlugins,
    ...(ctx.environment ? { environment: ctx.environment } : {}),
    ...(ctx.stateVars ? { stateVars: ctx.stateVars } : {}),
    ...(ctx.writeChannels ? { writeChannels: ctx.writeChannels } : {}),
    ...(ctx.routePlugin ? { routePlugin: ctx.routePlugin } : {}),
    ...(ctx.inventory ? { inventory: ctx.inventory } : {}),
    ...(ctx.resetSymbols ? { resetSymbols: ctx.resetSymbols } : {}),
    ...(ctx.setterFixedEffects
      ? { setterFixedEffects: ctx.setterFixedEffects }
      : {}),
    ...(ctx.resettableVarIds ? { resettableVarIds: ctx.resettableVarIds } : {}),
  };
}

export function extractSharedReactTransitions(
  ctx: SharedReactTransitionCtx,
): SourceExtractionResult {
  const { transitions, warnings } = extractReactSourceTransitions(
    ctx.sourceText,
    reactSourceTransitionOptions(ctx),
  );
  return { transitions, warnings };
}

export function extractSharedReactTransitionInventory(
  ctx: SharedReactTransitionCtx,
) {
  return extractReactSourceTransitions(
    ctx.sourceText,
    reactSourceTransitionOptions(ctx),
  );
}
