import * as ts from "typescript";
import {
  bindEngineFrameworkFromPlugin,
  providerComponentNames,
  withEngineFramework,
} from "./ast.js";
import type { EffectOpAliases } from "./effect-op-aliases.js";
import type { StateVarDecl, Transition, Value } from "modality-ts/core";
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
import {
  buildComponentRegistry,
  buildCustomHookRegistry,
  componentRegistryDisplayMap,
  detectStatefulListComponents,
} from "./components.js";
import {
  bindSetter,
  type DiscoverContextBindingsOptions,
  decodeSetterBinding,
  discoverContextBindings,
} from "./context.js";
import { withStableTransitionIds } from "./ids.js";
import {
  componentRegistryForPrimary,
  customHookRegistryForPrimary,
  type ReactExtractionProjectSummary,
} from "./react-extraction-project-summary.js";
import { collectMutationAliases } from "./transition/callback-effects.js";
import {
  discoverComponentRenderBoundaries,
} from "./transition/suspense.js";
import { discoverReactSourceTransitions } from "./react-source-discovery.js";
import {
  cloneContextBindings,
  collectProjectTypeAliases,
  mergeContextBindings,
  relatedDiscoverySourceFiles,
  supplementalSourcesForRegistry,
} from "./react-source-project.js";
import { staticNavigationTransitions } from "./static-navigation.js";
import type { ExtractableHandler, ExtractionWarning, SetterBinding } from "./types.js";

export interface ReactSourceTransitionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  routePatterns?: readonly string[];
  asyncOutcomes?: Record<string, { success: Value; error?: Value }>;
  effectOpAliases?: EffectOpAliases;
  environment?: import("./environment-config.js").EnvironmentEventConfig;
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  sourcePlugins?: readonly StateSourcePlugin[];
  handlerWrapperProviders?: readonly HandlerWrapperProvider[];
  routerPlugin?: NavigationAdapter;
  inventory?: RouteInventory;
  resetSymbols?: ReadonlySet<string>;
  setterFixedEffects?: ReadonlyMap<string, import("modality-ts/core").EffectIR>;
  resettableVarIds?: ReadonlySet<string>;
  relatedFragments?: readonly { sourceText: string; fileName: string }[];
  types?: SemanticTypeContext;
  domainRefinements?: readonly DomainRefinementProvider[];
  projectSummary?: ReactExtractionProjectSummary;
  framework?: FrameworkPlugin;
  effectModelProviders?: readonly EffectModelProvider[];
}

export interface ReactSourceTransitionResult {
  vars: StateVarDecl[];
  transitions: Transition[];
  warnings: ExtractionWarning[];
}

export function extractReactSourceTransitions(
  sourceText: string,
  options: ReactSourceTransitionOptions = {},
): ReactSourceTransitionResult {
  const fileName = options.fileName ?? "App.tsx";
  const framework = resolveFrameworkPlugin(options.framework);
  const source =
    options.types?.sourceFile &&
    options.types.sourceFile.fileName === fileName &&
    options.types.sourceFile.text === sourceText
      ? options.types.sourceFile
      : ts.createSourceFile(
          fileName,
          sourceText,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );
  const engineFramework = bindEngineFrameworkFromPlugin(framework, {
    ...(options.types ? { types: options.types } : {}),
    sourceFile: source,
    fileName,
  });
  return withEngineFramework(engineFramework, () =>
    extractReactSourceTransitionsImpl(options, source, fileName),
  );
}

function extractReactSourceTransitionsImpl(
  options: ReactSourceTransitionOptions,
  source: ts.SourceFile,
  fileName: string,
): ReactSourceTransitionResult {
  const typeAliases = options.projectSummary
    ? new Map(options.projectSummary.typeAliases)
    : collectProjectTypeAliases(source, options);
  const vars: StateVarDecl[] = options.stateVars ? [...options.stateVars] : [];
  const transitions: Transition[] = [];
  const warnings: ExtractionWarning[] = [];
  const route = options.route ?? "/";
  const routePatterns = options.routePatterns ?? [];
  const baseEffectOpAliases = options.effectOpAliases ?? new Map();
  const effectApis = new Set(options.effectApis ?? []);
  const localMutationAliases = collectMutationAliases(
    source,
    fileName,
    effectApis,
    baseEffectOpAliases,
  );
  const effectOpAliases: ReadonlyMap<
    string,
    ReadonlyMap<string, string>
  > = localMutationAliases.size > 0
    ? (() => {
        const merged = new Map(baseEffectOpAliases);
        const existing = merged.get(fileName);
        merged.set(
          fileName,
          existing
            ? new Map([...existing, ...localMutationAliases])
            : localMutationAliases,
        );
        return merged;
      })()
    : baseEffectOpAliases;
  const sourcePlugins = options.sourcePlugins ?? [];
  const handlerWrapperProviders = options.handlerWrapperProviders ?? [];
  const routerPlugin = options.routerPlugin;
  const inventory = options.inventory;
  const setters = new Map<string, SetterBinding>();
  const contextBindingOptions: DiscoverContextBindingsOptions = {
    ...(options.stateVars ? { stateVars: options.stateVars } : {}),
    ...(options.writeChannels ? { writeChannels: options.writeChannels } : {}),
    sourcePlugins,
    route,
    ...(options.types ? { types: options.types } : {}),
  };
  const contextBindings = options.projectSummary
    ? cloneContextBindings(options.projectSummary.contextBindings)
    : discoverContextBindings(
        source,
        fileName,
        route,
        typeAliases,
        contextBindingOptions,
      );
  if (!options.projectSummary) {
    for (const relatedSource of relatedDiscoverySourceFiles(source, options)) {
      mergeContextBindings(
        contextBindings,
        discoverContextBindings(
          relatedSource,
          relatedSource.fileName,
          route,
          typeAliases,
          contextBindingOptions,
        ),
      );
    }
  }
  const globalTaints = new Set<string>();
  const transitionBindings = new Map();
  const submitBindings = new Map<string, boolean>();
  const modeledSubmitHandlers = new Set<string>();
  const actionDataVarByComponent = new Map<string, string>();
  const relatedSourceFiles = options.projectSummary
    ? options.projectSummary.relatedSourceFiles
    : relatedDiscoverySourceFiles(source, options);
  const supplementalSources = supplementalSourcesForRegistry(
    options.relatedFragments ?? [],
    fileName,
    options.types,
  );
  const components = options.projectSummary
    ? componentRegistryForPrimary(options.projectSummary, source, options.types)
    : buildComponentRegistry(source, {
        ...(options.types ? { types: options.types } : {}),
        primaryFileName: fileName,
        relatedSourceFiles,
        ...(supplementalSources.length > 0 ? { supplementalSources } : {}),
      });
  const componentDisplayMap = componentRegistryDisplayMap(components);
  const customHooks = options.projectSummary
    ? customHookRegistryForPrimary(
        options.projectSummary,
        source,
        options.types,
      )
    : buildCustomHookRegistry(source, {
        ...(options.types ? { types: options.types } : {}),
        primaryFileName: fileName,
        relatedSourceFiles,
        ...(supplementalSources.length > 0 ? { supplementalSources } : {}),
      });
  const statefulListComponents = detectStatefulListComponents(
    source,
    components,
    options.types,
  );
  const reportedStatefulListComponents = new Set<string>();
  const providerComponents = providerComponentNames(source);
  const reportedCustomHooks = new Set<string>();
  for (const decl of contextBindings.vars) {
    if (!vars.some((candidate) => candidate.id === decl.id)) vars.push(decl);
  }
  const resetSymbols = options.resetSymbols ?? new Set<string>(["RESET"]);
  for (const channel of options.writeChannels ?? []) {
    const decl = vars.find((candidate) => candidate.id === channel.varId);
    if (!decl) continue;
    const binding = decodeSetterBinding(decl, sourcePlugins);
    if (
      channel.id.endsWith(".reset") ||
      options.resettableVarIds?.has(channel.varId)
    ) {
      binding.resettable = true;
    }
    const fixedEffect = options.setterFixedEffects?.get(channel.symbolName);
    if (fixedEffect) binding.fixedEffect = fixedEffect;
    if (channel.symbolKey) binding.symbolKey = channel.symbolKey;
    bindSetter(setters, channel.symbolName, binding);
  }
  for (const [symbolName, setter] of contextBindings.setters)
    setters.set(symbolName, setter);
  const handlers = new Map<string, ExtractableHandler>();
  const renderBoundaries = discoverComponentRenderBoundaries(
    source,
    componentDisplayMap,
  );
  discoverReactSourceTransitions({
    options: {
      ...(options.stateVars ? { stateVars: options.stateVars } : {}),
      ...(options.writeChannels ? { writeChannels: options.writeChannels } : {}),
      ...(options.types ? { types: options.types } : {}),
      ...(options.domainRefinements
        ? { domainRefinements: options.domainRefinements }
        : {}),
      ...(options.asyncOutcomes ? { asyncOutcomes: options.asyncOutcomes } : {}),
      ...(options.effectModelProviders
        ? { effectModelProviders: options.effectModelProviders }
        : {}),
      ...(options.environment ? { environment: options.environment } : {}),
      ...(options.setterFixedEffects
        ? { setterFixedEffects: options.setterFixedEffects }
        : {}),
      ...(options.resettableVarIds
        ? { resettableVarIds: options.resettableVarIds }
        : {}),
    },
    source,
    fileName,
    route,
    routePatterns,
    typeAliases,
    vars,
    transitions,
    warnings,
    effectApis,
    effectOpAliases,
    sourcePlugins,
    handlerWrapperProviders,
    routerPlugin,
    inventory,
    setters,
    contextBindings,
    globalTaints,
    timerCounter: 0,
    webSocketCounter: 0,
    transitionBindingCounter: 0,
    suspenseBoundaryCounter: 0,
    transitionBindings,
    submitBindings,
    modeledSubmitHandlers,
    actionDataVarByComponent,
    components,
    componentDisplayMap,
    customHooks,
    statefulListComponents,
    reportedStatefulListComponents,
    providerComponents,
    reportedCustomHooks,
    resetSymbols,
    handlers,
    renderBoundaries,
  });
  transitions.push(
    ...staticNavigationTransitions(
      source,
      fileName,
      routePatterns,
      componentDisplayMap,
      routerPlugin,
      inventory,
    ),
  );
  return {
    vars,
    transitions: withStableTransitionIds(transitions),
    warnings,
  };
}
