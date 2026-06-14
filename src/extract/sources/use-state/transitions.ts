import { extractReactSourceTransitions } from "../../engine/ts/react-source-transitions.js";
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
  return extractReactSourceTransitions(sourceText, {
    route,
    fileName,
    effectApis: options.effectApis,
    routePatterns: options.routePatterns,
    asyncOutcomes: options.asyncOutcomes,
    stateVars: options.stateVars,
    writeChannels: options.writeChannels,
    sourcePlugins: options.sourcePlugins,
    ...(options.routerPlugin ? { routerPlugin: options.routerPlugin } : {}),
  });
}
