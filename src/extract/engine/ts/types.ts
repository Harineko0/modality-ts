import type * as ts from "typescript";
import type {
  AbstractDomain,
  EffectIR,
  ExprIR,
  Transition,
  Value,
} from "modality-ts/core";
import type { ExtractableHandler } from "./ast.js";

export interface SetterBinding {
  varId: string;
  component: string;
  stateName: string;
  domain: AbstractDomain;
  initial?: Value;
  resettable?: boolean;
  fixedEffect?: EffectIR;
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
  warnings?: ExtractionWarning[];
}

export interface ContextBindings {
  vars: import("modality-ts/core").StateVarDecl[];
  setters: Map<string, SetterBinding>;
  hookReturns: Map<string, Map<string, SetterBinding>>;
}

export interface ExtractionWarning {
  message: string;
  line?: number;
  column?: number;
  caveat?: import("modality-ts/core").ExtractionCaveat;
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
