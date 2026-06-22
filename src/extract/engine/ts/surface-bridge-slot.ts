import type * as ts from "typescript";
import type { SurfaceStmt } from "../spi/surface-ir.js";
import type { NodeRef } from "../spi/surface-ir.js";
import type { SymbolPort } from "../spi/symbol-port.js";

type LowerStatement = (statement: ts.Statement, fileName: string) => SurfaceStmt;
interface ExtendedSymbolPort extends SymbolPort {
  nodeAt?(ref: NodeRef): ts.Node | undefined;
}
type SymbolPortFactory = (ctx: {
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFile?: ts.SourceFile;
  getSourceFile?(fileName: string): ts.SourceFile | undefined;
  localSymbolKey?(node: ts.Node): string | undefined;
  symbolAt?(node: ts.Node): ts.Symbol | undefined;
  aliasedSymbolAt?(node: ts.Node): ts.Symbol | undefined;
}) => ExtendedSymbolPort;

let lowerStatementImpl: LowerStatement | undefined;
let symbolPortFactory: SymbolPortFactory | undefined;

export function installSurfaceLowerer(fn: LowerStatement): void {
  lowerStatementImpl = fn;
}

export function installSymbolPortFactory(fn: SymbolPortFactory): void {
  symbolPortFactory = fn;
}

export function lowerTsStatement(
  statement: ts.Statement,
  fileName: string,
): SurfaceStmt {
  if (!lowerStatementImpl) {
    throw new Error(
      "Surface lowerer not installed; import modality-ts/extract/wiring",
    );
  }
  return lowerStatementImpl(statement, fileName);
}

export function createSymbolPort(
  ctx: Parameters<SymbolPortFactory>[0],
): ReturnType<SymbolPortFactory> {
  if (!symbolPortFactory) {
    throw new Error(
      "Symbol port factory not installed; import modality-ts/extract/wiring",
    );
  }
  return symbolPortFactory(ctx);
}
