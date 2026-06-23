import { isEffectOpAliasesPopulated } from "../../../compile/effect-op-aliases.js";
import { widenNumericDomainsFromTransitions } from "../../../compile/numeric/widening.js";
import { collectNumericSeedVarIds } from "../../../lang/ts/driver/numeric/use-state-updaters.js";
import { extractSharedReactTransitionInventory } from "../../shared/react-transition-extract.js";
import useStateSource from "./index.js";
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
    ...(isEffectOpAliasesPopulated(options.effectOpAliases)
      ? { effectOpAliases: options.effectOpAliases }
      : {}),
    statePlugins:
      options.statePlugins && options.statePlugins.length > 0
        ? options.statePlugins
        : [useStateSource()],
    ...(options.stateVars ? { stateVars: options.stateVars } : {}),
    ...(options.writeChannels ? { writeChannels: options.writeChannels } : {}),
    ...(options.routePlugin ? { routePlugin: options.routePlugin } : {}),
    ...(options.inventory ? { inventory: options.inventory } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
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
