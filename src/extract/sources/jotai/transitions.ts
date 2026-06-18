import type { StateVarDecl } from "modality-ts/core";
import type {
  NavigationAdapter,
  StateSourcePlugin,
  WriteChannel,
} from "modality-ts/extract/engine/spi";
import { extractSharedReactTransitions } from "../shared/react-transition-extract.js";
import type { ExtractedModelSkeleton } from "../use-state/types.js";
import { discoverJotaiAtomsDetailed } from "./discover.js";
import {
  discoverJotaiSafetyWarnings,
  discoverJotaiWriteChannels,
  discoverJotaiWritesDetailed,
  jotaiResetSymbols,
} from "./writes.js";
import { jotaiSource } from "./plugin.js";

export interface JotaiExtractionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  routePatterns?: readonly string[];
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  sourcePlugins?: readonly StateSourcePlugin[];
  routerPlugin?: NavigationAdapter;
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
  const sourcePlugins = [jotaiSource(), ...(options.sourcePlugins ?? [])];
  const safetyWarnings = discoverJotaiSafetyWarnings(sourceText, fileName);
  const discoveryWarnings = discovery.warnings.map((warning) => ({
    message: warning.message,
    ...(warning.source ? { line: warning.source.line } : {}),
  }));
  const { transitions, warnings = [] } = extractSharedReactTransitions({
    sourceText,
    fileName,
    route,
    effectApis: options.effectApis ?? [],
    routePatterns: options.routePatterns ?? [],
    stateVars: vars,
    ...(writeChannels.length > 0 ? { writeChannels } : {}),
    sourcePlugins,
    resetSymbols: jotaiResetSymbols(sourceText, fileName),
    setterFixedEffects: writeDiscovery.setterFixedEffects,
    resettableVarIds: writeDiscovery.resettableVarIds,
    ...(options.routerPlugin ? { routerPlugin: options.routerPlugin } : {}),
  });
  return {
    vars,
    transitions: [...transitions],
    warnings: [...safetyWarnings, ...discoveryWarnings, ...warnings],
  };
}
