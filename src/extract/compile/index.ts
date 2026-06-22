export {
  bindLocal,
  compileExpr,
  compileGuard,
  readLocal,
  readSymbol,
  type CompiledExpr,
} from "./compile-expr.js";
export {
  effectFromSummaries,
  effectWriteVars,
  identityEffect,
  PENDING_QUEUE_VAR,
  simplifyEffect,
  uniqueSummariesByEffect,
  type EffectSummaryLike,
} from "./effects.js";
export {
  compileFunctionBody,
  compileStatements,
  type CompileStmtOptions,
  type CompileSummary,
} from "./compile-stmt.js";
