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
export { findNodeAt, nodeRefFor, type NodeRef } from "./node-ref.js";
export {
  createTsSymbolPort,
  type ImportBinding,
  type ResolvedSymbol,
  type SymbolPort,
  type SymbolPortContext,
  type TypeView,
} from "./symbol-port.js";
export {
  lowerBlock,
  lowerExpr,
  lowerFunction,
  lowerModule,
  lowerStatement,
} from "./lower.js";
