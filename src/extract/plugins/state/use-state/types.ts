import type {
  AbstractDomain,
  EffectIR,
  ExprIR,
  StateVarDecl,
  Transition,
  Value,
} from "modality-ts/core";
import type * as ts from "typescript";
import type { ExtractableHandler } from "../../../lang/ts/driver/ast.js";
import type { EffectOpAliases } from "../../../compile/effect-op-aliases.js";

export interface UseStateExtractionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  routePatterns?: readonly string[];
  asyncOutcomes?: Record<string, { success: Value; error?: Value }>;
  effectOpAliases?: EffectOpAliases;
  environment?: import("../../../compile/environment-config.js").EnvironmentEventConfig;
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly import("../../../engine/spi/index.js").WriteChannel[];
  statePlugins?: readonly import("../../../engine/spi/index.js").StateSourcePlugin[];
  routePlugin?: import("../../../engine/spi/index.js").RoutePlugin;
  inventory?: import("../../../engine/spi/index.js").RouteInventory;
  bounds?: Pick<import("modality-ts/core").Bounds, "maxDepth">;
}

export interface ExtractionWarning {
  message: string;
  line?: number;
}

export interface UseStateExtractionResult {
  vars: StateVarDecl[];
  warnings: ExtractionWarning[];
}

export interface ExtractedModelSkeleton extends UseStateExtractionResult {
  transitions: Transition[];
}

export interface SetterBinding {
  varId: string;
  component: string;
  stateName: string;
  domain: AbstractDomain;
}

export interface SetterCall {
  setter: SetterBinding;
  argument: ts.Expression;
}

export type ComponentDecl =
  | ts.FunctionDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;
export type CustomHookDecl =
  | ts.FunctionDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;
export type InternalTransition = Transition & { __stableIdKey?: string };

export interface BoundExpr {
  expr: ExprIR;
  reads: string[];
  setter?: SetterBinding;
}

export interface HookStateReturn {
  domain: AbstractDomain;
  initial: Value;
}

export interface ContextBindings {
  vars: StateVarDecl[];
  setters: Map<string, SetterBinding>;
  hookReturns: Map<string, Map<string, SetterBinding>>;
}

export type StaticValue =
  | string
  | number
  | boolean
  | null
  | readonly StaticValue[]
  | { readonly [key: string]: StaticValue };
export type StaticEnv = Map<string, readonly StaticValue[]>;

export interface EffectSummary {
  effect: EffectIR;
  reads: string[];
}

export type { ExtractableHandler };
