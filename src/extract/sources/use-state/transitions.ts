import { extractSharedReactTransitionInventory } from "../shared/react-transition-extract.js";
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
  };
  const result = extractSharedReactTransitionInventory(ctx);
  return {
    vars: result.vars,
    transitions: result.transitions,
    warnings: result.warnings,
  };
}
