import type * as ts from "typescript";
import type { EffectIR, ExtractionCaveat } from "modality-ts/core";
import { compileStatements } from "../../../compile/index.js";
import type {
  CompileCtx,
  LeafDispatch,
} from "../../spi/leaf-dispatch.js";
import type { SurfaceStmt } from "../../spi/surface-ir.js";
import type { SymbolPort } from "../../spi/symbol-port.js";
import type { EffectSummary } from "../types.js";

export interface DispatchNodeOptions {
  symbols: SymbolPort;
  leaf: LeafDispatch;
  locals?: Map<string, { expr: import("modality-ts/core").ExprIR; reads: string[] }>;
  snapshotReads?: boolean;
  loopVars?: readonly string[];
  lowerStatement: (statement: ts.Statement, fileName: string) => SurfaceStmt;
  fileName: string;
}

export interface DispatchNodeResult {
  summaries: EffectSummary[];
  caveats: ExtractionCaveat[];
  terminated: boolean;
}

function compileCtxFrom(
  options: Pick<
    DispatchNodeOptions,
    "symbols" | "leaf" | "locals" | "snapshotReads"
  >,
): CompileCtx {
  return {
    symbols: options.symbols,
    locals: new Map(options.locals),
    snapshotReads: options.snapshotReads ?? true,
    caveats: [],
  };
}

export function dispatchSurfaceStatements(
  stmts: readonly SurfaceStmt[],
  options: Pick<
    DispatchNodeOptions,
    "symbols" | "leaf" | "locals" | "snapshotReads" | "loopVars"
  >,
): DispatchNodeResult | undefined {
  const ctx = compileCtxFrom(options);
  const compiled = compileStatements(stmts, {
    leaf: options.leaf,
    ctx,
    loopVars: options.loopVars,
  });
  if (!compiled) return undefined;
  return {
    summaries: [{ effect: compiled.effect, reads: compiled.reads }],
    caveats: [...compiled.caveats, ...ctx.caveats],
    terminated: compiled.terminated,
  };
}

export function dispatchTsStatements(
  statements: readonly ts.Statement[],
  options: DispatchNodeOptions,
): DispatchNodeResult | undefined {
  const surfaceStmts = statements.map((statement) =>
    options.lowerStatement(statement, options.fileName),
  );
  return dispatchSurfaceStatements(surfaceStmts, options);
}

export function dispatchNode(
  node: SurfaceStmt | readonly ts.Statement[],
  options: DispatchNodeOptions,
): DispatchNodeResult | undefined {
  if (Array.isArray(node)) {
    return dispatchTsStatements(node, options);
  }
  const surfaceStmt = node as SurfaceStmt;
  return dispatchSurfaceStatements([surfaceStmt], options);
}

export function stabilizeEffectIds(
  effect: EffectIR,
  seed: string,
): EffectIR {
  // Id stabilization applied after merge — placeholder keeps overlay keys stable
  // when the same structural effect is emitted with fresh object identities.
  void seed;
  return effect;
}
