import type { StateVarDecl } from "modality-ts/core";
import type {
  RoutePlugin,
  StateSourcePlugin,
  WriteChannel,
} from "modality-ts/extract/engine/spi";
import { extractSharedReactTransitions } from "../shared/react-transition-extract.js";
import type { ExtractedModelSkeleton } from "../use-state/types.js";
import { discoverJotaiAtomsDetailed } from "./discover.js";
import { jotaiSource } from "./plugin.js";
import {
  discoverJotaiSafetyWarnings,
  discoverJotaiWriteChannels,
  discoverJotaiWritesDetailed,
  jotaiResetSymbols,
} from "./writes.js";

export interface JotaiExtractionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  routePatterns?: readonly string[];
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  statePlugins?: readonly StateSourcePlugin[];
  routePlugin?: RoutePlugin;
}

export function extractJotaiSkeleton(
  sourceText: string,
  options: JotaiExtractionOptions = {},
): ExtractedModelSkeleton {
  const fileName = options.fileName ?? "App.tsx";
  const route = options.route ?? "/";
  const discovery = discoverJotaiAtomsDetailed(sourceText, fileName);
  const writeDiscovery = discoverJotaiWritesDetailed(sourceText, fileName);
  const vars = [
    ...discovery.decls
      .map((decl) => decl.var)
      .filter((decl): decl is StateVarDecl => Boolean(decl)),
    ...writeDiscovery.storeScopedDecls
      .map((decl) => decl.var)
      .filter((decl): decl is StateVarDecl => Boolean(decl)),
    ...(options.stateVars ?? []),
  ];
  const writeChannels = [
    ...discoverJotaiWriteChannels(sourceText, fileName),
    ...(options.writeChannels ?? []),
  ];
  const statePlugins = [jotaiSource(), ...(options.statePlugins ?? [])];
  const safetyWarnings = discoverJotaiSafetyWarnings(sourceText, fileName);
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
    resetSymbols: jotaiResetSymbols(sourceText, fileName),
    setterFixedEffects: writeDiscovery.setterFixedEffects,
    resettableVarIds: writeDiscovery.resettableVarIds,
    ...(options.routePlugin ? { routePlugin: options.routePlugin } : {}),
  });
  return {
    vars,
    transitions: [...transitions],
    warnings: [...safetyWarnings, ...discoveryWarnings, ...warnings],
  };
}
