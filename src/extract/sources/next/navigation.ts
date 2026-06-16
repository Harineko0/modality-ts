import type { NavIntent } from "modality-ts/extract/engine/spi";
import { normalizeRouteTarget } from "../../engine/ts/routes.js";

export type NextNavigationWarning = {
  kind: "model-slack" | "security-caveat";
  message: string;
};

export type NextNavClassification =
  | NavIntent
  | { kind: "refresh" }
  | { kind: "reload" }
  | { kind: "prefetch"; href?: string }
  | "unsupported";

const APP_ROUTER_CALLEES = new Set([
  "router.push",
  "router.replace",
  "router.back",
  "router.forward",
  "router.refresh",
  "router.prefetch",
  "redirect",
  "permanentRedirect",
]);

const PAGES_ROUTER_CALLEES = new Set([
  "router.push",
  "router.replace",
  "router.back",
  "router.forward",
  "router.reload",
  "router.prefetch",
  "router.beforePopState",
]);

export function classifyNextNavigationCall(
  callee: string,
  args: readonly unknown[],
  routePatterns: readonly string[] = [],
): {
  classification: NextNavClassification;
  warnings: NextNavigationWarning[];
} {
  const warnings: NextNavigationWarning[] = [];

  if (callee.endsWith(".forward") || callee === "go") {
    return { classification: "unsupported", warnings };
  }

  if (callee.endsWith(".beforePopState")) {
    warnings.push({
      kind: "model-slack",
      message:
        "router.beforePopState customizes back navigation; back transitions are over-approximated",
    });
    return { classification: { mode: "back" }, warnings };
  }

  if (callee.endsWith(".refresh") || callee === "refresh") {
    return { classification: { kind: "refresh" }, warnings };
  }

  if (callee.endsWith(".reload")) {
    return { classification: { kind: "reload" }, warnings };
  }

  if (callee.endsWith(".prefetch")) {
    const href = resolveNavigationTarget(args[0], routePatterns, warnings);
    return { classification: { kind: "prefetch", href }, warnings };
  }

  if (callee.endsWith(".back") && args.length === 0) {
    return { classification: { mode: "back" }, warnings };
  }

  if (
    callee === "redirect" ||
    callee === "permanentRedirect" ||
    callee.endsWith(".replace")
  ) {
    const target = resolveNavigationTarget(args[0], routePatterns, warnings);
    if (!target) return { classification: "unsupported", warnings };
    return { classification: { mode: "replace", to: target }, warnings };
  }

  if (callee.endsWith(".push") || callee === "navigate") {
    const target = resolveNavigationTarget(args[0], routePatterns, warnings);
    if (!target) return { classification: "unsupported", warnings };
    const replace =
      args.length >= 2 && isReplaceOptions(args[1]) ? true : undefined;
    if (callee === "navigate" && replace) {
      return { classification: { mode: "replace", to: target }, warnings };
    }
    return { classification: { mode: "push", to: target }, warnings };
  }

  if (
    !APP_ROUTER_CALLEES.has(callee) &&
    !PAGES_ROUTER_CALLEES.has(callee) &&
    !callee.endsWith(".push") &&
    !callee.endsWith(".replace")
  ) {
    return { classification: "unsupported", warnings };
  }

  return { classification: "unsupported", warnings };
}

export function classifyNavigationCall(
  callee: string,
  args: readonly unknown[],
): NavIntent | "unsupported" {
  const { classification } = classifyNextNavigationCall(callee, args);
  if (classification === "unsupported") return "unsupported";
  if ("kind" in classification) return "unsupported";
  return classification;
}

export function classifyNavigationJsx(
  tag: string,
  attrs: ReadonlyMap<string, unknown>,
  routePatterns: readonly string[] = [],
): NavIntent | "unsupported" {
  const { classification } = classifyNextNavigationJsx(
    tag,
    attrs,
    routePatterns,
  );
  if (classification === "unsupported") return "unsupported";
  if ("kind" in classification) return "unsupported";
  return classification;
}

export function classifyNextNavigationJsx(
  tag: string,
  attrs: ReadonlyMap<string, unknown>,
  routePatterns: readonly string[] = [],
): {
  classification: NextNavClassification;
  warnings: NextNavigationWarning[];
} {
  const warnings: NextNavigationWarning[] = [];

  if (tag !== "Link") {
    return { classification: "unsupported", warnings };
  }

  const href = attrs.get("href");
  if (typeof href === "string") {
    const target = resolveHrefTarget(href, routePatterns, warnings);
    if (!target) return { classification: "unsupported", warnings };
    const replace = attrs.has("replace");
    return {
      classification: {
        mode: replace ? "replace" : "push",
        to: target,
      },
      warnings,
    };
  }

  if (href !== undefined) {
    warnings.push({
      kind: "model-slack",
      message:
        "Dynamic Link href over-approximates to known route patterns for navigation",
    });
    const overApprox = overApproximateRouteTarget(routePatterns);
    if (!overApprox) return { classification: "unsupported", warnings };
    return {
      classification: { mode: "push", to: overApprox },
      warnings,
    };
  }

  return { classification: "unsupported", warnings };
}

export function resolveNavigationTarget(
  value: unknown,
  routePatterns: readonly string[],
  warnings: NextNavigationWarning[] = [],
): string | undefined {
  if (typeof value === "string") {
    return resolveHrefTarget(value, routePatterns, warnings);
  }

  if (!isRecord(value)) return undefined;

  const pathname = value.pathname;
  if (typeof pathname !== "string") {
    warnings.push({
      kind: "model-slack",
      message: "Dynamic navigation target over-approximates to known routes",
    });
    return overApproximateRouteTarget(routePatterns);
  }

  const pattern = pagesPathnameToPattern(pathname, value.query);
  return normalizeRouteTarget(pattern, routePatterns);
}

function resolveHrefTarget(
  href: string,
  routePatterns: readonly string[],
  warnings: NextNavigationWarning[],
): string | undefined {
  if (isExternalUrl(href)) return undefined;
  if (isJavascriptUrl(href)) {
    warnings.push({
      kind: "security-caveat",
      message: `Unsanitized javascript: navigation target "${href}" is a security risk`,
    });
    return undefined;
  }
  return normalizeRouteTarget(href, routePatterns);
}

function pagesPathnameToPattern(pathname: string, query: unknown): string {
  let pattern = pathname
    .replace(/\[\[\.\.\.([^\]]+)\]\]/g, "*")
    .replace(/\[\.\.\.([^\]]+)\]/g, "*")
    .replace(/\[([^\]]+)\]/g, ":$1");

  if (isRecord(query)) {
    for (const [key, value] of Object.entries(query)) {
      if (typeof value !== "string" && typeof value !== "number") continue;
      pattern = pattern.replace(`:${key}`, String(value));
    }
  }

  return pattern;
}

function overApproximateRouteTarget(
  routePatterns: readonly string[],
): string | undefined {
  const uiRoutes = routePatterns.filter((pattern) => pattern !== "/api");
  return uiRoutes[0];
}

function isExternalUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("/");
}

function isJavascriptUrl(url: string): boolean {
  return /^javascript:/i.test(url.trim());
}

function isReplaceOptions(value: unknown): value is { replace: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "replace" in value &&
    (value as { replace: unknown }).replace === true
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
