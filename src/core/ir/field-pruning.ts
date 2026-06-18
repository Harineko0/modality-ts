import { collectRecordDomainFieldPaths } from "./domains.js";
import type {
  AbstractDomain,
  EffectIR,
  ExprIR,
  FieldPruningEntry,
  FieldPruningMetadata,
  Model,
  Property,
  SourceAnchor,
  StateVarDecl,
} from "./types.js";

export type FieldPath = readonly string[];

function pathKey(path: readonly string[]): string {
  return path.join("\0");
}

function sortPaths(paths: readonly (readonly string[])[]): readonly string[][] {
  return [...paths]
    .map((path) => [...path])
    .sort((left, right) => pathKey(left).localeCompare(pathKey(right)));
}

export function domainPathAt(
  domain: AbstractDomain,
  path: FieldPath,
): AbstractDomain | undefined {
  let current = domain;
  for (const segment of path) {
    if (segment === "[]") {
      if (current.kind !== "boundedList") return undefined;
      current = current.inner;
      continue;
    }
    if (segment.startsWith("#")) {
      if (current.kind !== "tagged") return undefined;
      current = current.variants[segment.slice(1)];
      if (!current) return undefined;
      continue;
    }
    if (current.kind !== "record") return undefined;
    current = current.fields[segment];
    if (!current) return undefined;
  }
  return current;
}

export function collectExprReadFieldPaths(
  expr: ExprIR,
  varId?: string,
): readonly FieldPath[] {
  const paths: FieldPath[] = [];
  const walk = (node: ExprIR): void => {
    switch (node.kind) {
      case "read":
      case "readPre":
        if (varId !== undefined && node.var !== varId) break;
        if (node.path && node.path.length > 0) paths.push([...node.path]);
        break;
      case "eq":
      case "neq":
      case "and":
      case "or":
        for (const arg of node.args) walk(arg);
        break;
      case "not":
        walk(node.args[0]);
        break;
      case "cond":
        for (const arg of node.args) walk(arg);
        break;
      case "updateField":
        walk(node.target);
        walk(node.value);
        break;
      case "tagIs":
        walk(node.arg);
        break;
      case "lenCat":
        walk(node.arg);
        break;
      case "lt":
      case "lte":
      case "gt":
      case "gte":
      case "add":
      case "sub":
      case "mod":
        walk(node.args[0]);
        walk(node.args[1]);
        break;
      case "lit":
      case "readOpArg":
      case "transitionEnabled":
      case "transitionEnabledPrefix":
      case "freshToken":
        break;
    }
  };
  walk(expr);
  return sortPaths(paths);
}

export function collectUpdateFieldPaths(expr: ExprIR): readonly FieldPath[] {
  const paths: FieldPath[] = [];
  const walk = (node: ExprIR, prefix: FieldPath): void => {
    switch (node.kind) {
      case "updateField": {
        const next = [...prefix, ...node.path];
        paths.push(next);
        walk(node.target, prefix);
        walk(node.value, prefix);
        break;
      }
      case "eq":
      case "neq":
      case "and":
      case "or":
        for (const arg of node.args) walk(arg, prefix);
        break;
      case "not":
        walk(node.args[0], prefix);
        break;
      case "cond":
        for (const arg of node.args) walk(arg, prefix);
        break;
      case "tagIs":
        walk(node.arg, prefix);
        break;
      case "lenCat":
        walk(node.arg, prefix);
        break;
      case "lt":
      case "lte":
      case "gt":
      case "gte":
      case "add":
      case "sub":
      case "mod":
        walk(node.args[0], prefix);
        walk(node.args[1], prefix);
        break;
      case "lit":
      case "read":
      case "readPre":
      case "readOpArg":
      case "transitionEnabled":
      case "transitionEnabledPrefix":
      case "freshToken":
        break;
    }
  };
  walk(expr, []);
  return sortPaths(paths);
}

export function exprReadsWholeVar(expr: ExprIR, varId: string): boolean {
  let whole = false;
  const walk = (node: ExprIR): void => {
    switch (node.kind) {
      case "read":
      case "readPre":
        if (node.var === varId && (!node.path || node.path.length === 0)) {
          whole = true;
        }
        break;
      case "eq":
      case "neq":
      case "and":
      case "or":
        for (const arg of node.args) walk(arg);
        break;
      case "not":
        walk(node.args[0]);
        break;
      case "cond":
        for (const arg of node.args) walk(arg);
        break;
      case "updateField":
        walk(node.target);
        walk(node.value);
        break;
      case "tagIs":
        walk(node.arg);
        break;
      case "lenCat":
        walk(node.arg);
        break;
      case "lt":
      case "lte":
      case "gt":
      case "gte":
      case "add":
      case "sub":
      case "mod":
        walk(node.args[0]);
        walk(node.args[1]);
        break;
      case "lit":
      case "readOpArg":
      case "transitionEnabled":
      case "transitionEnabledPrefix":
      case "freshToken":
        break;
    }
  };
  walk(expr);
  return whole;
}

function collectEffectFieldPaths(
  effect: EffectIR,
  varId: string,
): { reads: FieldPath[]; writes: FieldPath[]; wholeRead: boolean } {
  const reads: FieldPath[] = [];
  const writes: FieldPath[] = [];
  let wholeRead = false;
  const walk = (node: EffectIR): void => {
    switch (node.kind) {
      case "assign":
        if (node.var === varId) {
          writes.push(...collectUpdateFieldPaths(node.expr));
          if (node.expr.kind === "read" && node.expr.var === varId) {
            if (!node.expr.path || node.expr.path.length === 0)
              wholeRead = true;
            else reads.push([...node.expr.path]);
          }
        }
        reads.push(...collectExprReadFieldPaths(node.expr, varId));
        if (exprReadsWholeVar(node.expr, varId)) wholeRead = true;
        break;
      case "choose":
        for (const option of node.among) {
          reads.push(...collectExprReadFieldPaths(option, varId));
          if (exprReadsWholeVar(option, varId)) wholeRead = true;
        }
        break;
      case "if":
        reads.push(...collectExprReadFieldPaths(node.cond, varId));
        if (exprReadsWholeVar(node.cond, varId)) wholeRead = true;
        walk(node.then);
        walk(node.else);
        break;
      case "enqueue":
        for (const arg of Object.values(node.args)) {
          reads.push(...collectExprReadFieldPaths(arg, varId));
          if (exprReadsWholeVar(arg, varId)) wholeRead = true;
        }
        break;
      case "seq":
        for (const child of node.effects) walk(child);
        break;
      case "havoc":
      case "dequeue":
      case "opaque":
        break;
    }
  };
  walk(effect);
  return { reads, writes, wholeRead };
}

function collectModelVarFieldUsage(
  model: Model,
  varId: string,
): { kept: readonly string[][]; wholeRead: boolean; source?: SourceAnchor } {
  const kept = new Set<string>();
  let wholeRead = false;
  let source: SourceAnchor | undefined;
  const addPaths = (paths: readonly FieldPath[]): void => {
    for (const path of paths) kept.add(pathKey(path));
  };
  for (const decl of model.vars) {
    if (decl.scope.kind === "mount-local") {
      const paths = collectExprReadFieldPaths(decl.scope.when, varId);
      addPaths(paths);
      if (exprReadsWholeVar(decl.scope.when, varId)) wholeRead = true;
    }
  }
  for (const transition of model.transitions) {
    const guardPaths = collectExprReadFieldPaths(transition.guard, varId);
    addPaths(guardPaths);
    if (exprReadsWholeVar(transition.guard, varId)) wholeRead = true;
    const effectUsage = collectEffectFieldPaths(transition.effect, varId);
    addPaths(effectUsage.reads);
    addPaths(effectUsage.writes);
    if (effectUsage.wholeRead) wholeRead = true;
    if ((guardPaths.length > 0 || effectUsage.reads.length > 0) && !source) {
      source = transition.source[0];
    }
  }
  return {
    kept: sortPaths(
      [...kept].map((key) => key.split("\0").filter((part) => part.length > 0)),
    ),
    wholeRead,
    source,
  };
}

function entryForRecordVar(
  decl: StateVarDecl,
  model: Model,
): FieldPruningEntry | undefined {
  if (decl.domain.kind !== "record") return undefined;
  const domainPaths = collectRecordDomainFieldPaths(decl.domain);
  if (domainPaths.length === 0) return undefined;
  const usage = collectModelVarFieldUsage(model, decl.id);
  const keptPaths = usage.wholeRead ? [...domainPaths] : [...usage.kept];
  const keptKeys = new Set(keptPaths.map(pathKey));
  const prunedPaths = domainPaths
    .filter((path) => !keptKeys.has(pathKey(path)))
    .map((path) => [...path]);
  if (prunedPaths.length === 0) return undefined;
  const hasTokenPruned = prunedPaths.some((path) => {
    const fieldDomain = domainPathAt(decl.domain, path);
    return fieldDomain?.kind === "tokens";
  });
  return {
    varId: decl.id,
    keptPaths: keptPaths.map((path) => [...path]),
    prunedPaths,
    reason: "unread",
    ...(usage.source ? { source: usage.source } : {}),
    confidence: usage.wholeRead || hasTokenPruned ? "over-approx" : "exact",
  };
}

export function buildFieldPruningMetadata(model: Model): FieldPruningMetadata {
  const entries = model.vars
    .map((decl) => entryForRecordVar(decl, model))
    .filter((entry): entry is FieldPruningEntry => entry !== undefined)
    .sort((left, right) => left.varId.localeCompare(right.varId));
  return { entries };
}

function propertyPredicates(property: Property): readonly ExprIR[] {
  switch (property.kind) {
    case "always":
    case "reachable":
      return [property.predicate];
    case "reachableFrom":
      return [property.when, property.goal];
    case "alwaysStep":
      if ("step" in property.predicate) {
        const preds: ExprIR[] = [];
        if (property.predicate.pre) preds.push(property.predicate.pre);
        if (property.predicate.post) preds.push(property.predicate.post);
        return preds;
      }
      return [];
    case "leadsToWithin":
      return [property.goal];
  }
}

export function propertyPrunedFieldPaths(
  model: Model,
  property: Property,
): Map<string, readonly string[][]> {
  const result = new Map<string, readonly string[][]>();
  const reads = new Set(property.reads ?? []);
  for (const entry of model.metadata?.fieldPruning?.entries ?? []) {
    if (!reads.has(entry.varId)) continue;
    const kept = new Set<string>();
    for (const predicate of propertyPredicates(property)) {
      const paths = collectExprReadFieldPaths(predicate, entry.varId);
      for (const path of paths) kept.add(pathKey(path));
      if (exprReadsWholeVar(predicate, entry.varId)) {
        for (const domainPath of entry.keptPaths) kept.add(pathKey(domainPath));
      }
    }
    const pruned = entry.prunedPaths.filter((path) => !kept.has(pathKey(path)));
    if (pruned.length > 0) result.set(entry.varId, pruned);
  }
  return result;
}

export function prunedFieldPathsForSlice(
  full: Model,
  slice: Model,
  properties: readonly Property[],
): Map<string, readonly string[][]> {
  const sliceVarIds = new Set(slice.vars.map((decl) => decl.id));
  const merged = new Map<string, string[][]>();
  for (const property of properties) {
    for (const [varId, paths] of propertyPrunedFieldPaths(full, property)) {
      if (!sliceVarIds.has(varId)) continue;
      const existing = merged.get(varId) ?? [];
      const keys = new Set(existing.map(pathKey));
      for (const path of paths) {
        const key = pathKey(path);
        if (keys.has(key)) continue;
        keys.add(key);
        existing.push([...path]);
      }
      merged.set(varId, existing);
    }
  }
  for (const [varId, paths] of merged) {
    merged.set(varId, sortPaths(paths) as string[][]);
  }
  return merged;
}
