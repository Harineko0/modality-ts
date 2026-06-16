import type {
  Model,
  PluginProvenance,
  StateVarDecl,
  TemplateFragment,
  Transition,
} from "modality-ts/core";
import type {
  StateSourcePlugin,
  RouterPlugin,
  WriteChannel,
  RouteInventory,
  LocationLowering,
} from "../spi/index.js";
import { extractReactSourceTransitions } from "../ts/react-source-transitions.js";
import { globalTaintCaveat } from "../ts/caveats.js";
import type { ExtractionWarning } from "../ts/types.js";
import { typeAliasDeclarations } from "../ts/domains.js";
import { synthesizeRedirectTransitions } from "./redirects.js";
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
  inventory?: RouteInventory;
  lowering?: LocationLowering;
  discoverFragments?: readonly { sourceText: string; fileName: string }[];
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
): ExtractionPipelineResult["plugins"] {
  validateUniquePlugins(sourcePlugins);
  return {
    sources: sourcePlugins
      .map((plugin) => provenanceForSource(plugin))
      .sort(comparePluginProvenance),
    ...(routerPlugin ? { router: provenanceForRouter(routerPlugin) } : {}),
  };
}

export function runExtractionPipeline(
  options: ExtractionPipelineOptions,
): ExtractionPipelineResult {
  const sourcePlugins = options.sourcePlugins ?? [];
  const plugins = createPluginRegistry(sourcePlugins, options.routerPlugin);
  const discoveryFragments = options.discoverFragments ?? [
    { sourceText: options.sourceText, fileName: options.fileName },
  ];
  const mergedDiscoveryFragment = {
    sourceText: discoveryFragments
      .map((fragment) => fragment.sourceText)
      .join("\n"),
    fileName: options.fileName,
  };
  const discoveryInputs =
    discoveryFragments.length > 1
      ? [mergedDiscoveryFragment]
      : discoveryFragments;
  const discoveries = discoveryInputs.flatMap((fragment) =>
    sourcePlugins.map((plugin) => ({
      plugin,
      decls: plugin.discover({
        sourceText: fragment.sourceText,
        fileName: fragment.fileName,
        route: options.route,
      }),
    })),
  );
  const stateVars = discoveries
    .flatMap((discovery) => discovery.decls)
    .map((decl) => decl.var)
    .filter((decl): decl is StateVarDecl => Boolean(decl))
    .filter(
      (decl, index, all) =>
        all.findIndex((candidate) => candidate.id === decl.id) === index,
    );
  const writeChannels = discoveryInputs
    .flatMap((fragment) =>
      sourcePlugins.flatMap((plugin) =>
        plugin.writeChannels({
          sourceText: fragment.sourceText,
          fileName: fragment.fileName,
        }),
      ),
    )
    .filter(
      (channel, index, all) =>
        all.findIndex((candidate) => candidate.id === channel.id) === index,
    );
  const pluginWarnings = discoveryInputs.flatMap((fragment) =>
    sourcePlugins.flatMap(
      (plugin) =>
        plugin.safetyWarnings?.({
          sourceText: fragment.sourceText,
          fileName: fragment.fileName,
        }) ?? [],
    ),
  );
  const templateFragments = discoveries.flatMap(({ plugin, decls }) =>
    decls.flatMap((decl) =>
      plugin.template ? [plugin.template(decl, { route: options.route })] : [],
    ),
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
  };
  const supplementalTypeText = discoveryInputs
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
    additionalComponentSources: discoveryFragments
      .filter((fragment) => fragment.fileName !== options.fileName)
      .map((fragment) => fragment.sourceText),
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.routerPlugin ? { routerPlugin: options.routerPlugin } : {}),
    ...(options.inventory ? { inventory: options.inventory } : {}),
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
  return {
    transitions,
    warnings: [
      ...extractedWarnings,
      ...genericExtraction.warnings,
      ...pluginWarnings.map((warning) => pluginSafetyWarning(warning)),
    ],
    stateVars: [...stateVars, ...additionalVars],
    templateFragments,
    routeVars,
    writeChannels,
    plugins,
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
