import type { StateVarDecl } from "modality-ts/core";
import type {
  RouterPlugin,
  StateSourcePlugin,
  WriteChannel,
} from "modality-ts/extract/engine/spi";
import { extractSharedReactTransitions } from "../shared/react-transition-extract.js";
import type { ExtractedModelSkeleton } from "../use-state/types.js";
import { discoverJotaiAtoms } from "./discover.js";
import {
  discoverJotaiSafetyWarnings,
  discoverJotaiWriteChannels,
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
  routerPlugin?: RouterPlugin;
}

export function extractJotaiSkeleton(
  sourceText: string,
  options: JotaiExtractionOptions = {},
): ExtractedModelSkeleton {
  const fileName = options.fileName ?? "App.tsx";
  const route = options.route ?? "/";
  const discovered = discoverJotaiAtoms(sourceText, fileName);
  const vars = [
    ...discovered
      .map((decl) => decl.var)
      .filter((decl): decl is StateVarDecl => Boolean(decl)),
    ...(options.stateVars ?? []),
  ];
  const writeChannels = [
    ...discoverJotaiWriteChannels(sourceText, fileName),
    ...(options.writeChannels ?? []),
  ];
  const sourcePlugins = [jotaiSource(), ...(options.sourcePlugins ?? [])];
  const safetyWarnings = discoverJotaiSafetyWarnings(sourceText, fileName).map(
    (warning) => ({
      message: warning.message,
      ...(warning.source ? { line: warning.source.line } : {}),
    }),
  );
  const { transitions, warnings = [] } = extractSharedReactTransitions({
    sourceText,
    fileName,
    route,
    effectApis: options.effectApis ?? [],
    routePatterns: options.routePatterns ?? [],
    stateVars: vars,
    ...(writeChannels.length > 0 ? { writeChannels } : {}),
    sourcePlugins,
    ...(options.routerPlugin ? { routerPlugin: options.routerPlugin } : {}),
  });
  return {
    vars,
    transitions: [...transitions],
    warnings: [...safetyWarnings, ...warnings],
  };
}
