import type { StateVarDecl } from "modality-ts/core";
import type {
  RouterPlugin,
  StateSourcePlugin,
  WriteChannel,
} from "modality-ts/extract/engine/spi";
import { extractSharedReactTransitions } from "../shared/react-transition-extract.js";
import type { ExtractedModelSkeleton } from "../use-state/types.js";
import { discoverSwrHooks } from "./discover.js";
import { swrSource } from "./plugin.js";
import { templateForSwrDecl } from "./template.js";
import { discoverSwrReadChannels } from "./writes.js";

export interface SwrExtractionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  routePatterns?: readonly string[];
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  sourcePlugins?: readonly StateSourcePlugin[];
  routerPlugin?: RouterPlugin;
}

export function extractSwrSkeleton(
  sourceText: string,
  options: SwrExtractionOptions = {},
): ExtractedModelSkeleton {
  const fileName = options.fileName ?? "App.tsx";
  const route = options.route ?? "/";
  const decls = discoverSwrHooks(sourceText, fileName);
  const templateFragments = decls.map((decl) =>
    templateForSwrDecl(decl),
  );
  const vars = [
    ...decls
      .map((decl) => decl.var)
      .filter((decl): decl is StateVarDecl => Boolean(decl)),
    ...templateFragments.flatMap((fragment) => fragment.vars),
    ...(options.stateVars ?? []),
  ];
  const writeChannels = [
    ...discoverSwrReadChannels(sourceText, fileName),
    ...(options.writeChannels ?? []),
  ];
  const sourcePlugins = [swrSource(), ...(options.sourcePlugins ?? [])];
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
    transitions: [
      ...transitions,
      ...templateFragments.flatMap((fragment) => fragment.transitions),
    ],
    warnings: [...warnings],
  };
}
