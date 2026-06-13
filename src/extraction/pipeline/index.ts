import type { EffectIR, Model, PluginProvenance, StateVarDecl, TemplateFragment, Transition } from "modality-ts/kernel";
import type { StateSourcePlugin, RouterPlugin, WriteChannel } from "../spi/index.js";

export interface HandlerExtractionResult {
  transitions: readonly Transition[];
  warnings: readonly { message: string }[];
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
  sourcePlugins?: readonly StateSourcePlugin[];
  routerPlugin?: RouterPlugin;
  extractHandlers?: (sourceText: string, options: HandlerExtractorOptions) => HandlerExtractionResult;
}

export interface ExtractionPipelineResult {
  model?: Model;
  transitions: readonly Transition[];
  warnings: readonly string[];
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
  { id: "P7", name: "emit-artifacts" }
];

export function createPluginRegistry(sourcePlugins: readonly StateSourcePlugin[] = [], routerPlugin?: RouterPlugin): ExtractionPipelineResult["plugins"] {
  validateUniquePlugins(sourcePlugins);
  return {
    sources: sourcePlugins.map((plugin) => provenanceForSource(plugin)).sort(comparePluginProvenance),
    ...(routerPlugin ? { router: provenanceForRouter(routerPlugin) } : {})
  };
}

export function runExtractionPipeline(options: ExtractionPipelineOptions): ExtractionPipelineResult {
  const sourcePlugins = options.sourcePlugins ?? [];
  const plugins = createPluginRegistry(sourcePlugins, options.routerPlugin);
  const discoverCtx = { sourceText: options.sourceText, fileName: options.fileName, route: options.route };
  const discoveries = sourcePlugins.map((plugin) => ({
    plugin,
    decls: plugin.discover(discoverCtx)
  }));
  const stateVars = discoveries
    .flatMap((discovery) => discovery.decls)
    .map((decl) => decl.var)
    .filter((decl): decl is StateVarDecl => Boolean(decl));
  const writeChannels = sourcePlugins.flatMap((plugin) => plugin.writeChannels({
    sourceText: options.sourceText,
    fileName: options.fileName
  }));
  const pluginWarnings = sourcePlugins.flatMap((plugin) => plugin.safetyWarnings?.({
    sourceText: options.sourceText,
    fileName: options.fileName
  }) ?? []);
  const templateFragments = discoveries.flatMap(({ plugin, decls }) =>
    decls.flatMap((decl) => plugin.template ? [plugin.template(decl, { route: options.route })] : [])
  );
  const extracted = options.extractHandlers?.(options.sourceText, {
    route: options.route,
    fileName: options.fileName,
    effectApis: options.effectApis ?? [],
    routePatterns: options.routePatterns ?? [],
    stateVars: [...stateVars, ...templateFragments.flatMap((fragment) => fragment.vars)],
    writeChannels,
    sourcePlugins,
    ...(options.routerPlugin ? { routerPlugin: options.routerPlugin } : {})
  }) ?? { transitions: [], warnings: [] };
  const transitions = [...extracted.transitions, ...templateFragments.flatMap((fragment) => fragment.transitions)];
  const routes = [options.route, ...navigatedRoutes(transitions.map((transition) => transition.effect))];
  return {
    transitions,
    warnings: [...extracted.warnings.map((warning) => warning.message), ...pluginWarnings.map((warning) => warning.message)].sort(),
    stateVars,
    templateFragments,
    routeVars: options.routerPlugin?.routeVars(routes, { route: options.route }) ?? [],
    writeChannels,
    plugins
  };
}

function provenanceForSource(plugin: StateSourcePlugin): PluginProvenance {
  return {
    id: plugin.id,
    version: plugin.version ?? "unknown",
    kind: "state-source",
    packageNames: [...plugin.packageNames].sort()
  };
}

function provenanceForRouter(plugin: RouterPlugin): PluginProvenance {
  return {
    id: plugin.id,
    version: plugin.version ?? "unknown",
    kind: "router",
    packageNames: [...plugin.packageNames].sort()
  };
}

function comparePluginProvenance(left: PluginProvenance, right: PluginProvenance): number {
  return left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind);
}

function validateUniquePlugins(sourcePlugins: readonly StateSourcePlugin[]): void {
  const seen = new Set<string>();
  for (const plugin of sourcePlugins) {
    if (seen.has(plugin.id)) throw new Error(`Duplicate extraction source plugin ${plugin.id}`);
    seen.add(plugin.id);
  }
}

function navigatedRoutes(effects: readonly EffectIR[]): string[] {
  const routes = new Set<string>();
  const visit = (effect: EffectIR): void => {
    if (effect.kind === "navigate" && effect.to?.kind === "lit" && typeof effect.to.value === "string") {
      routes.add(effect.to.value);
    }
    if (effect.kind === "seq") effect.effects.forEach(visit);
    if (effect.kind === "if") {
      visit(effect.then);
      visit(effect.else);
    }
  };
  effects.forEach(visit);
  return [...routes].sort();
}
