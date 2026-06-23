import { resolve } from "node:path";
import type {
  Bounds,
  Model,
  PluginProvenance,
  StateVarDecl,
  TemplateFragment,
  Transition,
} from "modality-ts/core";
import type { LanguageProject } from "../../lang/project.js";
import type { SemanticTypeContext } from "../../lang/type-context.js";
import type {
  EffectPlugin,
  FrameworkPlugin,
  LocationLowering,
  RouteInventory,
  RoutePlugin,
  SourceDecl,
  StateSourcePlugin,
  TypePlugin,
  WriteChannel,
} from "../spi/index.js";
import {
  type EffectOpAliases,
  isEffectOpAliasesPopulated,
} from "../../compile/effect-op-aliases.js";
import { widenNumericDomainsFromTransitions } from "../../compile/numeric/widening.js";
import type { ExtractionWarning } from "../spi/index.js";
import { synthesizeRedirectTransitions } from "./redirects.js";
import {
  type ExtractionProjectSummary,
  runSourceExtraction,
} from "./source-extraction.js";

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
  statePlugins: readonly StateSourcePlugin[];
  routePlugin?: RoutePlugin;
}

export interface SharedPluginDiscovery {
  stateVars: readonly StateVarDecl[];
  writeChannels: readonly WriteChannel[];
  pluginWarnings: readonly ExtractionWarning[];
  templateFragments: readonly TemplateFragment[];
  numericSeedVarIds: ReadonlySet<string>;
}

export interface ExtractionPipelineOptions {
  sourceText: string;
  fileName: string;
  route: string;
  routePatterns?: readonly string[];
  effectApis?: readonly string[];
  environment?: import("../../compile/environment-config.js").EnvironmentEventConfig;
  statePlugins?: readonly StateSourcePlugin[];
  routePlugin?: RoutePlugin;
  framework?: FrameworkPlugin;
  effectPlugins?: readonly EffectPlugin[];
  typePlugins?: readonly TypePlugin[];
  inventory?: RouteInventory;
  lowering?: LocationLowering;
  discoverFragments?: readonly { sourceText: string; fileName: string }[];
  bounds?: Pick<Bounds, "maxDepth">;
  semanticProject?: LanguageProject;
  effectOpAliases?: EffectOpAliases;
  sharedDiscovery?: SharedPluginDiscovery;
  projectSummary?: ExtractionProjectSummary;
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
    typePlugins?: readonly PluginProvenance[];
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
  statePlugins: readonly StateSourcePlugin[] = [],
  routePlugin?: RoutePlugin,
  typePlugins: readonly TypePlugin[] = [],
): ExtractionPipelineResult["plugins"] {
  validateUniquePlugins(statePlugins);
  validateUniqueTypePlugins(typePlugins);
  return {
    sources: statePlugins
      .map((plugin) => provenanceForSource(plugin))
      .sort(comparePluginProvenance),
    ...(routePlugin ? { router: provenanceForRouter(routePlugin) } : {}),
    ...(typePlugins.length > 0
      ? {
          typePlugins: typePlugins
            .map((provider) => provenanceForDomainRefinement(provider))
            .sort(comparePluginProvenance),
        }
      : {}),
  };
}

export function runPluginDiscoveryPhase(
  options: ExtractionPipelineOptions,
): SharedPluginDiscovery {
  const statePlugins = options.statePlugins ?? [];
  const typePlugins = options.typePlugins ?? [];
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
  const rawDiscoveries = discoveryFragments.flatMap((fragment) => {
    const types = semanticTypeContextForFile(
      options.semanticProject,
      fragment.fileName,
    );
    return statePlugins.map((plugin) => ({
      plugin,
      decls: plugin.discover({
        sourceText: fragment.sourceText,
        fileName: fragment.fileName,
        route: options.route,
        relatedFragments,
        ...(types ? { types } : {}),
        ...(typePlugins.length > 0 ? { typePlugins } : {}),
      }),
    }));
  });
  const discoveries = dedupeDiscoveries(rawDiscoveries);
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
      return statePlugins.flatMap((plugin) =>
        plugin.writeChannels({
          sourceText: fragment.sourceText,
          fileName: fragment.fileName,
          relatedFragments,
          ...(types ? { types } : {}),
          ...(typePlugins.length > 0 ? { typePlugins } : {}),
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
    return statePlugins.flatMap(
      (plugin) =>
        plugin.safetyWarnings?.({
          sourceText: fragment.sourceText,
          fileName: fragment.fileName,
          ...(types ? { types } : {}),
          ...(typePlugins.length > 0 ? { typePlugins } : {}),
        }) ?? [],
    );
  });
  const templateFragments = discoveries.flatMap(({ plugin, decls }) =>
    decls.flatMap((decl) =>
      plugin.template ? [plugin.template(decl, { route: options.route })] : [],
    ),
  );
  const numericSeedVarIds = new Set(
    rawDiscoveries
      .flatMap((discovery) => discovery.decls)
      .filter((decl) => decl.metadata?.numericSeed === true)
      .map((decl) => decl.id),
  );
  return {
    stateVars,
    writeChannels,
    pluginWarnings,
    templateFragments,
    numericSeedVarIds,
  };
}

export function runExtractionPipeline(
  options: ExtractionPipelineOptions,
): ExtractionPipelineResult {
  const statePlugins = options.statePlugins ?? [];
  const typePlugins = options.typePlugins ?? [];
  const plugins = createPluginRegistry(
    statePlugins,
    options.routePlugin,
    typePlugins,
  );
  const allDiscoveryFragments = options.discoverFragments ?? [
    { sourceText: options.sourceText, fileName: options.fileName },
  ];
  const relatedFragments = discoveryRelatedFragments(
    options,
    allDiscoveryFragments,
  );
  const sharedDiscovery =
    options.sharedDiscovery ??
    runPluginDiscoveryPhase({
      ...options,
      discoverFragments: allDiscoveryFragments,
    });
  const stateVars = sharedDiscovery.stateVars;
  const writeChannels = sharedDiscovery.writeChannels;
  const pluginWarnings = sharedDiscovery.pluginWarnings;
  const templateFragments = sharedDiscovery.templateFragments;
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
    statePlugins,
    ...(options.routePlugin ? { routePlugin: options.routePlugin } : {}),
    ...(options.inventory ? { inventory: options.inventory } : {}),
    ...(fragmentTypes ? { types: fragmentTypes } : {}),
    ...(typePlugins.length > 0 ? { typePlugins } : {}),
  };
  const genericExtraction = runSourceExtraction(options.sourceText, {
    route: options.route,
    fileName: options.fileName,
    effectApis: options.effectApis ?? [],
    routePatterns: options.routePatterns ?? [],
    stateVars: extractionCtx.stateVars,
    writeChannels,
    statePlugins,
    framework: options.framework,
    ...(options.effectPlugins ? { effectPlugins: options.effectPlugins } : {}),
    relatedFragments,
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.routePlugin ? { routePlugin: options.routePlugin } : {}),
    ...(options.inventory ? { inventory: options.inventory } : {}),
    ...(fragmentTypes ? { types: fragmentTypes } : {}),
    ...(typePlugins.length > 0 ? { typePlugins } : {}),
    ...(isEffectOpAliasesPopulated(options.effectOpAliases)
      ? { effectOpAliases: options.effectOpAliases }
      : {}),
    ...(options.projectSummary
      ? { projectSummary: options.projectSummary }
      : {}),
  });
  const sourceExtractions = statePlugins.map(
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
    options.routePlugin && options.inventory && options.lowering
      ? options.routePlugin.locationVars(
          options.inventory,
          { route: options.route, bounds: { maxHistory: 4 } },
          options.lowering,
        )
      : [];
  const numericSeedVarIds = sharedDiscovery.numericSeedVarIds;
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
      ...pluginWarnings,
    ],
    stateVars: widenedStateVars,
    templateFragments,
    routeVars,
    writeChannels,
    plugins,
  };
}

export function discoveryRelatedFragments(
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

export function semanticTypeContextForFile(
  semanticProject: LanguageProject | undefined,
  fileName: string,
): SemanticTypeContext | undefined {
  return semanticProject?.typeContextForFile?.(fileName);
}

function provenanceForSource(plugin: StateSourcePlugin): PluginProvenance {
  return {
    id: plugin.id,
    version: plugin.version ?? "unknown",
    kind: "state-source",
    packageNames: [...plugin.packageNames].sort(),
  };
}

function provenanceForDomainRefinement(provider: TypePlugin): PluginProvenance {
  return {
    id: provider.id,
    version: provider.version ?? "unknown",
    kind: "type",
    packageNames: [...provider.packageNames].sort(),
  };
}

function provenanceForRouter(plugin: RoutePlugin): PluginProvenance {
  return {
    id: plugin.id,
    version: plugin.version ?? "unknown",
    kind: "route",
    packageNames: [...plugin.packageNames].sort(),
  };
}

function comparePluginProvenance(
  left: PluginProvenance,
  right: PluginProvenance,
): number {
  return left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id);
}

function validateUniqueTypePlugins(providers: readonly TypePlugin[]): void {
  const seen = new Set<string>();
  for (const provider of providers) {
    if (seen.has(provider.id))
      throw new Error(`Duplicate domain refinement provider ${provider.id}`);
    seen.add(provider.id);
  }
}

function validateUniquePlugins(
  statePlugins: readonly StateSourcePlugin[],
): void {
  const seen = new Set<string>();
  for (const plugin of statePlugins) {
    if (seen.has(plugin.id))
      throw new Error(`Duplicate extraction source plugin ${plugin.id}`);
    seen.add(plugin.id);
  }
}

function dedupeDiscoveries(
  discoveries: readonly {
    plugin: StateSourcePlugin;
    decls: readonly SourceDecl[];
  }[],
): { plugin: StateSourcePlugin; decls: SourceDecl[] }[] {
  const seen = new Set<string>();
  return discoveries.map((discovery) => ({
    plugin: discovery.plugin,
    decls: discovery.decls.filter((decl) => {
      const key = `${discovery.plugin.id}:${decl.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  }));
}
