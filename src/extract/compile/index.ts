export {
  bindLocal,
  type CompiledExpr,
  compileExpr,
  compileGuard,
  readLocal,
  readSymbol,
} from "./compile-expr.js";
export {
  type CompileStmtOptions,
  type CompileSummary,
  compileFunctionBody,
  compileStatements,
} from "./compile-stmt.js";
export {
  type EffectSummaryLike,
  effectFromSummaries,
  effectWriteVars,
  identityEffect,
  PENDING_QUEUE_VAR,
  simplifyEffect,
  uniqueSummariesByEffect,
} from "./effects.js";
