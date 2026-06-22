import type { EffectIR, ExtractionCaveat } from "modality-ts/core";
import type {
  CompileCtx,
  LeafDispatch,
} from "../engine/spi/leaf-dispatch.js";
import type { SurfaceStmt } from "../engine/spi/surface-ir.js";
import { compileExpr, compileGuard } from "./compile-expr.js";

export interface CompileSummary {
  effect: EffectIR;
  reads: string[];
  caveats: ExtractionCaveat[];
  terminated: boolean;
}

export interface CompileStmtOptions {
  leaf: LeafDispatch;
  ctx: CompileCtx;
  loopVars?: readonly string[];
}

function identityEffect(): Extract<EffectIR, { kind: "seq" }> {
  return { kind: "seq", effects: [] };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function effectFromSummaries(
  summaries: readonly { effect: EffectIR; reads: string[] }[],
): EffectIR {
  const effects = summaries.map((summary) => summary.effect);
  if (effects.length === 0) return identityEffect();
  const effect = effects[0];
  return effects.length === 1 && effect
    ? effect
    : { kind: "seq", effects };
}

function compileLeafCall(
  call: Extract<import("../engine/spi/surface-ir.js").SurfaceExpr, { kind: "call" }>,
  options: CompileStmtOptions,
): CompileSummary | undefined {
  const leaf = options.leaf.interpretCall(call, options.ctx);
  if (!leaf) return undefined;
  return {
    effect: leaf.effect,
    reads: [],
    caveats: leaf.caveats ?? [],
    terminated: false,
  };
}

function compileStmt(
  stmt: SurfaceStmt,
  options: CompileStmtOptions,
): CompileSummary | undefined {
  switch (stmt.kind) {
    case "block": {
      const summaries: { effect: EffectIR; reads: string[] }[] = [];
      const caveats: import("modality-ts/core").ExtractionCaveat[] = [];
      let terminated = false;
      for (const child of stmt.stmts) {
        const result = compileStmt(child, options);
        if (!result) return undefined;
        summaries.push({ effect: result.effect, reads: result.reads });
        caveats.push(...result.caveats);
        if (result.terminated) {
          terminated = true;
          break;
        }
      }
      return {
        effect: effectFromSummaries(summaries),
        reads: uniqueStrings(summaries.flatMap((s) => s.reads)),
        caveats,
        terminated,
      };
    }
    case "if": {
      const condition = compileGuard(stmt.cond, options.ctx);
      if (!condition) return undefined;
      const thenResult = compileStmt(stmt.then, options);
      const elseResult = stmt.else
        ? compileStmt(stmt.else, options)
        : {
            effect: identityEffect(),
            reads: [],
            caveats: [],
            terminated: false,
          };
      if (!thenResult || !elseResult) return undefined;
      return {
        effect: {
          kind: "if",
          cond: condition.expr,
          // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
          then: thenResult.effect,
          else: elseResult.effect,
        },
        reads: uniqueStrings([
          ...condition.reads,
          ...thenResult.reads,
          ...elseResult.reads,
        ]),
        caveats: [...thenResult.caveats, ...elseResult.caveats],
        terminated: thenResult.terminated && elseResult.terminated,
      };
    }
    case "switch": {
      const discriminant = compileGuard(stmt.disc, options.ctx);
      if (!discriminant) return undefined;
      const branches: {
        cond?: import("modality-ts/core").ExprIR;
        reads: string[];
        result: CompileSummary;
      }[] = [];
      for (const clause of stmt.cases) {
        const result = compileStmt(clause.body, options);
        if (!result) return undefined;
        if (!clause.test) {
          branches.push({ reads: [], result });
          continue;
        }
        const test = compileExpr(clause.test, options.ctx);
        if (!test) return undefined;
        branches.push({
          cond: { kind: "eq", args: [discriminant.expr, test.expr] },
          reads: test.reads,
          result,
        });
      }
      const effect = branches
        .slice()
        .reverse()
        .reduce<EffectIR>((fallback, branch) => {
          if (!branch.cond) return branch.result.effect;
          return {
            kind: "if",
            cond: branch.cond,
            // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
            then: branch.result.effect,
            else: fallback,
          };
        }, identityEffect());
      return {
        effect,
        reads: uniqueStrings([
          ...discriminant.reads,
          ...branches.flatMap((b) => [...b.reads, ...b.result.reads]),
        ]),
        caveats: branches.flatMap((b) => b.result.caveats),
        terminated:
          branches.length > 0 &&
          branches.every((branch) => branch.result.terminated),
      };
    }
    case "for": {
      const loopVars = options.loopVars ?? [];
      const havocSummaries = loopVars.map((varId) => ({
        effect: { kind: "havoc" as const, var: varId },
        reads: [] as string[],
      }));
      return {
        effect: effectFromSummaries(havocSummaries),
        reads: [],
        caveats: loopVars.length
          ? [
              {
                kind: "model-slack",
                id: "loop-over-approx",
                reason: "Loop body over-approximated via havoc",
                severity: "over-approx",
              },
            ]
          : [],
        terminated: false,
      };
    }
    case "declare": {
      for (const binding of stmt.bindings) {
        if (!binding.init) continue;
        const value = compileExpr(binding.init, options.ctx);
        if (value) {
          options.ctx.locals.set(binding.name, {
            expr: value.expr,
            reads: value.reads,
          });
        }
      }
      return {
        effect: identityEffect(),
        reads: [],
        caveats: [],
        terminated: false,
      };
    }
    case "expr": {
      if (stmt.expr.kind === "call") {
        const leaf = compileLeafCall(stmt.expr, options);
        if (leaf) return leaf;
      }
      return {
        effect: identityEffect(),
        reads: [],
        caveats: [],
        terminated: false,
      };
    }
    case "return":
    case "break":
    case "continue":
      return {
        effect: identityEffect(),
        reads: [],
        caveats: [],
        terminated: true,
      };
    case "throw":
    case "tryish":
    case "opaque":
    case "assign":
      return {
        effect: identityEffect(),
        reads: [],
        caveats: [
          {
            kind: "model-slack",
            id: `unsupported-surface-${stmt.kind}`,
            reason: `Unsupported surface statement kind: ${stmt.kind}`,
            severity: "over-approx",
          },
        ],
        terminated: false,
      };
    default:
      return undefined;
  }
}

export function compileStatements(
  stmts: readonly SurfaceStmt[],
  options: CompileStmtOptions,
): CompileSummary | undefined {
  return compileStmt({ kind: "block", stmts: [...stmts] }, options);
}

export function compileFunctionBody(
  body: SurfaceStmt,
  options: CompileStmtOptions,
): CompileSummary | undefined {
  return compileStmt(body, options);
}
