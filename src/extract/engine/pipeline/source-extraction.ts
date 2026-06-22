import type { StateVarDecl, Transition } from "modality-ts/core";
import type {
  DomainRefinementProvider,
  EffectModelProvider,
  FrameworkPlugin,
  HandlerWrapperProvider,
  NavigationAdapter,
  RouteInventory,
  SemanticTypeContext,
  StateSourcePlugin,
  WriteChannel,
} from "../spi/index.js";
import { resolveFrameworkPlugin } from "../spi/index.js";
import type { EffectOpAliases } from "../ts/effect-op-aliases.js";
import type { EnvironmentEventConfig } from "../ts/environment-config.js";
import type { ExtractionWarning } from "../ts/types.js";

export interface ExtractionProjectSummary {
  readonly canonicalFileNames: readonly string[];
}

export interface SourceExtractionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  routePatterns?: readonly string[];
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  sourcePlugins?: readonly StateSourcePlugin[];
  handlerWrapperProviders?: readonly HandlerWrapperProvider[];
  environment?: EnvironmentEventConfig;
  routerPlugin?: NavigationAdapter;
  inventory?: RouteInventory;
  resetSymbols?: ReadonlySet<string>;
  relatedFragments?: readonly { sourceText: string; fileName: string }[];
  types?: SemanticTypeContext;
  domainRefinements?: readonly DomainRefinementProvider[];
  projectSummary?: ExtractionProjectSummary;
  framework?: FrameworkPlugin;
  effectModelProviders?: readonly EffectModelProvider[];
  effectOpAliases?: EffectOpAliases;
}

export interface SourceExtractionResult {
  vars: StateVarDecl[];
  transitions: Transition[];
  warnings: ExtractionWarning[];
}

export type SourceExtractor = (
  sourceText: string,
  options: SourceExtractionOptions,
) => SourceExtractionResult;

const sourceExtractors = new Map<string, SourceExtractor>();

export function registerSourceExtractor(
  frameworkId: string,
  extractor: SourceExtractor,
): void {
  sourceExtractors.set(frameworkId, extractor);
}

export function runSourceExtraction(
  sourceText: string,
  options: SourceExtractionOptions = {},
): SourceExtractionResult {
  const framework = resolveFrameworkPlugin(options.framework);
  const extractor = sourceExtractors.get(framework.id);
  if (!extractor) {
    throw new Error(
      `No source extractor registered for framework ${framework.id}`,
    );
  }
  return extractor(sourceText, { ...options, framework });
}
