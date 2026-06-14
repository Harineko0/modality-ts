import type { AbstractDomain, ExprIR, Model } from "modality-ts/core";

export function taggedDomainForExpr(model: Model, expr: ExprIR): Extract<AbstractDomain, { kind: "tagged" }> | undefined {
  const domain = domainForExpr(model, expr);
  return domain?.kind === "tagged" ? domain : undefined;
}

function domainForExpr(model: Model, expr: ExprIR): AbstractDomain | undefined {
  switch (expr.kind) {
    case "read": {
      const decl = model.vars.find((candidate) => candidate.id === expr.var);
      return decl ? domainAtPath(decl.domain, expr.path ?? []) : undefined;
    }
    case "cond": {
      const thenDomain = domainForExpr(model, expr.args[1]);
      const elseDomain = domainForExpr(model, expr.args[2]);
      return thenDomain && elseDomain && JSON.stringify(thenDomain) === JSON.stringify(elseDomain) ? thenDomain : undefined;
    }
    case "updateField":
      return domainForExpr(model, expr.target);
    default:
      return undefined;
  }
}

function domainAtPath(domain: AbstractDomain, path: readonly string[]): AbstractDomain | undefined {
  let current: AbstractDomain | undefined = domain;
  for (const segment of path) {
    if (!current) return undefined;
    while (current.kind === "option") current = current.inner;
    if (current.kind === "record") current = current.fields[segment];
    else if (current.kind === "boundedList") {
      if (!/^\d+$/.test(segment)) return undefined;
      const index = Number(segment);
      current = index >= 0 && index < current.maxLen ? current.inner : undefined;
    } else if (current.kind === "tagged") {
      current = segment === current.tag ? { kind: "enum", values: Object.keys(current.variants) } : undefined;
    } else return undefined;
  }
  return current;
}
