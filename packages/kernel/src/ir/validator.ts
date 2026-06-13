import { domainFingerprint, enumerateDomain, validateValue } from "./domains.js";
import type { AbstractDomain, EffectIR, ExprIR, Model, StateVarDecl, Transition, Value } from "./types.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateModel(model: Model): ValidationResult {
  const errors: string[] = [];
  const varIds = new Set(model.vars.map((v) => v.id));
  const varsById = new Map(model.vars.map((v) => [v.id, v]));
  if (model.schemaVersion !== 1) errors.push(`Unsupported model schemaVersion ${model.schemaVersion}`);
  validateBounds(errors, model);
  pushDuplicates(errors, "state var", model.vars.map((v) => v.id));
  pushDuplicates(errors, "transition", model.transitions.map((t) => t.id));
  for (const decl of model.vars) validateDecl(errors, decl);
  validateSystemVars(errors, varsById, model);
  for (const transition of model.transitions) validateTransition(errors, transition, varIds, varsById);
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

function validateBounds(errors: string[], model: Model): void {
  const bounds = model.bounds;
  if (!Number.isInteger(bounds.maxDepth) || bounds.maxDepth < 0) {
    errors.push("bounds.maxDepth must be a non-negative integer");
  }
  if (!Number.isInteger(bounds.maxPending) || bounds.maxPending < 0) {
    errors.push("bounds.maxPending must be a non-negative integer");
  }
  if (!Number.isInteger(bounds.maxInternalSteps) || bounds.maxInternalSteps < 1) {
    errors.push("bounds.maxInternalSteps must be a positive integer");
  }
}

function validateSystemVars(errors: string[], varsById: Map<string, StateVarDecl>, model: Model): void {
  const route = varsById.get("sys:route");
  const history = varsById.get("sys:history");
  const pending = varsById.get("sys:pending");

  validateSystemDecl(errors, "sys:route", route);
  validateSystemDecl(errors, "sys:history", history);
  validateSystemDecl(errors, "sys:pending", pending);

  if (route && route.domain.kind !== "enum") {
    errors.push("sys:route must use an enum domain");
  }
  if (history) {
    if (history.domain.kind !== "boundedList") {
      errors.push("sys:history must use a boundedList domain");
    } else if (route && domainFingerprint(history.domain.inner) !== domainFingerprint(route.domain)) {
      errors.push("sys:history inner domain must match sys:route domain");
    }
  }
  if (pending) {
    if (pending.domain.kind !== "boundedList") {
      errors.push("sys:pending must use a boundedList domain");
    } else {
      if (pending.domain.maxLen !== model.bounds.maxPending) {
        errors.push("sys:pending maxLen must match bounds.maxPending");
      }
      validatePendingOpDomain(errors, pending.domain.inner);
    }
  }
}

function validateSystemDecl(errors: string[], id: string, decl: StateVarDecl | undefined): void {
  if (!decl) {
    errors.push(`Missing required system var ${id}`);
    return;
  }
  if (decl.origin !== "system") errors.push(`${id} must have system origin`);
  if (decl.scope.kind !== "global") errors.push(`${id} must have global scope`);
}

function validatePendingOpDomain(errors: string[], domain: AbstractDomain): void {
  if (domain.kind !== "record") {
    errors.push("sys:pending items must use a record domain");
    return;
  }
  const { opId, continuation, args } = domain.fields;
  if (!opId) errors.push("sys:pending item domain missing opId");
  else if (opId.kind !== "enum") errors.push("sys:pending opId must use an enum domain");
  if (!continuation) errors.push("sys:pending item domain missing continuation");
  else if (continuation.kind !== "enum") errors.push("sys:pending continuation must use an enum domain");
  if (!args) errors.push("sys:pending item domain missing args");
  else if (args.kind !== "record") errors.push("sys:pending args must use a record domain");
}

function validateDecl(errors: string[], decl: StateVarDecl): void {
  const beforeDomainValidation = errors.length;
  validateDomainShape(errors, decl.id, decl.domain);
  if (errors.length > beforeDomainValidation) return;
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

function validateDomainShape(errors: string[], owner: string, domain: AbstractDomain): void {
  switch (domain.kind) {
    case "bool":
    case "lengthCat":
      return;
    case "enum":
      if (!Array.isArray(domain.values) || domain.values.length === 0) {
        errors.push(`${owner}: enum domain must have at least one value`);
      } else {
        if (!domain.values.every((value) => typeof value === "string")) errors.push(`${owner}: enum values must be strings`);
        pushDuplicateDomainValues(errors, owner, "enum value", domain.values);
      }
      return;
    case "boundedInt":
      if (!Number.isInteger(domain.min) || !Number.isInteger(domain.max)) errors.push(`${owner}: boundedInt min/max must be integers`);
      else if (domain.min > domain.max) errors.push(`${owner}: boundedInt min must be <= max`);
      return;
    case "option":
      validateDomainShape(errors, `${owner}.inner`, domain.inner);
      return;
    case "record":
      for (const [field, fieldDomain] of Object.entries(domain.fields)) validateDomainShape(errors, `${owner}.${field}`, fieldDomain);
      return;
    case "tagged":
      if (!domain.tag) errors.push(`${owner}: tagged domain must have a tag field`);
      if (Object.keys(domain.variants).length === 0) errors.push(`${owner}: tagged domain must have at least one variant`);
      for (const [variant, variantDomain] of Object.entries(domain.variants)) {
        if (variantDomain.kind !== "record") errors.push(`${owner}: tagged variant ${variant} must be a record domain`);
        validateDomainShape(errors, `${owner}.${variant}`, variantDomain);
      }
      return;
    case "tokens":
      if (!Number.isInteger(domain.count) || domain.count < 1) errors.push(`${owner}: tokens count must be a positive integer`);
      if (domain.names) {
        if (domain.names.length !== domain.count) errors.push(`${owner}: tokens names length must match count`);
        if (!domain.names.every((value) => typeof value === "string" && value.length > 0)) errors.push(`${owner}: token names must be non-empty strings`);
        pushDuplicateDomainValues(errors, owner, "token name", domain.names);
      }
      return;
    case "boundedList":
      if (!Number.isInteger(domain.maxLen) || domain.maxLen < 0) errors.push(`${owner}: boundedList maxLen must be a non-negative integer`);
      validateDomainShape(errors, `${owner}.inner`, domain.inner);
      return;
    default:
      errors.push(`${owner}: unknown domain kind ${(domain as { kind?: unknown }).kind}`);
  }
}

function pushDuplicateDomainValues(errors: string[], owner: string, kind: string, values: readonly string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) errors.push(`${owner}: duplicate ${kind} ${value}`);
    seen.add(value);
  }
}

export function initialValues(domain: AbstractDomain, initial: Value | readonly Value[]): readonly Value[] {
  return domain.kind === "boundedList" ? [initial as Value] : Array.isArray(initial) ? initial : [initial];
}

function validateTransition(errors: string[], transition: Transition, varIds: Set<string>, varsById: Map<string, StateVarDecl>): void {
  const declaredReads = new Set(transition.reads);
  const declaredWrites = new Set(transition.writes);
  for (const id of [...transition.reads, ...transition.writes]) {
    if (!varIds.has(id)) errors.push(`${transition.id}: references unknown var ${id}`);
  }
  validateTriggeredBy(errors, transition, varIds);
  for (const read of exprReads(transition.guard)) {
    if (!declaredReads.has(read)) errors.push(`${transition.id}: guard reads ${read} but reads does not declare it`);
  }
  for (const read of effectReads(transition.effect)) {
    if (!declaredReads.has(read)) errors.push(`${transition.id}: effect reads ${read} but reads does not declare it`);
  }
  const actualWrites = effectWrites(transition.effect);
  for (const write of actualWrites) {
    if (!declaredWrites.has(write)) errors.push(`${transition.id}: effect writes ${write} but writes does not declare it`);
  }
  validateRouteLocalWrites(errors, transition, actualWrites, varsById);
  validateExprShape(errors, transition.id, transition.guard);
  validateEffectShape(errors, transition.id, transition.effect);
  validateExprReferences(errors, transition.id, transition.guard, varsById);
  walkEffect(transition.effect, (effectNode) => {
    for (const expr of effectExpressions(effectNode)) validateExprReferences(errors, transition.id, expr, varsById);
  });
  validateExprType(errors, transition.id, transition.guard, varsById, "guard");
  validateEffectTypes(errors, transition.id, transition.effect, varsById);
  validateEffectValues(errors, transition.id, transition.effect, varsById);
}

function validateTriggeredBy(errors: string[], transition: Transition, varIds: Set<string>): void {
  if (!transition.triggeredBy || transition.triggeredBy.length === 0) return;
  if (transition.cls !== "internal") {
    errors.push(`${transition.id}: triggeredBy is only valid on internal transitions`);
  }
  for (const id of transition.triggeredBy) {
    if (!varIds.has(id)) errors.push(`${transition.id}: triggeredBy references unknown var ${id}`);
  }
}

function validateRouteLocalWrites(errors: string[], transition: Transition, actualWrites: Set<string>, varsById: Map<string, StateVarDecl>): void {
  const routeLocalWrites = [...actualWrites]
    .map((id) => varsById.get(id))
    .filter((decl): decl is StateVarDecl & { scope: { kind: "route-local"; route: string } } => decl?.scope.kind === "route-local");
  if (routeLocalWrites.length === 0) return;
  const routes = [...new Set(routeLocalWrites.map((decl) => decl.scope.route))].sort();
  if (routes.length > 1) errors.push(`${transition.id}: writes route-local vars for multiple routes: ${routes.join(", ")}`);
  if (actualWrites.has("sys:route") || actualWrites.has("sys:history")) {
    errors.push(`${transition.id}: writes route-local vars while navigating`);
  }
}

function validateEffectShape(errors: string[], transitionId: string, effect: EffectIR): void {
  walkEffect(effect, (node) => {
    switch (node.kind) {
      case "choose":
        if (!Array.isArray(node.among) || node.among.length === 0) errors.push(`${transitionId}: choose must have at least one option`);
        for (const expr of node.among) validateExprShape(errors, transitionId, expr);
        break;
      case "seq":
        if (!Array.isArray(node.effects)) errors.push(`${transitionId}: seq effects must be an array`);
        break;
      case "if":
        validateExprShape(errors, transitionId, node.cond);
        break;
      case "assign":
        validateExprShape(errors, transitionId, node.expr);
        break;
      case "enqueue":
        for (const expr of Object.values(node.args)) validateExprShape(errors, transitionId, expr);
        break;
      case "navigate":
        if (node.to) validateExprShape(errors, transitionId, node.to);
        break;
      case "dequeue":
        if (!Number.isInteger(node.index) || node.index < 0) errors.push(`${transitionId}: dequeue index must be a non-negative integer`);
        break;
      default:
        break;
    }
  });
}

function validateExprShape(errors: string[], transitionId: string, expr: ExprIR): void {
  walkExpr(expr, (node) => {
    switch (node.kind) {
      case "eq":
      case "neq":
        if (!Array.isArray(node.args) || node.args.length !== 2) errors.push(`${transitionId}: ${node.kind} expression must have exactly 2 args`);
        break;
      case "and":
      case "or":
        if (!Array.isArray(node.args) || node.args.length === 0) errors.push(`${transitionId}: ${node.kind} expression must have at least 1 arg`);
        break;
      case "not":
        if (!Array.isArray(node.args) || node.args.length !== 1) errors.push(`${transitionId}: not expression must have exactly 1 arg`);
        break;
      case "cond":
        if (!Array.isArray(node.args) || node.args.length !== 3) errors.push(`${transitionId}: cond expression must have exactly 3 args`);
        break;
      case "updateField":
        if (!Array.isArray(node.path) || node.path.length === 0) errors.push(`${transitionId}: updateField path must not be empty`);
        break;
      default:
        break;
    }
  });
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
  if (effect.kind === "seq" && Array.isArray(effect.effects)) effect.effects.forEach((e) => walkEffect(e, visit));
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
      if (Array.isArray(expr.args)) expr.args.forEach((arg) => walkExpr(arg, visit));
      break;
    case "not":
      if (Array.isArray(expr.args) && expr.args[0]) walkExpr(expr.args[0], visit);
      break;
    case "cond":
      if (Array.isArray(expr.args)) expr.args.forEach((arg) => walkExpr(arg, visit));
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

function validateEffectValues(errors: string[], transitionId: string, effect: EffectIR, varsById: Map<string, StateVarDecl>): void {
  walkEffect(effect, (effectNode) => {
    switch (effectNode.kind) {
      case "assign":
        validateAssignedExpr(errors, transitionId, effectNode.var, effectNode.expr, varsById);
        break;
      case "choose":
        for (const expr of effectNode.among) validateAssignedExpr(errors, transitionId, effectNode.var, expr, varsById);
        break;
      case "havoc":
        if (!varsById.has(effectNode.var)) errors.push(`${transitionId}: havoc targets unknown var ${effectNode.var}`);
        break;
      default:
        break;
    }
  });
}

function validateAssignedExpr(errors: string[], transitionId: string, varId: string, expr: ExprIR, varsById: Map<string, StateVarDecl>): void {
  const decl = varsById.get(varId);
  if (!decl) {
    errors.push(`${transitionId}: assignment targets unknown var ${varId}`);
    return;
  }
  if (expr.kind === "lit" && !validateValue(decl.domain, expr.value)) {
    errors.push(`${transitionId}: invalid assignment to ${varId}: ${JSON.stringify(expr.value)}`);
  }
  const exprDomain = inferExprDomain(errors, transitionId, expr, varsById);
  if (exprDomain && !sameDomain(exprDomain, decl.domain)) {
    errors.push(`${transitionId}: assignment to ${varId} expects ${domainFingerprint(decl.domain)} but got ${domainFingerprint(exprDomain)}`);
  }
  if (expr.kind === "freshToken" && decl.domain.kind !== "tokens") {
    errors.push(`${transitionId}: freshToken assignment to ${varId} requires a tokens target`);
  }
}

function validateEffectTypes(errors: string[], transitionId: string, effect: EffectIR, varsById: Map<string, StateVarDecl>): void {
  walkEffect(effect, (effectNode) => {
    if (effectNode.kind === "if") validateExprType(errors, transitionId, effectNode.cond, varsById, "if condition");
    if (effectNode.kind === "navigate" && effectNode.to) {
      const route = varsById.get("sys:route");
      const toDomain = inferExprDomain(errors, transitionId, effectNode.to, varsById);
      if (route && toDomain && !sameDomain(toDomain, route.domain)) {
        errors.push(`${transitionId}: navigate target expects ${domainFingerprint(route.domain)} but got ${domainFingerprint(toDomain)}`);
      }
    }
  });
}

function validateExprType(errors: string[], transitionId: string, expr: ExprIR, varsById: Map<string, StateVarDecl>, context: string): void {
  if (expr.kind === "lit" && typeof expr.value !== "boolean") {
    errors.push(`${transitionId}: ${context} must be boolean but got literal ${JSON.stringify(expr.value)}`);
    return;
  }
  const domain = inferExprDomain(errors, transitionId, expr, varsById);
  if (domain && !isBoolDomain(domain)) errors.push(`${transitionId}: ${context} must be boolean but got ${domainFingerprint(domain)}`);
}

function inferExprDomain(errors: string[], transitionId: string, expr: ExprIR, varsById: Map<string, StateVarDecl>): AbstractDomain | undefined {
  switch (expr.kind) {
    case "lit":
      return inferLiteralDomain(expr.value);
    case "read": {
      const decl = varsById.get(expr.var);
      return decl ? domainAtPath(decl.domain, expr.path ?? []) : undefined;
    }
    case "freshToken": {
      const decl = varsById.get(expr.domainOf);
      return decl?.domain.kind === "tokens" ? decl.domain : undefined;
    }
    case "eq":
    case "neq":
      if (Array.isArray(expr.args) && expr.args.length === 2) {
        const left = inferExprDomain(errors, transitionId, expr.args[0]!, varsById);
        const right = inferExprDomain(errors, transitionId, expr.args[1]!, varsById);
        if (left && right && !sameDomain(left, right)) {
          errors.push(`${transitionId}: ${expr.kind} compares ${domainFingerprint(left)} with ${domainFingerprint(right)}`);
        }
      }
      return bool;
    case "and":
    case "or":
      if (Array.isArray(expr.args)) {
        for (const arg of expr.args) validateBooleanOperand(errors, transitionId, expr.kind, arg, varsById);
      }
      return bool;
    case "not":
      if (Array.isArray(expr.args) && expr.args[0]) validateBooleanOperand(errors, transitionId, "not", expr.args[0], varsById);
      return bool;
    case "cond":
      return inferCondDomain(errors, transitionId, expr, varsById);
    case "updateField":
      return inferUpdateFieldDomain(errors, transitionId, expr, varsById);
    case "tagIs": {
      const argDomain = inferExprDomain(errors, transitionId, expr.arg, varsById);
      if (argDomain && argDomain.kind !== "tagged") {
        errors.push(`${transitionId}: tagIs expects tagged argument but got ${domainFingerprint(argDomain)}`);
      }
      return bool;
    }
    case "lenCat": {
      const argDomain = inferExprDomain(errors, transitionId, expr.arg, varsById);
      if (argDomain && argDomain.kind !== "boundedList") {
        errors.push(`${transitionId}: lenCat expects boundedList argument but got ${domainFingerprint(argDomain)}`);
      }
      return { kind: "lengthCat" };
    }
    default:
      return undefined;
  }
}

const bool: AbstractDomain = { kind: "bool" };

function inferLiteralDomain(value: Value): AbstractDomain | undefined {
  if (typeof value === "boolean") return bool;
  return undefined;
}

function inferCondDomain(
  errors: string[],
  transitionId: string,
  expr: Extract<ExprIR, { kind: "cond" }>,
  varsById: Map<string, StateVarDecl>
): AbstractDomain | undefined {
  if (!Array.isArray(expr.args) || expr.args.length !== 3) return undefined;
  validateBooleanOperand(errors, transitionId, "cond condition", expr.args[0]!, varsById);
  const thenDomain = inferExprDomain(errors, transitionId, expr.args[1]!, varsById);
  const elseDomain = inferExprDomain(errors, transitionId, expr.args[2]!, varsById);
  if (isNullLiteral(expr.args[1]) && elseDomain) return { kind: "option", inner: elseDomain };
  if (isNullLiteral(expr.args[2]) && thenDomain) return { kind: "option", inner: thenDomain };
  if (thenDomain && elseDomain && !sameDomain(thenDomain, elseDomain)) {
    errors.push(`${transitionId}: cond branches have incompatible domains ${domainFingerprint(thenDomain)} and ${domainFingerprint(elseDomain)}`);
  }
  return thenDomain && elseDomain && sameDomain(thenDomain, elseDomain) ? thenDomain : thenDomain ?? elseDomain;
}

function isNullLiteral(expr: ExprIR): boolean {
  return expr.kind === "lit" && expr.value === null;
}

function inferUpdateFieldDomain(
  errors: string[],
  transitionId: string,
  expr: Extract<ExprIR, { kind: "updateField" }>,
  varsById: Map<string, StateVarDecl>
): AbstractDomain | undefined {
  const targetDomain = inferExprDomain(errors, transitionId, expr.target, varsById);
  if (!targetDomain || !Array.isArray(expr.path) || expr.path.length === 0) return targetDomain;
  const fieldDomain = domainAtPath(targetDomain, expr.path);
  if (!fieldDomain) {
    errors.push(`${transitionId}: updateField has invalid path ${expr.path.join(".")} for ${domainFingerprint(targetDomain)}`);
    return targetDomain;
  }
  const valueDomain = inferExprDomain(errors, transitionId, expr.value, varsById);
  if (valueDomain && !sameDomain(valueDomain, fieldDomain)) {
    errors.push(`${transitionId}: updateField ${expr.path.join(".")} expects ${domainFingerprint(fieldDomain)} but got ${domainFingerprint(valueDomain)}`);
  }
  return targetDomain;
}

function validateBooleanOperand(errors: string[], transitionId: string, context: string, expr: ExprIR, varsById: Map<string, StateVarDecl>): void {
  const domain = inferExprDomain(errors, transitionId, expr, varsById);
  if (domain && !isBoolDomain(domain)) errors.push(`${transitionId}: ${context} expects boolean operand but got ${domainFingerprint(domain)}`);
}

function isBoolDomain(domain: AbstractDomain): boolean {
  return domain.kind === "bool";
}

function sameDomain(left: AbstractDomain, right: AbstractDomain): boolean {
  return domainFingerprint(left) === domainFingerprint(right);
}

function validateExprReferences(errors: string[], transitionId: string, expr: ExprIR, varsById: Map<string, StateVarDecl>): void {
  walkExpr(expr, (node) => {
    if (node.kind === "read") {
      validateReadReference(errors, transitionId, node, varsById);
    }
    if ((node.kind === "eq" || node.kind === "neq") && node.args.length === 2) {
      validateReadLiteralComparison(errors, transitionId, node.args[0], node.args[1], varsById);
      validateReadLiteralComparison(errors, transitionId, node.args[1], node.args[0], varsById);
    }
    if (node.kind === "tagIs" && node.arg.kind === "read") {
      const decl = varsById.get(node.arg.var);
      if (decl?.domain.kind === "tagged" && !Object.hasOwn(decl.domain.variants, node.tag)) {
        errors.push(`${transitionId}: ${decl.id} references invalid tag ${node.tag}`);
      }
    }
    if (node.kind === "freshToken") {
      const decl = varsById.get(node.domainOf);
      if (!decl) errors.push(`${transitionId}: freshToken domainOf references unknown var ${node.domainOf}`);
      else if (decl.domain.kind !== "tokens") errors.push(`${transitionId}: freshToken domainOf ${node.domainOf} must reference a tokens var`);
    }
  });
}

function validateReadReference(
  errors: string[],
  transitionId: string,
  read: Extract<ExprIR, { kind: "read" }>,
  varsById: Map<string, StateVarDecl>
): void {
  const decl = varsById.get(read.var);
  if (!decl) {
    errors.push(`${transitionId}: expression reads unknown var ${read.var}`);
    return;
  }
  const path = read.path ?? [];
  if (path.length > 0 && !domainAtPath(decl.domain, path)) {
    errors.push(`${transitionId}: ${decl.id} has invalid read path ${path.join(".")}`);
  }
}

function validateReadLiteralComparison(
  errors: string[],
  transitionId: string,
  left: ExprIR,
  right: ExprIR,
  varsById: Map<string, StateVarDecl>
): void {
  if (left.kind !== "read" || right.kind !== "lit") return;
  const decl = varsById.get(left.var);
  if (!decl) return;
  const domain = domainAtPath(decl.domain, left.path ?? []);
  if (domain?.kind === "enum" && typeof right.value === "string" && !domain.values.includes(right.value)) {
    errors.push(`${transitionId}: ${decl.id} references invalid enum value ${right.value}`);
  }
  if (domain?.kind === "tagged" && typeof right.value === "object" && right.value !== null && !Array.isArray(right.value)) {
    const tag = (right.value as Record<string, Value>)[domain.tag];
    if (typeof tag === "string" && !Object.hasOwn(domain.variants, tag)) {
      errors.push(`${transitionId}: ${decl.id} references invalid tag ${tag}`);
    }
  }
}

function domainAtPath(domain: AbstractDomain, path: readonly string[]): AbstractDomain | undefined {
  let current: AbstractDomain | undefined = domain;
  for (const segment of path) {
    if (!current) return undefined;
    while (current.kind === "option") current = current.inner;
    if (current.kind === "record") current = current.fields[segment];
    else if (current.kind === "boundedList") {
      if (!/^\d+$/.test(segment)) current = undefined;
      else {
        const index = Number(segment);
        current = index >= 0 && index < current.maxLen ? current.inner : undefined;
      }
    }
    else if (current.kind === "tagged") current = segment === current.tag ? { kind: "enum", values: Object.keys(current.variants) } : undefined;
    else return undefined;
  }
  return current;
}

function effectExpressions(effect: EffectIR): ExprIR[] {
  switch (effect.kind) {
    case "assign":
      return [effect.expr];
    case "choose":
      return [...effect.among];
    case "if":
      return [effect.cond];
    case "enqueue":
      return Object.values(effect.args);
    case "navigate":
      return effect.to ? [effect.to] : [];
    default:
      return [];
  }
}

function union(sets: readonly Set<string>[]): Set<string> {
  const out = new Set<string>();
  for (const set of sets) for (const value of set) out.add(value);
  return out;
}
