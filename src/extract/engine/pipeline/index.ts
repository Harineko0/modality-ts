import type {
  Model,
  PluginProvenance,
  StateVarDecl,
  TemplateFragment,
  Transition,
  Bounds,
} from "modality-ts/core";
import { resolve } from "node:path";
import type {
  StateSourcePlugin,
  RouterPlugin,
  WriteChannel,
  RouteInventory,
  LocationLowering,
  SemanticTypeContext,
  DomainRefinementProvider,
} from "../spi/index.js";
import { extractReactSourceTransitions } from "../ts/react-source-transitions.js";
import { globalTaintCaveat } from "../ts/caveats.js";
import type { ExtractionWarning } from "../ts/types.js";
import { typeAliasDeclarations } from "../ts/domains.js";
import { widenNumericDomainsFromTransitions } from "../ts/numeric/use-state-updaters.js";
import { synthesizeRedirectTransitions } from "./redirects.js";
import type { SemanticProject } from "../ts/semantic-project.js";
import * as ts from "typescript";

export interface HandlerExtractionResult {
  transitions: readonly Transition[];
  warnings: readonly ExtractionWarning[];
}

export interface HandlerExtractorOptions {
  route: string;
  fileName: string;
  routePatterns: readonly string[];
  effectApis: readonly string[];
  stateVars: readonly StateVarDecl[];
  writeChannels: readonly WriteChannel[];
  sourcePlugins: readonly StateSourcePlugin[];
  routerPlugin?: RouterPlugin;
}

export interface ExtractionPipelineOptions {
  sourceText: string;
  fileName: string;
  route: string;
  routePatterns?: readonly string[];
  effectApis?: readonly string[];
  environment?: import("../ts/environment-config.js").EnvironmentEventConfig;
  sourcePlugins?: readonly StateSourcePlugin[];
  routerPlugin?: RouterPlugin;
  domainRefinements?: readonly DomainRefinementProvider[];
  inventory?: RouteInventory;
  lowering?: LocationLowering;
  discoverFragments?: readonly { sourceText: string; fileName: string }[];
  bounds?: Pick<Bounds, "maxDepth">;
  semanticProject?: SemanticProject;
}

export interface ExtractionPipelineResult {
  model?: Model;
  transitions: readonly Transition[];
  warnings: readonly ExtractionWarning[];
  stateVars: readonly StateVarDecl[];
  templateFragments: readonly TemplateFragment[];
  routeVars: readonly StateVarDecl[];
  writeChannels: readonly WriteChannel[];
  plugins: {
    sources: readonly PluginProvenance[];
    router?: PluginProvenance;
    domainRefinements?: readonly PluginProvenance[];
  };
}

export interface PipelinePhase {
  id: "P0" | "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7";
  name: string;
}

export const extractionPipelinePhases: readonly PipelinePhase[] = [
  { id: "P0", name: "project-load" },
  { id: "P1", name: "state-inventory" },
  { id: "P2", name: "domain-inference" },
  { id: "P3", name: "handler-discovery" },
  { id: "P4", name: "effect-summarization" },
  { id: "P5", name: "escape-analysis" },
  { id: "P6", name: "overlay-merge" },
  { id: "P7", name: "emit-artifacts" },
];

export function createPluginRegistry(
  sourcePlugins: readonly StateSourcePlugin[] = [],
  routerPlugin?: RouterPlugin,
  domainRefinementProviders: readonly DomainRefinementProvider[] = [],
): ExtractionPipelineResult["plugins"] {
  validateUniquePlugins(sourcePlugins);
  validateUniqueDomainRefinementProviders(domainRefinementProviders);
  return {
    sources: sourcePlugins
      .map((plugin) => provenanceForSource(plugin))
      .sort(comparePluginProvenance),
    ...(routerPlugin ? { router: provenanceForRouter(routerPlugin) } : {}),
    ...(domainRefinementProviders.length > 0
      ? {
          domainRefinements: domainRefinementProviders
            .map((provider) => provenanceForDomainRefinement(provider))
            .sort(comparePluginProvenance),
        }
      : {}),
  };
}

export function runExtractionPipeline(
  options: ExtractionPipelineOptions,
): ExtractionPipelineResult {
  const sourcePlugins = options.sourcePlugins ?? [];
  const domainRefinements = options.domainRefinements ?? [];
  const plugins = createPluginRegistry(
    sourcePlugins,
    options.routerPlugin,
    domainRefinements,
  );
  const allDiscoveryFragments = options.discoverFragments ?? [
    { sourceText: options.sourceText, fileName: options.fileName },
  ];
  const relatedFragments = discoveryRelatedFragments(
    options,
    allDiscoveryFragments,
  );
  const discoveryFragments =
    allDiscoveryFragments.length > 0
      ? allDiscoveryFragments
      : [{ sourceText: options.sourceText, fileName: options.fileName }];
  const discoveries = discoveryFragments.flatMap((fragment) => {
    const types = semanticTypeContextForFile(
      options.semanticProject,
      fragment.fileName,
    );
    return sourcePlugins.map((plugin) => ({
      plugin,
      decls: plugin.discover({
        sourceText: fragment.sourceText,
        fileName: fragment.fileName,
        route: options.route,
        relatedFragments,
        ...(types ? { types } : {}),
        ...(domainRefinements.length > 0 ? { domainRefinements } : {}),
      }),
    }));
  });
  const stateVars = discoveries
    .flatMap((discovery) => discovery.decls)
    .map((decl) => decl.var)
    .filter((decl): decl is StateVarDecl => Boolean(decl))
    .filter(
      (decl, index, all) =>
        all.findIndex((candidate) => candidate.id === decl.id) === index,
    );
  const writeChannels = discoveryFragments
    .flatMap((fragment) => {
      const types = semanticTypeContextForFile(
        options.semanticProject,
        fragment.fileName,
      );
      return sourcePlugins.flatMap((plugin) =>
        plugin.writeChannels({
          sourceText: fragment.sourceText,
          fileName: fragment.fileName,
          ...(types ? { types } : {}),
          ...(domainRefinements.length > 0 ? { domainRefinements } : {}),
        }),
      );
    })
    .filter(
      (channel, index, all) =>
        all.findIndex((candidate) => candidate.id === channel.id) === index,
    );
  const pluginWarnings = discoveryFragments.flatMap((fragment) => {
    const types = semanticTypeContextForFile(
      options.semanticProject,
      fragment.fileName,
    );
    return sourcePlugins.flatMap(
      (plugin) =>
        plugin.safetyWarnings?.({
          sourceText: fragment.sourceText,
          fileName: fragment.fileName,
          ...(types ? { types } : {}),
          ...(domainRefinements.length > 0 ? { domainRefinements } : {}),
        }) ?? [],
    );
  });
  const templateFragments = discoveries.flatMap(({ plugin, decls }) =>
    decls.flatMap((decl) =>
      plugin.template ? [plugin.template(decl, { route: options.route })] : [],
    ),
  );
  const fragmentTypes = semanticTypeContextForFile(
    options.semanticProject,
    options.fileName,
  );
  const extractionCtx = {
    sourceText: options.sourceText,
    fileName: options.fileName,
    route: options.route,
    effectApis: options.effectApis ?? [],
    routePatterns: options.routePatterns ?? [],
    stateVars: [
      ...stateVars,
      ...templateFragments.flatMap((fragment) => fragment.vars),
    ],
    writeChannels,
    sourcePlugins,
    ...(options.routerPlugin ? { routerPlugin: options.routerPlugin } : {}),
    ...(options.inventory ? { inventory: options.inventory } : {}),
    ...(fragmentTypes ? { types: fragmentTypes } : {}),
    ...(domainRefinements.length > 0 ? { domainRefinements } : {}),
  };
  const supplementalTypeText = allDiscoveryFragments
    .map((fragment) => fragment.sourceText)
    .join("\n");
  const supplementalTypes = typeAliasDeclarations(
    ts.createSourceFile(
      "__types__.ts",
      supplementalTypeText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ),
  );
  const genericExtraction = extractReactSourceTransitions(options.sourceText, {
    route: options.route,
    fileName: options.fileName,
    effectApis: options.effectApis ?? [],
    routePatterns: options.routePatterns ?? [],
    stateVars: extractionCtx.stateVars,
    writeChannels,
    sourcePlugins,
    additionalTypeAliases: supplementalTypes,
    additionalComponentSources: allDiscoveryFragments
      .filter((fragment) => fragment.fileName !== options.fileName)
      .map((fragment) => fragment.sourceText),
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.routerPlugin ? { routerPlugin: options.routerPlugin } : {}),
    ...(options.inventory ? { inventory: options.inventory } : {}),
    ...(fragmentTypes ? { types: fragmentTypes } : {}),
    ...(domainRefinements.length > 0 ? { domainRefinements } : {}),
  });
  const sourceExtractions = sourcePlugins.map(
    (plugin) =>
      plugin.extract?.(extractionCtx) ?? { transitions: [], warnings: [] },
  );
  const extractedTransitions = sourceExtractions.flatMap(
    (result) => result.transitions,
  );
  const extractedWarnings = sourceExtractions.flatMap(
    (result) => result.warnings ?? [],
  );
  const transitions = [
    ...genericExtraction.transitions,
    ...extractedTransitions,
    ...templateFragments.flatMap((fragment) => fragment.transitions),
    ...(options.inventory
      ? synthesizeRedirectTransitions(options.inventory)
      : []),
  ];
  const pluginVarIds = new Set(stateVars.map((decl) => decl.id));
  const additionalVars = genericExtraction.vars.filter(
    (decl) =>
      decl.id.startsWith("router:actionData:") && !pluginVarIds.has(decl.id),
  );
  const routeVars =
    options.routerPlugin && options.inventory && options.lowering
      ? options.routerPlugin.locationVars(
          options.inventory,
          { route: options.route, bounds: { maxHistory: 4 } },
          options.lowering,
        )
      : [];
  const numericSeedVarIds = new Set(
    discoveries
      .flatMap((discovery) => discovery.decls)
      .filter((decl) => decl.metadata?.numericSeed === true)
      .map((decl) => decl.id),
  );
  const mergedStateVars = [...stateVars, ...additionalVars];
  const widenedStateVars = widenNumericDomainsFromTransitions({
    vars: mergedStateVars,
    transitions,
    maxDepth: options.bounds?.maxDepth ?? 12,
    numericSeedVarIds,
  });
  return {
    transitions,
    warnings: [
      ...extractedWarnings,
      ...genericExtraction.warnings,
      ...pluginWarnings.map((warning) => pluginSafetyWarning(warning)),
    ],
    stateVars: widenedStateVars,
    templateFragments,
    routeVars,
    writeChannels,
    plugins,
  };
}

function discoveryRelatedFragments(
  options: ExtractionPipelineOptions,
  discoveryFragments: readonly { sourceText: string; fileName: string }[],
): readonly { sourceText: string; fileName: string }[] {
  const byPath = new Map(
    discoveryFragments.map((fragment) => [
      resolve(fragment.fileName),
      fragment,
    ]),
  );
  if (options.semanticProject) {
    for (const [fileName, sourceFile] of options.semanticProject.sourceFiles) {
      const key = resolve(fileName);
      if (!byPath.has(key)) {
        byPath.set(key, { sourceText: sourceFile.text, fileName });
      }
    }
  }
  return [...byPath.values()];
}

function semanticTypeContextForFile(
  semanticProject: SemanticProject | undefined,
  fileName: string,
): SemanticTypeContext | undefined {
  if (!semanticProject) return undefined;
  const sourceFile = semanticProject.getSourceFile(fileName);
  return {
    program: semanticProject.program,
    checker: semanticProject.checker,
    ...(sourceFile ? { sourceFile } : {}),
    getSourceFile: (name) => semanticProject.getSourceFile(name),
  };
}

function provenanceForSource(plugin: StateSourcePlugin): PluginProvenance {
  return {
    id: plugin.id,
    version: plugin.version ?? "unknown",
    kind: "state-source",
    packageNames: [...plugin.packageNames].sort(),
  };
}

function provenanceForDomainRefinement(
  provider: DomainRefinementProvider,
): PluginProvenance {
  return {
    id: provider.id,
    version: provider.version ?? "unknown",
    kind: "domain-refinement",
    packageNames: [...provider.packageNames].sort(),
  };
}

function provenanceForRouter(plugin: RouterPlugin): PluginProvenance {
  return {
    id: plugin.id,
    version: plugin.version ?? "unknown",
    kind: "router",
    packageNames: [...plugin.packageNames].sort(),
  };
}

function comparePluginProvenance(
  left: PluginProvenance,
  right: PluginProvenance,
): number {
  return left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind);
}

function pluginSafetyWarning(warning: {
  message: string;
  source?: import("modality-ts/core").SourceAnchor;
}): ExtractionWarning {
  const globalTaintPrefix = "Global taint ";
  if (warning.message.startsWith(globalTaintPrefix)) {
    const id = warning.message.slice(globalTaintPrefix.length);
    const caveat = globalTaintCaveat(id, warning.source);
    return {
      message: warning.message,
      ...(warning.source?.line !== undefined
        ? { line: warning.source.line }
        : {}),
      ...(warning.source?.column !== undefined
        ? { column: warning.source.column }
        : {}),
      caveat,
    };
  }
  return {
    message: warning.message,
    ...(warning.source?.line !== undefined
      ? { line: warning.source.line }
      : {}),
    ...(warning.source?.column !== undefined
      ? { column: warning.source.column }
      : {}),
  };
}

function validateUniqueDomainRefinementProviders(
  providers: readonly DomainRefinementProvider[],
): void {
  const seen = new Set<string>();
  for (const provider of providers) {
    if (seen.has(provider.id))
      throw new Error(`Duplicate domain refinement provider ${provider.id}`);
    seen.add(provider.id);
  }
}

function validateUniquePlugins(
  sourcePlugins: readonly StateSourcePlugin[],
): void {
  const seen = new Set<string>();
  for (const plugin of sourcePlugins) {
    if (seen.has(plugin.id))
      throw new Error(`Duplicate extraction source plugin ${plugin.id}`);
    seen.add(plugin.id);
  }
}
