import {
  domainFingerprint,
  enumerateDomain,
  validateValue,
} from "./domains.js";
import { effectiveRoleGroup } from "./roles.js";
import type {
  AbstractDomain,
  EffectIR,
  ExprIR,
  Model,
  StateVarDecl,
  Transition,
  Value,
} from "./types.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface ValidationOptions {
  sliced?: boolean;
}

export function validateModel(
  model: Model,
  options: ValidationOptions = {},
): ValidationResult {
  const errors: string[] = [];
  const varIds = new Set(model.vars.map((v) => v.id));
  const varsById = new Map(model.vars.map((v) => [v.id, v]));
  if (model.schemaVersion !== 1)
    errors.push(`Unsupported model schemaVersion ${model.schemaVersion}`);
  validateBounds(errors, model);
  pushDuplicates(
    errors,
    "state var",
    model.vars.map((v) => v.id),
  );
  pushDuplicates(
    errors,
    "transition",
    model.transitions.map((t) => t.id),
  );
  for (const decl of model.vars) validateDecl(errors, decl, varsById);
  if (options.sliced) {
    validatePresentSystemVars(errors, varsById, model);
  } else {
    validateSystemVars(errors, varsById, model);
  }
  for (const transition of model.transitions)
    validateTransition(errors, transition, varIds, varsById, model);
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
      case "dequeue":
        if (effectNode.queue) writes.add(effectNode.queue);
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

export function effectWritesForModel(
  errors: string[],
  model: Model,
  effect: EffectIR,
  transitionId: string,
): Set<string> {
  const writes = new Set<string>();
  walkEffect(effect, (effectNode) => {
    switch (effectNode.kind) {
      case "assign":
      case "havoc":
      case "choose":
        writes.add(effectNode.var);
        break;
      case "enqueue":
      case "dequeue": {
        const queue = resolvePendingQueueVar(
          errors,
          model,
          effectNode.queue,
          transitionId,
        );
        if (queue) writes.add(queue.id);
        break;
      }
      case "opaque":
        for (const write of effectNode.ref.declaredWrites) writes.add(write);
        break;
      default:
        break;
    }
  });
  return writes;
}

function pendingQueueRoleVars(model: Model): StateVarDecl[] {
  return model.vars.filter((decl) => decl.role?.kind === "pending-queue");
}

export function pendingQueueVar(
  model: Model,
  explicitQueue: string | undefined,
  transitionId?: string,
): StateVarDecl | undefined {
  const errors: string[] = [];
  const context = transitionId ?? "model";
  return resolvePendingQueueVar(errors, model, explicitQueue, context);
}

function resolvePendingQueueVar(
  errors: string[],
  model: Model,
  explicitQueue: string | undefined,
  context: string,
): StateVarDecl | undefined {
  const varsById = new Map(model.vars.map((decl) => [decl.id, decl]));
  if (explicitQueue !== undefined) {
    const decl = varsById.get(explicitQueue);
    if (!decl) {
      errors.push(
        `${context}: pending queue references unknown var ${explicitQueue}`,
      );
      return undefined;
    }
    if (decl.role?.kind !== "pending-queue") {
      errors.push(
        `${context}: ${explicitQueue} is not a pending-queue role var`,
      );
      return undefined;
    }
    return decl;
  }
  const queues = pendingQueueRoleVars(model);
  if (queues.length === 0) {
    errors.push(
      `${context}: enqueue/dequeue requires a pending-queue role var`,
    );
    return undefined;
  }
  if (queues.length > 1) {
    errors.push(
      `${context}: enqueue/dequeue queue is ambiguous; specify queue explicitly`,
    );
    return undefined;
  }
  return queues[0];
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
  if (
    !Number.isInteger(bounds.maxInternalSteps) ||
    bounds.maxInternalSteps < 1
  ) {
    errors.push("bounds.maxInternalSteps must be a positive integer");
  }
}

function validateSystemVars(
  errors: string[],
  _varsById: Map<string, StateVarDecl>,
  model: Model,
): void {
  validateRoleVars(errors, model);
}

function validatePresentSystemVars(
  errors: string[],
  _varsById: Map<string, StateVarDecl>,
  model: Model,
): void {
  validateRoleVars(errors, model);
}

function validateRoleVars(errors: string[], model: Model): void {
  const varsById = new Map(model.vars.map((decl) => [decl.id, decl]));
  const locationCurrentByGroup = new Map<string, StateVarDecl[]>();

  for (const decl of model.vars) {
    if (!decl.role) continue;
    switch (decl.role.kind) {
      case "pending-queue":
        validatePendingQueueDecl(errors, decl, model);
        break;
      case "location-current":
        validateLocationCurrentDecl(errors, decl);
        trackLocationCurrentGroup(locationCurrentByGroup, decl);
        break;
      case "location-history":
        validateLocationHistoryDecl(errors, decl, varsById);
        break;
      case "tree-slot":
      case "boundary-phase":
      case "cache-entry":
      case "environment":
        validateEnumerableRoleDecl(errors, decl);
        break;
    }
  }

  validateLocationCurrentGroupConflicts(errors, locationCurrentByGroup);
}

function trackLocationCurrentGroup(
  byGroup: Map<string, StateVarDecl[]>,
  decl: StateVarDecl,
): void {
  const group = effectiveRoleGroup(decl.role?.group);
  const existing = byGroup.get(group) ?? [];
  existing.push(decl);
  byGroup.set(group, existing);
}

function validateLocationCurrentGroupConflicts(
  errors: string[],
  byGroup: Map<string, StateVarDecl[]>,
): void {
  for (const [group, decls] of byGroup) {
    if (decls.length <= 1) continue;
    errors.push(
      `Multiple location-current vars in group ${group}: ${decls.map((decl) => decl.id).join(", ")}`,
    );
  }
}

function validateLocationCurrentDecl(
  errors: string[],
  decl: StateVarDecl,
): void {
  if (decl.scope.kind !== "global") {
    errors.push(`${decl.id} must have global scope`);
  }
  if (decl.origin !== "system" && decl.origin !== "library-template") {
    errors.push(`${decl.id} must have system or library-template origin`);
  }
  if (decl.domain.kind !== "enum") {
    errors.push(`${decl.id} must use an enum domain`);
  }
}

function validateLocationHistoryDecl(
  errors: string[],
  decl: StateVarDecl,
  varsById: Map<string, StateVarDecl>,
): void {
  if (decl.scope.kind !== "global") {
    errors.push(`${decl.id} must have global scope`);
  }
  if (decl.domain.kind !== "boundedList") {
    errors.push(`${decl.id} must use a boundedList domain`);
    return;
  }
  const group = effectiveRoleGroup(decl.role?.group);
  const current = [...varsById.values()].find(
    (candidate) =>
      candidate.role?.kind === "location-current" &&
      effectiveRoleGroup(candidate.role.group) === group,
  );
  if (!current) return;
  const inner = decl.domain.inner;
  const currentDomain = current.domain;
  const within =
    inner.kind === "enum" && currentDomain.kind === "enum"
      ? inner.values.every((value) => currentDomain.values.includes(value))
      : domainFingerprint(inner) === domainFingerprint(currentDomain);
  if (!within) {
    errors.push(
      `${decl.id} inner domain must be compatible with ${current.id} domain`,
    );
  }
}

function validateEnumerableRoleDecl(
  errors: string[],
  decl: StateVarDecl,
): void {
  try {
    enumerateDomain(decl.domain);
  } catch (error) {
    errors.push(
      `${decl.id}: ${decl.role?.kind} domain cannot enumerate: ${(error as Error).message}`,
    );
  }
}

function validatePendingQueueDecl(
  errors: string[],
  decl: StateVarDecl,
  model: Model,
): void {
  if (decl.origin !== "system") {
    errors.push(`${decl.id} must have system origin`);
  }
  if (decl.scope.kind !== "global") {
    errors.push(`${decl.id} must have global scope`);
  }
  if (decl.domain.kind !== "boundedList") {
    errors.push(`${decl.id} must use a boundedList domain`);
    return;
  }
  if (decl.domain.maxLen !== model.bounds.maxPending) {
    errors.push(`${decl.id} maxLen must match bounds.maxPending`);
  }
  validatePendingOpDomain(errors, decl.id, decl.domain.inner);
}

function validatePendingOpDomain(
  errors: string[],
  varId: string,
  domain: AbstractDomain,
): void {
  if (domain.kind !== "record") {
    errors.push(`${varId} items must use a record domain`);
    return;
  }
  const { opId, continuation, args } = domain.fields;
  if (!opId) errors.push(`${varId} item domain missing opId`);
  else if (opId.kind !== "enum")
    errors.push(`${varId} opId must use an enum domain`);
  if (!continuation) errors.push(`${varId} item domain missing continuation`);
  else if (continuation.kind !== "enum")
    errors.push(`${varId} continuation must use an enum domain`);
  if (!args) errors.push(`${varId} item domain missing args`);
  else if (args.kind !== "record")
    errors.push(`${varId} args must use a record domain`);
}

function validateDecl(
  errors: string[],
  decl: StateVarDecl,
  varsById: Map<string, StateVarDecl>,
): void {
  const beforeDomainValidation = errors.length;
  validateDomainShape(errors, decl.id, decl.domain);
  if (errors.length > beforeDomainValidation) return;
  const initials = initialValues(decl.domain, decl.initial);
  if (initials.length === 0)
    errors.push(`${decl.id}: initial must not be empty`);
  for (const value of initials) {
    if (!validateValue(decl.domain, value)) {
      errors.push(`${decl.id}: invalid initial ${JSON.stringify(value)}`);
    }
  }
  try {
    enumerateDomain(decl.domain);
  } catch (error) {
    errors.push(
      `${decl.id}: domain cannot enumerate: ${(error as Error).message}`,
    );
  }
  validateScope(errors, decl, varsById);
}

function validateScope(
  errors: string[],
  decl: StateVarDecl,
  varsById: Map<string, StateVarDecl>,
): void {
  if (decl.scope.kind !== "mount-local") return;
  validateExprShape(errors, decl.id, decl.scope.when);
  validateExprReferences(errors, decl.id, decl.scope.when, varsById);
  validateExprType(
    errors,
    decl.id,
    decl.scope.when,
    varsById,
    "mount-local when",
  );
  if (exprReads(decl.scope.when).has(decl.id)) {
    errors.push(
      `${decl.id}: mount-local when must not read the scoped var itself`,
    );
  }
}

function validateDomainShape(
  errors: string[],
  owner: string,
  domain: AbstractDomain,
): void {
  switch (domain.kind) {
    case "bool":
    case "lengthCat":
      return;
    case "enum":
      if (!Array.isArray(domain.values) || domain.values.length === 0) {
        errors.push(`${owner}: enum domain must have at least one value`);
      } else {
        if (!domain.values.every((value) => typeof value === "string"))
          errors.push(`${owner}: enum values must be strings`);
        pushDuplicateDomainValues(errors, owner, "enum value", domain.values);
      }
      return;
    case "boundedInt":
      if (!Number.isInteger(domain.min) || !Number.isInteger(domain.max))
        errors.push(`${owner}: boundedInt min/max must be integers`);
      else if (domain.min > domain.max)
        errors.push(`${owner}: boundedInt min must be <= max`);
      return;
    case "intSet":
      if (!Array.isArray(domain.values) || domain.values.length === 0) {
        errors.push(`${owner}: intSet domain must have at least one value`);
      } else {
        if (!domain.values.every((value) => Number.isInteger(value)))
          errors.push(`${owner}: intSet values must be integers`);
        pushDuplicateNumericValues(
          errors,
          owner,
          "intSet value",
          domain.values,
        );
        if (
          domain.values.some((value, index) => {
            const previous = domain.values[index - 1];
            return index > 0 && previous !== undefined && value <= previous;
          })
        )
          errors.push(`${owner}: intSet values must be sorted and unique`);
      }
      return;
    case "option":
      validateDomainShape(errors, `${owner}.inner`, domain.inner);
      return;
    case "record":
      for (const [field, fieldDomain] of Object.entries(domain.fields))
        validateDomainShape(errors, `${owner}.${field}`, fieldDomain);
      return;
    case "tagged":
      if (!domain.tag)
        errors.push(`${owner}: tagged domain must have a tag field`);
      if (Object.keys(domain.variants).length === 0)
        errors.push(`${owner}: tagged domain must have at least one variant`);
      for (const [variant, variantDomain] of Object.entries(domain.variants)) {
        if (variantDomain.kind !== "record")
          errors.push(
            `${owner}: tagged variant ${variant} must be a record domain`,
          );
        validateDomainShape(errors, `${owner}.${variant}`, variantDomain);
      }
      return;
    case "tokens":
      if (!Number.isInteger(domain.count) || domain.count < 1)
        errors.push(`${owner}: tokens count must be a positive integer`);
      if (domain.names) {
        if (domain.names.length !== domain.count)
          errors.push(`${owner}: tokens names length must match count`);
        if (
          !domain.names.every(
            (value) => typeof value === "string" && value.length > 0,
          )
        )
          errors.push(`${owner}: token names must be non-empty strings`);
        pushDuplicateDomainValues(errors, owner, "token name", domain.names);
      }
      return;
    case "boundedList":
      if (!Number.isInteger(domain.maxLen) || domain.maxLen < 0)
        errors.push(
          `${owner}: boundedList maxLen must be a non-negative integer`,
        );
      validateDomainShape(errors, `${owner}.inner`, domain.inner);
      return;
    default:
      errors.push(
        `${owner}: unknown domain kind ${(domain as { kind?: unknown }).kind}`,
      );
  }
}

function pushDuplicateDomainValues(
  errors: string[],
  owner: string,
  kind: string,
  values: readonly string[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) errors.push(`${owner}: duplicate ${kind} ${value}`);
    seen.add(value);
  }
}

function pushDuplicateNumericValues(
  errors: string[],
  owner: string,
  kind: string,
  values: readonly number[],
): void {
  const seen = new Set<number>();
  for (const value of values) {
    if (seen.has(value)) errors.push(`${owner}: duplicate ${kind} ${value}`);
    seen.add(value);
  }
}

export function initialValues(
  domain: AbstractDomain,
  initial: Value | readonly Value[],
): readonly Value[] {
  return domain.kind === "boundedList"
    ? [initial as Value]
    : Array.isArray(initial)
      ? initial
      : [initial];
}

function validateTransition(
  errors: string[],
  transition: Transition,
  varIds: Set<string>,
  varsById: Map<string, StateVarDecl>,
  model: Model,
): void {
  const declaredReads = new Set(transition.reads);
  const declaredWrites = new Set(transition.writes);
  for (const id of [...transition.reads, ...transition.writes]) {
    if (!varIds.has(id))
      errors.push(`${transition.id}: references unknown var ${id}`);
  }
  validateTriggeredBy(errors, transition, varIds);
  for (const read of exprReads(transition.guard)) {
    if (!declaredReads.has(read))
      errors.push(
        `${transition.id}: guard reads ${read} but reads does not declare it`,
      );
  }
  for (const read of effectReads(transition.effect)) {
    if (!declaredReads.has(read))
      errors.push(
        `${transition.id}: effect reads ${read} but reads does not declare it`,
      );
  }
  const actualWrites = effectWritesForModel(
    errors,
    model,
    transition.effect,
    transition.id,
  );
  for (const write of actualWrites) {
    if (!declaredWrites.has(write))
      errors.push(
        `${transition.id}: effect writes ${write} but writes does not declare it`,
      );
  }
  validateExprShape(errors, transition.id, transition.guard);
  validateEffectShape(errors, transition.id, transition.effect, model);
  validateExprReferences(errors, transition.id, transition.guard, varsById);
  walkEffect(transition.effect, (effectNode) => {
    for (const expr of effectExpressions(effectNode))
      validateExprReferences(errors, transition.id, expr, varsById);
  });
  validateExprType(errors, transition.id, transition.guard, varsById, "guard");
  validateEffectTypes(errors, transition.id, transition.effect, varsById);
  validateEffectValues(errors, transition.id, transition.effect, varsById);
}

function validateTriggeredBy(
  errors: string[],
  transition: Transition,
  varIds: Set<string>,
): void {
  if (!transition.triggeredBy || transition.triggeredBy.length === 0) return;
  if (transition.cls !== "internal") {
    errors.push(
      `${transition.id}: triggeredBy is only valid on internal transitions`,
    );
  }
  for (const id of transition.triggeredBy) {
    if (!varIds.has(id))
      errors.push(`${transition.id}: triggeredBy references unknown var ${id}`);
  }
}

function validateEffectShape(
  errors: string[],
  transitionId: string,
  effect: EffectIR,
  model: Model,
): void {
  walkEffect(effect, (node) => {
    switch (node.kind) {
      case "choose":
        if (!Array.isArray(node.among) || node.among.length === 0)
          errors.push(`${transitionId}: choose must have at least one option`);
        for (const expr of node.among)
          validateExprShape(errors, transitionId, expr);
        break;
      case "seq":
        if (!Array.isArray(node.effects))
          errors.push(`${transitionId}: seq effects must be an array`);
        break;
      case "if":
        validateExprShape(errors, transitionId, node.cond);
        break;
      case "assign":
        validateExprShape(errors, transitionId, node.expr);
        break;
      case "enqueue":
      case "dequeue": {
        const queueErrors: string[] = [];
        resolvePendingQueueVar(queueErrors, model, node.queue, transitionId);
        errors.push(...queueErrors);
        if (node.kind === "enqueue") {
          for (const expr of Object.values(node.args))
            validateExprShape(errors, transitionId, expr);
        } else if (!Number.isInteger(node.index) || node.index < 0) {
          errors.push(
            `${transitionId}: dequeue index must be a non-negative integer`,
          );
        }
        break;
      }
      default:
        break;
    }
  });
}

function validateExprShape(
  errors: string[],
  transitionId: string,
  expr: ExprIR,
): void {
  walkExpr(expr, (node) => {
    switch (node.kind) {
      case "eq":
      case "neq":
        if (!Array.isArray(node.args) || node.args.length !== 2)
          errors.push(
            `${transitionId}: ${node.kind} expression must have exactly 2 args`,
          );
        break;
      case "and":
      case "or":
        if (!Array.isArray(node.args) || node.args.length === 0)
          errors.push(
            `${transitionId}: ${node.kind} expression must have at least 1 arg`,
          );
        break;
      case "not":
        if (!Array.isArray(node.args) || node.args.length !== 1)
          errors.push(
            `${transitionId}: not expression must have exactly 1 arg`,
          );
        break;
      case "cond":
        if (!Array.isArray(node.args) || node.args.length !== 3)
          errors.push(
            `${transitionId}: cond expression must have exactly 3 args`,
          );
        break;
      case "updateField":
        if (!Array.isArray(node.path) || node.path.length === 0)
          errors.push(`${transitionId}: updateField path must not be empty`);
        break;
      case "lt":
      case "lte":
      case "gt":
      case "gte":
      case "add":
      case "sub":
      case "mod":
        if (!Array.isArray(node.args) || node.args.length !== 2)
          errors.push(
            `${transitionId}: ${node.kind} expression must have exactly 2 args`,
          );
        break;
      default:
        break;
    }
  });
}

function pushDuplicates(
  errors: string[],
  kind: string,
  ids: readonly string[],
): void {
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
    case "opaque":
      return new Set(effect.ref.declaredReads);
    default:
      return new Set();
  }
}

function walkEffect(effect: EffectIR, visit: (effect: EffectIR) => void): void {
  visit(effect);
  if (effect.kind === "seq" && Array.isArray(effect.effects)) {
    for (const child of effect.effects) walkEffect(child, visit);
  }
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
      if (Array.isArray(expr.args)) {
        for (const arg of expr.args) walkExpr(arg, visit);
      }
      break;
    case "not":
      if (Array.isArray(expr.args) && expr.args[0])
        walkExpr(expr.args[0], visit);
      break;
    case "cond":
      if (Array.isArray(expr.args)) {
        for (const arg of expr.args) walkExpr(arg, visit);
      }
      break;
    case "updateField":
      walkExpr(expr.target, visit);
      walkExpr(expr.value, visit);
      break;
    case "tagIs":
    case "lenCat":
      walkExpr(expr.arg, visit);
      break;
    case "lt":
    case "lte":
    case "gt":
    case "gte":
    case "add":
    case "sub":
    case "mod":
      walkExpr(expr.args[0], visit);
      walkExpr(expr.args[1], visit);
      break;
    default:
      break;
  }
}

function validateEffectValues(
  errors: string[],
  transitionId: string,
  effect: EffectIR,
  varsById: Map<string, StateVarDecl>,
): void {
  walkEffect(effect, (effectNode) => {
    switch (effectNode.kind) {
      case "assign":
        validateAssignedExpr(
          errors,
          transitionId,
          effectNode.var,
          effectNode.expr,
          varsById,
        );
        break;
      case "choose":
        for (const expr of effectNode.among)
          validateAssignedExpr(
            errors,
            transitionId,
            effectNode.var,
            expr,
            varsById,
          );
        break;
      case "havoc":
        if (!varsById.has(effectNode.var))
          errors.push(
            `${transitionId}: havoc targets unknown var ${effectNode.var}`,
          );
        break;
      default:
        break;
    }
  });
}

function validateAssignedExpr(
  errors: string[],
  transitionId: string,
  varId: string,
  expr: ExprIR,
  varsById: Map<string, StateVarDecl>,
): void {
  const decl = varsById.get(varId);
  if (!decl) {
    errors.push(`${transitionId}: assignment targets unknown var ${varId}`);
    return;
  }
  if (expr.kind === "lit" && !validateValue(decl.domain, expr.value)) {
    errors.push(
      `${transitionId}: invalid assignment to ${varId}: ${JSON.stringify(expr.value)}`,
    );
  }
  const exprDomain = inferExprDomain(errors, transitionId, expr, varsById);
  if (isNumericDomain(decl.domain)) {
    if (exprDomain && !isNumericDomain(exprDomain)) {
      errors.push(
        `${transitionId}: assignment to ${varId} expects a numeric expression but got ${domainFingerprint(exprDomain)}`,
      );
    }
  } else if (exprDomain && !sameDomain(exprDomain, decl.domain)) {
    errors.push(
      `${transitionId}: assignment to ${varId} expects ${domainFingerprint(decl.domain)} but got ${domainFingerprint(exprDomain)}`,
    );
  }
  if (expr.kind === "freshToken" && decl.domain.kind !== "tokens") {
    errors.push(
      `${transitionId}: freshToken assignment to ${varId} requires a tokens target`,
    );
  }
}

function validateEffectTypes(
  errors: string[],
  transitionId: string,
  effect: EffectIR,
  varsById: Map<string, StateVarDecl>,
): void {
  walkEffect(effect, (effectNode) => {
    if (effectNode.kind === "if")
      validateExprType(
        errors,
        transitionId,
        effectNode.cond,
        varsById,
        "if condition",
      );
  });
}

function validateExprType(
  errors: string[],
  transitionId: string,
  expr: ExprIR,
  varsById: Map<string, StateVarDecl>,
  context: string,
): void {
  if (expr.kind === "lit" && typeof expr.value !== "boolean") {
    errors.push(
      `${transitionId}: ${context} must be boolean but got literal ${JSON.stringify(expr.value)}`,
    );
    return;
  }
  const domain = inferExprDomain(errors, transitionId, expr, varsById);
  if (domain && !isBoolDomain(domain))
    errors.push(
      `${transitionId}: ${context} must be boolean but got ${domainFingerprint(domain)}`,
    );
}

function inferExprDomain(
  errors: string[],
  transitionId: string,
  expr: ExprIR,
  varsById: Map<string, StateVarDecl>,
): AbstractDomain | undefined {
  switch (expr.kind) {
    case "lit":
      return inferLiteralDomain(expr.value);
    case "read": {
      const decl = varsById.get(expr.var);
      return decl ? domainAtPath(decl.domain, expr.path ?? []) : undefined;
    }
    case "readPre": {
      const decl = varsById.get(expr.var);
      return decl ? domainAtPath(decl.domain, expr.path ?? []) : undefined;
    }
    case "readOpArg":
      return { kind: "tokens", count: 1 };
    case "freshToken": {
      const decl = varsById.get(expr.domainOf);
      return decl?.domain.kind === "tokens" ? decl.domain : undefined;
    }
    case "eq":
    case "neq":
      if (Array.isArray(expr.args) && expr.args.length === 2) {
        const leftArg = expr.args[0];
        const rightArg = expr.args[1];
        if (!leftArg || !rightArg) return bool;
        const left = inferExprDomain(errors, transitionId, leftArg, varsById);
        const right = inferExprDomain(errors, transitionId, rightArg, varsById);
        if (left && right && !sameDomain(left, right)) {
          errors.push(
            `${transitionId}: ${expr.kind} compares ${domainFingerprint(left)} with ${domainFingerprint(right)}`,
          );
        }
      }
      return bool;
    case "and":
    case "or":
      if (Array.isArray(expr.args)) {
        for (const arg of expr.args)
          validateBooleanOperand(
            errors,
            transitionId,
            expr.kind,
            arg,
            varsById,
          );
      }
      return bool;
    case "not":
      if (Array.isArray(expr.args) && expr.args[0])
        validateBooleanOperand(
          errors,
          transitionId,
          "not",
          expr.args[0],
          varsById,
        );
      return bool;
    case "cond":
      return inferCondDomain(errors, transitionId, expr, varsById);
    case "updateField":
      return inferUpdateFieldDomain(errors, transitionId, expr, varsById);
    case "tagIs": {
      const argDomain = inferExprDomain(
        errors,
        transitionId,
        expr.arg,
        varsById,
      );
      if (argDomain && argDomain.kind !== "tagged") {
        errors.push(
          `${transitionId}: tagIs expects tagged argument but got ${domainFingerprint(argDomain)}`,
        );
      }
      return bool;
    }
    case "lenCat": {
      const argDomain = inferExprDomain(
        errors,
        transitionId,
        expr.arg,
        varsById,
      );
      if (argDomain && argDomain.kind !== "boundedList") {
        errors.push(
          `${transitionId}: lenCat expects boundedList argument but got ${domainFingerprint(argDomain)}`,
        );
      }
      return { kind: "lengthCat" };
    }
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      return inferComparisonDomain(
        errors,
        transitionId,
        expr.kind,
        expr.args,
        varsById,
      );
    case "add":
    case "sub":
    case "mod":
      return inferArithmeticDomain(
        errors,
        transitionId,
        expr.kind,
        expr.args,
        varsById,
      );
    default:
      return undefined;
  }
}

const bool: AbstractDomain = { kind: "bool" };

function inferLiteralDomain(value: Value): AbstractDomain | undefined {
  if (typeof value === "boolean") return bool;
  if (typeof value === "number" && Number.isInteger(value)) {
    return { kind: "boundedInt", min: value, max: value };
  }
  return undefined;
}

function isNumericDomain(domain: AbstractDomain): boolean {
  return domain.kind === "boundedInt" || domain.kind === "intSet";
}

function inferComparisonDomain(
  errors: string[],
  transitionId: string,
  kind: "lt" | "lte" | "gt" | "gte",
  args: readonly [ExprIR, ExprIR],
  varsById: Map<string, StateVarDecl>,
): AbstractDomain {
  const left = inferExprDomain(errors, transitionId, args[0], varsById);
  const right = inferExprDomain(errors, transitionId, args[1], varsById);
  if (left && !isNumericDomain(left)) {
    errors.push(
      `${transitionId}: ${kind} expects numeric left operand but got ${domainFingerprint(left)}`,
    );
  }
  if (right && !isNumericDomain(right)) {
    errors.push(
      `${transitionId}: ${kind} expects numeric right operand but got ${domainFingerprint(right)}`,
    );
  }
  return bool;
}

const MAX_INFERRED_INT_SET_PRODUCT = 64;

function inferArithmeticDomain(
  errors: string[],
  transitionId: string,
  kind: "add" | "sub" | "mod",
  args: readonly [ExprIR, ExprIR],
  varsById: Map<string, StateVarDecl>,
): AbstractDomain | undefined {
  const left = inferExprDomain(errors, transitionId, args[0], varsById);
  const right = inferExprDomain(errors, transitionId, args[1], varsById);
  if (left && !isNumericDomain(left)) {
    errors.push(
      `${transitionId}: ${kind} expects numeric left operand but got ${domainFingerprint(left)}`,
    );
  }
  if (right && !isNumericDomain(right)) {
    errors.push(
      `${transitionId}: ${kind} expects numeric right operand but got ${domainFingerprint(right)}`,
    );
  }
  if (!left || !right || !isNumericDomain(left) || !isNumericDomain(right)) {
    return undefined;
  }
  const leftValues = numericDomainValues(left);
  const rightValues = numericDomainValues(right);
  if (!leftValues || !rightValues) return undefined;
  const product = leftValues.length * rightValues.length;
  if (product > MAX_INFERRED_INT_SET_PRODUCT) {
    return conservativeArithmeticRange(kind, left, right);
  }
  const results = new Set<number>();
  for (const l of leftValues) {
    for (const r of rightValues) {
      const value = applyArithmetic(kind, l, r);
      if (value === undefined) continue;
      results.add(value);
    }
  }
  if (results.size === 0) return undefined;
  const sorted = [...results].sort((a, b) => a - b);
  if (sorted.length === sorted[sorted.length - 1]! - sorted[0]! + 1) {
    return {
      kind: "boundedInt",
      min: sorted[0]!,
      max: sorted[sorted.length - 1]!,
    };
  }
  return { kind: "intSet", values: sorted };
}

function numericDomainValues(
  domain: AbstractDomain,
): readonly number[] | undefined {
  if (domain.kind === "boundedInt") {
    if (domain.max - domain.min + 1 > MAX_INFERRED_INT_SET_PRODUCT) {
      return undefined;
    }
    return Array.from(
      { length: domain.max - domain.min + 1 },
      (_, index) => domain.min + index,
    );
  }
  if (domain.kind === "intSet") return domain.values;
  return undefined;
}

function conservativeArithmeticRange(
  kind: "add" | "sub" | "mod",
  left: AbstractDomain,
  right: AbstractDomain,
): AbstractDomain | undefined {
  const leftRange = boundedDomainRange(left);
  const rightRange = boundedDomainRange(right);
  if (!leftRange || !rightRange) return undefined;
  if (kind === "mod") {
    const divisor = positiveLiteralOrRangeMax(right);
    if (divisor !== undefined && divisor > 0) {
      return { kind: "boundedInt", min: 0, max: divisor - 1 };
    }
    return undefined;
  }
  const [lMin, lMax] = leftRange;
  const [rMin, rMax] = rightRange;
  if (kind === "add") {
    return { kind: "boundedInt", min: lMin + rMin, max: lMax + rMax };
  }
  return { kind: "boundedInt", min: lMin - rMax, max: lMax - rMin };
}

function boundedDomainRange(
  domain: AbstractDomain,
): readonly [number, number] | undefined {
  if (domain.kind === "boundedInt") return [domain.min, domain.max];
  if (domain.kind === "intSet" && domain.values.length > 0) {
    return [domain.values[0]!, domain.values[domain.values.length - 1]!];
  }
  return undefined;
}

function positiveLiteralOrRangeMax(domain: AbstractDomain): number | undefined {
  if (
    domain.kind === "boundedInt" &&
    domain.min === domain.max &&
    domain.min > 0
  ) {
    return domain.min;
  }
  if (domain.kind === "boundedInt" && domain.min > 0) return domain.max;
  if (domain.kind === "intSet") {
    const positives = domain.values.filter((value) => value > 0);
    if (positives.length === domain.values.length && positives.length > 0) {
      return Math.max(...positives);
    }
  }
  return undefined;
}

function applyArithmetic(
  kind: "add" | "sub" | "mod",
  left: number,
  right: number,
): number | undefined {
  switch (kind) {
    case "add":
      return left + right;
    case "sub":
      return left - right;
    case "mod":
      if (right === 0) return undefined;
      return ((left % right) + right) % right;
  }
}

function inferCondDomain(
  errors: string[],
  transitionId: string,
  expr: Extract<ExprIR, { kind: "cond" }>,
  varsById: Map<string, StateVarDecl>,
): AbstractDomain | undefined {
  if (!Array.isArray(expr.args) || expr.args.length !== 3) return undefined;
  const condition = expr.args[0];
  const thenArg = expr.args[1];
  const elseArg = expr.args[2];
  if (!condition || !thenArg || !elseArg) return undefined;
  validateBooleanOperand(
    errors,
    transitionId,
    "cond condition",
    condition,
    varsById,
  );
  const thenDomain = inferExprDomain(errors, transitionId, thenArg, varsById);
  const elseDomain = inferExprDomain(errors, transitionId, elseArg, varsById);
  if (isNullLiteral(thenArg) && elseDomain)
    return { kind: "option", inner: elseDomain };
  if (isNullLiteral(expr.args[2]) && thenDomain)
    return { kind: "option", inner: thenDomain };
  if (thenDomain && elseDomain && !sameDomain(thenDomain, elseDomain)) {
    errors.push(
      `${transitionId}: cond branches have incompatible domains ${domainFingerprint(thenDomain)} and ${domainFingerprint(elseDomain)}`,
    );
  }
  return thenDomain && elseDomain && sameDomain(thenDomain, elseDomain)
    ? thenDomain
    : (thenDomain ?? elseDomain);
}

function isNullLiteral(expr: ExprIR): boolean {
  return expr.kind === "lit" && expr.value === null;
}

function inferUpdateFieldDomain(
  errors: string[],
  transitionId: string,
  expr: Extract<ExprIR, { kind: "updateField" }>,
  varsById: Map<string, StateVarDecl>,
): AbstractDomain | undefined {
  const targetDomain = inferExprDomain(
    errors,
    transitionId,
    expr.target,
    varsById,
  );
  if (!targetDomain || !Array.isArray(expr.path) || expr.path.length === 0)
    return targetDomain;
  const fieldDomain = domainAtPath(targetDomain, expr.path);
  if (!fieldDomain) {
    errors.push(
      `${transitionId}: updateField has invalid path ${expr.path.join(".")} for ${domainFingerprint(targetDomain)}`,
    );
    return targetDomain;
  }
  const valueDomain = inferExprDomain(
    errors,
    transitionId,
    expr.value,
    varsById,
  );
  if (valueDomain && !sameDomain(valueDomain, fieldDomain)) {
    errors.push(
      `${transitionId}: updateField ${expr.path.join(".")} expects ${domainFingerprint(fieldDomain)} but got ${domainFingerprint(valueDomain)}`,
    );
  }
  return targetDomain;
}

function validateBooleanOperand(
  errors: string[],
  transitionId: string,
  context: string,
  expr: ExprIR,
  varsById: Map<string, StateVarDecl>,
): void {
  const domain = inferExprDomain(errors, transitionId, expr, varsById);
  if (domain && !isBoolDomain(domain))
    errors.push(
      `${transitionId}: ${context} expects boolean operand but got ${domainFingerprint(domain)}`,
    );
}

function isBoolDomain(domain: AbstractDomain): boolean {
  return domain.kind === "bool";
}

function sameDomain(left: AbstractDomain, right: AbstractDomain): boolean {
  return domainFingerprint(left) === domainFingerprint(right);
}

function validateExprReferences(
  errors: string[],
  transitionId: string,
  expr: ExprIR,
  varsById: Map<string, StateVarDecl>,
): void {
  walkExpr(expr, (node) => {
    if (node.kind === "read") {
      validateReadReference(errors, transitionId, node, varsById);
    }
    if ((node.kind === "eq" || node.kind === "neq") && node.args.length === 2) {
      validateReadLiteralComparison(
        errors,
        transitionId,
        node.args[0],
        node.args[1],
        varsById,
      );
      validateReadLiteralComparison(
        errors,
        transitionId,
        node.args[1],
        node.args[0],
        varsById,
      );
    }
    if (node.kind === "tagIs" && node.arg.kind === "read") {
      const decl = varsById.get(node.arg.var);
      if (
        decl?.domain.kind === "tagged" &&
        !Object.hasOwn(decl.domain.variants, node.tag)
      ) {
        errors.push(
          `${transitionId}: ${decl.id} references invalid tag ${node.tag}`,
        );
      }
    }
    if (node.kind === "freshToken") {
      const decl = varsById.get(node.domainOf);
      if (!decl)
        errors.push(
          `${transitionId}: freshToken domainOf references unknown var ${node.domainOf}`,
        );
      else if (decl.domain.kind !== "tokens")
        errors.push(
          `${transitionId}: freshToken domainOf ${node.domainOf} must reference a tokens var`,
        );
    }
  });
}

function validateReadReference(
  errors: string[],
  transitionId: string,
  read: Extract<ExprIR, { kind: "read" }>,
  varsById: Map<string, StateVarDecl>,
): void {
  const decl = varsById.get(read.var);
  if (!decl) {
    errors.push(`${transitionId}: expression reads unknown var ${read.var}`);
    return;
  }
  const path = read.path ?? [];
  if (path.length > 0 && !domainAtPath(decl.domain, path)) {
    errors.push(
      `${transitionId}: ${decl.id} has invalid read path ${path.join(".")}`,
    );
  }
}

function validateReadLiteralComparison(
  errors: string[],
  transitionId: string,
  left: ExprIR,
  right: ExprIR,
  varsById: Map<string, StateVarDecl>,
): void {
  if (left.kind !== "read" || right.kind !== "lit") return;
  const decl = varsById.get(left.var);
  if (!decl) return;
  const domain = domainAtPath(decl.domain, left.path ?? []);
  if (
    domain?.kind === "enum" &&
    typeof right.value === "string" &&
    !domain.values.includes(right.value)
  ) {
    errors.push(
      `${transitionId}: ${decl.id} references invalid enum value ${right.value}`,
    );
  }
  if (
    domain?.kind === "tagged" &&
    typeof right.value === "object" &&
    right.value !== null &&
    !Array.isArray(right.value)
  ) {
    const tag = (right.value as Record<string, Value>)[domain.tag];
    if (typeof tag === "string" && !Object.hasOwn(domain.variants, tag)) {
      errors.push(`${transitionId}: ${decl.id} references invalid tag ${tag}`);
    }
  }
}

function domainAtPath(
  domain: AbstractDomain,
  path: readonly string[],
): AbstractDomain | undefined {
  let current: AbstractDomain | undefined = domain;
  for (const segment of path) {
    if (!current) return undefined;
    while (current.kind === "option") current = current.inner;
    if (current.kind === "record") current = current.fields[segment];
    else if (current.kind === "boundedList") {
      if (!/^\d+$/.test(segment)) current = undefined;
      else {
        const index = Number(segment);
        current =
          index >= 0 && index < current.maxLen ? current.inner : undefined;
      }
    } else if (current.kind === "tagged")
      current =
        segment === current.tag
          ? { kind: "enum", values: Object.keys(current.variants) }
          : undefined;
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
    default:
      return [];
  }
}

function union(sets: readonly Set<string>[]): Set<string> {
  const out = new Set<string>();
  for (const set of sets) for (const value of set) out.add(value);
  return out;
}
