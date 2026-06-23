import type { ExprIR, StateVarScope } from "modality-ts/core";

export function routeMountScope(
  routePattern: string | undefined,
): StateVarScope {
  return {
    kind: "mount-local",
    id: `route:${routePattern ?? "<unknown>"}`,
    when: routeMountGuard(routePattern),
  };
}

export function routeMountGuard(routePattern: string | undefined): ExprIR {
  return routePattern
    ? {
        kind: "eq",
        args: [
          { kind: "read", var: "sys:route" },
          { kind: "lit", value: routePattern },
        ],
      }
    : { kind: "lit", value: true };
}

export function routeMountReads(routePattern: string | undefined): string[] {
  return routePattern
    ? ["sys:history", "sys:route"]
    : ["sys:route", "sys:history"];
}

export function normalizeRouteTarget(
  target: string,
  routePatterns: readonly string[],
): string {
  const withoutQuery = target.split(/[?#]/)[0] || "/";
  const slash = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;
  const matched = [...routePatterns]
    .sort(
      (left, right) =>
        routePatternSpecificity(right) - routePatternSpecificity(left),
    )
    .find((pattern) => routePatternMatches(pattern, slash));
  return matched ?? slash.replace(/\/:param(?=\/|$)/g, "/:id");
}

function routePatternSpecificity(pattern: string): number {
  return pattern
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && !part.startsWith(":") && part !== "*").length;
}

function routePatternMatches(pattern: string, target: string): boolean {
  const left = pattern.replace(/^\/+/, "").split("/");
  const right = target.replace(/^\/+/, "").split("/");
  if (left.length !== right.length) return false;
  return left.every((part, index) => {
    const targetPart = right[index];
    if (targetPart === ":param") return part.startsWith(":") || part === "*";
    return part.startsWith(":") || part === "*" || part === targetPart;
  });
}
