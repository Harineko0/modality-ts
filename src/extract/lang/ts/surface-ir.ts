import type { Value } from "modality-ts/core";
import type { NodeRef } from "./node-ref.js";

export interface SymbolRef {
  readonly name: string;
  readonly origin: NodeRef;
}

export type AssignOp = "=" | "+=" | "-=" | "*=" | "/=" | "%=";

export interface SurfaceParam {
  name: string;
  origin: NodeRef;
}

export interface SurfaceBinding {
  name: string;
  init?: SurfaceExpr;
  origin: NodeRef;
}

export type SurfaceLValue =
  | { kind: "ref"; symbol: SymbolRef }
  | { kind: "member"; object: SurfaceExpr; name: string; origin: NodeRef }
  | { kind: "opaque"; origin: NodeRef };

export type SurfaceExpr =
  | { kind: "literal"; value: Value }
  | { kind: "ref"; symbol: SymbolRef }
  | {
      kind: "call";
      callee: SurfaceExpr;
      args: SurfaceExpr[];
      origin: NodeRef;
    }
  | {
      kind: "member";
      object: SurfaceExpr;
      name: string;
      origin: NodeRef;
    }
  | {
      kind: "binary";
      op: string;
      left: SurfaceExpr;
      right: SurfaceExpr;
      origin: NodeRef;
    }
  | {
      kind: "unary";
      op: string;
      operand: SurfaceExpr;
      origin: NodeRef;
    }
  | {
      kind: "logical";
      op: "&&" | "||" | "??";
      left: SurfaceExpr;
      right: SurfaceExpr;
      origin: NodeRef;
    }
  | {
      kind: "ternary";
      test: SurfaceExpr;
      whenTrue: SurfaceExpr;
      whenFalse: SurfaceExpr;
      origin: NodeRef;
    }
  | {
      kind: "object";
      fields: { name: string; value: SurfaceExpr }[];
      origin: NodeRef;
    }
  | { kind: "array"; elements: SurfaceExpr[]; origin: NodeRef }
  | {
      kind: "jsx";
      tag: string;
      attrs: { name: string; value?: SurfaceExpr }[];
      children: SurfaceExpr[];
      origin: NodeRef;
    }
  | { kind: "opaque"; origin: NodeRef };

export type SurfaceStmt =
  | { kind: "block"; stmts: SurfaceStmt[] }
  | {
      kind: "if";
      cond: SurfaceExpr;
      then: SurfaceStmt;
      else?: SurfaceStmt;
    }
  | {
      kind: "switch";
      disc: SurfaceExpr;
      cases: { test?: SurfaceExpr; body: SurfaceStmt }[];
    }
  | {
      kind: "for";
      init?: SurfaceStmt;
      cond?: SurfaceExpr;
      update?: SurfaceExpr;
      body: SurfaceStmt;
      loopKind: "for" | "while" | "forOf" | "forIn" | "doWhile";
    }
  | { kind: "return"; value?: SurfaceExpr }
  | {
      kind: "assign";
      target: SurfaceLValue;
      op: AssignOp;
      value: SurfaceExpr;
    }
  | { kind: "declare"; bindings: SurfaceBinding[] }
  | { kind: "expr"; expr: SurfaceExpr }
  | {
      kind: "throw" | "break" | "continue" | "tryish" | "opaque";
      origin: NodeRef;
    };

export interface SurfaceFunction {
  name?: string;
  params: SurfaceParam[];
  body: SurfaceStmt;
  origin: NodeRef;
}

export type SurfaceDecl =
  | { kind: "function"; fn: SurfaceFunction }
  | { kind: "component"; fn: SurfaceFunction }
  | { kind: "hook"; fn: SurfaceFunction }
  | { kind: "var"; bindings: SurfaceBinding[]; origin: NodeRef }
  | { kind: "other"; origin: NodeRef };

export interface SurfaceModule {
  decls: SurfaceDecl[];
}

export type SurfaceNode = SurfaceStmt | SurfaceExpr | SurfaceDecl;

export type SurfaceCall = Extract<SurfaceExpr, { kind: "call" }>;
