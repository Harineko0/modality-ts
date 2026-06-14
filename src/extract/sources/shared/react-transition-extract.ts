import { extractReactSourceTransitions } from "../../engine/ts/react-source-transitions.js";
import type { Value } from "modality-ts/core";
import type {
  ExtractCtx,
  SourceExtractionResult,
  WriteChannel,
} from "../../engine/spi/index.js";

export type SharedReactTransitionCtx = Omit<
  ExtractCtx,
  "stateVars" | "writeChannels"
> & {
  stateVars?: readonly ExtractCtx["stateVars"][number][];
  writeChannels?: readonly WriteChannel[];
  asyncOutcomes?: Record<string, { success: Value; error?: Value }>;
};

function reactSourceTransitionOptions(
  ctx: SharedReactTransitionCtx,
) {
  return {
    route: ctx.route,
    fileName: ctx.fileName,
    effectApis: ctx.effectApis,
    routePatterns: ctx.routePatterns,
    asyncOutcomes: ctx.asyncOutcomes,
    sourcePlugins: ctx.sourcePlugins,
    ...(ctx.stateVars ? { stateVars: ctx.stateVars } : {}),
    ...(ctx.writeChannels ? { writeChannels: ctx.writeChannels } : {}),
    ...(ctx.routerPlugin ? { routerPlugin: ctx.routerPlugin } : {}),
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
