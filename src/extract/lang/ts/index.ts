export {
  lowerBlock,
  lowerExpr,
  lowerFunction,
  lowerModule,
  lowerStatement,
} from "./lower.js";
export { findNodeAt, type NodeRef, nodeRefFor } from "./node-ref.js";
export {
  createTsOriginReader,
  type OriginReader,
  type TsOriginReader,
  type TsOriginReaderContext,
} from "./origin-reader.js";
export type {
  ResolvedModuleName,
  SemanticTypeContext,
} from "./semantic-type-context.js";
export type {
  AssignOp,
  SurfaceBinding,
  SurfaceCall,
  SurfaceDecl,
  SurfaceExpr,
  SurfaceFunction,
  SurfaceLValue,
  SurfaceModule,
  SurfaceNode,
  SurfaceParam,
  SurfaceStmt,
  SymbolRef,
} from "./surface-ir.js";
export {
  createTsSymbolPort,
  type ImportBinding,
  type ResolvedSymbol,
  type SymbolPort,
  type SymbolPortContext,
  type TsSymbolPort,
  type TypeView,
} from "./symbol-port.js";
