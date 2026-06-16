import { extractSharedReactTransitionInventory } from "../shared/react-transition-extract.js";
import {
  collectNumericSeedVarIds,
  widenNumericDomainsFromTransitions,
} from "../../engine/ts/numeric/use-state-updaters.js";
import type {
  ExtractedModelSkeleton,
  UseStateExtractionOptions,
  UseStateExtractionResult,
} from "./types.js";

export function extractUseStateVars(
  sourceText: string,
  options: UseStateExtractionOptions = {},
): UseStateExtractionResult {
  return extractUseStateSkeleton(sourceText, options);
}

export function extractUseStateSkeleton(
  sourceText: string,
  options: UseStateExtractionOptions = {},
): ExtractedModelSkeleton {
  const fileName = options.fileName ?? "App.tsx";
  const route = options.route ?? "/";
  const ctx = {
    sourceText,
    fileName,
    route,
    effectApis: options.effectApis ?? [],
    routePatterns: options.routePatterns ?? [],
    asyncOutcomes: options.asyncOutcomes,
    sourcePlugins: options.sourcePlugins ?? [],
    ...(options.stateVars ? { stateVars: options.stateVars } : {}),
    ...(options.writeChannels ? { writeChannels: options.writeChannels } : {}),
    ...(options.routerPlugin ? { routerPlugin: options.routerPlugin } : {}),
    ...(options.inventory ? { inventory: options.inventory } : {}),
  };
  const result = extractSharedReactTransitionInventory(ctx);
  const widenedVars = widenNumericDomainsFromTransitions({
    vars: result.vars,
    transitions: result.transitions,
    maxDepth: options.bounds?.maxDepth ?? 12,
    numericSeedVarIds: collectNumericSeedVarIds(sourceText, fileName),
  });
  return {
    vars: widenedVars,
    transitions: result.transitions,
    warnings: result.warnings,
  };
}
