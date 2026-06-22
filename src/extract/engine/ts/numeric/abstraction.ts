import {
  type AbstractDomain,
  domainCardinality,
  type ExprIR,
  exceedsWideNumericThreshold,
  type Model,
  type NumericReduction,
  type NumericReductionClaim,
  type Property,
  type SourceAnchor,
  type TemporalFormula,
  type Transition,
} from "modality-ts/core";

export type { NumericReduction };

export interface SaturationCounterConfig {
  /** Inclusive property ceiling; values above become the sentinel. */
  ceiling: number;
  /** When true, decrement from sentinel is conservative (heuristic claim). */
  decrementAmbiguous?: boolean;
  source?: SourceAnchor;
}

export interface IntervalAbstractionConfig {
  cutPoints: readonly number[];
  /** When omitted, derive category names from cut intervals. */
  categoryNames?: readonly string[];
  source?: SourceAnchor;
}

export interface PredicateAbstractionConfig {
  /** Named predicate categories covering numeric observations. */
  categories: readonly { name: string; predicate: ExprIR }[];
  source?: SourceAnchor;
}

export interface InputClassConfig {
  classes: readonly string[];
  source?: SourceAnchor;
}

export const DEFAULT_INPUT_CLASSES = [
  "empty",
  "invalid",
  "belowMin",
  "validSmall",
  "validLarge",
  "aboveMax",
] as const;

const CLAIM_RANK: Record<NumericReductionClaim, number> = {
  exact: 0,
  "property-preserving": 1,
  heuristic: 2,
};

export function worstNumericClaim(
  reductions: readonly NumericReduction[],
): NumericReductionClaim {
  let worst: NumericReductionClaim = "exact";
  for (const reduction of reductions) {
    if (CLAIM_RANK[reduction.claim] > CLAIM_RANK[worst]) {
      worst = reduction.claim;
    }
  }
  return worst;
}

export function mergeNumericReductions(
  ...groups: readonly (readonly NumericReduction[] | undefined)[]
): NumericReduction[] {
  const byKey = new Map<string, NumericReduction>();
  for (const group of groups) {
    if (!group) continue;
    for (const reduction of group) {
      const key = `${reduction.varId}\0${reduction.kind}`;
      const existing = byKey.get(key);
      if (
        !existing ||
        CLAIM_RANK[reduction.claim] > CLAIM_RANK[existing.claim]
      ) {
        byKey.set(key, reduction);
      }
    }
  }
  return [...byKey.values()].sort((left, right) =>
    left.varId.localeCompare(right.varId),
  );
}

export function isNumericDomain(
  domain: AbstractDomain,
): domain is Extract<AbstractDomain, { kind: "boundedInt" | "intSet" }> {
  return domain.kind === "boundedInt" || domain.kind === "intSet";
}

export function exactFirstReduction(
  varId: string,
  domain: AbstractDomain,
  source?: SourceAnchor,
): NumericReduction | undefined {
  if (domain.kind === "intSet") {
    return {
      varId,
      kind: "exact",
      claim: "exact",
      reason: `Sparse numeric set preserved exactly (${domain.values.length} values)`,
      ...(source ? { source } : {}),
    };
  }
  if (domain.kind === "boundedInt" && !exceedsWideNumericThreshold(domain)) {
    return {
      varId,
      kind: "exact",
      claim: "exact",
      reason: `Numeric range ${domain.min}..${domain.max} kept exact (${domainCardinality(domain)} values)`,
      ...(source ? { source } : {}),
    };
  }
  if (domain.kind === "boundedInt" && exceedsWideNumericThreshold(domain)) {
    return {
      varId,
      kind: "lazy-range",
      claim: "property-preserving",
      reason: `Wide numeric range ${domain.min}..${domain.max} kept as bounds; deterministic transitions explore reachable values only`,
      ...(source ? { source } : {}),
    };
  }
  return undefined;
}

export function reductionsForVarDomain(
  varId: string,
  domain: AbstractDomain,
  source?: SourceAnchor,
): NumericReduction[] {
  const reduction = exactFirstReduction(varId, domain, source);
  return reduction ? [reduction] : [];
}

export function collectModelNumericReductions(
  model: Model,
): NumericReduction[] {
  return mergeNumericReductions(
    ...model.vars.map((decl) => reductionsForVarDomain(decl.id, decl.domain)),
  );
}

export function applySaturationCounter(
  varId: string,
  domain: AbstractDomain,
  config: SaturationCounterConfig,
): { domain: AbstractDomain; reduction: NumericReduction } {
  const sentinel = config.ceiling + 1;
  const min =
    domain.kind === "boundedInt"
      ? domain.min
      : domain.kind === "intSet"
        ? (domain.values[0] ?? 0)
        : 0;
  const values = Array.from(
    { length: sentinel - min + 1 },
    (_, index) => min + index,
  );
  const reduced: AbstractDomain = {
    kind: "intSet",
    values,
    ...(domain.kind === "boundedInt" || domain.kind === "intSet"
      ? { overflow: domain.overflow ?? "saturate" }
      : {}),
  };
  const claim: NumericReductionClaim = config.decrementAmbiguous
    ? "heuristic"
    : "property-preserving";
  return {
    domain: reduced,
    reduction: {
      varId,
      kind: "saturation",
      claim,
      reason: `Saturation counter: ${config.ceiling}+ collapsed to sentinel ${sentinel}`,
      ...(config.source ? { source: config.source } : {}),
    },
  };
}

export function applyIntervalAbstraction(
  varId: string,
  domain: AbstractDomain,
  config: IntervalAbstractionConfig,
  observations: readonly ExprIR[],
): { domain: AbstractDomain; reduction: NumericReduction } | undefined {
  if (!isNumericDomain(domain)) return undefined;
  const bounds = numericBounds(domain);
  if (!bounds) return undefined;
  const cuts = normalizeCutPoints(config.cutPoints, bounds.min, bounds.max);
  const categories = config.categoryNames ?? intervalCategoryNames(cuts);
  if (categories.length === 0) return undefined;
  if (!intervalCoversObservations(cuts, observations, bounds)) {
    return {
      domain,
      reduction: {
        varId,
        kind: "interval",
        claim: "heuristic",
        reason: `Interval cuts [${cuts.join(", ")}] do not cover all numeric observations`,
        ...(config.source ? { source: config.source } : {}),
      },
    };
  }
  const values = categories.map((name) => name);
  return {
    domain: { kind: "enum", values },
    reduction: {
      varId,
      kind: "interval",
      claim: "property-preserving",
      reason: `Interval abstraction over cuts [${cuts.join(", ")}] -> ${values.join(", ")}`,
      ...(config.source ? { source: config.source } : {}),
    },
  };
}

export function applyPredicateAbstraction(
  varId: string,
  _domain: AbstractDomain,
  config: PredicateAbstractionConfig,
  observations: readonly ExprIR[],
): { domain: AbstractDomain; reduction: NumericReduction } {
  const categoryNames = config.categories.map((entry) => entry.name);
  const coversAll = predicateCategoriesCoverObservations(
    config.categories,
    observations,
    varId,
  );
  return {
    domain: { kind: "enum", values: categoryNames },
    reduction: {
      varId,
      kind: "predicate",
      claim: coversAll ? "property-preserving" : "heuristic",
      reason: coversAll
        ? `Predicate abstraction covers observed numeric comparisons for ${varId}`
        : `Predicate abstraction for ${varId} may hide unmodeled numeric distinctions`,
      ...(config.source ? { source: config.source } : {}),
    },
  };
}

export function applyInputClassAbstraction(
  varId: string,
  domain: AbstractDomain,
  config: InputClassConfig = { classes: [...DEFAULT_INPUT_CLASSES] },
): { domain: AbstractDomain; reduction: NumericReduction } {
  const classes = [...config.classes];
  return {
    domain: { kind: "enum", values: classes },
    reduction: {
      varId,
      kind: "input-class",
      claim: exceedsWideNumericThreshold(domain) ? "heuristic" : "exact",
      reason: exceedsWideNumericThreshold(domain)
        ? `User-entered numeric input modeled as classes (${classes.join(", ")}) instead of ${domainCardinality(domain)} values`
        : `User-entered numeric input modeled as classes (${classes.join(", ")})`,
      ...(config.source ? { source: config.source } : {}),
    },
  };
}

export function inputClassDomain(
  config: InputClassConfig = { classes: [...DEFAULT_INPUT_CLASSES] },
): AbstractDomain {
  return { kind: "enum", values: [...config.classes] };
}

export function collectNumericCutPoints(
  model: Model,
  properties: readonly Property[] = [],
): number[] {
  const cuts = new Set<number>();
  for (const transition of model.transitions) {
    collectExprCutPoints(transition.guard, cuts);
    collectEffectCutPoints(transition.effect, cuts);
  }
  for (const property of properties) {
    collectPropertyCutPoints(property, cuts);
  }
  return [...cuts].sort((left, right) => left - right);
}

function collectFormulaAtomExprs(formula: TemporalFormula): ExprIR[] {
  const atoms: ExprIR[] = [];
  const walk = (f: TemporalFormula): void => {
    switch (f.kind) {
      case "atom":
        atoms.push(f.predicate);
        break;
      case "fnot":
        walk(f.arg);
        break;
      case "fand":
      case "for":
        for (const arg of f.args) walk(arg);
        break;
      case "EX":
      case "AX":
      case "EF":
      case "AF":
      case "EG":
      case "AG":
        walk(f.arg);
        break;
      case "EU":
      case "AU":
        walk(f.left);
        walk(f.right);
        break;
    }
  };
  walk(formula);
  return atoms;
}

function collectPropertyCutPoints(property: Property, cuts: Set<number>): void {
  switch (property.kind) {
    case "temporal":
      for (const atom of collectFormulaAtomExprs(property.formula)) {
        collectExprCutPoints(atom, cuts);
      }
      break;
    case "alwaysStep":
      if ("pre" in property.predicate && property.predicate.pre) {
        collectExprCutPoints(property.predicate.pre, cuts);
      }
      if ("post" in property.predicate && property.predicate.post) {
        collectExprCutPoints(property.predicate.post, cuts);
      }
      break;
    case "leadsToWithin":
      collectExprCutPoints(property.goal, cuts);
      break;
  }
}

export function collectNumericObservations(
  model: Model,
  properties: readonly Property[] = [],
  varId?: string,
): ExprIR[] {
  const observations: ExprIR[] = [];
  for (const transition of model.transitions) {
    collectExprObservations(transition.guard, observations, varId);
    collectEffectObservations(transition.effect, observations, varId);
  }
  for (const property of properties) {
    collectPropertyObservations(property, observations, varId);
  }
  return observations;
}

function collectPropertyObservations(
  property: Property,
  observations: ExprIR[],
  varId?: string,
): void {
  switch (property.kind) {
    case "temporal":
      for (const atom of collectFormulaAtomExprs(property.formula)) {
        collectExprObservations(atom, observations, varId);
      }
      break;
    case "alwaysStep":
      if ("pre" in property.predicate && property.predicate.pre) {
        collectExprObservations(property.predicate.pre, observations, varId);
      }
      if ("post" in property.predicate && property.predicate.post) {
        collectExprObservations(property.predicate.post, observations, varId);
      }
      break;
    case "leadsToWithin":
      collectExprObservations(property.goal, observations, varId);
      break;
  }
}

export function numericCoiDroppedReductions(
  original: Model,
  sliced: Model,
  propertyReads: readonly string[],
): NumericReduction[] {
  const kept = new Set(sliced.vars.map((decl) => decl.id));
  const reductions: NumericReduction[] = [];
  for (const decl of original.vars) {
    if (kept.has(decl.id) || !isNumericDomain(decl.domain)) continue;
    if (propertyReads.includes(decl.id)) continue;
    reductions.push({
      varId: decl.id,
      kind: "dropped",
      claim: "property-preserving",
      reason: `Numeric variable ${decl.id} dropped from property slice (cone-of-influence)`,
    });
  }
  return reductions;
}

export function applyInputClassToWideInputVars(model: Model): {
  model: Model;
  reductions: NumericReduction[];
} {
  const inputVars = new Set<string>();
  for (const transition of model.transitions) {
    if (transition.label.kind !== "input") continue;
    for (const write of transition.writes) inputVars.add(write);
  }
  const reductions: NumericReduction[] = [];
  let changed = false;
  const vars = model.vars.map((decl) => {
    if (!inputVars.has(decl.id)) return decl;
    if (decl.domain.kind !== "boundedInt") return decl;
    if (!exceedsWideNumericThreshold(decl.domain)) return decl;
    const { domain, reduction } = applyInputClassAbstraction(
      decl.id,
      decl.domain,
    );
    reductions.push(reduction);
    changed = true;
    return { ...decl, domain };
  });
  if (!changed) return { model, reductions: [] };
  return { model: { ...model, vars }, reductions };
}

export function attachNumericReductions(
  model: Model,
  extra: readonly NumericReduction[] = [],
): Model {
  const entries = mergeNumericReductions(
    model.metadata?.numericReductions?.entries,
    ...model.vars.map((decl) => reductionsForVarDomain(decl.id, decl.domain)),
    extra,
  );
  if (entries.length === 0) return model;
  return {
    ...model,
    metadata: {
      ...model.metadata,
      numericReductions: { entries },
    },
  };
}

export function reductionsAffectingProperty(
  reductions: readonly NumericReduction[],
  propertyReads: readonly string[] | undefined,
): NumericReduction[] {
  if (!propertyReads) return [...reductions];
  const reads = new Set(propertyReads);
  return reductions.filter((reduction) => reads.has(reduction.varId));
}

export function downgradeVerdictForReductions(
  status: "verified" | "verified-within-bounds",
  reductions: readonly NumericReduction[],
): {
  status: "verified" | "verified-within-bounds" | "vacuous-warning";
  message?: string;
} {
  const worst = worstNumericClaim(reductions);
  if (worst !== "heuristic") return { status };
  return {
    status: "vacuous-warning",
    message: `Heuristic numeric reduction may hide relevant distinctions (${reductions.length} reduction(s))`,
  };
}

function numericBounds(
  domain: Extract<AbstractDomain, { kind: "boundedInt" | "intSet" }>,
): { min: number; max: number } | undefined {
  if (domain.kind === "boundedInt") {
    return { min: domain.min, max: domain.max };
  }
  if (domain.values.length === 0) return undefined;
  return {
    min: domain.values[0]!,
    max: domain.values[domain.values.length - 1]!,
  };
}

function normalizeCutPoints(
  cutPoints: readonly number[],
  min: number,
  max: number,
): number[] {
  const cuts = new Set<number>([min, ...cutPoints, max]);
  return [...cuts].sort((left, right) => left - right);
}

function intervalCategoryNames(cuts: readonly number[]): string[] {
  if (cuts.length < 2) return [];
  const names: string[] = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const start = cuts[index]!;
    const end = cuts[index + 1]!;
    if (start === end) names.push(String(start));
    else if (end - start === 1) names.push(String(start));
    else if (index === cuts.length - 2) names.push(`${start}+`);
    else names.push(`${start}..${end - 1}`);
  }
  return names;
}

function intervalCoversObservations(
  cuts: readonly number[],
  observations: readonly ExprIR[],
  bounds: { min: number; max: number },
): boolean {
  for (const observation of observations) {
    const literal = comparisonLiteral(observation);
    if (literal === undefined) continue;
    if (literal < bounds.min || literal > bounds.max) continue;
    if (!cuts.some((cut) => cut === literal)) return false;
  }
  return true;
}

function predicateCategoriesCoverObservations(
  categories: readonly { name: string; predicate: ExprIR }[],
  observations: readonly ExprIR[],
  varId: string,
): boolean {
  if (observations.length === 0) return true;
  const varObservations = observations.filter((expr) =>
    exprReferencesVar(expr, varId),
  );
  if (varObservations.length === 0) return true;
  return varObservations.every((observation) =>
    categories.some((category) =>
      predicatesEquivalent(category.predicate, observation),
    ),
  );
}

function predicatesEquivalent(left: ExprIR, right: ExprIR): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exprReferencesVar(expr: ExprIR, varId: string): boolean {
  if (expr.kind === "read" || expr.kind === "readPre")
    return expr.var === varId;
  if ("args" in expr && Array.isArray(expr.args)) {
    return expr.args.some((arg) => exprReferencesVar(arg, varId));
  }
  if (expr.kind === "not") return exprReferencesVar(expr.args[0], varId);
  if (expr.kind === "updateField") {
    return (
      exprReferencesVar(expr.target, varId) ||
      exprReferencesVar(expr.value, varId)
    );
  }
  if (expr.kind === "tagIs" || expr.kind === "lenCat") {
    return exprReferencesVar(expr.arg, varId);
  }
  if (expr.kind === "cond") {
    return (
      exprReferencesVar(expr.args[0], varId) ||
      exprReferencesVar(expr.args[1], varId) ||
      exprReferencesVar(expr.args[2], varId)
    );
  }
  return false;
}

function comparisonLiteral(expr: ExprIR): number | undefined {
  if (
    expr.kind === "lt" ||
    expr.kind === "lte" ||
    expr.kind === "gt" ||
    expr.kind === "gte"
  ) {
    const [left, right] = expr.args;
    if (left?.kind === "lit" && typeof left.value === "number")
      return left.value;
    if (right?.kind === "lit" && typeof right.value === "number")
      return right.value;
  }
  if (expr.kind === "eq" || expr.kind === "neq") {
    for (const arg of expr.args) {
      if (arg.kind === "lit" && typeof arg.value === "number") return arg.value;
    }
  }
  return undefined;
}

function collectExprCutPoints(expr: ExprIR, cuts: Set<number>): void {
  const literal = comparisonLiteral(expr);
  if (literal !== undefined) cuts.add(literal);
  if ("args" in expr && Array.isArray(expr.args)) {
    for (const arg of expr.args) collectExprCutPoints(arg, cuts);
  }
  if (expr.kind === "not") collectExprCutPoints(expr.args[0], cuts);
  if (expr.kind === "updateField") {
    collectExprCutPoints(expr.target, cuts);
    collectExprCutPoints(expr.value, cuts);
  }
  if (expr.kind === "tagIs" || expr.kind === "lenCat") {
    collectExprCutPoints(expr.arg, cuts);
  }
  if (expr.kind === "cond") {
    for (const arg of expr.args) collectExprCutPoints(arg, cuts);
  }
}

function collectEffectCutPoints(
  effect: Transition["effect"],
  cuts: Set<number>,
): void {
  if (effect.kind === "if") {
    collectExprCutPoints(effect.cond, cuts);
    collectEffectCutPoints(effect.then, cuts);
    collectEffectCutPoints(effect.else, cuts);
    return;
  }
  if (effect.kind === "seq") {
    for (const child of effect.effects) collectEffectCutPoints(child, cuts);
  }
}

function collectExprObservations(
  expr: ExprIR,
  observations: ExprIR[],
  varId?: string,
): void {
  if (
    expr.kind === "lt" ||
    expr.kind === "lte" ||
    expr.kind === "gt" ||
    expr.kind === "gte" ||
    expr.kind === "eq" ||
    expr.kind === "neq"
  ) {
    if (!varId || exprReferencesVar(expr, varId)) observations.push(expr);
  }
  if ("args" in expr && Array.isArray(expr.args)) {
    for (const arg of expr.args)
      collectExprObservations(arg, observations, varId);
  }
  if (expr.kind === "not")
    collectExprObservations(expr.args[0], observations, varId);
  if (expr.kind === "updateField") {
    collectExprObservations(expr.target, observations, varId);
    collectExprObservations(expr.value, observations, varId);
  }
  if (expr.kind === "tagIs" || expr.kind === "lenCat") {
    collectExprObservations(expr.arg, observations, varId);
  }
  if (expr.kind === "cond") {
    for (const arg of expr.args)
      collectExprObservations(arg, observations, varId);
  }
}

function collectEffectObservations(
  effect: Transition["effect"],
  observations: ExprIR[],
  varId?: string,
): void {
  if (effect.kind === "assign") {
    collectExprObservations(effect.expr, observations, varId);
    return;
  }
  if (effect.kind === "if") {
    collectExprObservations(effect.cond, observations, varId);
    collectEffectObservations(effect.then, observations, varId);
    collectEffectObservations(effect.else, observations, varId);
    return;
  }
  if (effect.kind === "seq") {
    for (const child of effect.effects) {
      collectEffectObservations(child, observations, varId);
    }
  }
}
