import type { AbstractDomain, EffectIR, ExprIR, Locator, ModelState, SourceAnchor, StateVarDecl, TemplateFragment, Value } from "@modality/kernel";

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
  summarizeWrite?(call: CallSite, ctx: M0Ctx): EffectIR | "unsupported";
  template?(decl: SourceDecl, options: ResolvedOptions): TemplateFragment;
  harness: {
    setup(ctx: HarnessCtx): HarnessHooks;
    observe(varId: string, handles: HarnessHooks): ObservedRead | "unobservable";
    witness?(domain: AbstractDomain, varId: string): WitnessFactory | undefined;
  };
  conformance?: {
    templateProbes?: readonly ProbeWalk[];
    testedVersions: string;
  };
}

export interface RouterPlugin {
  id: string;
  version?: string;
  packageNames: readonly string[];
  routeVars(routes: readonly string[], options: ResolvedOptions): readonly StateVarDecl[];
  navigationCall(callee: string, args: readonly unknown[]): { mode: "push" | "replace" | "back"; to?: string } | "unsupported";
  harness: {
    setup(ctx: HarnessCtx): HarnessHooks;
    observe(handles: HarnessHooks): ObservedRead | "unobservable";
    navigate(handles: HarnessHooks, mode: "push" | "replace" | "back", to?: string): Promise<void> | void;
  };
}
