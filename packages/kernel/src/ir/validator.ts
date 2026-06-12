import { enumerateDomain, validateValue } from "./domains.js";
import type { AbstractDomain, EffectIR, ExprIR, Model, StateVarDecl, Transition, Value } from "./types.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateModel(model: Model): ValidationResult {
  const errors: string[] = [];
  const varIds = new Set(model.vars.map((v) => v.id));
  if (model.schemaVersion !== 1) errors.push(`Unsupported model schemaVersion ${model.schemaVersion}`);
  pushDuplicates(errors, "state var", model.vars.map((v) => v.id));
  pushDuplicates(errors, "transition", model.transitions.map((t) => t.id));
  for (const decl of model.vars) validateDecl(errors, decl);
  for (const transition of model.transitions) validateTransition(errors, transition, varIds);
  return { ok: errors.length === 0, errors };
}

export function effectReads(effect: EffectIR): Set<string> {
  const reads = new Set<string>();
  walkEffect(effect, (e) => {
    for (const read of exprReadsInEffect(e)) reads.add(read);
  });
  return reads;
}

export function effectWrites(effect: EffectIR): Set<string> {
  const writes = new Set<string>();
  walkEffect(effect, (effectNode) => {
    switch (effectNode.kind) {
      case "assign":
      case "havoc":
      case "choose":
        writes.add(effectNode.var);
        break;
      case "enqueue":
        writes.add("sys:pending");
        break;
      case "dequeue":
        writes.add("sys:pending");
        break;
      case "navigate":
        writes.add("sys:route");
        writes.add("sys:history");
        break;
      case "opaque":
        for (const write of effectNode.ref.declaredWrites) writes.add(write);
        break;
      default:
        break;
    }
  });
  return writes;
}

export function exprReads(expr: ExprIR): Set<string> {
  const reads = new Set<string>();
  walkExpr(expr, (node) => {
    if (node.kind === "read") reads.add(node.var);
  });
  return reads;
}

function validateDecl(errors: string[], decl: StateVarDecl): void {
  const initials = initialValues(decl.domain, decl.initial);
  if (initials.length === 0) errors.push(`${decl.id}: initial must not be empty`);
  for (const value of initials) {
    if (!validateValue(decl.domain, value)) {
      errors.push(`${decl.id}: invalid initial ${JSON.stringify(value)}`);
    }
  }
  try {
    enumerateDomain(decl.domain);
  } catch (error) {
    errors.push(`${decl.id}: domain cannot enumerate: ${(error as Error).message}`);
  }
}

export function initialValues(domain: AbstractDomain, initial: Value | readonly Value[]): readonly Value[] {
  return domain.kind === "boundedList" ? [initial as Value] : Array.isArray(initial) ? initial : [initial];
}

function validateTransition(errors: string[], transition: Transition, varIds: Set<string>): void {
  const declaredReads = new Set(transition.reads);
  const declaredWrites = new Set(transition.writes);
  for (const id of [...transition.reads, ...transition.writes]) {
    if (!varIds.has(id)) errors.push(`${transition.id}: references unknown var ${id}`);
  }
  for (const read of exprReads(transition.guard)) {
    if (!declaredReads.has(read)) errors.push(`${transition.id}: guard reads ${read} but reads does not declare it`);
  }
  for (const read of effectReads(transition.effect)) {
    if (!declaredReads.has(read)) errors.push(`${transition.id}: effect reads ${read} but reads does not declare it`);
  }
  for (const write of effectWrites(transition.effect)) {
    if (!declaredWrites.has(write)) errors.push(`${transition.id}: effect writes ${write} but writes does not declare it`);
  }
}

function pushDuplicates(errors: string[], kind: string, ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`Duplicate ${kind} id ${id}`);
    seen.add(id);
  }
}

function exprReadsInEffect(effect: EffectIR): Set<string> {
  switch (effect.kind) {
    case "assign":
      return exprReads(effect.expr);
    case "choose":
      return union(effect.among.map(exprReads));
    case "if":
      return exprReads(effect.cond);
    case "enqueue":
      return union(Object.values(effect.args).map(exprReads));
    case "navigate":
      return effect.to ? exprReads(effect.to) : new Set();
    case "opaque":
      return new Set(effect.ref.declaredReads);
    default:
      return new Set();
  }
}

function walkEffect(effect: EffectIR, visit: (effect: EffectIR) => void): void {
  visit(effect);
  if (effect.kind === "seq") effect.effects.forEach((e) => walkEffect(e, visit));
  if (effect.kind === "if") {
    walkEffect(effect.then, visit);
    walkEffect(effect.else, visit);
  }
}

function walkExpr(expr: ExprIR, visit: (expr: ExprIR) => void): void {
  visit(expr);
  switch (expr.kind) {
    case "eq":
    case "neq":
    case "and":
    case "or":
      expr.args.forEach((arg) => walkExpr(arg, visit));
      break;
    case "not":
      walkExpr(expr.args[0], visit);
      break;
    case "cond":
      expr.args.forEach((arg) => walkExpr(arg, visit));
      break;
    case "updateField":
      walkExpr(expr.target, visit);
      walkExpr(expr.value, visit);
      break;
    case "tagIs":
    case "lenCat":
      walkExpr(expr.arg, visit);
      break;
    default:
      break;
  }
}

function union(sets: readonly Set<string>[]): Set<string> {
  const out = new Set<string>();
  for (const set of sets) for (const value of set) out.add(value);
  return out;
}
