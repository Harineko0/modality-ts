import type { EffectIR, ExtractionCaveat } from "modality-ts/core";
import type { CompileCtx, LeafDispatch } from "../engine/spi/leaf-dispatch.js";
import type { SurfaceCall, SurfaceStmt } from "../lang/surface-ir.js";
import { compileExpr, compileGuard } from "./compile-expr.js";
import { effectFromSummaries, identityEffect } from "./effects.js";

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
  taintVars?: readonly string[];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function taintEffect(varIds: readonly string[]): EffectIR {
  if (varIds.length === 0) return identityEffect();
  if (varIds.length === 1) {
    return { kind: "havoc", var: varIds[0]! };
  }
  return {
    kind: "seq",
    effects: varIds.map((varId) => ({ kind: "havoc" as const, var: varId })),
  };
}

function taintSummary(
  varIds: readonly string[],
  id: string,
  reason: string,
): CompileSummary {
  return {
    effect: taintEffect(varIds),
    reads: [],
    caveats:
      varIds.length > 0
        ? [
            {
              kind: "model-slack",
              id,
              reason,
              severity: "over-approx",
            },
          ]
        : [],
    terminated: false,
  };
}

function readsFromExpr(expr: import("modality-ts/core").ExprIR): string[] {
  if (expr.kind === "read" || expr.kind === "readPre") return [expr.var];
  if (expr.kind === "readOpArg") return [];
  if ("args" in expr && Array.isArray(expr.args)) {
    return uniqueStrings(expr.args.flatMap((arg) => readsFromExpr(arg)));
  }
  return [];
}

function readsFromEffect(
  effect: import("modality-ts/core").EffectIR,
): string[] {
  if (effect.kind === "assign") return readsFromExpr(effect.expr);
  if (effect.kind === "seq") {
    return uniqueStrings(effect.effects.flatMap(readsFromEffect));
  }
  if (effect.kind === "if") {
    return uniqueStrings([
      ...readsFromEffect(effect.then),
      ...readsFromEffect(effect.else),
    ]);
  }
  return [];
}

function compileLeafCall(
  call: SurfaceCall,
  options: CompileStmtOptions,
): CompileSummary | undefined {
  const leaf = options.leaf.interpretCall(call, options.ctx);
  if (!leaf) return undefined;
  return {
    effect: leaf.effect,
    reads: readsFromEffect(leaf.effect),
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
      const guarded = compileGuardedRestBlock(stmt.stmts, options);
      if (guarded) return guarded;
      const summaries: { effect: EffectIR; reads: string[] }[] = [];
      const caveats: ExtractionCaveat[] = [];
      let terminated = false;
      for (const child of stmt.stmts) {
        const result = compileStmt(child, options);
        if (!result) return undefined;
        if (
          result.effect.kind === "seq" &&
          result.effect.effects.length === 0 &&
          result.reads.length === 0 &&
          result.caveats.length === 0
        ) {
          continue;
        }
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
      if (
        thenResult.caveats.some((caveat) => caveat.id === "loop-over-approx")
      ) {
        return thenResult;
      }
      if (
        elseResult.caveats.some((caveat) => caveat.id === "loop-over-approx")
      ) {
        return elseResult;
      }
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
      const summaries: { effect: EffectIR; reads: string[] }[] = [];
      const caveats: ExtractionCaveat[] = [];
      for (const binding of stmt.bindings) {
        if (!binding.init) continue;
        if (binding.init.kind === "call") {
          const leaf = compileLeafCall(binding.init, options);
          if (leaf) {
            summaries.push({ effect: leaf.effect, reads: leaf.reads });
            caveats.push(...leaf.caveats);
            continue;
          }
        }
        const value = compileExpr(binding.init, options.ctx);
        if (value) {
          const leafValue = options.leaf.interpretExpr(
            binding.init,
            options.ctx,
          );
          options.ctx.locals.set(binding.name, {
            expr: value.expr,
            reads: value.reads,
            ...(leafValue?.setter ? { setter: leafValue.setter } : {}),
          });
        }
      }
      return {
        effect: effectFromSummaries(summaries),
        reads: uniqueStrings(summaries.flatMap((s) => s.reads)),
        caveats,
        terminated: false,
      };
    }
    case "expr": {
      if (stmt.expr.kind === "call") {
        const leaf = compileLeafCall(stmt.expr, options);
        if (leaf) return leaf;
        return taintSummary(
          options.taintVars ?? [],
          "unknown-call-taint",
          "Unknown call expression",
        );
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
      return taintSummary(
        options.taintVars ?? [],
        `unsupported-surface-${stmt.kind}`,
        `Unsupported surface statement kind: ${stmt.kind}`,
      );
    case "assign": {
      const leaf = options.leaf.interpretAssignment?.(stmt, options.ctx);
      if (leaf) {
        return {
          effect: leaf.effect,
          reads: readsFromEffect(leaf.effect),
          caveats: leaf.caveats ?? [],
          terminated: false,
        };
      }
      return taintSummary(
        options.taintVars ?? [],
        "unsupported-surface-assign",
        "Direct assignment not lowered to setter write",
      );
    }
    default:
      return undefined;
  }
}

function compileGuardedRestBlock(
  stmts: readonly SurfaceStmt[],
  options: CompileStmtOptions,
): CompileSummary | undefined {
  const guardedIndex = stmts.findIndex(
    (stmt) =>
      stmt.kind === "if" &&
      branchTerminates(stmt.then) &&
      stmt.else === undefined,
  );
  if (guardedIndex < 0) return undefined;
  const guarded = stmts[guardedIndex] as Extract<SurfaceStmt, { kind: "if" }>;
  const prefixSummaries: { effect: EffectIR; reads: string[] }[] = [];
  const prefixCaveats: ExtractionCaveat[] = [];
  for (const prefix of stmts.slice(0, guardedIndex)) {
    const result = compileStmt(prefix, options);
    if (!result) return undefined;
    if (
      result.effect.kind === "seq" &&
      result.effect.effects.length === 0 &&
      result.reads.length === 0 &&
      result.caveats.length === 0
    ) {
      continue;
    }
    prefixSummaries.push({ effect: result.effect, reads: result.reads });
    prefixCaveats.push(...result.caveats);
  }
  const condition = compileGuard(guarded.cond, options.ctx);
  if (!condition) return undefined;
  const rest = compileStmt(
    { kind: "block", stmts: stmts.slice(guardedIndex + 1) },
    options,
  );
  if (!rest) return undefined;
  const guardedEffect: EffectIR = {
    kind: "if",
    cond: condition.expr,
    // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
    then: identityEffect(),
    else: rest.effect,
  };
  return {
    effect: effectFromSummaries([
      ...prefixSummaries,
      { effect: guardedEffect, reads: [...condition.reads, ...rest.reads] },
    ]),
    reads: uniqueStrings([
      ...prefixSummaries.flatMap((summary) => summary.reads),
      ...condition.reads,
      ...rest.reads,
    ]),
    caveats: [...prefixCaveats, ...rest.caveats],
    terminated: false,
  };
}

function branchTerminates(stmt: SurfaceStmt): boolean {
  if (stmt.kind === "return" || stmt.kind === "throw") return true;
  return stmt.kind === "block" && stmt.stmts.some(branchTerminates);
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
