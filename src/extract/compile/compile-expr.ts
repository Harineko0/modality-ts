import type { ExprIR, Value } from "modality-ts/core";
import type {
  CompileCtx,
  DataflowBinding,
} from "../engine/spi/leaf-dispatch.js";
import type { SurfaceExpr, SymbolRef } from "../lang/surface-ir.js";

export interface CompiledExpr {
  expr: ExprIR;
  reads: string[];
}

export function readLocal(
  name: string,
  ctx: CompileCtx,
): CompiledExpr | undefined {
  const binding = ctx.locals.get(name);
  if (!binding) return undefined;
  return { expr: binding.expr, reads: [...binding.reads] };
}

export function readSymbol(symbol: SymbolRef, ctx: CompileCtx): CompiledExpr {
  const local = readLocal(symbol.name, ctx);
  if (local) return local;
  const stateVar = ctx.stateVarIds?.get(symbol.name);
  if (stateVar) {
    if (ctx.snapshottedReads?.has(stateVar)) {
      return {
        expr: { kind: "readOpArg", key: `snap:${stateVar}` },
        reads: [],
      };
    }
    return {
      expr: {
        kind: ctx.snapshotReads ? "readPre" : "read",
        var: stateVar,
      },
      reads: [stateVar],
    };
  }
  const key = ctx.symbols.localSymbolKey(symbol);
  const varName = key ? `sym:${key}` : symbol.name;
  return {
    expr: { kind: "read", var: varName },
    reads: [varName],
  };
}

function literalExpr(value: Value): CompiledExpr {
  return { expr: { kind: "lit", value }, reads: [] };
}

function combineReads(reads: readonly string[][]): string[] {
  return [...new Set(reads.flat())].sort();
}

export function compileExpr(
  expr: SurfaceExpr,
  ctx: CompileCtx,
): CompiledExpr | undefined {
  switch (expr.kind) {
    case "literal":
      return literalExpr(expr.value);
    case "ref":
      return readSymbol(expr.symbol, ctx);
    case "binary": {
      const left = compileExpr(expr.left, ctx);
      const right = compileExpr(expr.right, ctx);
      if (!left || !right) return undefined;
      return {
        expr: {
          kind: binaryKind(expr.op),
          args: [left.expr, right.expr],
        },
        reads: combineReads([left.reads, right.reads]),
      };
    }
    case "logical": {
      const left = compileExpr(expr.left, ctx);
      const right = compileExpr(expr.right, ctx);
      if (!left || !right) return undefined;
      if (expr.op === "&&") {
        return {
          expr: {
            kind: "and",
            args: [left.expr, right.expr],
          },
          reads: combineReads([left.reads, right.reads]),
        };
      }
      if (expr.op === "||") {
        return {
          expr: {
            kind: "or",
            args: [left.expr, right.expr],
          },
          reads: combineReads([left.reads, right.reads]),
        };
      }
      return undefined;
    }
    case "unary": {
      const operand = compileExpr(expr.operand, ctx);
      if (!operand) return undefined;
      if (expr.op === "!") {
        return {
          expr: { kind: "not", args: [operand.expr] },
          reads: operand.reads,
        };
      }
      return undefined;
    }
    case "ternary": {
      const test = compileExpr(expr.test, ctx);
      const whenTrue = compileExpr(expr.whenTrue, ctx);
      const whenFalse = compileExpr(expr.whenFalse, ctx);
      if (!test || !whenTrue || !whenFalse) return undefined;
      return {
        expr: {
          kind: "cond",
          args: [test.expr, whenTrue.expr, whenFalse.expr],
        },
        reads: combineReads([test.reads, whenTrue.reads, whenFalse.reads]),
      };
    }
    case "member": {
      const object = compileExpr(expr.object, ctx);
      if (
        object?.expr.kind === "lit" &&
        object.expr.value &&
        typeof object.expr.value === "object" &&
        !Array.isArray(object.expr.value) &&
        expr.name in object.expr.value
      ) {
        return {
          expr: {
            kind: "lit",
            value: (object.expr.value as Record<string, Value>)[expr.name],
          },
          reads: object.reads,
        };
      }
      if (object?.expr.kind !== "read") return undefined;
      return {
        expr: {
          kind: "read",
          var: object.expr.var,
          path: [...(object.expr.path ?? []), expr.name],
        },
        reads: object.reads,
      };
    }
    case "call":
    case "jsx":
    case "object":
    case "array":
    case "opaque":
      return undefined;
    default:
      return undefined;
  }
}

function binaryKind(
  op: string,
): "eq" | "neq" | "lt" | "gt" | "add" | "sub" | "mod" {
  switch (op) {
    case "===":
    case "==":
      return "eq";
    case "!==":
    case "!=":
      return "neq";
    case "<":
      return "lt";
    case ">":
      return "gt";
    case "+":
      return "add";
    case "-":
      return "sub";
    case "%":
      return "mod";
    default:
      return "eq";
  }
}

export function bindLocal(
  name: string,
  binding: DataflowBinding,
  ctx: CompileCtx,
): void {
  ctx.locals.set(name, binding);
}

export function compileGuard(
  expr: SurfaceExpr,
  ctx: CompileCtx,
): CompiledExpr | undefined {
  const compiled = compileExpr(expr, ctx);
  if (!compiled) return undefined;
  return compiled;
}
