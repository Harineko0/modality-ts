import type {
  AbstractDomain,
  EffectIR,
  ExtractionCaveat,
  ExprIR,
  Locator,
  ModelState,
  NumericReduction,
  PluginProvenance,
  SourceAnchor,
  StateVarDecl,
  TemplateFragment,
  Transition,
  Value,
} from "modality-ts/core";
import type * as ts from "typescript";

export interface DomainRefinementContext {
  typeNode?: ts.TypeNode;
  initializer?: ts.Expression;
  declaration?: ts.VariableDeclaration;
  sourceFile?: ts.SourceFile;
  typeAliases: ReadonlyMap<string, ts.TypeNode>;
  visited: ReadonlySet<string>;
  varId?: string;
}

export interface DomainRefinementResolution {
  domain?: AbstractDomain;
  caveats: ExtractionCaveat[];
  reductions?: NumericReduction[];
}

export interface ModalityAdapterBase {
  id: string;
  version?: string;
  packageNames: readonly string[];
}

export interface DomainRefinementProvider extends ModalityAdapterBase {
  refineDomain(
    ctx: DomainRefinementContext,
  ): DomainRefinementResolution | undefined;
}

export interface ResolvedModuleName {
  fileName: string;
  sourceFile?: ts.SourceFile;
  isExternal: boolean;
}

export interface SemanticTypeContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFile?: ts.SourceFile;
  getSourceFile(fileName: string): ts.SourceFile | undefined;
  canonicalFileName?(fileName: string): string;
  resolveModuleName?(
    specifier: string,
    containingFile: string,
  ): ResolvedModuleName | undefined;
  symbolAt?(node: ts.Node): ts.Symbol | undefined;
  aliasedSymbolAt?(node: ts.Node): ts.Symbol | undefined;
  symbolKey?(symbol: ts.Symbol): string;
  localSymbolKey?(node: ts.Node): string | undefined;
}

export {
  compilerBackedTypeAliases,
  firstValue,
  inferDomainFromTypeNode,
  inferDomainSemantic,
  inferUseStateDomain,
  inferUseStateDomainDetailed,
  inferUseStateDomainSemanticDetailed,
  initialValueForUseState,
  typeAliasDeclarations,
  useStateCallForSemanticInference,
} from "../ts/domains.js";

export {
  collectSemanticNamedImports,
  resolveSemanticNamedExport,
  type ResolvedSemanticImport,
  type SemanticImportContext,
} from "../ts/semantic-imports.js";

export interface SourceDecl {
  id: string;
  kind: string;
  var?: StateVarDecl;
  origin: SourceAnchor | "system" | "library-template";
  metadata?: Record<string, Value>;
}

export interface WriteChannel {
  id: string;
  varId: string;
  /** Local display / syntax-only fallback identity for the setter. */
  symbolName: string;
  /** Stable checker symbol identity when semantic extraction is available. */
  symbolKey?: string;
  source: SourceAnchor;
}

export interface ExtractionWarning {
  message: string;
  source?: SourceAnchor;
  caveat?: ExtractionCaveat;
  confidence?: Transition["confidence"];
  producer?: { kind: PluginProvenance["kind"]; id: string };
}

export interface CallSite {
  callee: string;
  arguments: readonly unknown[];
  source: SourceAnchor;
}

export interface DiscoverCtx {
  sourceText: string;
  fileName: string;
  route: string;
  types?: SemanticTypeContext;
  domainRefinements?: readonly DomainRefinementProvider[];
  relatedFragments?: readonly { sourceText: string; fileName: string }[];
}

export interface TypeCtx {
  sourceText: string;
  fileName: string;
  types?: SemanticTypeContext;
  domainRefinements?: readonly DomainRefinementProvider[];
}

export interface ChannelCtx {
  sourceText: string;
  fileName: string;
  types?: SemanticTypeContext;
  domainRefinements?: readonly DomainRefinementProvider[];
}

export interface ExtractCtx {
  sourceText: string;
  fileName: string;
  route: string;
  routePatterns: readonly string[];
  effectApis: readonly string[];
  stateVars: readonly StateVarDecl[];
  writeChannels: readonly WriteChannel[];
  sourcePlugins: readonly StateSourcePlugin[];
  routerPlugin?: NavigationAdapter;
  types?: SemanticTypeContext;
  domainRefinements?: readonly DomainRefinementProvider[];
}

export interface SourceExtractionResult {
  transitions: readonly import("modality-ts/core").Transition[];
  warnings?: readonly ExtractionWarning[];
}

export interface M0Ctx {
  read(name: string, path?: readonly string[]): ExprIR;
  locator?: Locator;
}

export interface ResolvedOptions {
  route: string;
  bounds?: {
    maxPending?: number;
    maxHistory?: number;
  };
}

export type NavMode = "push" | "replace" | "back";

export interface NavIntent {
  mode: NavMode;
  to?: string;
}

export type RouteKind = "page" | "index" | "layout" | "resource";

export interface RouteNode {
  pattern: string;
  kind: RouteKind;
  file?: string;
  redirectTo?: string;
  metadata?: Record<string, Value>;
}

export interface RouteInventory {
  routes: readonly RouteNode[];
}

export interface RouteDiscoveryCtx {
  rootDir?: string;
  files: readonly { path: string; text: string }[];
  readFile(path: string): Promise<string>;
}

export interface LocationLowering {
  pushTargets: readonly string[];
  pushOrigins: readonly string[];
  hasUnboundPush: boolean;
}

export interface HarnessHooks {
  readonly [key: string]: unknown;
}

export interface HarnessCtx {
  initialState?: ModelState;
}

export interface ObservedRead {
  value: Value;
}

export interface WitnessFactory {
  value(token: Value): unknown;
}

export interface ProbeWalk {
  id: string;
  steps: readonly string[];
}

export interface StateSourcePlugin extends ModalityAdapterBase {
  discover(ctx: DiscoverCtx): readonly SourceDecl[];
  domainHints?(decl: SourceDecl, ctx: TypeCtx): AbstractDomain | undefined;
  writeChannels(ctx: ChannelCtx): readonly WriteChannel[];
  safetyWarnings?(ctx: ChannelCtx): readonly ExtractionWarning[];
  extract?(ctx: ExtractCtx): SourceExtractionResult;
  summarizeWrite?(call: CallSite, ctx: M0Ctx): EffectIR | "unsupported";
  template?(decl: SourceDecl, options: ResolvedOptions): TemplateFragment;
  harness: {
    setup(ctx: HarnessCtx): HarnessHooks;
    observe(
      varId: string,
      handles: HarnessHooks,
    ): ObservedRead | "unobservable";
    witness?(domain: AbstractDomain, varId: string): WitnessFactory | undefined;
  };
  conformance?: {
    templateProbes?: readonly ProbeWalk[];
    testedVersions: string;
  };
}

export type ModuleRuntimeContext = "client" | "server" | "shared" | "type";

export type ModuleDirective = "use client" | "use server";

export type ImportEdgeContext =
  | "client-value"
  | "server-value"
  | "render-value"
  | "type"
  | "asset"
  | "unknown";

export type ModuleExtractionSurface = "render" | "interaction";

export interface ModuleClassification {
  defaultContext: ModuleRuntimeContext | "unknown";
  directives?: readonly ModuleDirective[];
  serverOnly?: boolean;
  reason?: string;
}

export interface ModuleEntryExport {
  name: "default" | string;
  context: ModuleRuntimeContext;
  reason: string;
}

export interface ModuleRoleCtx {
  fileName: string;
  sourceText: string;
  route?: RouteNode;
}

export interface ImportEdgeCtx {
  importer: string;
  specifier: string;
  imported?: string;
  isTypeOnly: boolean;
  importerContext: ModuleRuntimeContext | "unknown";
  surface: ModuleExtractionSurface;
}

export interface EffectApiDiscoveryCtx {
  fileName: string;
  sourceText: string;
  route?: RouteNode;
  inventory?: RouteInventory;
}

export interface RouteExecutionDiscoveryCtx {
  inventory: RouteInventory;
  effectApis: readonly DiscoveredEffectApi[];
  files: readonly { path: string; text: string; route?: RouteNode }[];
}

export interface EffectApiSurfaceCtx {
  fileName: string;
  sourceText: string;
  route?: RouteNode;
  classification: ModuleClassification;
  entryExports: readonly ModuleEntryExport[];
  isManifest: boolean;
  surface?: ModuleExtractionSurface;
}

export interface DiscoveredEffectApi {
  opId: string;
  source: { file: string; line: number; column: number };
  warning?: string;
  caveats?: readonly ExtractionCaveat[];
  confidence?: Transition["confidence"];
  producer?: { kind: PluginProvenance["kind"]; id: string };
}

export interface ModuleRoleAdapter extends ModalityAdapterBase {
  kind: "module-roles";
  classifyModule(ctx: ModuleRoleCtx): ModuleClassification;
  moduleEntryExports(ctx: ModuleRoleCtx): readonly ModuleEntryExport[];
  classifyImportEdge(ctx: ImportEdgeCtx): ImportEdgeContext;
  isServerOnlyModule(
    fileName: string,
    classification?: ModuleClassification,
  ): boolean;
  shouldDiscoverEffectApis?(ctx: EffectApiSurfaceCtx): boolean;
}

export interface EffectApiProvider extends ModalityAdapterBase {
  kind: "effect-api";
  discoverEffectApis(
    ctx: EffectApiDiscoveryCtx,
  ): readonly DiscoveredEffectApi[];
}

export interface RouteExecutionResource {
  id: string;
  domain: AbstractDomain;
}

export interface RouteLoaderDescriptor {
  id: string;
  op: string;
  routePattern: string;
  producesDomain: AbstractDomain;
  readsResources: readonly string[];
  auto: "mount" | "navigate";
  gated?: boolean;
}

export interface RouteActionDescriptor {
  id: string;
  op: string;
  mutatesResources: readonly string[];
  revalidates: readonly string[];
  outcomes: "success-error";
}

export interface RouteExecutionDescriptor {
  resources: readonly RouteExecutionResource[];
  loaders: readonly RouteLoaderDescriptor[];
  actions: readonly RouteActionDescriptor[];
}

export interface RouteExecutionProvider extends ModalityAdapterBase {
  kind: "route-execution";
  describeRouteExecution(
    ctx: RouteExecutionDiscoveryCtx,
  ): RouteExecutionDescriptor;
}

export interface CacheStorageDiscoveryCtx {
  rootDir?: string;
  files: readonly { path: string; text: string }[];
  inventory?: RouteInventory;
  options: ResolvedOptions;
}

export interface CacheStorageFragment {
  vars: readonly StateVarDecl[];
  transitions: readonly import("modality-ts/core").Transition[];
  caveats: readonly ExtractionCaveat[];
  reductions?: readonly NumericReduction[];
  warnings?: readonly string[];
}

export interface CacheStorageProvider extends ModalityAdapterBase {
  kind: "cache-storage";
  discoverCacheStorage(ctx: CacheStorageDiscoveryCtx): CacheStorageFragment;
}

export interface NavigationLoweringCtx {
  inventory: RouteInventory;
  routePatterns: readonly string[];
}

export interface NavigationLoweringResult {
  effect: EffectIR;
  reads: readonly string[];
  writes: readonly string[];
  confidence: Transition["confidence"];
}

export interface NavigationAdapter extends ModalityAdapterBase {
  discoverRoutes(ctx: RouteDiscoveryCtx): Promise<RouteInventory>;
  classifyNavigationCall(
    callee: string,
    args: readonly unknown[],
  ): NavIntent | "unsupported";
  classifyNavigationJsx?(
    tag: string,
    attrs: ReadonlyMap<string, unknown>,
  ): NavIntent | "unsupported";
  routeForComponent?(
    componentName: string,
    inventory: RouteInventory,
  ): string | undefined;
  locationVars(
    inventory: RouteInventory,
    options: ResolvedOptions,
    lowering: LocationLowering,
  ): readonly StateVarDecl[];
  routeTreeVars?(
    inventory: RouteInventory,
    options: ResolvedOptions,
  ): readonly StateVarDecl[];
  lowerNavigation?(
    intent: NavIntent,
    ctx: NavigationLoweringCtx,
  ): NavigationLoweringResult;
  mountScopeForComponent?(
    componentName: string,
    inventory: RouteInventory,
  ): StateVarDecl["scope"] | undefined;
  harness: {
    setup(ctx: HarnessCtx): HarnessHooks;
    observe(handles: HarnessHooks): ObservedRead | "unobservable";
    navigate(
      handles: HarnessHooks,
      mode: "push" | "replace" | "back",
      to?: string,
    ): Promise<void> | void;
  };
}

export interface ObservationProvider extends ModalityAdapterBase {
  kind: "observation";
  setup(ctx: HarnessCtx): HarnessHooks;
  observe(varId: string, handles: HarnessHooks): ObservedRead | "unobservable";
  witness?(domain: AbstractDomain, varId: string): WitnessFactory | undefined;
}

export interface HandlerWrapperCtx {
  sourceFile: ts.SourceFile;
  fileName: string;
  types?: SemanticTypeContext;
}

export type HandlerWrapperProviderExtractableHandler =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | (ts.FunctionDeclaration & { body: ts.Block });

export interface HandlerWrapperProvider extends ModalityAdapterBase {
  kind: "handler-wrapper";
  /**
   * Given a variable initializer or inline JSX expression, if it is a recognized
   * handler-wrapper call (e.g. form.handleSubmit(cb)), returns the inner callback
   * to be extracted as the handler; otherwise returns undefined.
   */
  unwrapHandler(
    node: ts.Expression,
    ctx: HandlerWrapperCtx,
  ): HandlerWrapperProviderExtractableHandler | undefined;
}

export type {
  ComponentRole,
  EngineFrameworkContext,
  FrameworkCtx,
  FrameworkPlugin,
  HookCall,
  RenderBoundary,
  SurfaceCall,
  SurfaceDecl,
  SurfaceNode,
} from "./framework.js";
export {
  createEngineFrameworkContext,
  resolveImportedName,
} from "./framework.js";
export {
  registerFrameworkPlugin,
  resolveFrameworkPlugin,
} from "./framework-runtime.js";
