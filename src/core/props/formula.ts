import { lift, type Operand } from "./operand.js";
import type {
  FairnessConstraint,
  StatePredicateIR,
  TemporalFormula,
} from "../ir/types.js";

export type { TemporalFormula, FairnessConstraint };

// ---------------------------------------------------------------------------
// Low-level formula constructors (used internally and re-exported via `ctl`)
// ---------------------------------------------------------------------------

export function atom(predicate: StatePredicateIR): TemporalFormula {
  return { kind: "atom", predicate };
}

export function holds(predicate: Operand): TemporalFormula {
  return atom(lift(predicate));
}

export function negate(f: TemporalFormula): TemporalFormula {
  return { kind: "fnot", arg: f };
}

export function allOf(...args: TemporalFormula[]): TemporalFormula {
  if (args.length === 1) return args[0];
  return { kind: "fand", args };
}

export function anyOf(...args: TemporalFormula[]): TemporalFormula {
  if (args.length === 1) return args[0];
  return { kind: "for", args };
}

export function implies(
  antecedent: TemporalFormula,
  consequent: TemporalFormula,
): TemporalFormula {
  return anyOf(negate(antecedent), consequent);
}

// ---------------------------------------------------------------------------
// CTL state-formula operators (friendly names → standard CTL)
// ---------------------------------------------------------------------------

/** AG f — f is true in every reachable state (universal invariant). */
export function always(f: TemporalFormula): TemporalFormula {
  return { kind: "AG", arg: f };
}

/** EF f — some path reaches a state where f holds (existential reachability). */
export function canReach(f: TemporalFormula): TemporalFormula {
  return { kind: "EF", arg: f };
}

/** AF f — every path eventually reaches a state where f holds (inevitable). */
export function eventually(f: TemporalFormula): TemporalFormula {
  return { kind: "AF", arg: f };
}

/** EG f — some path keeps f true forever (existential invariance / liveness cycle). */
export function canStayForever(f: TemporalFormula): TemporalFormula {
  return { kind: "EG", arg: f };
}

/** AX f — every immediate successor satisfies f. */
export function afterEveryStep(f: TemporalFormula): TemporalFormula {
  return { kind: "AX", arg: f };
}

/** EX f — some immediate successor satisfies f. */
export function afterSomeStep(f: TemporalFormula): TemporalFormula {
  return { kind: "EX", arg: f };
}

/** AU p q — on every path, p stays true until q becomes true. */
export function holdsUntil(
  p: TemporalFormula,
  q: TemporalFormula,
): TemporalFormula {
  return { kind: "AU", left: p, right: q };
}

/** EU p q — some path keeps p true until q becomes true. */
export function canHoldUntil(
  p: TemporalFormula,
  q: TemporalFormula,
): TemporalFormula {
  return { kind: "EU", left: p, right: q };
}

/** Fairness constraint: the formula must hold infinitely often on every fair path. */
export function fairlyOften(
  condition: TemporalFormula,
  name?: string,
): FairnessConstraint {
  return name !== undefined ? { name, condition } : { condition };
}

// ---------------------------------------------------------------------------
// `ctl` namespace object — the recommended public API surface
// ---------------------------------------------------------------------------

export const ctl = {
  holds,
  negate,
  allOf,
  anyOf,
  implies,
  always,
  canReach,
  eventually,
  canStayForever,
  afterEveryStep,
  afterSomeStep,
  holdsUntil,
  canHoldUntil,
  fairlyOften,
} as const;
