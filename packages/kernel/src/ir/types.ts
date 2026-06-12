export type PrimitiveValue = null | boolean | number | string;

export type Value =
  | PrimitiveValue
  | readonly Value[]
  | { readonly [key: string]: Value };

export type AbstractDomain =
  | { kind: "bool" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "boundedInt"; min: number; max: number }
  | { kind: "option"; inner: AbstractDomain }
  | { kind: "record"; fields: Record<string, AbstractDomain> }
  | { kind: "tagged"; tag: string; variants: Record<string, AbstractDomain> }
  | { kind: "tokens"; count: number; names?: readonly string[] }
  | { kind: "lengthCat" }
  | { kind: "boundedList"; inner: AbstractDomain; maxLen: number };

export interface SourceAnchor {
  file: string;
  line?: number;
  column?: number;
}

export interface StateVarDecl {
  id: string;
  domain: AbstractDomain;
  origin: SourceAnchor | "system" | "library-template";
  scope: { kind: "global" } | { kind: "route-local"; route: string };
  initial: Value | readonly Value[];
}

export type ExprIR =
  | { kind: "lit"; value: Value }
  | { kind: "read"; var: string; path?: readonly string[] }
  | { kind: "eq" | "neq" | "and" | "or"; args: readonly ExprIR[] }
  | { kind: "not"; args: readonly [ExprIR] }
  | { kind: "cond"; args: readonly [ExprIR, ExprIR, ExprIR] }
  | { kind: "updateField"; target: ExprIR; path: readonly string[]; value: ExprIR }
  | { kind: "tagIs"; arg: ExprIR; tag: string }
  | { kind: "lenCat"; arg: ExprIR }
  | { kind: "freshToken"; domainOf: string };

export type GuardIR = ExprIR;

export type EffectIR =
  | { kind: "assign"; var: string; expr: ExprIR }
  | { kind: "havoc"; var: string }
  | { kind: "choose"; var: string; among: readonly ExprIR[] }
  | { kind: "if"; cond: ExprIR; then: EffectIR; else: EffectIR }
  | { kind: "seq"; effects: readonly EffectIR[] }
  | { kind: "enqueue"; op: string; continuation: string; args: Record<string, ExprIR> }
  | { kind: "dequeue"; index: number }
  | { kind: "navigate"; mode: "push" | "replace" | "back"; to?: ExprIR }
  | { kind: "opaque"; ref: OpaqueRef };

export interface OpaqueRef {
  module: string;
  export: string;
  declaredReads: readonly string[];
  declaredWrites: readonly string[];
}

export type Locator =
  | { kind: "testId"; value: string }
  | { kind: "role"; role: string; name?: string }
  | { kind: "positional"; base: Locator; index: number };

export type EventLabel =
  | { kind: "click" | "submit"; locator?: Locator; text?: string }
  | { kind: "input"; locator?: Locator; valueClass: string }
  | { kind: "navigate"; mode: "push" | "back"; to?: string }
  | { kind: "resolve"; op: string; outcome: string }
  | { kind: "focus-revalidate" | "timer"; key?: string }
  | { kind: "internal"; text: string };

export interface Transition {
  id: string;
  cls: "user" | "nav" | "env" | "internal" | "library";
  label: EventLabel;
  source: readonly SourceAnchor[];
  guard: GuardIR;
  effect: EffectIR;
  reads: readonly string[];
  writes: readonly string[];
  confidence: "exact" | "over-approx" | "manual";
  triggeredBy?: readonly string[];
}

export interface Bounds {
  maxDepth: number;
  maxPending: number;
  maxInternalSteps: number;
}

export interface Model {
  schemaVersion: 1;
  id: string;
  vars: readonly StateVarDecl[];
  transitions: readonly Transition[];
  bounds: Bounds;
}

export type ModelState = Record<string, Value>;
