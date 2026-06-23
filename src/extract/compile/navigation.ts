import type { EffectIR, ExprIR, Value } from "modality-ts/core";
import { uniqueStrings } from "./ids.js";

const DEFAULT_HISTORY_CAP = 4;
const HISTORY_UNROLL_THRESHOLD = 512;

function readVar(varId: string, path?: readonly string[]): ExprIR {
  return path
    ? { kind: "read", var: varId, path }
    : { kind: "read", var: varId };
}

function readPreVar(varId: string): ExprIR {
  return { kind: "readPre", var: varId };
}

function litValue(value: Value): ExprIR {
  return { kind: "lit", value };
}

function eqExpr(left: ExprIR, right: ExprIR): ExprIR {
  return { kind: "eq", args: [left, right] };
}

function neqExpr(left: ExprIR, right: ExprIR): ExprIR {
  return { kind: "neq", args: [left, right] };
}

function conjIr(left: ExprIR, right: ExprIR): ExprIR {
  return { kind: "and", args: [left, right] };
}

function disjIr(left: ExprIR, right: ExprIR): ExprIR {
  return { kind: "or", args: [left, right] };
}

function orMany(parts: readonly ExprIR[]): ExprIR {
  if (parts.length === 0) return litValue(false);
  return parts
    .slice(1)
    .reduce((acc, next) => disjIr(acc, next), parts[0] ?? litValue(false));
}

function lenCatExpr(varId: string): ExprIR {
  return { kind: "lenCat", arg: readVar(varId) };
}

function assignEffect(varId: string, expr: ExprIR): EffectIR {
  return { kind: "assign", var: varId, expr };
}

function ifEffect(
  cond: ExprIR,
  then: EffectIR,
  elseBranch: EffectIR,
): EffectIR {
  return { kind: "if", cond, then, else: elseBranch };
}

function seqEffects(effects: readonly EffectIR[]): EffectIR {
  if (effects.length === 0) {
    return assignEffect("__modality_noop", litValue(true));
  }
  if (effects.length === 1) return effects[0]!;
  return { kind: "seq", effects: [...effects] };
}

function identityAssign(varId: string): EffectIR {
  return assignEffect(varId, readVar(varId));
}

function cartesianTuples(
  values: readonly string[],
  length: number,
): string[][] {
  if (length === 0) return [[]];
  return cartesianTuples(values, length - 1).flatMap((prefix) =>
    values.map((value) => [...prefix, value]),
  );
}

function exactHistoryLengthGuard(
  historyVar: string,
  length: number,
  maxLen: number,
): ExprIR {
  if (length === 0) return eqExpr(lenCatExpr(historyVar), litValue("0"));
  if (length === 1) return eqExpr(lenCatExpr(historyVar), litValue("1"));
  let guard = eqExpr(lenCatExpr(historyVar), litValue("many"));
  guard = conjIr(
    guard,
    neqExpr(readVar(historyVar, [String(length - 1)]), litValue(null)),
  );
  if (length < maxLen) {
    guard = conjIr(
      guard,
      eqExpr(readVar(historyVar, [String(length)]), litValue(null)),
    );
  }
  return guard;
}

function historyTupleGuard(
  historyVar: string,
  tuple: readonly string[],
  maxLen: number,
): ExprIR {
  let guard = exactHistoryLengthGuard(historyVar, tuple.length, maxLen);
  for (let index = 0; index < tuple.length; index++) {
    guard = conjIr(
      guard,
      eqExpr(readVar(historyVar, [String(index)]), litValue(tuple[index]!)),
    );
  }
  return guard;
}

function historyShorterThanCap(historyVar: string, cap: number): ExprIR {
  const guards: ExprIR[] = [];
  for (let length = 0; length < cap; length++) {
    guards.push(exactHistoryLengthGuard(historyVar, length, cap));
  }
  return orMany(guards);
}

function historyOverflowAssign(
  historyVar: string,
  cap: number,
  routeValues: readonly string[],
): EffectIR {
  const tuples = cartesianTuples(routeValues, cap);
  if (tuples.length === 0) {
    return assignEffect(historyVar, litValue([]));
  }
  if (tuples.length === 1) {
    return assignEffect(historyVar, litValue(tuples[0]!));
  }
  return {
    kind: "choose",
    var: historyVar,
    among: tuples.map((tuple) => litValue(tuple)),
  };
}

function compactHistoryAssign(
  historyVar: string,
  routeValues: readonly string[],
): EffectIR {
  const choices = [
    litValue([]),
    ...routeValues.map((route) => litValue([route])),
  ];
  return {
    kind: "choose",
    var: historyVar,
    among: choices,
  };
}

function canUnrollHistory(
  routeValues: readonly string[] | undefined,
  historyCap: number,
): routeValues is readonly string[] {
  if (!routeValues || routeValues.length === 0) return false;
  let states = 1;
  for (let length = 0; length <= historyCap; length++) {
    states += routeValues.length ** length;
    if (states > HISTORY_UNROLL_THRESHOLD) return false;
  }
  return true;
}

function buildPushHistoryEffect(
  historyVar: string,
  currentVar: string,
  historyRouteValues: readonly string[],
  historyCap: number,
): EffectIR {
  let effect: EffectIR = identityAssign(historyVar);
  for (let length = historyCap - 1; length >= 0; length--) {
    for (const tuple of cartesianTuples(historyRouteValues, length)) {
      for (const current of historyRouteValues) {
        const guard = conjIr(
          historyTupleGuard(historyVar, tuple, historyCap),
          eqExpr(readPreVar(currentVar), litValue(current)),
        );
        effect = ifEffect(
          guard,
          assignEffect(historyVar, litValue([...tuple, current])),
          effect,
        );
      }
    }
  }
  return effect;
}

function buildBackHistoryEffect(
  historyVar: string,
  currentVar: string,
  historyRouteValues: readonly string[],
  historyCap: number,
): EffectIR {
  let effect: EffectIR = seqEffects([
    identityAssign(currentVar),
    identityAssign(historyVar),
  ]);
  for (let length = 1; length <= historyCap; length++) {
    for (const tuple of cartesianTuples(historyRouteValues, length)) {
      const previous = tuple.at(-1);
      if (!previous) continue;
      const guard = historyTupleGuard(historyVar, tuple, historyCap);
      const nextHistory = tuple.slice(0, -1);
      effect = ifEffect(
        guard,
        seqEffects([
          assignEffect(currentVar, litValue(previous)),
          assignEffect(historyVar, litValue(nextHistory)),
        ]),
        effect,
      );
    }
  }
  return effect;
}

export function historyRouteValuesForNavigation(
  routePatterns: readonly string[],
  options: { mountRoute?: string; pushTo?: string } = {},
): readonly string[] {
  const values = uniqueStrings(
    [options.mountRoute, options.pushTo].filter(
      (route): route is string => typeof route === "string",
    ),
  );
  return values.length > 0 ? values : routePatterns;
}

export function locationEffect(args: {
  currentVar: string;
  historyVar?: string;
  mode: "push" | "replace" | "back";
  to?: ExprIR;
  historyCap?: number;
  routeValues?: readonly string[];
  historyRouteValues?: readonly string[];
}): {
  effect: EffectIR;
  reads: readonly string[];
  writes: readonly string[];
} {
  const historyVar = args.historyVar ?? "sys:history";
  const historyCap = args.historyCap ?? DEFAULT_HISTORY_CAP;
  const currentVar = args.currentVar;
  const routeValues = args.routeValues ?? ["/"];
  const historyRouteValues = args.historyRouteValues ?? routeValues;

  if (args.mode === "replace") {
    if (!args.to) {
      throw new Error("locationEffect replace requires `to`");
    }
    const effect = assignEffect(currentVar, args.to);
    return {
      effect,
      reads: args.historyVar ? [historyVar] : [],
      writes: [currentVar],
    };
  }

  if (args.mode === "back") {
    const effect = canUnrollHistory(historyRouteValues, historyCap)
      ? buildBackHistoryEffect(
          historyVar,
          currentVar,
          historyRouteValues,
          historyCap,
        )
      : seqEffects([
          { kind: "havoc", var: currentVar },
          compactHistoryAssign(historyVar, historyRouteValues),
        ]);
    return {
      effect,
      reads: [currentVar, historyVar],
      writes: [currentVar, historyVar],
    };
  }

  if (!args.to) {
    throw new Error("locationEffect push requires `to`");
  }

  const canUnrollPushHistory = canUnrollHistory(historyRouteValues, historyCap);
  const pushBody = canUnrollPushHistory
    ? seqEffects([
        buildPushHistoryEffect(
          historyVar,
          currentVar,
          historyRouteValues,
          historyCap,
        ),
        assignEffect(currentVar, args.to),
      ])
    : seqEffects([
        compactHistoryAssign(historyVar, historyRouteValues),
        assignEffect(currentVar, args.to),
      ]);

  const effect = canUnrollPushHistory
    ? ifEffect(
        historyShorterThanCap(historyVar, historyCap),
        pushBody,
        historyOverflowAssign(historyVar, historyCap, historyRouteValues),
      )
    : pushBody;

  return {
    effect,
    reads: [currentVar, historyVar],
    writes: [currentVar, historyVar],
  };
}
