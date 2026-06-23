import type { StateVarDecl } from "modality-ts/core";
import type {
  RoutePlugin,
  StateSourcePlugin,
  WriteChannel,
} from "modality-ts/extract/engine/spi";
import { extractSharedReactTransitions } from "../../shared/react-transition-extract.js";
import type { ExtractedModelSkeleton } from "../use-state/types.js";
import { discoverTanstackQueryHooks } from "./discover.js";
import { tanstackQuerySource } from "./plugin.js";
import {
  createTanstackMutationTemplate,
  templateForTanstackQueryDecl,
} from "./template.js";
import { mutationMetadataFromRecord } from "./types.js";
import { discoverTanstackQueryWriteChannels } from "./writes.js";

export interface TanstackQueryExtractionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  routePatterns?: readonly string[];
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  statePlugins?: readonly StateSourcePlugin[];
  routePlugin?: RoutePlugin;
}

export function extractTanstackQuerySkeleton(
  sourceText: string,
  options: TanstackQueryExtractionOptions = {},
): ExtractedModelSkeleton {
  const fileName = options.fileName ?? "App.tsx";
  const route = options.route ?? "/";
  const decls = discoverTanstackQueryHooks(sourceText, fileName);
  const templateFragments = decls.map((decl) => {
    if (decl.kind === "tanstack-query/useMutation") {
      const metadata = mutationMetadataFromRecord(decl.metadata);
      if (!metadata) return { vars: [], transitions: [] };
      return createTanstackMutationTemplate(
        metadata.mutationId,
        metadata.payloadDomain,
        metadata.op,
        decl.origin !== "system" && decl.origin !== "library-template"
          ? decl.origin.file
          : undefined,
      );
    }
    return templateForTanstackQueryDecl(decl);
  });
  const vars = [
    ...decls
      .map((decl) => decl.var)
      .filter((decl): decl is StateVarDecl => Boolean(decl)),
    ...templateFragments.flatMap((fragment) => fragment.vars),
    ...(options.stateVars ?? []),
  ];
  const writeChannels = [
    ...discoverTanstackQueryWriteChannels(sourceText, fileName),
    ...(options.writeChannels ?? []),
  ];
  const statePlugins = [tanstackQuerySource(), ...(options.statePlugins ?? [])];
  const { transitions, warnings = [] } = extractSharedReactTransitions({
    sourceText,
    fileName,
    route,
    effectApis: options.effectApis ?? [],
    routePatterns: options.routePatterns ?? [],
    stateVars: vars,
    ...(writeChannels.length > 0 ? { writeChannels } : {}),
    statePlugins,
    ...(options.routePlugin ? { routePlugin: options.routePlugin } : {}),
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
