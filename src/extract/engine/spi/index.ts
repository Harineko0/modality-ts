import type {
  AbstractDomain,
  EffectIR,
  ExprIR,
  Locator,
  ModelState,
  SourceAnchor,
  StateVarDecl,
  TemplateFragment,
  Value,
} from "modality-ts/core";

export {
  firstValue,
  inferDomainFromTypeNode,
  typeAliasDeclarations,
} from "../ts/domains.js";

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
  symbolName: string;
  source: SourceAnchor;
}

export interface ExtractionWarning {
  message: string;
  source?: SourceAnchor;
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
}

export interface TypeCtx {
  sourceText: string;
  fileName: string;
}

export interface ChannelCtx {
  sourceText: string;
  fileName: string;
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

export interface StateSourcePlugin {
  id: string;
  version?: string;
  packageNames: readonly string[];
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

export interface NavigationAdapter {
  id: string;
  version?: string;
  packageNames: readonly string[];
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

/** @deprecated use NavigationAdapter */
export type RouterPlugin = NavigationAdapter;
